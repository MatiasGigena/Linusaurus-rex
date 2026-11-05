import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

function source(holdFocus = false) {
  return `
import React from'react';import{createRoot}from'react-dom/client';
import App from'/src/App.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import'/src/styles.css';import'/src/dialogs.css';import'/src/advanced.css';import'/src/macos.css';
let settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'same',label:'Host A',endpoint:'unix:///a.sock'}],lastSelection:{hostId:'same',sessionId:'b',windowId:'first'},confirmClose:false};
const listeners=new Set(),calls=[],focusRequests=[];let nextId=0,show;
const f=window.fixture={calls,replies:[],contextFailure:undefined,
 replace(){settings={...settings,hosts:[{id:'same',label:'Host B',endpoint:'unix:///b.sock'}]};for(const listener of listeners)listener({type:'settings',settings});},
 selectFromServer(sessionId){for(const listener of listeners)listener({type:'action',hostId:'same',name:'session.select',requestId:'server-selection',args:{session_id:sessionId,window_id:'first'}});},
 pendingFocus(){return focusRequests.filter(request=>!request.settled).map(({id,args})=>({id,args}));},
 completeFocus(id){const request=focusRequests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing focus '+id);request.settled=true;request.resolve();},
 failFocus(id,message){const request=focusRequests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing focus '+id);request.settled=true;request.reject(Error(message));},
 unmount(){show(false);},
};
window.rex={getSettings:async()=>structuredClone(settings),setSettings:async next=>{settings=structuredClone(next);return next;},onClientEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onCommand:()=>()=>{},replyAction(requestId,result,error){f.replies.push({requestId,error});},windowControl(){},async writeClipboard(){},async readClipboard(){return'';},
 request(method,args){const id=++nextId;calls.push({id,method,args:structuredClone(args),endpoint:settings.hosts[0].endpoint});
  if(method==='setContext')return f.contextFailure?Promise.reject(Error(f.contextFailure)):Promise.resolve();
  if(method==='focusWindow')return ${holdFocus}?new Promise((resolve,reject)=>focusRequests.push({id,args,resolve,reject,settled:false})):Promise.resolve();
  if(method==='status')return Promise.resolve({connected:true});
  if(method==='listSessions')return Promise.resolve([{id:'a',label:'Session a'},{id:'b',label:'Session b'}]);
  if(method==='inspectSession')return Promise.resolve({id:args.sessionId,label:'Session '+args.sessionId,activeWindowId:'first',windows:[{id:'first',label:args.sessionId+' First',panes:[]},{id:'second',label:args.sessionId+' Second',panes:[]}]});
  if(method==='keymap')return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});
  if(method==='updateStatus')return Promise.resolve({phase:'idle',currentVersion:'1.0.0',canApply:false,installKind:'development'});
  if(method==='newWindow'||method==='reorderWindow')return Promise.resolve();
  throw Error('Unexpected '+method);
 }
};
function Fixture(){const[visible,setVisible]=React.useState(true);show=setVisible;return visible?React.createElement(App):React.createElement('p',null,'App unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
}

interface BridgeCall {
  id: number;
  method: string;
  args: Record<string, unknown>;
  endpoint: string;
}
interface AppTargetFixture {
  calls: BridgeCall[];
  replies: { requestId: string; error?: string }[];
  contextFailure?: string;
  replace(): void;
  selectFromServer(sessionId: string): void;
  pendingFocus(): { id: number; args: Record<string, unknown> }[];
  completeFocus(id: number): void;
  failFocus(id: number, message: string): void;
  unmount(): void;
}
interface FixtureWindow {
  fixture: AppTargetFixture;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

async function ready(page: Page) {
  await expect(page.locator(".host-name")).toHaveText("Host A");
  await expect(page.locator(".toolbar-subtitle")).toHaveText(
    "Host A / Session b",
  );
  await expect(
    page.locator(".window-item").filter({ hasText: "a First" }),
  ).toBeVisible();
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function focusRequest(page: Page, sessionId: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (sessionId) =>
          (window as unknown as FixtureWindow).fixture
            .pendingFocus()
            .some((request) => request.args.sessionId === sessionId),
        sessionId,
      ),
    )
    .toBe(true);
  const request = await page.evaluate(
    (sessionId) =>
      (window as unknown as FixtureWindow).fixture
        .pendingFocus()
        .find((request) => request.args.sessionId === sessionId),
    sessionId,
  );
  assert.ok(request);
  return request.id;
}

for (const kind of ["session", "tab"] as const) {
  test(
    `an actual App ${kind} menu cannot apply old endpoint intent to a replacement server with colliding IDs`,
    options,
    async () => {
      await withBrowserFixture(
        `app-${kind}-menu-endpoint`,
        source(),
        async (page) => {
          await ready(page);
          const row =
            kind === "session"
              ? page.locator(".session-heading").filter({
                  has: page.getByRole("button", {
                    name: "Session a",
                    exact: true,
                  }),
                })
              : page.locator(".window-item").filter({ hasText: "a First" });
          const label =
            kind === "session" ? "New terminal tab" : "Move tab forward";
          const mutation = kind === "session" ? "newWindow" : "reorderWindow";
          await row.click({ button: "right" });
          const entry = page.getByRole("menuitem", {
            name: label,
            exact: true,
          });
          await expect(entry).toBeVisible();
          if (kind === "session") {
            // Deliver the setting event and click the still-mounted menu in one turn:
            // the bridge has changed even before React can hide the old entry.
            await entry.evaluate((button) => {
              (window as unknown as FixtureWindow).fixture.replace();
              (button as HTMLButtonElement).click();
            });
          } else {
            await page.evaluate(() =>
              (window as unknown as FixtureWindow).fixture.replace(),
            );
          }
          await expect(page.locator(".host-name")).toHaveText("Host B");
          // A stale menu may be invalidated outright. If still visible, exercising its
          // actual UI callback must not send the old intent to the replacement host.
          if (await entry.count()) await entry.click();
          await frame(page);
          assert.deepEqual(
            await page.evaluate(
              (method) =>
                (window as unknown as FixtureWindow).fixture.calls.filter(
                  (call) => call.method === method,
                ),
              mutation,
            ),
            [],
            "The old menu must not mutate the replacement endpoint",
          );
          await expect(page.getByRole("menu")).toHaveCount(0);
          await row.click({ button: "right" });
          await page
            .getByRole("menuitem", { name: label, exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(
                (method) =>
                  (window as unknown as FixtureWindow).fixture.calls.filter(
                    (call) => call.method === method,
                  ).length,
                mutation,
              ),
            )
            .toBe(1);
          const calls = await page.evaluate(
            (method) =>
              (window as unknown as FixtureWindow).fixture.calls.filter(
                (call) => call.method === method,
              ),
            mutation,
          );
          assert.equal(calls[0].endpoint, "unix:///b.sock");
          assert.equal(calls[0].args.hostId, "same");
          assert.equal(calls[0].args.sessionId, "a");
          if (kind === "tab") assert.equal(calls[0].args.windowId, "first");
          await expect(page.getByRole("menu")).toHaveCount(0);
        },
      );
    },
  );
}

test(
  "an old App focus failure cannot replace current feedback after a newer selection succeeds",
  options,
  async () => {
    await withBrowserFixture(
      "app-focus-selection-owner",
      source(true),
      async (page) => {
        await ready(page);
        const old = await focusRequest(page, "b");
        await page.evaluate(() => {
          (window as unknown as FixtureWindow).fixture.contextFailure =
            "Current context feedback";
        });
        await page
          .getByRole("button", { name: "Session a", exact: true })
          .click();
        const current = await focusRequest(page, "a");
        await expect(page.locator(".toolbar-subtitle")).toHaveText(
          "Host A / Session a",
        );
        await expect(page.getByRole("alert")).toContainText(
          "Workspace context: Current context feedback",
        );
        await page.evaluate(
          ({ old, current }) => {
            const fixture = (window as unknown as FixtureWindow).fixture;
            fixture.completeFocus(current);
            fixture.failFocus(old, "Old focus refused");
          },
          { old, current },
        );
        await frame(page);
        assert.match(
          (await page.getByRole("alert").textContent()) || "",
          /Workspace context: Current context feedback/,
          "The late focus rejection must not replace current feedback even temporarily",
        );
        await expect(page.locator(".toolbar-subtitle")).toHaveText(
          "Host A / Session a",
        );
      },
    );
  },
);

test(
  "an actual server selection revokes old focus feedback before React commits the new window",
  options,
  async () => {
    await withBrowserFixture(
      "app-focus-server-intent-owner",
      source(true),
      async (page) => {
        await ready(page);
        const old = await focusRequest(page, "b");
        await page.evaluate((id) => {
          const fixture = (window as unknown as FixtureWindow).fixture;
          fixture.selectFromServer("a");
          fixture.failFocus(id, "Previous window focus refused");
        }, old);
        const current = await focusRequest(page, "a");
        await page.evaluate(
          (id) =>
            (window as unknown as FixtureWindow).fixture.completeFocus(id),
          current,
        );
        await frame(page);
        await expect(page.locator(".toolbar-subtitle")).toHaveText(
          "Host A / Session a",
        );
        assert.deepEqual(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.replies,
          ),
          [{ requestId: "server-selection", error: undefined }],
        );
        assert.deepEqual(
          await page.getByRole("alert").allTextContents(),
          [],
          "The previous window failure must stay quiet after the live server selection",
        );
      },
    );
  },
);

test(
  "current App focus failures remain visible and completion after unmount stays quiet",
  options,
  async () => {
    await withBrowserFixture(
      "app-focus-unmount-owner",
      source(true),
      async (page) => {
        await ready(page);
        const current = await focusRequest(page, "b");
        await page.evaluate(
          (id) =>
            (window as unknown as FixtureWindow).fixture.failFocus(
              id,
              "Current focus refused",
            ),
          current,
        );
        await expect(page.getByRole("alert")).toContainText(
          "Current focus refused",
        );
        await page
          .getByRole("button", { name: "Session a", exact: true })
          .click();
        const late = await focusRequest(page, "a");
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.unmount(),
        );
        await expect(
          page.getByText("App unmounted", { exact: true }),
        ).toBeVisible();
        const before = await page.evaluate(
          () => (window as unknown as FixtureWindow).fixture.calls.length,
        );
        await page.evaluate(
          (id) =>
            (window as unknown as FixtureWindow).fixture.failFocus(
              id,
              "Unmounted focus refused",
            ),
          late,
        );
        await frame(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        assert.equal(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.calls.length,
          ),
          before,
        );
      },
    );
  },
);
