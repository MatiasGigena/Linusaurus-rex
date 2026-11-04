import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { RendererContext } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';import App from'/src/App.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import'/src/styles.css';import'/src/dialogs.css';import'/src/advanced.css';import'/src/macos.css';
const settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'one',label:'Host one',endpoint:'unix:///one.sock'}],lastSelection:undefined};
const calls=[],pending=[];let nextId=0;
const f=window.fixture={calls,defer:false,pending:()=>pending.filter(request=>!request.settled).map(({id,args})=>({id,args})),complete(id){const request=pending.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing context');request.settled=true;request.resolve();},fail(id,message){const request=pending.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing context');request.settled=true;request.reject(new Error(message));}};
window.rex={getSettings:async()=>settings,setSettings:async next=>next,onClientEvent:()=>()=>{},onCommand:()=>()=>{},windowControl(){},async writeClipboard(){},async readClipboard(){return'';},request(method,args){const id=++nextId;calls.push({id,method,args:structuredClone(args)});if(method==='setContext'){if(f.defer)return new Promise((resolve,reject)=>pending.push({id,args:structuredClone(args),resolve,reject,settled:false}));return Promise.resolve();}if(method==='status')return Promise.resolve({connected:true});if(method==='listSessions')return Promise.resolve([]);if(method==='keymap')return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});if(method==='updateStatus')return Promise.resolve({phase:'idle',currentVersion:'1.0.0',canApply:false,installKind:'development'});throw Error('Unexpected '+method);}};
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
interface ContextRequest {
  id: number;
  args: RendererContext;
}
interface AppContextFixture {
  defer: boolean;
  calls: { method: string; args: RendererContext }[];
  pending(): ContextRequest[];
  complete(id: number): void;
  fail(id: number, message: string): void;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function context(page: Page, after = 0): Promise<ContextRequest> {
  await expect
    .poll(() =>
      page.evaluate(
        (after) =>
          (window as unknown as { fixture: AppContextFixture }).fixture
            .pending()
            .some((request) => request.id > after),
        after,
      ),
    )
    .toBe(true);
  const request = await page.evaluate(
    (after) =>
      (window as unknown as { fixture: AppContextFixture }).fixture
        .pending()
        .find((request) => request.id > after),
    after,
  );
  if (!request) throw Error("Missing App context publication");
  return request;
}
async function openPalette(page: Page) {
  await page
    .getByRole("button", { name: /Find a session or command/ })
    .waitFor();
  await page.evaluate(() => {
    (window as unknown as { fixture: AppContextFixture }).fixture.defer = true;
  });
  await page.getByRole("button", { name: /Find a session or command/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Command palette", exact: true }),
  ).toBeVisible();
  const request = await context(page);
  assert.equal(request.args.uiBusy, true);
  return request;
}

test(
  "actual App modal context failures are visible and refresh retries the latest idle state",
  options,
  async () => {
    await withBrowserFixture("app-context-busy-retry", source, async (page) => {
      const busy = await openPalette(page);
      await page.evaluate(
        (id) =>
          (window as unknown as { fixture: AppContextFixture }).fixture.fail(
            id,
            "Busy context refused",
          ),
        busy.id,
      );
      await expect(page.getByRole("alert")).toHaveText(
        /Workspace context: Busy context refused/,
      );
      await page.keyboard.press("Escape");
      const idle = await context(page, busy.id);
      assert.equal(idle.args.uiBusy, false);
      await page.evaluate(
        (id) =>
          (window as unknown as { fixture: AppContextFixture }).fixture.fail(
            id,
            "Idle context refused",
          ),
        idle.id,
      );
      await expect(page.getByRole("alert")).toHaveText(
        /Workspace context: Idle context refused/,
      );
      await page
        .getByRole("button", { name: "Reconnect", exact: true })
        .click();
      const retry = await context(page, idle.id);
      assert.equal(retry.args.uiBusy, false);
      assert.equal(retry.args.selection, null);
      assert.equal(retry.args.visible, true);
      await page.evaluate(
        (id) =>
          (
            window as unknown as { fixture: AppContextFixture }
          ).fixture.complete(id),
        retry.id,
      );
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  },
);

test(
  "a late busy-publication rejection cannot replace the newer closed-modal state",
  options,
  async () => {
    await withBrowserFixture("app-context-busy-stale", source, async (page) => {
      const busy = await openPalette(page);
      await page.keyboard.press("Escape");
      const idle = await context(page, busy.id);
      assert.equal(idle.args.uiBusy, false);
      await page.evaluate(
        ({ busy, idle }) => {
          const fixture = (window as unknown as { fixture: AppContextFixture })
            .fixture;
          fixture.complete(idle);
          fixture.fail(busy, "Stale modal context");
        },
        { busy: busy.id, idle: idle.id },
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  },
);
