import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { RendererContext, Selection } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

function source({ held = false, strict = false, rejectContext = false } = {}) {
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspace} from '/src/hooks/useWorkspace.ts';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import {updateRendererContext} from '/electron/bridge-contracts.ts';
const initialSelection={hostId:'host',sessionId:'b',windowId:'window-b',blockId:'block-b'};
const globalSelection={hostId:'host',sessionId:'a',windowId:'window-a',blockId:'block-a'};
let stored={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'host',label:'Host',endpoint:'unix:///host.sock'}],lastSelection:globalSelection};
let context={},workspace;const listeners=new Set(),readers=[],trace=[];
// The native WindowContext.getSettings policy: explicit null clears the stored
// selection, otherwise current window context wins over the window launch target.
function nativeSettings(){const settings=structuredClone(stored);if(context.selection===null){delete settings.lastSelection;return settings;}const selected=context.selection??initialSelection;return selected?{...settings,lastSelection:selected}:settings;}
const f=window.fixture={trace,broadcasts:0,preMountSelection:nativeSettings().lastSelection,
 context:()=>structuredClone(context),nativeSelection:()=>nativeSettings().lastSelection,waiting:()=>readers.length,
 releaseSettings(){for(const resolve of readers.splice(0))resolve();},
 busy(value){workspace.publishUiBusy(value);},
 visibility(hidden){Object.defineProperty(document,'hidden',{configurable:true,value:hidden});document.dispatchEvent(new Event('visibilitychange'));},
 refresh(){void workspace.refresh();},
 clear(){workspace.setSelection(undefined);workspace.setFocusedPane(undefined);},
 broadcastGlobals(){f.broadcasts++;for(const listener of listeners)listener({type:'settings',settings:{...stored,lastSelection:globalSelection}});},
};
window.rex={
 async getSettings(){trace.push({phase:'getSettings:entered'});if(${held})await new Promise(resolve=>readers.push(resolve));const saved=nativeSettings();trace.push({phase:'getSettings:return',selection:saved.lastSelection});return saved;},
 async setSettings(next){stored=structuredClone(next);return next;},
 onClientEvent(listener){listeners.add(listener);return()=>listeners.delete(listener);},
 request(method,args){
  if(method==='setContext'){trace.push({phase:'setContext',args:structuredClone(args)});if(${rejectContext})return Promise.reject(new Error('Context unavailable'));context=updateRendererContext(context,args);return Promise.resolve();}
  if(method==='status')return Promise.resolve({connected:true});
  if(method==='listSessions')return Promise.resolve([{id:'a',label:'Global A'},{id:'b',label:'Window B'}]);
  if(method==='inspectSession'){const id=args.sessionId;return Promise.resolve({id,label:id==='a'?'Global A':'Window B',activeWindowId:'window-'+id,windows:[{id:'window-'+id,label:'Tab',focusedBlockId:'block-'+id,panes:[{id:'block-'+id,rect:[0,0,1,1]}],floating:[],minimized:[]}]});}
  if(method==='keymap')return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});
  throw Error('Unexpected '+method);
 }
};
function Fixture(){workspace=useWorkspace();const selected=workspace.selection;const view=selected&&workspace.views[selected.hostId+'/'+selected.sessionId];return React.createElement(React.Fragment,null,React.createElement('h1',null,view?.label||'Loading workspace'),React.createElement('pre',{id:'state'},JSON.stringify({selection:selected,loading:workspace.loading,views:Object.keys(workspace.views),error:workspace.error})));}
createRoot(document.getElementById('root')).render(React.createElement(${strict ? "React.StrictMode" : "React.Fragment"},null,React.createElement(Fixture)));
`;
}

interface BootstrapFixture {
  broadcasts: number;
  preMountSelection: Selection;
  trace: unknown[];
  context(): RendererContext;
  nativeSelection(): Selection | undefined;
  waiting(): number;
  releaseSettings(): void;
  busy(value: boolean): void;
  visibility(hidden: boolean): void;
  refresh(): void;
  clear(): void;
  broadcastGlobals(): void;
}
interface FixtureWindow {
  fixture: BootstrapFixture;
}
interface WorkspaceState {
  loading: boolean;
  views: string[];
  selection?: Selection;
  error?: string;
}
async function state(page: Page): Promise<WorkspaceState> {
  return JSON.parse((await page.locator("#state").textContent()) || "{}");
}
async function assertWindowTarget(page: Page) {
  await expect.poll(async () => (await state(page)).loading).toBe(false);
  await expect.poll(async () => (await state(page)).views.length).toBe(2);
  const evidence = await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).fixture;
    return {
      preMountSelection: fixture.preMountSelection,
      broadcasts: fixture.broadcasts,
      trace: fixture.trace,
    };
  });
  assert.equal(evidence.preMountSelection.sessionId, "b");
  assert.equal(evidence.broadcasts, 0);
  assert.equal(
    await page.getByRole("heading", { level: 1 }).textContent(),
    "Window B",
    JSON.stringify(evidence),
  );
  assert.equal((await state(page)).selection?.sessionId, "b");
}

const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

test(
  "workspace bootstrap preserves the native window target over the global stored selection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-native-target",
      source(),
      assertWindowTarget,
    );
  },
);

test(
  "StrictMode bootstrap holds context admission through busy, visibility and refresh, then permits explicit clearing",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-native-target-held",
      source({ held: true, strict: true }),
      async (page) => {
        await expect
          .poll(() =>
            page.evaluate(() =>
              (window as unknown as FixtureWindow).fixture.waiting(),
            ),
          )
          .toBe(2);
        await page.evaluate(() => {
          const fixture = (window as unknown as FixtureWindow).fixture;
          fixture.busy(true);
          fixture.visibility(true);
          fixture.refresh();
          fixture.releaseSettings();
        });
        await assertWindowTarget(page);
        await expect
          .poll(() =>
            page.evaluate(() =>
              (window as unknown as FixtureWindow).fixture.context(),
            ),
          )
          .toMatchObject({
            selection: { sessionId: "b", blockId: "block-b" },
            uiBusy: true,
            visible: false,
          });
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.clear(),
        );
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as FixtureWindow).fixture.context()
                  .selection,
            ),
          )
          .toBe(null);
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture.nativeSelection(),
          ),
          undefined,
        );
      },
    );
  },
);

test(
  "a refused context write preserves launch targeting and a later global settings broadcast does not replace the window selection",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-native-target-refused",
      source({ rejectContext: true }),
      async (page) => {
        await assertWindowTarget(page);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.broadcastGlobals(),
        );
        await expect
          .poll(async () => (await state(page)).error)
          .toBe("Workspace context: Context unavailable");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          "Window B",
        );
        assert.equal((await state(page)).selection?.sessionId, "b");
      },
    );
  },
);
