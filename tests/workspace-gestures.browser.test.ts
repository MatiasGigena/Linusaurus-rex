import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspaceGestures} from '/src/hooks/useWorkspaceGestures.ts';
const calls=[];let update,show,setVersion;
window.fixture={calls,ready:false,
 update(patch){update(current=>({...current,...patch}));},
 version(value){setVersion(value);},unmount(){show(false);},
 wheel(options){const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,...options});window.fixture.element.dispatchEvent(event);return event.defaultPrevented;}
};
function Gestures(){
 const element=React.useRef(null);
 const [settings,setSettings]=React.useState({trackpadGestures:true,sidebarGesture:'off',tabStyle:'left',sidebarCollapsed:false,zoomedBlockId:undefined});
 const [version,nextVersion]=React.useState(1);update=setSettings;setVersion=nextVersion;
 const active={id:'window',zoomedBlockId:settings.zoomedBlockId};
 useWorkspaceGestures(element,settings,active,name=>calls.push({name,version}));
 React.useEffect(()=>{window.fixture.ready=true;},[]);
 return React.createElement('div',null,
   React.createElement('div',{id:'gesture-target',ref:node=>{element.current=node;if(node)window.fixture.element=node;}},'Workspace gesture target'),
   React.createElement('pre',{id:'gesture-state'},JSON.stringify({version,...settings})));
}
function Root(){const[visible,setVisible]=React.useState(true);show=setVisible;return visible?React.createElement(Gestures):React.createElement('p',null,'Gestures unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Root));
`;
interface GestureWindow {
  fixture: {
    ready: boolean;
    calls: { name: string; version: number }[];
    update(patch: Record<string, unknown>): void;
    version(value: number): void;
    unmount(): void;
    wheel(options: {
      deltaX?: number;
      deltaY?: number;
      ctrlKey?: boolean;
      altKey?: boolean;
    }): boolean;
  };
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function wheel(
  page: Page,
  event: Parameters<GestureWindow["fixture"]["wheel"]>[0],
) {
  return page.evaluate(
    (event) => (window as unknown as GestureWindow).fixture.wheel(event),
    event,
  );
}
async function calls(page: Page) {
  return page.evaluate(
    () => (window as unknown as GestureWindow).fixture.calls,
  );
}
async function update(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    (patch) => (window as unknown as GestureWindow).fixture.update(patch),
    patch,
  );
  await expect
    .poll(async () => {
      const state = JSON.parse(
        await page.locator("#gesture-state").innerText(),
      ) as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(patch).map((key) => [key, state[key]]),
      );
    })
    .toEqual(patch);
}

test(
  "pinch gestures respect accumulated threshold and burst boundaries, use the latest callback, and remove capture listeners on unmount",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-gestures-pinch",
      source,
      async (page) => {
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as GestureWindow).fixture.ready,
            ),
          )
          .toBe(true);
        await page.clock.install();
        assert.equal(await wheel(page, { deltaY: -15, ctrlKey: true }), true);
        assert.deepEqual(await calls(page), []);
        await wheel(page, { deltaY: -1, ctrlKey: true });
        await wheel(page, { deltaY: -50, ctrlKey: true });
        assert.deepEqual(await calls(page), [
          { name: "pane.zoom", version: 1 },
        ]);
        await page.evaluate(() =>
          (window as unknown as GestureWindow).fixture.version(2),
        );
        await expect(page.locator("#gesture-state")).toContainText(
          '"version":2',
        );
        await page.clock.runFor(301);
        await wheel(page, { deltaY: -16, ctrlKey: true });
        assert.deepEqual(await calls(page), [
          { name: "pane.zoom", version: 1 },
          { name: "pane.zoom", version: 2 },
        ]);
        await update(page, { zoomedBlockId: "pane" });
        await page.clock.runFor(301);
        await wheel(page, { deltaY: -16, ctrlKey: true });
        assert.equal(
          (await calls(page)).length,
          2,
          "pinching toward an already zoomed state must not toggle it off",
        );
        await page.clock.runFor(301);
        await wheel(page, { deltaY: 16, ctrlKey: true });
        assert.equal((await calls(page)).length, 3);
        await update(page, { trackpadGestures: false });
        assert.equal(await wheel(page, { deltaY: 16, ctrlKey: true }), false);
        await update(page, { trackpadGestures: true });
        await page.evaluate(() =>
          (window as unknown as GestureWindow).fixture.unmount(),
        );
        await expect(page.getByText("Gestures unmounted")).toBeVisible();
        await page.clock.runFor(301);
        assert.equal(
          await wheel(page, { deltaY: -20, ctrlKey: true }),
          false,
          "the detached workspace must lose its capture listener",
        );
        assert.equal((await calls(page)).length, 3);
      },
    );
  },
);

test(
  "sidebar swipes require the configured modifier and horizontal threshold and respect sidebar placement",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-gestures-swipe",
      source,
      async (page) => {
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as GestureWindow).fixture.ready,
            ),
          )
          .toBe(true);
        await page.clock.install();
        await update(page, { sidebarGesture: "alt-swipe" });
        assert.equal(await wheel(page, { deltaX: 100 }), false);
        assert.equal(await wheel(page, { deltaX: 90, altKey: true }), true);
        assert.deepEqual(await calls(page), []);
        await wheel(page, { deltaX: 1, altKey: true });
        await wheel(page, { deltaX: 100, altKey: true });
        assert.deepEqual(await calls(page), [
          { name: "client.sidebar.toggle", version: 1 },
        ]);
        await update(page, { sidebarGesture: "swipe", tabStyle: "right" });
        await page.clock.runFor(301);
        await wheel(page, { deltaX: 100 });
        assert.equal(
          (await calls(page)).length,
          1,
          "right-side collapse uses the opposite horizontal direction",
        );
        await page.clock.runFor(301);
        await wheel(page, { deltaX: -91 });
        assert.equal((await calls(page)).length, 2);
        await update(page, { sidebarCollapsed: true });
        await page.clock.runFor(301);
        await wheel(page, { deltaX: -91 });
        assert.equal(
          (await calls(page)).length,
          2,
          "already collapsed swipes must not reopen the sidebar",
        );
        await page.clock.runFor(301);
        await wheel(page, { deltaX: 91 });
        assert.equal((await calls(page)).length, 3);
        await update(page, { sidebarGesture: "off" });
        assert.equal(await wheel(page, { deltaX: 120 }), false);
      },
    );
  },
);
