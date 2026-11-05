import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{WorkspaceLayout}from'/src/components/workspace/WorkspaceLayout.tsx';
import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import{SupersededSessionInspectionError}from'/src/core/workspaceOperations.ts';
import{dispatchTerminalCommandAsync}from'/src/terminal/commands.ts';
import'/src/styles.css';import'/src/advanced.css';
const listeners=new Set(),calls=[],actions=[],events=[];let select,setHosts,setModal,setWindows;
const ref={hostId:'host',sessionId:'session',blockId:'left'};
window.fixture={calls,actions,events,select:id=>select(id),hosts:value=>setHosts(value),modal:value=>setModal(value),
 floating(rect){setWindows(previous=>previous.map(window=>({...window,panes:window.panes.map(pane=>pane.layerId==='layer'?{...pane,rect}:pane)})));},
 command(){window.fixture.commandStatus='pending';void dispatchTerminalCommandAsync('plugin.example.refresh',ref).then(()=>{window.fixture.commandStatus='complete';},error=>{window.fixture.commandStatus=error.message;});},
 release(){window.fixture.releaseAction();},reject(){window.fixture.rejectAction(new Error('Action refused'));},
 many(){setWindows(Array.from({length:13},(_,index)=>({id:'empty-'+index,label:'Empty '+index,focusedBlockId:'',panes:[]})));},
};
window.rex={request:async(method,args)=>{calls.push({method,args});if(method==='resizeLayer')setWindows(previous=>previous.map(window=>({...window,panes:window.panes.map(pane=>pane.layerId===args.layerId?{...pane,rect:args.bounds}:pane)})));if(method==='subscribe')requestAnimationFrame(()=>{for(const listener of listeners)listener({subscriptionId:args.subscriptionId,kind:'snapshot',data:'ready> ',cols:60,rows:20});});},onTerminal:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},onCommand:()=>()=>{},writeClipboard:async()=>{},readClipboard:async()=>''};
const windows=[{id:'one',label:'Split window',focusedBlockId:'left',panes:[{id:'left',label:'Left',rect:[0,0,.5,1]},{id:'right',label:'Right',rect:[.5,0,.5,1]},{id:'float',label:'Floating',layerId:'layer',layerKind:'floating',rect:[.2,.2,.3,.3]}],dividers:[{beforeBlockId:'left',afterBlockId:'right',direction:'horizontal',rect:[0,0,1,1],ratio:.5}],minimizedLayers:[{id:'minimized-layer',blockId:'minimized',label:'Hidden notes'}]},{id:'two',label:'Other window',focusedBlockId:'other',panes:[{id:'other',label:'Other',rect:[0,0,1,1]}]}];
function Fixture(){
 const element=React.useRef(null),[active,setActive]=React.useState('one'),[hosts,updateHosts]=React.useState([{id:'host',connected:true}]),[modal,updateModal]=React.useState(false),[currentWindows,updateWindows]=React.useState(windows);
 select=setActive;setHosts=updateHosts;setModal=updateModal;setWindows=updateWindows;
 const view={id:'session',label:'Session',activeWindowId:active,windows:currentWindows};
 const operations={getSettings:()=>settings,saveSettings:async next=>{events.push(['settings',next]);return next;},mutateHostAndRefresh:async(hostId,action)=>{events.push(['mutateHostAndRefresh',hostId]);return action();},reloadSession:async(hostId,sessionId)=>{events.push(['reload',hostId,sessionId]);if(window.fixture.reloadFailure==='superseded')throw new SupersededSessionInspectionError();if(window.fixture.reloadFailure==='denied')throw new Error('Resize inspection denied');return view;},focusPane:async target=>{events.push(['focus',target]);},refresh:async()=>{events.push(['refresh']);}};
 const settings={...DEFAULT_SETTINGS,hosts:[{id:'host',label:'Host',endpoint:'unix:///host.sock'}],showPaneHeaders:true,focusFollowsMouse:true,highlightActivePane:false,paddingX:0,paddingY:0,cursorEffect:'off',cursorBlink:false};
 return React.createElement('main',{style:{display:'flex',flexDirection:'column',height:700,width:1000}},React.createElement(WorkspaceLayout,{workspaceElement:element,selection:{hostId:'host',sessionId:'session',windowId:active},views:{'host/session':view},hosts,metadata:{},settings,focusedPane:active==='one'?'left':'other',modalOpen:modal,connectionRevisions:{},operations,onError:message=>events.push(['error',message]),execute:(name,args)=>{actions.push({name,args});return new Promise((resolve,reject)=>{window.fixture.releaseAction=resolve;window.fixture.rejectAction=reject;});}},React.createElement('p',null,'Empty workspace')));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
interface LayoutFixtureWindow {
  fixture: {
    calls: { method: string; args: Record<string, unknown> }[];
    select(id: string): void;
    floating(rect: [number, number, number, number]): void;
  };
}
async function requests(page: Page, method: string) {
  return page.evaluate(
    (method) =>
      (window as unknown as LayoutFixtureWindow).fixture.calls.filter(
        (call) => call.method === method,
      ),
    method,
  );
}

test(
  "retained windows preserve terminal mounts, hide inactive windows, bound retention, and expose reconnect state",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-layout-retention",
      source,
      async (page) => {
        await expect
          .poll(async () => (await requests(page, "subscribe")).length)
          .toBe(3);
        await page.evaluate(
          "window.fixture.left=document.querySelector('[data-block-id=left] .terminal-container');window.fixture.select('two')",
        );
        await expect
          .poll(async () => (await requests(page, "subscribe")).length)
          .toBe(4);
        await expect(page.locator("[data-block-id=left]")).toBeHidden();
        await expect(page.locator("[data-block-id=other]")).toBeVisible();
        await page.evaluate("window.fixture.select('one')");
        await expect(page.locator("[data-block-id=left]")).toBeVisible();
        assert.equal(
          await page.evaluate(
            "window.fixture.left===document.querySelector('[data-block-id=left] .terminal-container')",
          ),
          true,
        );
        assert.equal((await requests(page, "subscribe")).length, 4);
        await page.evaluate("window.fixture.modal(true)");
        await expect(page.locator(".terminal-pane.is-focused")).toHaveCount(0);
        await page.evaluate(
          "window.fixture.hosts([{id:'host',connected:false,error:'Connection unavailable'}])",
        );
        await expect(page.getByText("Connection unavailable")).toBeVisible();
        await page
          .getByRole("button", { name: "Reconnect", exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              "window.fixture.events.some(event=>event[0]==='refresh')",
            ),
          )
          .toBe(true);
        await page.evaluate("window.fixture.many()");
        for (let index = 0; index < 13; index++) {
          await page.evaluate(
            (index) =>
              (window as unknown as LayoutFixtureWindow).fixture.select(
                "empty-" + index,
              ),
            index,
          );
          await expect(
            page.locator(
              `.terminal-layout[data-window-id="empty-${index}"][aria-hidden=false]`,
            ),
          ).toHaveCount(1);
        }
        await expect(page.locator(".terminal-layout")).toHaveCount(12);
      },
    );
  },
);

test(
  "workspace controls preserve explicit pane targets and terminal action promises",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-layout-actions",
      source,
      async (page) => {
        await expect
          .poll(async () => (await requests(page, "subscribe")).length)
          .toBe(3);
        await page.locator("[data-block-id=right]").hover();
        await expect
          .poll(() =>
            page.evaluate(
              "window.fixture.events.some(event=>event[0]==='focus'&&event[1].hostId==='host'&&event[1].sessionId==='session'&&event[1].blockId==='right')",
            ),
          )
          .toBe(true);
        await page
          .getByRole("button", { name: "Hidden notes", exact: true })
          .click();
        assert.deepEqual(await page.evaluate("window.fixture.actions.at(-1)"), {
          name: "pane.restore_floating",
          args: {
            host_id: "host",
            session_id: "session",
            block_id: "minimized",
            layer_id: "minimized-layer",
          },
        });
        await page.evaluate("window.fixture.command()");
        await expect
          .poll(() => page.evaluate("window.fixture.actions.at(-1)?.name"))
          .toBe("plugin.example.refresh");
        assert.deepEqual(
          await page.evaluate("window.fixture.actions.at(-1).args"),
          { host_id: "host", session_id: "session", block_id: "left" },
        );
        assert.equal(
          await page.evaluate("window.fixture.commandStatus"),
          "pending",
        );
        await page.evaluate("window.fixture.release()");
        await expect
          .poll(() => page.evaluate("window.fixture.commandStatus"))
          .toBe("complete");
        await page.evaluate("window.fixture.command()");
        await expect
          .poll(() =>
            page.evaluate(
              "window.fixture.actions.filter(action=>action.name==='plugin.example.refresh').length",
            ),
          )
          .toBe(2);
        await page.evaluate("window.fixture.reject()");
        await expect
          .poll(() => page.evaluate("window.fixture.commandStatus"))
          .toBe("Action refused");
      },
    );
  },
);

test(
  "divider keyboard and pointer controls share bounded geometry and floating controls distinguish moving from resizing",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-layout-geometry",
      source,
      async (page) => {
        const divider = page.getByRole("separator", {
          name: "Resize columns",
          exact: true,
        });
        await expect(divider).toHaveAttribute("aria-orientation", "vertical");
        await expect(divider).toHaveAttribute("aria-valuenow", "50");
        await divider.focus();
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(async () => (await requests(page, "resizeDivider")).length)
          .toBe(1);
        assert.equal(
          (await requests(page, "resizeDivider"))[0].args.ratio,
          0.55,
        );
        const body = await page.locator(".workspace-body").boundingBox();
        assert.ok(body);
        const handle = await divider.boundingBox();
        assert.ok(handle);
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          body.x + body.width + 100,
          handle.y + handle.height / 2,
        );
        await page.mouse.up();
        await expect
          .poll(async () =>
            (await requests(page, "resizeDivider")).some(
              (call) => call.args.ratio === 0.95,
            ),
          )
          .toBe(true);
        assert.equal(
          await page.evaluate(
            "window.fixture.events.some(event=>event[0]==='reload'&&event[1]==='host'&&event[2]==='session')",
          ),
          true,
        );
        const floating = page.locator("[data-floating-block=float]");
        const drag = await floating
          .locator(".floating-drag-handle")
          .boundingBox();
        assert.ok(drag);
        await page.mouse.move(
          drag.x + drag.width / 2,
          drag.y + drag.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          drag.x + drag.width / 2 + 100,
          drag.y + drag.height / 2 + 70,
        );
        await page.mouse.up();
        await expect
          .poll(async () => (await requests(page, "resizeLayer")).length)
          .toBe(1);
        const moved = (await requests(page, "resizeLayer"))[0].args
          .bounds as number[];
        assert.ok(Math.abs(moved[0] - 0.3) < 0.005);
        assert.ok(Math.abs(moved[1] - 0.3) < 0.005);
        assert.deepEqual(moved.slice(2), [0.3, 0.3]);
        const resize = await floating
          .locator(".floating-resize-handle")
          .boundingBox();
        assert.ok(resize);
        await page.mouse.move(
          resize.x + resize.width / 2,
          resize.y + resize.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          resize.x + resize.width / 2 + 100,
          resize.y + resize.height / 2 + 70,
        );
        await page.mouse.up();
        await expect
          .poll(async () => (await requests(page, "resizeLayer")).length)
          .toBe(2);
        const resized = (await requests(page, "resizeLayer"))[1].args
          .bounds as number[];
        assert.deepEqual(resized.slice(0, 2), moved.slice(0, 2));
        assert.ok(Math.abs(resized[2] - 0.4) < 0.005);
        assert.ok(Math.abs(resized[3] - 0.4) < 0.005);
      },
    );
  },
);

test(
  "divider reads ignore recognized supersession but still report a current RPC failure",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-layout-resize-feedback",
      source,
      async (page) => {
        const divider = page.getByRole("separator", {
          name: "Resize columns",
          exact: true,
        });
        const bounds = await divider.boundingBox();
        assert.ok(bounds);
        await page.evaluate("window.fixture.reloadFailure='superseded'");
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2);
        await page.mouse.up();
        await expect
          .poll(() =>
            page.evaluate(
              "window.fixture.events.some(event=>event[0]==='reload')",
            ),
          )
          .toBe(true);
        assert.equal(
          await page.evaluate(
            "window.fixture.events.some(event=>event[0]==='error')",
          ),
          false,
        );
        await page.evaluate("window.fixture.reloadFailure='denied'");
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2);
        await page.mouse.up();
        await expect
          .poll(() =>
            page.evaluate(
              "window.fixture.events.some(event=>event[0]==='error'&&event[1]==='Resize inspection denied')",
            ),
          )
          .toBe(true);
      },
    );
  },
);

test(
  "floating resize preserves available space when the preferred minimum cannot fit",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-floating-edge-resize",
      source,
      async (page) => {
        await page.evaluate(() =>
          (window as unknown as LayoutFixtureWindow).fixture.floating([
            0.9, 0.9, 0.1, 0.1,
          ]),
        );
        const floating = page.locator("[data-floating-block=float]");
        const body = await page.locator(".workspace-body").boundingBox();
        assert.ok(body);
        const handle = await floating
          .locator(".floating-resize-handle")
          .boundingBox();
        assert.ok(handle);
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.width / 2 + 100,
          handle.y + handle.height / 2 + 70,
        );
        const preview = await floating.boundingBox();
        assert.ok(preview);
        assert.equal(
          (await requests(page, "resizeLayer")).length,
          0,
          "Resizing previews locally until pointer release",
        );
        await page.mouse.up();
        await expect
          .poll(async () => (await requests(page, "resizeLayer")).length)
          .toBe(1);
        const bounds = (await requests(page, "resizeLayer"))[0].args
          .bounds as number[];
        assert.deepEqual(bounds.slice(0, 2), [0.9, 0.9]);
        assert.ok(
          bounds[0] + bounds[2] <= 1.000001,
          "Submitted width must fit the remaining workspace",
        );
        assert.ok(
          bounds[1] + bounds[3] <= 1.000001,
          "Submitted height must fit the remaining workspace",
        );
        assert.ok(Math.abs(bounds[2] - 0.1) < 0.000001);
        assert.ok(Math.abs(bounds[3] - 0.1) < 0.000001);
        assert.ok(
          preview.x + preview.width <= body.x + body.width + 0.5,
          "Pointer preview stays inside the right edge",
        );
        assert.ok(
          preview.y + preview.height <= body.y + body.height + 0.5,
          "Pointer preview stays inside the bottom edge",
        );
        await page.evaluate(() =>
          (window as unknown as LayoutFixtureWindow).fixture.floating([
            0.2, 0.2, 0.3, 0.3,
          ]),
        );
        await expect(floating).toHaveCSS("left", `${body.width * 0.2}px`);
        const centered = await floating
          .locator(".floating-resize-handle")
          .boundingBox();
        assert.ok(centered);
        await page.mouse.move(
          centered.x + centered.width / 2,
          centered.y + centered.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          centered.x + centered.width / 2 - body.width * 0.5,
          centered.y + centered.height / 2 - body.height * 0.5,
        );
        await page.mouse.up();
        await expect
          .poll(async () => (await requests(page, "resizeLayer")).length)
          .toBe(2);
        assert.deepEqual(
          (await requests(page, "resizeLayer"))[1].args.bounds,
          [0.2, 0.2, 0.15, 0.15],
          "The preferred minimum still applies when the workspace has room",
        );
      },
    );
  },
);
