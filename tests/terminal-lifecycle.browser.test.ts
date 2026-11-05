import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import type { TerminalFrame } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';
import{TerminalPane,dispatchTerminalCommandAsync}from'/src/terminal/TerminalPane.tsx';import{getCachedTerminal}from'/src/terminal/runtime.ts';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const style=document.createElement('style');style.textContent='html,body,#root{margin:0}.terminal-pane{height:100%;display:flex;flex-direction:column;position:relative}.terminal-container{flex:1;min-height:0}.terminal-emulator,.xterm{height:100%}.terminal-pane[aria-hidden="true"]{display:none}';document.head.append(style);
const ref={hostId:'lifecycle',sessionId:'session',blockId:'pane'},settings={...DEFAULT_SETTINGS,cursorBlink:false},listeners=new Set(),calls=[],resizes=new Map();let subscription,streams=0,nextId=0,mount,show,size;
function emit(frame){for(const listener of listeners)listener({subscriptionId:subscription,...frame});}
const f=window.fixture={calls,deferResize:false,emit,term:()=>getCachedTerminal(ref).terminal,mount:value=>mount(value),show:value=>show(value),size:width=>size(width),pendingResizes:()=>[...resizes.values()].filter(item=>!item.settled).map(({id,args})=>({id,args})),async finishResize(id,message){const item=resizes.get(id);if(!item||item.settled)throw Error('Missing resize');item.settled=true;if(message)item.reject(new Error(message));else item.resolve();await item.promise.catch(()=>{});},feedback:()=>dispatchTerminalCommandAsync('plugin.feedback',ref).catch(()=>{})};
window.rex={request(method,args){const id=++nextId;calls.push({id,method,args});if(method==='subscribe'){subscription=args.subscriptionId;const stream=++streams;requestAnimationFrame(()=>emit({kind:'snapshot',data:'ready-'+stream+' ',cols:80,rows:24}));}if(method==='resize'&&f.deferResize){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});resizes.set(id,{id,args,promise,resolve,reject,settled:false});return promise;}return Promise.resolve();},onTerminal:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onCommand:()=>()=>{},readClipboard:async()=>'',writeClipboard:async()=>{}};
function Fixture(){const[mounted,setMounted]=React.useState(true),[visible,setVisible]=React.useState(true),[width,setWidth]=React.useState(800);mount=setMounted;show=setVisible;size=setWidth;return React.createElement('main',{style:{height:400,width}},mounted?React.createElement(TerminalPane,{pane:{id:'pane',label:'Lifecycle',rect:[0,0,1,1]},terminalRef:ref,settings,visible,focused:true,showHeader:false,onFocus(){},onClose(){},onZoom(){},async onAction(){throw Error('Current feedback');}}):React.createElement('p',null,'Terminal unmounted'));}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

interface LifecycleFixture {
  calls: { id: number; method: string; args: Record<string, unknown> }[];
  deferResize: boolean;
  emit(frame: Omit<TerminalFrame, "subscriptionId">): void;
  term(): Terminal;
  mount(value: boolean): void;
  show(value: boolean): void;
  size(width: number): void;
  feedback(): Promise<void>;
  pendingResizes(): { id: number; args: { cols: number; rows: number } }[];
  finishResize(id: number, message?: string): Promise<void>;
}
interface LifecycleWindow {
  fixture: LifecycleFixture;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 20_000 };

async function ready(page: Page, generation = 1) {
  await expect
    .poll(async () => {
      await page.clock.runFor(20);
      return page.evaluate(() =>
        (window as unknown as LifecycleWindow).fixture
          .term()
          .buffer.active.getLine(0)
          ?.translateToString(true),
      );
    })
    .toContain(`ready-${generation}`);
}
async function setup(page: Page) {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.reload();
  await ready(page);
  await page.locator(".xterm-helper-textarea").focus();
  await page.clock.pauseAt(new Date("2026-01-02T00:00:00Z"));
  await page.clock.runFor(200);
}
async function inputs(page: Page) {
  return page.evaluate(() =>
    (window as unknown as LifecycleWindow).fixture.calls
      .filter((call) => call.method === "input")
      .map((call) => call.args.data),
  );
}
async function pendingResize(page: Page, after = 0) {
  let resize:
    ReturnType<LifecycleFixture["pendingResizes"]>[number] | undefined;
  await expect
    .poll(async () => {
      await page.clock.runFor(200);
      resize = await page.evaluate(
        (after) =>
          (window as unknown as LifecycleWindow).fixture
            .pendingResizes()
            .find((item) => item.id > after),
        after,
      );
      return resize?.id;
    })
    .toBeDefined();
  if (!resize) throw Error("Missing resize request");
  return resize;
}
async function beginComposition(page: Page, text: string) {
  await page.locator(".xterm-helper-textarea").evaluate((element, text) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.value = "";
    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Process",
        code: "Unidentified",
        keyCode: 229,
        isComposing: true,
      }),
    );
    textarea.value = text;
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: text }),
    );
  }, text);
}
async function finishComposition(page: Page, text: string) {
  await page.locator(".xterm-helper-textarea").evaluate((element, text) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: text,
        isComposing: true,
      }),
    );
    textarea.value = text;
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: text }),
    );
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }, text);
  await page.clock.runFor(10);
}

test(
  "registered DOM composition, beforeinput and dead-key sequences send committed text exactly once",
  options,
  async () => {
    await withBrowserFixture("terminal-native-input", source, async (page) => {
      await setup(page);
      await beginComposition(page, "日本");
      assert.deepEqual(await inputs(page), []);
      await finishComposition(page, "日本");
      assert.deepEqual(await inputs(page), ["日本"]);
      await page.locator(".xterm-helper-textarea").evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.value = "";
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Process",
            code: "Unidentified",
            keyCode: 229,
          }),
        );
        textarea.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            inputType: "insertCompositionText",
            data: "漢",
            isComposing: true,
          }),
        );
        textarea.value = "漢";
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "漢",
          }),
        );
      });
      await page.clock.runFor(10);
      assert.deepEqual(await inputs(page), ["日本", "漢"]);
      await page.locator(".xterm-helper-textarea").evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.value = "";
        for (const event of [
          new KeyboardEvent("keydown", {
            key: "Dead",
            code: "Quote",
            keyCode: 222,
            bubbles: true,
            cancelable: true,
          }),
          new KeyboardEvent("keyup", {
            key: "Dead",
            code: "Quote",
            keyCode: 222,
            bubbles: true,
            cancelable: true,
          }),
          new KeyboardEvent("keydown", {
            key: "e",
            code: "KeyE",
            keyCode: 69,
            bubbles: true,
            cancelable: true,
          }),
          new KeyboardEvent("keypress", {
            key: "é",
            code: "KeyE",
            charCode: 233,
            keyCode: 233,
            bubbles: true,
            cancelable: true,
          }),
          new KeyboardEvent("keyup", {
            key: "e",
            code: "KeyE",
            keyCode: 69,
            bubbles: true,
            cancelable: true,
          }),
        ])
          textarea.dispatchEvent(event);
      });
      await page.clock.runFor(10);
      assert.deepEqual(await inputs(page), ["日本", "漢", "é"]);
      await page.keyboard.press("a");
      await page.clock.runFor(10);
      const keys = await page.evaluate(() =>
        (window as unknown as LifecycleWindow).fixture.calls
          .filter((call) => call.method === "key")
          .map((call) => call.args.event),
      );
      assert.deepEqual(keys, [
        {
          key: "key_a",
          text: "a",
          mods: "",
          consumed_mods: "",
          unshifted_codepoint: 97,
          composing: false,
          action: "press",
        },
        {
          key: "key_a",
          text: "",
          mods: "",
          consumed_mods: "",
          unshifted_codepoint: 97,
          composing: false,
          action: "release",
        },
      ]);
      assert.deepEqual(await inputs(page), ["日本", "漢", "é"]);
    });
  },
);

for (const boundary of ["hide", "reconnect", "remount"] as const) {
  test(
    `a DOM composition invalidated by ${boundary} cannot commit into its replacement input lifetime`,
    options,
    async () => {
      await withBrowserFixture(
        `terminal-composition-${boundary}`,
        source,
        async (page) => {
          await setup(page);
          await beginComposition(page, "stale");
          if (boundary === "hide") {
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.show(false),
            );
            await expect(page.locator(".terminal-pane")).toHaveAttribute(
              "aria-hidden",
              "true",
            );
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.show(true),
            );
            await expect(page.locator(".terminal-pane")).toHaveAttribute(
              "aria-hidden",
              "false",
            );
          } else if (boundary === "reconnect") {
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.emit({
                error: "Transport lost",
              }),
            );
            await expect(
              page.getByText("Transport lost", { exact: true }),
            ).toBeVisible();
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.emit({
                kind: "snapshot",
                data: "ready-2 ",
              }),
            );
            await ready(page, 2);
          } else {
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.mount(false),
            );
            await expect(page.getByText("Terminal unmounted")).toBeVisible();
            await page.evaluate(() =>
              (window as unknown as LifecycleWindow).fixture.mount(true),
            );
            await ready(page, 2);
          }
          await page.locator(".xterm-helper-textarea").evaluate((element) => {
            element.dispatchEvent(
              new KeyboardEvent("keyup", {
                bubbles: true,
                key: "Process",
                code: "Unidentified",
                keyCode: 229,
              }),
            );
          });
          await finishComposition(page, "stale");
          assert.deepEqual(
            await inputs(page),
            [],
            "late native composition must not replay after reset/disposal",
          );
          await beginComposition(page, "fresh");
          await finishComposition(page, "fresh");
          assert.deepEqual(await inputs(page), ["fresh"]);
        },
      );
    },
  );
}

test(
  "a late superseded resize rejection preserves current feedback and viewport deduplication",
  options,
  async () => {
    await withBrowserFixture(
      "terminal-viewport-request-owner",
      source,
      async (page) => {
        await setup(page);
        await page.evaluate(() => {
          const f = (window as unknown as LifecycleWindow).fixture;
          f.deferResize = true;
          f.size(640);
        });
        const old = await pendingResize(page);
        await page.evaluate(() =>
          (window as unknown as LifecycleWindow).fixture.size(960),
        );
        const current = await pendingResize(page, old.id);
        assert.notEqual(current.args.cols, old.args.cols);
        await page.evaluate(async (id) => {
          const f = (window as unknown as LifecycleWindow).fixture;
          await f.finishResize(id);
          await f.feedback();
        }, current.id);
        await expect(
          page.getByText("Current feedback", { exact: true }),
        ).toBeVisible();
        await page.evaluate(
          (id) =>
            (window as unknown as LifecycleWindow).fixture.finishResize(
              id,
              "Old resize denied",
            ),
          old.id,
        );
        await page.clock.runFor(20);
        const feedback = await page
          .locator(".terminal-error span")
          .textContent();
        const before = await page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).fixture.calls.filter(
              (call) => call.method === "resize",
            ).length,
        );
        await page.evaluate(() => {
          const f = (window as unknown as LifecycleWindow).fixture;
          f.emit({ kind: "resize", cols: f.term().cols, rows: f.term().rows });
        });
        await page.clock.runFor(200);
        const after = await page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).fixture.calls.filter(
              (call) => call.method === "resize",
            ).length,
        );
        assert.deepEqual(
          { feedback, extraResizes: after - before },
          { feedback: "Current feedback", extraResizes: 0 },
        );
      },
    );
  },
);

test(
  "the current resize failure remains visible and permits retry at unchanged dimensions",
  options,
  async () => {
    await withBrowserFixture(
      "terminal-viewport-current-failure",
      source,
      async (page) => {
        await setup(page);
        await page.evaluate(() => {
          const f = (window as unknown as LifecycleWindow).fixture;
          f.deferResize = true;
          f.size(640);
        });
        const current = await pendingResize(page);
        await page.evaluate(
          (id) =>
            (window as unknown as LifecycleWindow).fixture.finishResize(
              id,
              "Current resize denied",
            ),
          current.id,
        );
        await expect(
          page.getByText("Resize failed: Current resize denied", {
            exact: true,
          }),
        ).toBeVisible();
        await page.evaluate(() => {
          const f = (window as unknown as LifecycleWindow).fixture;
          f.emit({ kind: "resize", cols: f.term().cols, rows: f.term().rows });
        });
        const retry = await pendingResize(page, current.id);
        assert.deepEqual(retry.args, current.args);
        await page.evaluate(
          (id) =>
            (window as unknown as LifecycleWindow).fixture.finishResize(id),
          retry.id,
        );
        await expect(page.locator(".terminal-error")).toHaveCount(0);
      },
    );
  },
);
