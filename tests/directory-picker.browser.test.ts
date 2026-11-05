import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture.js";

const source = (
  mode: "insert" | "directory",
  failure: "reconcile" | "history" | "write",
) => `
import React from'react';import{createRoot}from'react-dom/client';
import{DirectoryDialog}from'/src/components/DirectoryDialog.tsx';
import{pickDirectoryPath}from'/src/workspace/actions/directoryActions.ts';
import{WorkspaceReconciliationError}from'/src/core/workspaceOperations.ts';
import{terminalCommands}from'/src/terminal/commands.ts';
import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const target={hostId:'host',sessionId:'session',blockId:'pane'};
const f=window.fixture={writes:0,histories:0,reads:0,closed:0,readFailure:true,writeFailure:${failure === "write"},hold:false};
window.rex={async request(method,args){if(method==='listDirectory')return{status:'ok',path:'/work',entries:[{name:'file.txt',file:true},{name:'nested'}],truncated:false};if(method==='newWindow'||method==='paste'){f.writes++;if(f.writeFailure)throw Error('Write refused');return;}throw Error('Unexpected '+method);}};
terminalCommands.register(target,{available:()=>true,focused:()=>false,onError(){},async execute(request,signal,completion){if(typeof request==='string'||request.command!=='paste')throw Error('Unexpected terminal command');if(completion!=='settled')throw Error('Directory paste must settle');await window.rex.request('paste',{...target,text:request.text});}});
const workspace={getSettings:()=>DEFAULT_SETTINGS,async saveSettings(settings){f.histories++;if(${failure === "history"})throw Error('History disk unavailable');return settings;},async mutateSession(plan,action){const result=await action();if(${failure === "reconcile"})throw new WorkspaceReconciliationError(Error('Inspection unavailable'));return{result,view:{id:'session',label:'Session',windows:[]}};}};
function Fixture(){const[endpoint,setEndpoint]=React.useState('unix:///first.sock');f.replace=()=>setEndpoint('unix:///replacement.sock');return React.createElement(DirectoryDialog,{terminalRef:target,endpoint,mode:${JSON.stringify(mode)},recent:['/recent'],onPick:async path=>{if(f.hold){await new Promise((resolve,reject)=>{f.release=success=>success?resolve():reject(new WorkspaceReconciliationError(Error('Old inspection failed')));});return;}await pickDirectoryPath(workspace,{mode:${JSON.stringify(mode)},ref:target},path);},async onRefresh(){f.reads++;if(f.readFailure)throw Error('Refresh unavailable');},onClose(){f.closed++;}});}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

for (const [mode, failure] of [
  ["directory", "reconcile"],
  ["insert", "history"],
] as const) {
  test(
    `${mode} picker locks completed writes and recovers with reads only after ${failure} failure`,
    options,
    async () => {
      await withBrowserFixture(
        `directory-${failure}-recovery`,
        source(mode, failure),
        async (page) => {
          const pick = page.getByRole("button", {
            name:
              mode === "insert" ? "Insert selected path" : "Open terminal here",
            exact: true,
          });
          await expect(pick).toBeEnabled();
          await pick.click();
          await expect(page.getByRole("alert")).toContainText(
            failure === "history" ? "saving recent paths" : "change completed",
          );
          await expect(pick).toBeDisabled();
          // Both keyboard file activation and recent-path shortcuts must respect the lock.
          if (mode === "insert") {
            await page
              .getByRole("button", { name: "recent", exact: true })
              .click({ force: true });
            await page
              .getByRole("option", { name: /file\.txt/ })
              .press("Enter");
          }
          await page
            .getByRole("button", { name: "Home directory", exact: true })
            .click();
          await expect(page.getByRole("alert")).toContainText(
            failure === "history" ? "saving recent paths" : "change completed",
          );
          await expect(pick).toBeDisabled();
          assert.equal(await page.evaluate("window.fixture.writes"), 1);
          const refresh = page.getByRole("button", {
            name: "Refresh workspace",
            exact: true,
          });
          await refresh.click();
          await expect(page.getByRole("alert")).toContainText(
            "Refresh unavailable",
          );
          await expect(pick).toBeDisabled();
          await page.evaluate("window.fixture.readFailure=false");
          await refresh.click();
          await expect
            .poll(() => page.evaluate("window.fixture.closed"))
            .toBe(1);
          assert.equal(await page.evaluate("window.fixture.reads"), 2);
          assert.equal(await page.evaluate("window.fixture.writes"), 1);
          assert.equal(
            await page.evaluate("window.fixture.histories"),
            failure === "history" ? 1 : 0,
          );
        },
      );
    },
  );
}

test(
  "a directory write refusal permits an explicit retry without recording an unused path",
  options,
  async () => {
    await withBrowserFixture(
      "directory-write-retry",
      source("directory", "write"),
      async (page) => {
        const pick = page.getByRole("button", {
          name: "Open terminal here",
          exact: true,
        });
        await expect(pick).toBeEnabled();
        await pick.click();
        await expect(page.getByRole("alert")).toHaveText("Write refused");
        await expect(pick).toBeEnabled();
        assert.equal(await page.evaluate("window.fixture.histories"), 0);
        await page.evaluate("window.fixture.writeFailure=false");
        await pick.click();
        await expect.poll(() => page.evaluate("window.fixture.writes")).toBe(2);
        // A successful write reaches this fixture's ordinary history persistence.
        await expect.poll(() => page.evaluate("window.fixture.closed")).toBe(1);
        assert.equal(await page.evaluate("window.fixture.histories"), 1);
      },
    );
  },
);

for (const success of [true, false]) {
  test(
    `endpoint replacement ignores an old picker ${success ? "success" : "committed failure"}`,
    options,
    async () => {
      await withBrowserFixture(
        `directory-owner-${success}`,
        source("directory", "write"),
        async (page) => {
          await page.evaluate("window.fixture.hold=true");
          const pick = page.getByRole("button", {
            name: "Open terminal here",
            exact: true,
          });
          await expect(pick).toBeEnabled();
          await pick.click();
          await expect
            .poll(() => page.evaluate("typeof window.fixture.release"))
            .toBe("function");
          await page.evaluate("window.fixture.replace()");
          await expect(pick).toBeEnabled();
          await page.evaluate((success) => {
            (
              window as unknown as {
                fixture: { release(success: boolean): void };
              }
            ).fixture.release(success);
          }, success);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              ),
          );
          assert.equal(await page.evaluate("window.fixture.closed"), 0);
          await expect(page.getByRole("alert")).toHaveCount(0);
          await expect(pick).toBeEnabled();
        },
      );
    },
  );
}
