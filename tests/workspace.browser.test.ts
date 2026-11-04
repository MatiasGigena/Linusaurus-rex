import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";
import type { RendererContext } from "../src/shared/types";

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspace} from '/src/hooks/useWorkspace.ts';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import {createWorkspaceActions} from '/src/workspace/actions/createWorkspaceActions.ts';
import{WorkspaceDialogController}from'/src/workspace/dialogs.ts';
const dialogs=new WorkspaceDialogController();
let workspace,setVisible,nextId=0;
let settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'one',label:'Host one',endpoint:'unix:///one.sock'}],lastSelection:{hostId:'one',sessionId:'s',windowId:'w'}};
const listeners=new Set(),calls=[],requests=[];
window.fixture={calls,
 pending(){return requests.filter(request=>!request.settled).map(({id,method,args})=>({id,method,args}));},
 fail(id,message,code='permission_denied'){const request=requests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing pending request '+id);request.settled=true;const error=Object.assign(new Error(message),{code,method:request.method});window.fixture.lastFailure=error;request.reject(error);},
 complete(id,value){const request=requests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing pending request '+id);request.settled=true;request.resolve(value);},
 refresh(){void workspace.refresh();},select(hostId,sessionId,windowId,blockId){workspace.select(hostId,sessionId,windowId,blockId);},reload(hostId,sessionId){void workspace.reloadSession(hostId,sessionId).catch(error=>{(window.fixture.reloadErrors??=[]).push(error.message);});},
 reloadAfterResize(){const reload=workspace.reloadSession;window.fixture.reloadResult='pending';void window.rex.request('resizeDivider',{hostId:'one',sessionId:'s',beforeBlockId:'before',afterBlockId:'after',direction:'horizontal',ratio:0.5}).then(()=>reload('one','s')).then(()=>{window.fixture.reloadResult='complete';},error=>{window.fixture.reloadResult=error.message;});},
 mutate(){window.fixture.mutation='pending';void workspace.operations.mutateSession({hostId:'one',sessionId:'s',selectActive:true},()=>window.rex.request('renameWindow',{hostId:'one',sessionId:'s',windowId:'w',label:'Updated'})).then(value=>{window.fixture.mutation='complete';window.fixture.completed=value;},error=>{window.fixture.mutation=error.message;window.fixture.failureIdentity=error===window.fixture.lastFailure;window.fixture.failureCause=error.cause===window.fixture.lastFailure;window.fixture.failureCode=error.code;window.fixture.failureMethod=error.method;});},
 mutateTarget(sessionId,key){(window.fixture.mutations??={})[key]='pending';void workspace.operations.mutateSession({hostId:'one',sessionId},()=>window.rex.request('renameWindow',{hostId:'one',sessionId,windowId:'w',label:key})).then(()=>{window.fixture.mutations[key]='complete';},error=>{window.fixture.mutations[key]=error.message;});},
 mutateHostAndRefresh(){window.fixture.mutation='pending';void workspace.operations.mutateHostAndRefresh('one',()=>window.rex.request('renameWindow',{hostId:'one',sessionId:'s',windowId:'w',label:'Updated'})).then(()=>{window.fixture.mutation='complete';},error=>{window.fixture.mutation=error.message;window.fixture.failureIdentity=error===window.fixture.lastFailure;window.fixture.failureCause=error.cause===window.fixture.lastFailure;window.fixture.failureCode=error.code;window.fixture.failureMethod=error.method;});},
 dispatch(name,args={}){const noop=()=>{};const execute=createWorkspaceActions({dialogs,workspace:workspace.operations,settings,hosts:workspace.hosts,views:workspace.views,selection:workspace.selection,keymaps:workspace.keymaps,focusedPane:workspace.focusedPane,workspaceElement:{current:null},setCollapsedSessions:noop,setActivityOnly:noop,setActivityOpen:noop,setActivityGroup:noop});window.fixture.mutation='pending';void execute(name,args).then(value=>{window.fixture.mutation='complete';window.fixture.completed=value;},error=>{window.fixture.mutation=error.message;window.fixture.failureCause=error.cause===window.fixture.lastFailure;window.fixture.failureCode=error.code;window.fixture.failureMethod=error.method;});},
 preferences(patch){settings={...settings,...patch};for(const listener of listeners)listener({type:'settings',settings});},
 changeHosts(hosts){settings={...settings,hosts};for(const listener of listeners)listener({type:'settings',settings});},
 visibility(hidden){Object.defineProperty(document,'hidden',{configurable:true,value:hidden});document.dispatchEvent(new Event('visibilitychange'));},
 report(message){workspace.setError(message);},
 status(hostId,connected){for(const listener of listeners)listener({type:'status',hostId,connected});},
 unmount(){setVisible(false);}
};
window.rex={
 getSettings:async()=>settings,
 setSettings:async(next)=>{calls.push({method:'setSettings'});settings=next;return next;},
 onClientEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
 request(method,args){const id=++nextId;calls.push({id,method,args});if(method==='setContext'&&!window.fixture.deferContexts)return Promise.resolve();if(method==='keymap'&&!window.fixture.deferKeymaps)return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});return new Promise((resolve,reject)=>requests.push({id,method,args,resolve,reject,settled:false}));}
};
function WorkspaceFixture(){const state=useWorkspace();workspace=state;return React.createElement('pre',{id:'workspace-state'},JSON.stringify({settingsHosts:state.settings?.hosts.map(host=>host.id),hosts:state.hosts.map(host=>host.id),views:Object.fromEntries(Object.entries(state.views).map(([key,view])=>[key,view.label])),hostErrors:Object.fromEntries(state.hosts.map(host=>[host.id,host.error])),connected:Object.fromEntries(state.hosts.map(host=>[host.id,host.connected])),keymapHosts:Object.keys(state.keymaps),selection:state.selection,focusedPane:state.focusedPane,sessions:Object.fromEntries(state.hosts.map(host=>[host.id,host.sessions.map(session=>session.label)])),busy:state.busy,loading:state.loading,error:state.error}));}
function Root(){const[visible,show]=React.useState(true);setVisible=show;return visible?React.createElement(WorkspaceFixture):React.createElement('p',null,'Workspace unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Root));
`;
interface PendingRequest {
  id: number;
  method: string;
  args: { hostId?: string; sessionId?: string } & RendererContext;
}
interface WorkspaceFixtureWindow {
  fixture: {
    calls: PendingRequest[];
    deferKeymaps?: boolean;
    deferContexts?: boolean;
    visibility(hidden: boolean): void;
    report(message: string): void;
    mutation?: string;
    failureIdentity?: boolean;
    failureCause?: boolean;
    failureCode?: string;
    failureMethod?: string;
    fail(id: number, message: string, code?: string): void;
    dispatch(name: string, args?: Record<string, unknown>): void;
    preferences(patch: Record<string, unknown>): void;
    pending(): PendingRequest[];
    complete(id: number, value: unknown): void;
    refresh(): void;
    mutateHostAndRefresh(): void;
    mutate(): void;
    mutateTarget(sessionId: string, key: string): void;
    mutations?: Record<string, string>;
    reload(hostId: string, sessionId: string): void;
    select(
      hostId: string,
      sessionId: string,
      windowId?: string,
      blockId?: string,
    ): void;
    reloadAfterResize(): void;
    reloadResult?: string;
    changeHosts(hosts: { id: string; label: string; endpoint: string }[]): void;
    status(hostId: string, connected: boolean): void;
    unmount(): void;
  };
}
interface WorkspaceSnapshot {
  settingsHosts?: string[];
  hosts: string[];
  views: Record<string, string>;
  keymapHosts: string[];
  loading: boolean;
  busy: boolean;
  error?: string;
  hostErrors: Record<string, string | undefined>;
  connected: Record<string, boolean>;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function pending(
  page: Page,
  method: string,
  hostId: string,
  except?: number,
): Promise<number> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ method, hostId, except }) =>
          (window as unknown as WorkspaceFixtureWindow).fixture
            .pending()
            .filter(
              (request) =>
                request.method === method &&
                request.args.hostId === hostId &&
                request.id !== except,
            ).length,
        { method, hostId, except },
      ),
    )
    .toBeGreaterThan(0);
  const id = await page.evaluate(
    ({ method, hostId, except }) =>
      (window as unknown as WorkspaceFixtureWindow).fixture
        .pending()
        .find(
          (request) =>
            request.method === method &&
            request.args.hostId === hostId &&
            request.id !== except,
        )?.id,
    { method, hostId, except },
  );
  if (id === undefined)
    throw new Error("The expected workspace request is no longer pending.");
  return id;
}
async function complete(page: Page, id: number, value: unknown) {
  await page.evaluate(
    ({ id, value }) =>
      (window as unknown as WorkspaceFixtureWindow).fixture.complete(id, value),
    { id, value },
  );
}
function view(id: string, label: string) {
  return {
    id,
    label,
    activeWindowId: "w",
    windows: [
      {
        id: "w",
        label: "Terminal",
        focusedBlockId: "b",
        panes: [{ id: "b", label: "Terminal", rect: [0, 0, 1, 1] }],
      },
    ],
  };
}
async function startInspection(page: Page, hostId = "one", sessionId = "s") {
  await complete(page, await pending(page, "status", hostId), {
    connected: true,
  });
  await complete(page, await pending(page, "listSessions", hostId), [
    { id: sessionId, label: "Session" },
  ]);
  return pending(page, "inspectSession", hostId);
}
async function snapshot(page: Page): Promise<WorkspaceSnapshot> {
  return JSON.parse(
    await page.locator("#workspace-state").innerText(),
  ) as WorkspaceSnapshot;
}
async function nextFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

test(
  "overlapping workspace refreshes preserve a later reload and coalesce into one converging refresh",
  options,
  async () => {
    await withBrowserFixture("workspace-ordering", source, async (page) => {
      const old = await startInspection(page);
      await page.evaluate(() =>
        (window as unknown as WorkspaceFixtureWindow).fixture.reload(
          "one",
          "s",
        ),
      );
      const fresh = await pending(page, "inspectSession", "one", old);
      await complete(page, fresh, view("s", "Newer session reload"));
      await expect
        .poll(async () => (await snapshot(page)).views["one/s"])
        .toBe("Newer session reload");
      await page.evaluate(() => {
        const fixture = (window as unknown as WorkspaceFixtureWindow).fixture;
        fixture.refresh();
        fixture.refresh();
      });
      await complete(page, old, view("s", "Stale refresh"));
      const convergence = await pending(page, "status", "one");
      assert.equal(
        (await snapshot(page)).views["one/s"],
        "Newer session reload",
      );
      await complete(page, convergence, { connected: true });
      await complete(page, await pending(page, "listSessions", "one"), [
        { id: "s", label: "Session" },
      ]);
      await complete(
        page,
        await pending(page, "inspectSession", "one"),
        view("s", "Converged session"),
      );
      await expect
        .poll(async () => (await snapshot(page)).views["one/s"])
        .toBe("Converged session");
      await expect.poll(async () => (await snapshot(page)).loading).toBe(false);
      assert.equal(
        await page.evaluate(
          () =>
            (window as unknown as WorkspaceFixtureWindow).fixture.calls.filter(
              (call) => call.method === "status",
            ).length,
        ),
        2,
      );
    });
  },
);

test(
  "a host configuration change discards stale snapshots and prevents follow-up RPCs to the removed host",
  options,
  async () => {
    await withBrowserFixture("workspace-hosts", source, async (page) => {
      const old = await startInspection(page);
      const marker = await page.evaluate(() => {
        const fixture = (window as unknown as WorkspaceFixtureWindow).fixture;
        const marker = fixture.calls.length;
        fixture.changeHosts([
          { id: "two", label: "Host two", endpoint: "unix:///two.sock" },
        ]);
        fixture.refresh();
        return marker;
      });
      await expect
        .poll(async () => (await snapshot(page)).settingsHosts)
        .toEqual(["two"]);
      await complete(page, old, view("s", "Removed host snapshot"));
      const fresh = await startInspection(page, "two", "new-session");
      await complete(page, fresh, view("new-session", "Current host snapshot"));
      await expect
        .poll(async () => (await snapshot(page)).hosts)
        .toEqual(["two"]);
      await expect
        .poll(async () => (await snapshot(page)).views)
        .toEqual({ "two/new-session": "Current host snapshot" });
      const laterCalls = await page.evaluate(
        (marker) =>
          (window as unknown as WorkspaceFixtureWindow).fixture.calls.slice(
            marker,
          ),
        marker,
      );
      assert.equal(
        laterCalls.some((call) => call.args?.hostId === "one"),
        false,
        "removed hosts must not receive late keymap or refresh RPCs",
      );
      assert.equal((await snapshot(page)).keymapHosts.includes("one"), false);
    });
  },
);

test(
  "workspace request completion after unmount starts no subsequent bridge work",
  options,
  async () => {
    for (const stage of ["status", "inspectSession"]) {
      await withBrowserFixture(
        `workspace-unmount-${stage.toLowerCase()}`,
        source,
        async (page) => {
          const held =
            stage === "status"
              ? await pending(page, "status", "one")
              : await startInspection(page);
          await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.unmount(),
          );
          await expect(page.getByText("Workspace unmounted")).toBeVisible();
          const calls = await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls
                .length,
          );
          await complete(
            page,
            held,
            stage === "status"
              ? { connected: true }
              : view("s", "Late completion"),
          );
          await nextFrame(page);
          assert.equal(
            await page.evaluate(
              () =>
                (window as unknown as WorkspaceFixtureWindow).fixture.calls
                  .length,
            ),
            calls,
            `${stage} completion must not initiate another RPC after unmount`,
          );
        },
      );
    }
  },
);

test(
  "a late keymap response cannot publish state for a host that has been removed",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-keymap-lifetime",
      source,
      async (page) => {
        const inspected = await startInspection(page);
        await page.evaluate(() => {
          (window as unknown as WorkspaceFixtureWindow).fixture.deferKeymaps =
            true;
        });
        await complete(page, inspected, view("s", "Initial host"));
        const keymap = await pending(page, "keymap", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.changeHosts([
            { id: "two", label: "Host two", endpoint: "unix:///two.sock" },
          ]),
        );
        await expect
          .poll(async () => (await snapshot(page)).settingsHosts)
          .toEqual(["two"]);
        await complete(page, keymap, {
          actions: [],
          bindings: [],
          modes: [],
          warnings: [],
        });
        await nextFrame(page);
        assert.equal((await snapshot(page)).keymapHosts.includes("one"), false);
      },
    );
  },
);

test(
  "targeted mutation completion reloads once, updates navigation and selection, and schedules no redundant refresh",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-mutation-completion",
      source,
      async (page) => {
        await page.clock.install();
        await complete(
          page,
          await startInspection(page),
          view("s", "Initial session"),
        );
        await expect
          .poll(async () => (await snapshot(page)).loading)
          .toBe(false);
        await page.evaluate("window.fixture.mutate()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        const inspected = await pending(page, "inspectSession", "one");
        assert.equal(await page.evaluate("window.fixture.mutation"), "pending");
        const updated = view("s", "Updated session");
        updated.activeWindowId = "active";
        updated.windows.push({
          ...updated.windows[0],
          id: "active",
          focusedBlockId: "focused",
          panes: [{ id: "focused", label: "New pane", rect: [0, 0, 1, 1] }],
        });
        await complete(page, inspected, updated);
        await expect
          .poll(() => page.evaluate("window.fixture.mutation"))
          .toBe("complete");
        await expect
          .poll(() =>
            page.evaluate(
              "JSON.parse(document.querySelector('#workspace-state').textContent).selection.windowId",
            ),
          )
          .toBe("active");
        assert.equal(
          await page.evaluate(
            "JSON.parse(document.querySelector('#workspace-state').textContent).focusedPane",
          ),
          "focused",
        );
        assert.deepEqual(
          await page.evaluate(
            "JSON.parse(document.querySelector('#workspace-state').textContent).sessions.one",
          ),
          ["Updated session"],
        );
        await page.clock.runFor(1000);
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='status').length",
          ),
          1,
        );
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='inspectSession').length",
          ),
          2,
        );
      },
    );
  },
);

test(
  "global mutation completion waits for an already-running refresh to converge",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-global-completion",
      source,
      async (page) => {
        await page.clock.install();
        const previous = await startInspection(page);
        await page.evaluate("window.fixture.mutateHostAndRefresh()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        await page.evaluate(
          () => new Promise<void>((resolve) => queueMicrotask(resolve)),
        );
        assert.equal(await page.evaluate("window.fixture.mutation"), "pending");
        await complete(page, previous, view("s", "Stale session"));
        const latest = await startInspection(page);
        assert.equal(await page.evaluate("window.fixture.mutation"), "pending");
        await complete(page, latest, view("s", "Reconciled session"));
        await expect
          .poll(() => page.evaluate("window.fixture.mutation"))
          .toBe("complete");
        await expect
          .poll(async () => (await snapshot(page)).views["one/s"])
          .toBe("Reconciled session");
        await page.clock.runFor(1000);
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='status').length",
          ),
          2,
        );
      },
    );
  },
);

test(
  "targeted mutation rejects an inspection from a replaced host endpoint without changing selection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-mutation-endpoint",
      source,
      async (page) => {
        await complete(
          page,
          await startInspection(page),
          view("s", "Initial session"),
        );
        await expect
          .poll(async () => (await snapshot(page)).loading)
          .toBe(false);
        await page.evaluate("window.fixture.mutate()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        const inspected = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.changeHosts([
            {
              id: "one",
              label: "Replacement endpoint",
              endpoint: "unix:///replacement.sock",
            },
          ]),
        );
        const stale = view("s", "Stale endpoint session");
        stale.activeWindowId = "stale-window";
        stale.windows[0].id = "stale-window";
        await complete(page, inspected, stale);
        await expect
          .poll(() => page.evaluate("window.fixture.mutation"))
          .toMatch(/host configuration changed/i);
        assert.equal(
          await page.evaluate(
            "JSON.parse(document.querySelector('#workspace-state').textContent).selection.windowId",
          ),
          "w",
        );
        assert.equal((await snapshot(page)).views["one/s"], "Initial session");
      },
    );
  },
);

for (const lifetime of ["unmount", "host removal"] as const) {
  test(
    `a resize completion after ${lifetime} cannot start a session inspection`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-late-reload-${lifetime.replace(" ", "-")}`,
        source,
        async (page) => {
          await complete(
            page,
            await startInspection(page),
            view("s", "Initial session"),
          );
          await expect
            .poll(async () => (await snapshot(page)).loading)
            .toBe(false);
          await page.evaluate(() =>
            (
              window as unknown as WorkspaceFixtureWindow
            ).fixture.reloadAfterResize(),
          );
          const resize = await pending(page, "resizeDivider", "one");
          if (lifetime === "unmount") {
            await page.evaluate(() =>
              (window as unknown as WorkspaceFixtureWindow).fixture.unmount(),
            );
            await expect(page.getByText("Workspace unmounted")).toBeVisible();
          } else {
            await page.evaluate(() =>
              (window as unknown as WorkspaceFixtureWindow).fixture.changeHosts(
                [],
              ),
            );
            await expect
              .poll(async () => (await snapshot(page)).settingsHosts)
              .toEqual([]);
          }
          const marker = await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls
                .length,
          );
          await complete(page, resize, undefined);
          await nextFrame(page);
          const lateCalls = await page.evaluate(
            (marker) =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls.slice(
                marker,
              ),
            marker,
          );
          assert.equal(
            lateCalls.filter((call) => call.method === "inspectSession").length,
            0,
            "a retained reload callback must reject before issuing another bridge request",
          );
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (window as unknown as WorkspaceFixtureWindow).fixture
                    .reloadResult,
              ),
            )
            .toMatch(
              lifetime === "unmount"
                ? /workspace.*closed/i
                : /host.*no longer configured/i,
            );
          if (lifetime === "unmount") assert.deepEqual(lateCalls, []);
        },
      );
    },
  );
}

async function initialWorkspace(page: Page) {
  await complete(
    page,
    await startInspection(page),
    view("s", "Last good session"),
  );
  await expect.poll(async () => (await snapshot(page)).loading).toBe(false);
}
async function fail(page: Page, id: number, message: string) {
  await page.evaluate(
    ({ id, message }) =>
      (window as unknown as WorkspaceFixtureWindow).fixture.fail(id, message),
    { id, message },
  );
}
async function mutationStatus(page: Page) {
  return page.evaluate(
    () => (window as unknown as WorkspaceFixtureWindow).fixture.mutation,
  );
}
async function assertReconciliationFailure(
  page: Page,
  message: string,
  method: string,
) {
  await expect
    .poll(() => mutationStatus(page))
    .toContain("The change completed, but refreshing the workspace failed:");
  assert.match((await mutationStatus(page)) || "", new RegExp(message));
  assert.deepEqual(
    await page.evaluate(() => {
      const fixture = (window as unknown as WorkspaceFixtureWindow).fixture;
      return {
        cause: fixture.failureCause,
        code: fixture.failureCode,
        method: fixture.failureMethod,
      };
    }),
    { cause: true, code: "permission_denied", method },
  );
  await expect
    .poll(async () => (await snapshot(page)).hostErrors.one)
    .toBe(message);
  assert.equal((await snapshot(page)).connected.one, false);
  assert.equal((await snapshot(page)).views["one/s"], "Last good session");
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
}

for (const stage of ["listSessions", "inspectSession"] as const) {
  test(
    `a completed host mutation rejects a deferred ${stage} failure and preserves the last good snapshot`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-failed-${stage.toLowerCase()}`,
        source,
        async (page) => {
          await initialWorkspace(page);
          await page.evaluate("window.fixture.mutateHostAndRefresh()");
          await complete(
            page,
            await pending(page, "renameWindow", "one"),
            undefined,
          );
          await complete(page, await pending(page, "status", "one"), {
            connected: true,
          });
          const listed = await pending(page, "listSessions", "one");
          let held = listed;
          if (stage === "inspectSession") {
            await complete(page, listed, [{ id: "s", label: "Session" }]);
            held = await pending(page, "inspectSession", "one");
          }
          assert.equal(await mutationStatus(page), "pending");
          await fail(page, held, `${stage} permission failure`);
          await assertReconciliationFailure(
            page,
            `${stage} permission failure`,
            stage,
          );
          // Recovery only retries reads, even though the mutation's result is no longer observable.
          await complete(
            page,
            await startInspection(page),
            view("s", "Recovered session"),
          );
          await expect
            .poll(async () => (await snapshot(page)).views["one/s"])
            .toBe("Recovered session");
          assert.equal(
            await page.evaluate(
              "window.fixture.calls.filter(call=>call.method==='renameWindow').length",
            ),
            1,
          );
        },
      );
    },
  );
}

test(
  "targeted session inspection failure rejects with cause and publishes the host error without replacing its view",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-failed-target-inspection",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate("window.fixture.mutate()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        const inspected = await pending(page, "inspectSession", "one");
        assert.equal(await mutationStatus(page), "pending");
        await fail(page, inspected, "Target inspection failed");
        await assertReconciliationFailure(
          page,
          "Target inspection failed",
          "inspectSession",
        );
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='renameWindow').length",
          ),
          1,
        );
      },
    );
  },
);

test(
  "an action rejection remains primary when read-only background recovery also fails",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-failed-action-recovery",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate("window.fixture.mutateHostAndRefresh()");
        await fail(
          page,
          await pending(page, "renameWindow", "one"),
          "Original mutation failure",
        );
        await expect
          .poll(() => mutationStatus(page))
          .toBe("Original mutation failure");
        assert.equal(
          await page.evaluate("window.fixture.failureIdentity"),
          true,
        );
        await complete(page, await pending(page, "status", "one"), {
          connected: true,
        });
        await fail(
          page,
          await pending(page, "listSessions", "one"),
          "Recovery list failure",
        );
        await expect
          .poll(async () => (await snapshot(page)).hostErrors.one)
          .toBe("Recovery list failure");
        assert.equal((await snapshot(page)).error, "Original mutation failure");
        assert.equal(await mutationStatus(page), "Original mutation failure");
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='renameWindow').length",
          ),
          1,
        );
      },
    );
  },
);

test(
  "an unrelated disconnected host stays visible without failing host or session mutation completion",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-unrelated-offline",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() => {
          const fixture = (window as unknown as WorkspaceFixtureWindow).fixture;
          fixture.changeHosts([
            { id: "one", label: "Host one", endpoint: "unix:///one.sock" },
            { id: "two", label: "Offline host", endpoint: "unix:///two.sock" },
          ]);
          fixture.refresh();
        });
        await complete(page, await pending(page, "status", "two"), {
          connected: false,
          error: "Other host is offline",
        });
        await complete(
          page,
          await startInspection(page),
          view("s", "Last good session"),
        );
        await expect
          .poll(async () => (await snapshot(page)).hostErrors.two)
          .toBe("Other host is offline");
        await page.evaluate("window.fixture.mutateHostAndRefresh()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        await complete(page, await pending(page, "status", "two"), {
          connected: false,
          error: "Other host is offline",
        });
        await complete(
          page,
          await startInspection(page),
          view("s", "Host mutation refreshed"),
        );
        await expect.poll(() => mutationStatus(page)).toBe("complete");
        await page.evaluate("window.fixture.mutate()");
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        await complete(
          page,
          await pending(page, "inspectSession", "one"),
          view("s", "Session mutation refreshed"),
        );
        await expect.poll(() => mutationStatus(page)).toBe("complete");
        assert.deepEqual((await snapshot(page)).hosts, ["one", "two"]);
        assert.equal(
          (await snapshot(page)).hostErrors.two,
          "Other host is offline",
        );
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Session mutation refreshed",
        );
      },
    );
  },
);

for (const kind of ["mutateHostAndRefresh", "mutate"] as const) {
  test(
    `${kind} rejects reconciliation after unmount without launching any further bridge work`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-dispose-${kind}`,
        source,
        async (page) => {
          await initialWorkspace(page);
          await page.evaluate((kind) => {
            (window as unknown as WorkspaceFixtureWindow).fixture[kind]();
          }, kind);
          await complete(
            page,
            await pending(page, "renameWindow", "one"),
            undefined,
          );
          const inspected =
            kind === "mutateHostAndRefresh"
              ? await startInspection(page)
              : await pending(page, "inspectSession", "one");
          await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.unmount(),
          );
          await expect(page.getByText("Workspace unmounted")).toBeVisible();
          const marker = await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls
                .length,
          );
          await complete(
            page,
            inspected,
            view("s", "Late mutation inspection"),
          );
          await expect
            .poll(() => mutationStatus(page))
            .toMatch(/change completed.*workspace closed/i);
          assert.equal(
            await page.evaluate(
              () =>
                (window as unknown as WorkspaceFixtureWindow).fixture.calls
                  .length,
            ),
            marker,
          );
        },
      );
    },
  );
}

for (const scenario of [
  "balanced",
  "unbalanced",
  "inspection rejects",
  "balancing rejects",
] as const) {
  test(
    `dispatcher split completion is ordered through ${scenario}`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-split-${scenario.replace(" ", "-")}`,
        source,
        async (page) => {
          await initialWorkspace(page);
          await page.evaluate((scenario) => {
            const fixture = (window as unknown as WorkspaceFixtureWindow)
              .fixture;
            fixture.preferences({
              autobalanceSplits: scenario !== "unbalanced",
            });
            fixture.dispatch("pane.split.right");
          }, scenario);
          const split = await pending(page, "split", "one");
          assert.equal(await mutationStatus(page), "pending");
          assert.equal(
            await page.evaluate(
              "window.fixture.pending().some(call=>call.method==='layoutAction'||call.method==='inspectSession')",
            ),
            false,
          );
          await complete(page, split, undefined);
          if (scenario !== "unbalanced") {
            const balanced = await pending(page, "layoutAction", "one");
            assert.equal(
              await page.evaluate(
                "window.fixture.pending().some(call=>call.method==='inspectSession')",
              ),
              false,
            );
            assert.equal(await mutationStatus(page), "pending");
            if (scenario === "balancing rejects")
              await fail(page, balanced, "Split balance denied");
            else await complete(page, balanced, undefined);
          }
          const inspected = await pending(page, "inspectSession", "one");
          assert.equal(await mutationStatus(page), "pending");
          if (scenario === "balancing rejects") {
            await complete(page, inspected, view("s", "Committed split"));
            await expect
              .poll(() => mutationStatus(page))
              .toMatch(/split completed.*balanc.*failed/i);
            assert.equal(
              (await snapshot(page)).views["one/s"],
              "Committed split",
            );
            assert.equal(
              await page.evaluate("window.fixture.failureCause"),
              true,
            );
            assert.equal(
              await page.evaluate("window.fixture.failureMethod"),
              "layoutAction",
            );
          } else if (scenario === "inspection rejects") {
            await fail(page, inspected, "Split inspection failed");
            await assertReconciliationFailure(
              page,
              "Split inspection failed",
              "inspectSession",
            );
          } else {
            await complete(page, inspected, view("s", "Split session"));
            await expect.poll(() => mutationStatus(page)).toBe("complete");
            assert.equal(
              await page.evaluate("window.fixture.completed.label"),
              "Split session",
            );
          }
          const ordered = await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.calls
              .filter((call) =>
                ["split", "layoutAction", "inspectSession"].includes(
                  call.method,
                ),
              )
              .map((call) => call.method),
          );
          assert.deepEqual(
            ordered,
            scenario === "unbalanced"
              ? ["inspectSession", "split", "inspectSession"]
              : ["inspectSession", "split", "layoutAction", "inspectSession"],
          );
        },
      );
    },
  );
}

for (const outcome of ["success", "failure"] as const) {
  test(
    `an older direct inspection ${outcome} cannot replace a newer inspection's view, focus, or host status`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-direct-order-${outcome}`,
        source,
        async (page) => {
          await initialWorkspace(page);
          await page.evaluate((outcome) => {
            const fixture = (window as unknown as WorkspaceFixtureWindow)
              .fixture;
            if (outcome === "failure") fixture.select("one", "s");
            else fixture.reload("one", "s");
          }, outcome);
          const old = await pending(page, "inspectSession", "one");
          await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.reload(
              "one",
              "s",
            ),
          );
          const latest = await pending(page, "inspectSession", "one", old);
          const current = view("s", "Newest direct inspection");
          current.windows[0].focusedBlockId = "new-focus";
          await complete(page, latest, current);
          await expect
            .poll(async () => (await snapshot(page)).views["one/s"])
            .toBe("Newest direct inspection");
          if (outcome === "success")
            await complete(page, old, view("s", "Older direct inspection"));
          else await fail(page, old, "Older inspection denied");
          await nextFrame(page);
          assert.equal(
            (await snapshot(page)).views["one/s"],
            "Newest direct inspection",
          );
          assert.equal((await snapshot(page)).connected.one, true);
          assert.equal((await snapshot(page)).hostErrors.one, undefined);
          assert.equal((await snapshot(page)).error, undefined);
          assert.equal(
            await page.evaluate(
              "JSON.parse(document.querySelector('#workspace-state').textContent).focusedPane",
            ),
            "new-focus",
          );
        },
      );
    },
  );
}

test(
  "a published workspace snapshot supersedes a still-pending direct session inspection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-direct-versus-snapshot",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "s",
          ),
        );
        const old = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        await complete(page, await pending(page, "status", "one"), {
          connected: true,
        });
        await complete(page, await pending(page, "listSessions", "one"), [
          { id: "s", label: "Session" },
        ]);
        const latest = await pending(page, "inspectSession", "one", old);
        await complete(page, latest, view("s", "Newer published workspace"));
        await expect
          .poll(async () => (await snapshot(page)).views["one/s"])
          .toBe("Newer published workspace");
        await complete(page, old, view("s", "Older direct session"));
        await nextFrame(page);
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Newer published workspace",
        );
      },
    );
  },
);

test(
  "starting a mutation prevents a pre-mutation inspection from publishing before reconciliation",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-direct-versus-mutation",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "s",
          ),
        );
        const old = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.mutate(),
        );
        const changed = await pending(page, "renameWindow", "one");
        await complete(page, old, view("s", "Pre-mutation direct session"));
        await nextFrame(page);
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Last good session",
        );
        await complete(page, changed, undefined);
        await complete(
          page,
          await pending(page, "inspectSession", "one"),
          view("s", "Mutation reconciled"),
        );
        await expect.poll(() => mutationStatus(page)).toBe("complete");
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Mutation reconciled",
        );
      },
    );
  },
);

test(
  "independent session inspections may complete in either order without superseding one another",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-independent-inspections",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "s",
          ),
        );
        const selected = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "other",
          ),
        );
        const other = await pending(page, "inspectSession", "one", selected);
        await complete(page, other, view("other", "Other session refreshed"));
        await expect
          .poll(async () => (await snapshot(page)).views["one/other"])
          .toBe("Other session refreshed");
        await complete(page, selected, view("s", "Selected session refreshed"));
        await expect
          .poll(async () => (await snapshot(page)).views["one/s"])
          .toBe("Selected session refreshed");
        assert.equal(
          (await snapshot(page)).views["one/other"],
          "Other session refreshed",
        );
        assert.equal((await snapshot(page)).error, undefined);
      },
    );
  },
);

test(
  "a current selection inspection failure remains visible while superseded selection failures stay quiet",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-selection-inspection-error",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.select(
            "one",
            "s",
          ),
        );
        const inspected = await pending(page, "inspectSession", "one");
        await fail(page, inspected, "Current selection denied");
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Current selection denied");
        assert.equal(
          (await snapshot(page)).hostErrors.one,
          "Current selection denied",
        );
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Last good session",
        );
      },
    );
  },
);

test(
  "a current direct inspection failure cannot be hidden by an older in-flight full refresh",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-error-versus-old-refresh",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        const old = await startInspection(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "s",
          ),
        );
        const latest = await pending(page, "inspectSession", "one", old);
        await fail(page, latest, "Newest inspection denied");
        await expect
          .poll(async () => (await snapshot(page)).hostErrors.one)
          .toBe("Newest inspection denied");
        await complete(page, old, view("s", "Older successful full refresh"));
        await nextFrame(page);
        assert.equal(
          (await snapshot(page)).hostErrors.one,
          "Newest inspection denied",
        );
        assert.equal((await snapshot(page)).connected.one, false);
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Last good session",
        );
      },
    );
  },
);

test(
  "a pending session selection inspection cannot undo a later explicit window choice",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-selection-request-owner",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.select(
            "one",
            "s",
          ),
        );
        const inspected = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.select(
            "one",
            "s",
            "chosen",
          ),
        );
        const current = view("s", "Session after explicit selection");
        current.windows.push({
          ...current.windows[0],
          id: "chosen",
          label: "Chosen tab",
        });
        await complete(page, inspected, current);
        await nextFrame(page);
        assert.equal(
          await page.evaluate(
            "JSON.parse(document.querySelector('#workspace-state').textContent).selection.windowId",
          ),
          "chosen",
        );
      },
    );
  },
);

test(
  "an older full refresh cannot supersede a direct inspection that started afterward",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-new-direct-versus-old-refresh",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        const olderSnapshot = await startInspection(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.reload(
            "one",
            "s",
          ),
        );
        const newerDirect = await pending(
          page,
          "inspectSession",
          "one",
          olderSnapshot,
        );
        await complete(page, olderSnapshot, view("s", "Older full refresh"));
        await nextFrame(page);
        await complete(page, newerDirect, view("s", "Newer direct inspection"));
        await nextFrame(page);
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Newer direct inspection",
        );
        assert.deepEqual(
          await page.evaluate("window.fixture.reloadErrors || []"),
          [],
        );
      },
    );
  },
);

for (const firstCompletion of ["first", "second"] as const) {
  test(
    `independent session mutations reconcile successfully when ${firstCompletion} inspection finishes first`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-independent-mutations-${firstCompletion}`,
        source,
        async (page) => {
          await initialWorkspace(page);
          await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.mutateTarget(
              "s",
              "first",
            ),
          );
          await complete(
            page,
            await pending(page, "renameWindow", "one"),
            undefined,
          );
          const first = await pending(page, "inspectSession", "one");
          await page.evaluate(() =>
            (window as unknown as WorkspaceFixtureWindow).fixture.mutateTarget(
              "other",
              "second",
            ),
          );
          await complete(
            page,
            await pending(page, "renameWindow", "one"),
            undefined,
          );
          const second = await pending(page, "inspectSession", "one", first);
          const inspections = {
            first: {
              request: first,
              view: view("s", "First mutation reconciled"),
            },
            second: {
              request: second,
              view: view("other", "Second mutation reconciled"),
            },
          };
          const lastCompletion =
            firstCompletion === "first" ? "second" : "first";
          await complete(
            page,
            inspections[firstCompletion].request,
            inspections[firstCompletion].view,
          );
          await nextFrame(page);
          assert.equal(
            (await snapshot(page)).busy,
            true,
            "the remaining mutation keeps the workspace busy",
          );
          await complete(
            page,
            inspections[lastCompletion].request,
            inspections[lastCompletion].view,
          );
          await expect
            .poll(() =>
              page.evaluate(() =>
                Object.values(
                  (window as unknown as WorkspaceFixtureWindow).fixture
                    .mutations || {},
                ).every((status) => status !== "pending"),
              ),
            )
            .toBe(true);
          assert.deepEqual(
            await page.evaluate(
              () =>
                (window as unknown as WorkspaceFixtureWindow).fixture.mutations,
            ),
            { first: "complete", second: "complete" },
          );
          const state = await snapshot(page);
          assert.equal(state.views["one/s"], "First mutation reconciled");
          assert.equal(state.views["one/other"], "Second mutation reconciled");
          assert.equal(state.busy, false);
          assert.equal(state.error, undefined);
        },
      );
    },
  );
}

test(
  "a new mutation of the same session invalidates an earlier post-write inspection before applying",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-same-session-mutations",
      source,
      async (page) => {
        await initialWorkspace(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.mutateTarget(
            "s",
            "first",
          ),
        );
        await complete(
          page,
          await pending(page, "renameWindow", "one"),
          undefined,
        );
        const older = await pending(page, "inspectSession", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.mutateTarget(
            "s",
            "second",
          ),
        );
        const latestAction = await pending(page, "renameWindow", "one");
        await complete(page, older, view("s", "Older mutation inspection"));
        await nextFrame(page);
        assert.equal(
          (await snapshot(page)).views["one/s"],
          "Last good session",
          "the pending same-session write must prevent stale publication",
        );
        await complete(page, latestAction, undefined);
        const latest = await pending(page, "inspectSession", "one");
        await complete(page, latest, view("s", "Latest mutation reconciled"));
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as WorkspaceFixtureWindow).fixture.mutations
                  ?.second,
            ),
          )
          .toBe("complete");
        const state = await snapshot(page);
        assert.equal(state.views["one/s"], "Latest mutation reconciled");
        assert.equal(state.busy, false);
        assert.match(
          await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.mutations
                ?.first || "",
          ),
          /inspection was superseded/,
        );
      },
    );
  },
);

test(
  "current keymap initialization failure is visible and a later refresh retries",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-keymap-failure-retry",
      source,
      async (page) => {
        const inspected = await startInspection(page);
        await page.evaluate(() => {
          (window as unknown as WorkspaceFixtureWindow).fixture.deferKeymaps =
            true;
        });
        await complete(page, inspected, view("s", "Initial session"));
        const failed = await pending(page, "keymap", "one");
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Keymap denied",
            ),
          failed,
        );
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Keyboard shortcuts for Host one: Keymap denied");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        await complete(
          page,
          await startInspection(page),
          view("s", "Retried session"),
        );
        const retry = await pending(page, "keymap", "one");
        assert.notEqual(retry, failed);
        await complete(page, retry, {
          actions: [],
          bindings: [],
          modes: [],
          warnings: [],
        });
        await expect
          .poll(async () => (await snapshot(page)).keymapHosts)
          .toEqual(["one"]);
        assert.equal(
          await page.evaluate(
            () =>
              (
                window as unknown as WorkspaceFixtureWindow
              ).fixture.calls.filter((call) => call.method === "keymap").length,
          ),
          2,
        );
      },
    );
  },
);

for (const lifetime of ["removed", "replaced", "unmounted"] as const) {
  test(
    `a delayed keymap initialization failure stays quiet after its host is ${lifetime}`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-keymap-${lifetime}-failure`,
        source,
        async (page) => {
          const inspected = await startInspection(page);
          await page.evaluate(() => {
            (window as unknown as WorkspaceFixtureWindow).fixture.deferKeymaps =
              true;
          });
          await complete(page, inspected, view("s", "Initial session"));
          const old = await pending(page, "keymap", "one");
          if (lifetime === "unmounted") {
            await page.evaluate(() =>
              (window as unknown as WorkspaceFixtureWindow).fixture.unmount(),
            );
            await expect(page.getByText("Workspace unmounted")).toBeVisible();
          } else {
            await page.evaluate(
              (replaced) =>
                (
                  window as unknown as WorkspaceFixtureWindow
                ).fixture.changeHosts(
                  replaced
                    ? [
                        {
                          id: "one",
                          label: "Replacement host",
                          endpoint: "unix:///replacement.sock",
                        },
                      ]
                    : [],
                ),
              lifetime === "replaced",
            );
            if (lifetime === "removed")
              await expect
                .poll(async () => (await snapshot(page)).settingsHosts)
                .toEqual([]);
          }
          const replacement =
            lifetime === "replaced" ? await startInspection(page) : undefined;
          if (replacement !== undefined)
            await complete(page, replacement, view("s", "Replacement session"));
          const current =
            lifetime === "replaced"
              ? await pending(page, "keymap", "one", old)
              : undefined;
          const marker = await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls
                .length,
          );
          await page.evaluate(
            (id) =>
              (window as unknown as WorkspaceFixtureWindow).fixture.fail(
                id,
                "Old keymap denied",
              ),
            old,
          );
          await nextFrame(page);
          if (lifetime === "unmounted") {
            assert.equal(
              await page.evaluate(
                () =>
                  (window as unknown as WorkspaceFixtureWindow).fixture.calls
                    .length,
              ),
              marker,
            );
            await expect(page.getByText("Workspace unmounted")).toBeVisible();
          } else {
            assert.equal((await snapshot(page)).error, undefined);
            if (current !== undefined) {
              await complete(page, current, {
                actions: [],
                bindings: [],
                modes: [],
                warnings: [],
              });
              await expect
                .poll(async () => (await snapshot(page)).keymapHosts)
                .toEqual(["one"]);
            } else
              assert.equal(
                (await snapshot(page)).keymapHosts.includes("one"),
                false,
              );
          }
        },
      );
    },
  );
}

test(
  "an older same-endpoint keymap failure cannot invalidate the replacement request",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-keymap-request-owner",
      source,
      async (page) => {
        const inspected = await startInspection(page);
        await page.evaluate(() => {
          (window as unknown as WorkspaceFixtureWindow).fixture.deferKeymaps =
            true;
        });
        await complete(page, inspected, view("s", "Initial session"));
        const old = await pending(page, "keymap", "one");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.status(
            "one",
            false,
          ),
        );
        await complete(
          page,
          await startInspection(page),
          view("s", "Reconnected session"),
        );
        const current = await pending(page, "keymap", "one", old);
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Old keymap denied",
            ),
          old,
        );
        await nextFrame(page);
        assert.equal((await snapshot(page)).error, undefined);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        await complete(
          page,
          await startInspection(page),
          view("s", "Refreshed session"),
        );
        await expect
          .poll(async () => (await snapshot(page)).views["one/s"])
          .toBe("Refreshed session");
        assert.equal(
          await page.evaluate(
            () =>
              (
                window as unknown as WorkspaceFixtureWindow
              ).fixture.calls.filter((call) => call.method === "keymap").length,
          ),
          2,
          "A stale failure cannot clear another request's initialization marker",
        );
        await complete(page, current, {
          actions: [],
          bindings: [],
          modes: [],
          warnings: [],
        });
        await expect
          .poll(async () => (await snapshot(page)).keymapHosts)
          .toEqual(["one"]);
      },
    );
  },
);

async function contextRequest(page: Page, after = 0): Promise<PendingRequest> {
  await expect
    .poll(() =>
      page.evaluate(
        (after) =>
          (window as unknown as WorkspaceFixtureWindow).fixture
            .pending()
            .some(
              (request) =>
                request.method === "setContext" && request.id > after,
            ),
        after,
      ),
    )
    .toBe(true);
  const request = await page.evaluate(
    (after) =>
      (window as unknown as WorkspaceFixtureWindow).fixture
        .pending()
        .find(
          (request) => request.method === "setContext" && request.id > after,
        ),
    after,
  );
  if (!request) throw Error("Missing pending context publication");
  return request;
}
async function contextFixture(page: Page) {
  await complete(
    page,
    await startInspection(page),
    view("s", "Context session"),
  );
  await expect
    .poll(async () => (await snapshot(page)).views["one/s"])
    .toBe("Context session");
  await page.evaluate(() => {
    const fixture = (window as unknown as WorkspaceFixtureWindow).fixture;
    fixture.deferContexts = true;
    fixture.select("one", "s", "w", "other");
  });
  return contextRequest(page);
}

test(
  "context publication failures report and a refresh retries the latest selection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-context-refresh",
      source,
      async (page) => {
        const first = await contextFixture(page);
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Context refused",
            ),
          first.id,
        );
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Workspace context: Context refused");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.select(
            "one",
            "s",
            "w",
            "b",
          ),
        );
        const latest = await contextRequest(page, first.id);
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Latest context refused",
            ),
          latest.id,
        );
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Workspace context: Latest context refused");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        const retry = await contextRequest(page, latest.id);
        assert.deepEqual(retry.args.selection, {
          hostId: "one",
          sessionId: "s",
          windowId: "w",
          blockId: "b",
        });
        assert.equal(retry.args.visible, true);
        await complete(page, retry.id, undefined);
      },
    );
  },
);

test(
  "visibility retries current context after a failed publication",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-context-visibility",
      source,
      async (page) => {
        const first = await contextFixture(page);
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Context refused",
            ),
          first.id,
        );
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Workspace context: Context refused");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.visibility(
            true,
          ),
        );
        const retry = await contextRequest(page, first.id);
        assert.equal(retry.args.visible, false);
        assert.deepEqual(retry.args.selection, first.args.selection);
        await complete(page, retry.id, undefined);
      },
    );
  },
);

for (const lifetime of [
  "new selection",
  "host replacement",
  "unmount",
] as const) {
  test(
    `stale context failures cannot overwrite feedback after ${lifetime}`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-context-stale-${lifetime.replaceAll(" ", "-")}`,
        source,
        async (page) => {
          const old = await contextFixture(page);
          const before = await page.evaluate(
            () =>
              (window as unknown as WorkspaceFixtureWindow).fixture.calls
                .length,
          );
          await page.evaluate(
            ({ lifetime, id }) => {
              const fixture = (window as unknown as WorkspaceFixtureWindow)
                .fixture;
              fixture.report("Replacement feedback");
              if (lifetime === "new selection")
                fixture.select("one", "s", "w", "b");
              else if (lifetime === "host replacement")
                fixture.changeHosts([
                  {
                    id: "one",
                    label: "New endpoint",
                    endpoint: "unix:///new.sock",
                  },
                ]);
              else fixture.unmount();
              fixture.fail(id, "Old context failed");
            },
            { lifetime, id: old.id },
          );
          if (lifetime === "unmount") {
            await expect(page.getByText("Workspace unmounted")).toBeVisible();
            await nextFrame(page);
            assert.equal(
              await page.evaluate(
                () =>
                  (window as unknown as WorkspaceFixtureWindow).fixture.calls
                    .length,
              ),
              before,
            );
          } else {
            await nextFrame(page);
            assert.equal((await snapshot(page)).error, "Replacement feedback");
          }
        },
      );
    },
  );
}

test(
  "refresh retries context without waiting for an older snapshot collection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-context-held-refresh",
      source,
      async (page) => {
        const failed = await contextFixture(page);
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        const held = await pending(page, "status", "one");
        await page.evaluate(
          (id) =>
            (window as unknown as WorkspaceFixtureWindow).fixture.fail(
              id,
              "Context refused",
            ),
          failed.id,
        );
        await expect
          .poll(async () => (await snapshot(page)).error)
          .toBe("Workspace context: Context refused");
        await page.evaluate(() =>
          (window as unknown as WorkspaceFixtureWindow).fixture.refresh(),
        );
        const retry = await contextRequest(page, failed.id);
        assert.deepEqual(retry.args.selection, failed.args.selection);
        assert.equal(
          await page.evaluate(
            (id) =>
              (window as unknown as WorkspaceFixtureWindow).fixture
                .pending()
                .some((request) => request.id === id),
            held,
          ),
          true,
          "Context recovery is independent of the held host read",
        );
        await complete(page, retry.id, undefined);
      },
    );
  },
);
