import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspace} from '/src/hooks/useWorkspace.ts';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
let workspace,setVisible,nextId=0;
let settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'one',label:'Host one',endpoint:'unix:///one.sock'}],lastSelection:{hostId:'one',sessionId:'s',windowId:'w'}};
const listeners=new Set(),calls=[],requests=[];
window.fixture={calls,
 pending(){return requests.filter(request=>!request.settled).map(({id,method,args})=>({id,method,args}));},
 complete(id,value){const request=requests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing pending request '+id);request.settled=true;request.resolve(value);},
 refresh(){void workspace.refresh();},reload(hostId,sessionId){void workspace.reloadSession(hostId,sessionId);},
 changeHosts(hosts){settings={...settings,hosts};for(const listener of listeners)listener({type:'settings',settings});},
 unmount(){setVisible(false);}
};
window.rex={
 getSettings:async()=>settings,
 setSettings:async(next)=>{calls.push({method:'setSettings'});settings=next;return next;},
 onClientEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
 request(method,args){const id=++nextId;calls.push({id,method,args});if(method==='setContext')return Promise.resolve();if(method==='keymap'&&!window.fixture.deferKeymaps)return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});return new Promise(resolve=>requests.push({id,method,args,resolve,settled:false}));}
};
function WorkspaceFixture(){const state=useWorkspace();workspace=state;return React.createElement('pre',{id:'workspace-state'},JSON.stringify({settingsHosts:state.settings?.hosts.map(host=>host.id),hosts:state.hosts.map(host=>host.id),views:Object.fromEntries(Object.entries(state.views).map(([key,view])=>[key,view.label])),keymapHosts:Object.keys(state.keymaps),selection:state.selection,loading:state.loading,error:state.error}));}
function Root(){const[visible,show]=React.useState(true);setVisible=show;return visible?React.createElement(WorkspaceFixture):React.createElement('p',null,'Workspace unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Root));
`;
interface PendingRequest {
  id: number;
  method: string;
  args: { hostId?: string; sessionId?: string };
}
interface WorkspaceFixtureWindow {
  fixture: {
    calls: PendingRequest[];
    deferKeymaps?: boolean;
    pending(): PendingRequest[];
    complete(id: number, value: unknown): void;
    refresh(): void;
    reload(hostId: string, sessionId: string): void;
    changeHosts(hosts: { id: string; label: string; endpoint: string }[]): void;
    unmount(): void;
  };
}
interface WorkspaceSnapshot {
  settingsHosts?: string[];
  hosts: string[];
  views: Record<string, string>;
  keymapHosts: string[];
  loading: boolean;
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
