import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture.js";

const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {TabStrip} from '/src/components/workspace/TabStrip.tsx';
import {ContextMenu} from '/src/components/ContextMenu.tsx';
import {WindowControls} from '/src/components/WindowControls.tsx';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';import '/src/macos.css';
const fixture=window.fixture={calls:[]};
const initial=[{id:'one',label:'Shell',focusedBlockId:'b1',panes:[{id:'b1',rect:[0,0,1,1],program:'bash'}]},{id:'two',label:'Build',focusedBlockId:'b2',panes:[{id:'b2',rect:[0,0,1,1],program:'codex',activities:[{id:'build',state:'blocked',kind:'permission'}]}]}];
function Fixture(){const [windows,setWindows]=React.useState(initial),[active,setActive]=React.useState('one'),[menu,setMenu]=React.useState(),[variant,setVariant]=React.useState('linux');
 fixture.menu=(x,y)=>setMenu({x,y});fixture.variant=setVariant;
 const log=(...event)=>fixture.calls.push(event);
 return React.createElement(React.Fragment,null,
 React.createElement(TabStrip,{windows,activeId:active,settings:{...DEFAULT_SETTINGS,tabStyle:'top'},onSelect:id=>{log('select',id);setActive(id);},onClose:id=>{log('close',id);setWindows(previous=>previous.filter(item=>item.id!==id));},onNew:()=>log('new'),onContext:(event,id)=>{log('context',id);setMenu({x:event.clientX,y:event.clientY});},onReorder:(id,before)=>{log('reorder',id,before);setWindows(previous=>{const next=previous.filter(item=>item.id!==id);next.splice(next.findIndex(item=>item.id===before),0,previous.find(item=>item.id===id));return next;});}}),
 React.createElement(WindowControls,{variant,onWindowControl:action=>log('window',action)}),
 menu&&React.createElement(ContextMenu,{...menu,onClose:()=>{log('menu-close');setMenu(undefined);},items:[{label:'Unavailable',disabled:true,run:()=>log('disabled')},{label:'Rename',run:()=>log('rename')},null,{label:'Delete',run:()=>log('delete')}]}));
}createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

test(
  "top tabs select, close, create, reorder and expose activity and context actions",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("tab-navigation", source, async (page) => {
      const tabs = page.getByRole("navigation", { name: "Terminal tabs" });
      await expect(
        tabs.getByRole("button", { name: "Shell", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(tabs.getByText("Needs approval")).toBeVisible();
      await tabs.getByRole("button", { name: /^Build Needs approval/ }).click();
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "select",
        "two",
      ]);
      await expect(
        tabs.getByRole("button", { name: /^Build Needs approval/ }),
      ).toHaveAttribute("aria-current", "page");
      await tabs.getByRole("button", { name: "New terminal tab" }).click();
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), [
        "new",
      ]);
      const first = tabs
        .locator(".horizontal-tab")
        .filter({ hasText: "Shell" });
      const second = tabs
        .locator(".horizontal-tab")
        .filter({ hasText: "Build" });
      await second.dragTo(first);
      await expect
        .poll(() =>
          page.evaluate(
            'window.fixture.calls.some(call=>call[0]==="reorder"&&call[1]==="two"&&call[2]==="one")',
          ),
        )
        .toBe(true);
      await expect(tabs.locator(".horizontal-tab").first()).toContainText(
        "Build",
      );
      await second.click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
      assert.ok(
        await page.evaluate(
          'window.fixture.calls.some(call=>call[0]==="context"&&call[1]==="two")',
        ),
      );
      await page.keyboard.press("Escape");
      await first.click({ button: "middle" });
      await expect(tabs.locator(".horizontal-tab")).toHaveCount(1);
      assert.ok(
        await page.evaluate(
          'window.fixture.calls.some(call=>call[0]==="close"&&call[1]==="one")',
        ),
      );
      await tabs.getByRole("button", { name: "Close Build" }).click();
      await expect(tabs.locator(".horizontal-tab")).toHaveCount(0);
    });
  },
);

test(
  "context menu clamps to viewport, skips disabled items and cleans keyboard/outside listeners",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("context-navigation", source, async (page) => {
      await page.evaluate("window.fixture.menu(9999,9999)");
      const menu = page.getByRole("menu");
      await expect(
        page.getByRole("menuitem", { name: "Rename" }),
      ).toBeFocused();
      const bounds = await menu.boundingBox();
      assert.ok(
        bounds &&
          bounds.x >= 8 &&
          bounds.y >= 8 &&
          bounds.x + bounds.width <= 1193 &&
          bounds.y + bounds.height <= 893,
      );
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "Delete" }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "Rename" }),
      ).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(
        page.getByRole("menuitem", { name: "Delete" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu).toHaveCount(0);
      assert.deepEqual(await page.evaluate("window.fixture.calls.slice(-2)"), [
        ["menu-close"],
        ["delete"],
      ]);
      assert.equal(
        await page.evaluate(
          'window.fixture.calls.some(call=>call[0]==="disabled")',
        ),
        false,
      );
      await page.evaluate("window.fixture.menu(20,20)");
      await expect(menu).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(menu).toHaveCount(0);
      const closeCount = await page.evaluate<number>(
        'window.fixture.calls.filter(call=>call[0]==="menu-close").length',
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(
          'window.fixture.calls.filter(call=>call[0]==="menu-close").length',
        ),
        closeCount,
      );
    });
  },
);

test(
  "both window-control variants dispatch minimize, maximize/restore and close",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("window-controls", source, async (page) => {
      for (const variant of ["linux", "traffic"]) {
        await page.evaluate(
          `window.fixture.variant(${JSON.stringify(variant)})`,
        );
        const controls = page.getByRole("group", {
          name: "Application window controls",
        });
        await controls.getByRole("button", { name: "Minimize window" }).click();
        await controls
          .getByRole("button", { name: "Maximize or restore window" })
          .click();
        await controls
          .getByRole("button", { name: "Maximize or restore window" })
          .click();
        await controls
          .getByRole("button", { name: "Close application" })
          .click();
        assert.deepEqual(
          await page.evaluate("window.fixture.calls.slice(-4)"),
          [
            ["window", "minimize"],
            ["window", "maximize"],
            ["window", "maximize"],
            ["window", "close"],
          ],
        );
      }
    });
  },
);
