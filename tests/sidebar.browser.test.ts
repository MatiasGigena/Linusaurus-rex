import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Sidebar} from '/src/components/Sidebar.tsx';import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/macos.css';
const fixture=window.fixture={calls:[]};const log=(...args)=>fixture.calls.push(args);
const hosts=[{id:'h1',label:'Local',connected:true,sessions:[{id:'s1',label:'Work',windows:[{id:'w1',label:'Shell',program:'bash',activity:{id:'idle',state:'idle'}},{id:'w2',label:'Build',program:'codex',activity:{id:'build',state:'blocked',kind:'permission'}}]}]},{id:'h2',label:'Remote',connected:true,sessions:[{id:'s2',label:'Remote work',windows:[{id:'r1',label:'Remote shell',program:'fish',activity:{id:'work',state:'working'}}]}]}];
function Fixture(){const[selection,setSelection]=React.useState(['h1','s1','w1']),[collapsed,setCollapsed]=React.useState(new Set()),[width,setWidth]=React.useState(278),[right,setRight]=React.useState(false),[activityOnly,setActivityOnly]=React.useState(false),[hidden,setHidden]=React.useState(false);
 // The next keyboard event must see the committed side, as it would after a user selection.
 fixture.right=value=>flushSync(()=>setRight(value));fixture.activity=setActivityOnly;fixture.hidden=setHidden;
 return React.createElement(Sidebar,{hosts,activeHostId:selection[0],activeSessionId:selection[1],activeWindowId:selection[2],collapsed:hidden,width,settings:{...DEFAULT_SETTINGS,tabStyle:right?'right':'left'},collapsedSessions:collapsed,compactFooter:true,activityCount:2,activityOnly,
 onResize:value=>{log('resize',value);setWidth(value);},onResizeEnd:value=>{log('commit-width',value);setWidth(value);},
 onSelect:(...args)=>{log('select',...args);setSelection(args);},onNewSession:id=>log('new-session',id),onNewWindow:(...args)=>log('new-window',...args),onRenameSession:(...args)=>log('rename-session',...args),onSettings:()=>log('settings'),onToggle:()=>setHidden(value=>!value),onPalette:()=>log('palette'),onAddHost:()=>log('add-host'),onActivity:()=>log('activity'),
 onToggleSession:id=>setCollapsed(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;}),onContextSession:(_event,...args)=>log('session-menu',...args),onContextWindow:(_event,...args)=>log('window-menu',...args),onCloseWindow:(...args)=>log('close-window',...args),onReorderWindow:(...args)=>log('reorder',...args)});
}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

test(
  "sidebar navigation preserves host/session targets while filtering, collapsing and moving tabs",
  options,
  async () => {
    await withBrowserFixture("sidebar-navigation", source, async (page) => {
      const shell = page
        .locator(".window-item")
        .filter({ hasText: "Shell" })
        .filter({ hasNotText: "Remote" });
      const build = page.locator(".window-item").filter({ hasText: "Build" });
      const remote = page
        .locator(".window-item")
        .filter({ hasText: "Remote shell" });
      await remote.click();
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "select",
        "h2",
        "s2",
        "r1",
      ]);
      await expect(remote).toHaveAttribute("aria-current", "page");
      await page.getByLabel("Filter tabs", { exact: true }).fill("CODEX");
      await expect(build).toBeVisible();
      await expect(shell).toHaveCount(0);
      await expect(remote).toHaveCount(0);
      await page
        .getByRole("button", { name: "Clear tab filter", exact: true })
        .click();
      await page.evaluate("window.fixture.activity(true)");
      await expect(shell).toHaveCount(0);
      await expect(build).toBeVisible();
      await expect(remote).toBeVisible();
      await page.evaluate("window.fixture.activity(false)");
      await page
        .getByRole("button", { name: "Collapse Work", exact: true })
        .click();
      await expect(build).toHaveCount(0);
      await page
        .getByRole("button", { name: "Expand Work", exact: true })
        .click();
      await expect(build).toBeVisible();
      await build.dragTo(shell);
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "reorder",
        "h1",
        "s1",
        "w2",
        "w1",
      ]);
      const reorders = await page.evaluate<number>(
        'window.fixture.calls.filter(call=>call[0]==="reorder").length',
      );
      await remote.dragTo(shell);
      await shell.evaluate((element) => {
        for (const value of [
          "not json",
          "null",
          JSON.stringify({ hostId: "h1", sessionId: "s1", windowId: 17 }),
        ]) {
          const transfer = new DataTransfer();
          transfer.setData("application/x-rex-window", value);
          element.dispatchEvent(
            new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
          );
        }
      });
      assert.equal(
        await page.evaluate(
          'window.fixture.calls.filter(call=>call[0]==="reorder").length',
        ),
        reorders,
      );
      await build.click({ button: "middle" });
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "close-window",
        "h1",
        "s1",
        "w2",
      ]);
      await build.click({ button: "right" });
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "window-menu",
        "h1",
        "s1",
        "w2",
      ]);
      await page.locator(".host-toggle").filter({ hasText: "Local" }).click();
      await expect(build).toHaveCount(0);
      await expect(remote).toBeVisible();
    });
  },
);

test(
  "sidebar resize and footer menus preserve direction, bounds and chosen host",
  options,
  async () => {
    await withBrowserFixture("sidebar-controls", source, async (page) => {
      const resizer = page.getByRole("separator", { name: "Sidebar width" });
      await resizer.press("ArrowRight");
      await expect(resizer).toHaveAttribute("aria-valuenow", "288");
      await page.evaluate("window.fixture.right(true)");
      await resizer.press("ArrowRight");
      await expect(resizer).toHaveAttribute("aria-valuenow", "278");
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "commit-width",
        278,
      ]);
      await page
        .getByRole("button", { name: "More options", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "New session on Remote", exact: true })
        .click();
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "new-session",
        "h2",
      ]);
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page
        .getByRole("button", { name: "More options", exact: true })
        .click();
      await page.evaluate("window.fixture.hidden(true)");
      await expect(
        page.getByRole("complementary", { name: "Rex workspaces" }),
      ).toHaveCount(0);
      await page.evaluate("window.fixture.hidden(false)");
      await expect(
        page.getByRole("complementary", { name: "Rex workspaces" }),
      ).toBeVisible();
      await expect(page.getByRole("menu")).toHaveCount(0);
    });
  },
);
