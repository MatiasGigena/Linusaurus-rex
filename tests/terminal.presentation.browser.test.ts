import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import type { TerminalFrame } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';
import{TerminalPane}from'/src/terminal/TerminalPane.tsx';import{getCachedTerminal}from'/src/terminal/runtime.ts';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const style=document.createElement('style');style.textContent='html,body,#root{height:100%;margin:0}.terminal-pane{height:100%;display:flex;flex-direction:column;position:relative}.terminal-container{flex:1;min-height:0}.terminal-emulator,.xterm{height:100%}.terminal-pane[aria-hidden="true"]{display:none}';document.head.append(style);
const ref={hostId:'presentation',sessionId:'session',blockId:'pane'},listeners=new Set();let subscription,mount,show,snapshots=0;
function emit(frame){for(const listener of listeners)listener({subscriptionId:subscription,...frame});}
window.fixture={bells:0,emit,mount:value=>mount(value),show:value=>show(value),term:()=>getCachedTerminal(ref).terminal};
window.rex={request:async(method,args)=>{if(method==='subscribe'){subscription=args.subscriptionId;const snapshot=++snapshots;requestAnimationFrame(()=>emit({kind:'snapshot',data:'ready> '+snapshot+' \\x07',cols:80,rows:24}));}},onTerminal:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onCommand:()=>()=>{},readClipboard:async()=>'',writeClipboard:async()=>{}};
function Fixture(){const[mounted,setMounted]=React.useState(true),[visible,setVisible]=React.useState(true);mount=setMounted;show=setVisible;return mounted?React.createElement(TerminalPane,{pane:{id:'pane',label:'Presentation',rect:[0,0,1,1]},terminalRef:ref,settings:{...DEFAULT_SETTINGS,theme:'system',appearance:'system',darkTheme:'midnight',lightTheme:'light',terminalBell:false},visible,focused:true,showHeader:false,onFocus(){},onClose(){},onZoom(){},onBell(){window.fixture.bells++;}}):React.createElement('p',null,'Terminal unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

interface PresentationWindow {
  fixture: {
    bells: number;
    emit(frame: Omit<TerminalFrame, "subscriptionId">): void;
    mount(value: boolean): void;
    show(value: boolean): void;
    term(): Terminal;
    colorChanged?: Promise<void>;
  };
}

test(
  "terminal presentation follows system colors and revokes cached bell/color listeners on unmount",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 20_000 },
  async () => {
    await withBrowserFixture("terminal-presentation", source, async (page) => {
      const bell = () =>
        page.evaluate(async () => {
          const f = (window as unknown as PresentationWindow).fixture;
          f.emit({ kind: "output", data: "\x07" });
          await new Promise<void>((resolve) => f.term().write("", resolve));
          return f.bells;
        });
      const appearance = () =>
        page.evaluate(() => ({
          terminal: (window as unknown as PresentationWindow).fixture.term()
            .options.theme?.background,
          container: getComputedStyle(
            document.querySelector(".terminal-container")!,
          ).backgroundColor,
        }));
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as PresentationWindow).fixture
              .term()
              .buffer.active.getLine(0)
              ?.translateToString(true),
          ),
        )
        .toContain("ready>");
      assert.equal(
        await page.evaluate(
          () => (window as unknown as PresentationWindow).fixture.bells,
        ),
        0,
        "snapshot replay must not publish a live bell",
      );
      assert.equal(await bell(), 1);
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(appearance).toEqual({
        terminal: "#10151f",
        container: "rgb(16, 21, 31)",
      });
      await page.emulateMedia({ colorScheme: "light" });
      await expect.poll(appearance).toEqual({
        terminal: "#f5f6f3",
        container: "rgb(245, 246, 243)",
      });

      await page.evaluate(() =>
        (window as unknown as PresentationWindow).fixture.show(false),
      );
      await expect(page.locator(".terminal-pane")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      assert.equal(
        await bell(),
        2,
        "a live hidden bell still notifies its owner",
      );
      await page.evaluate(() =>
        (window as unknown as PresentationWindow).fixture.mount(false),
      );
      await expect(page.getByText("Terminal unmounted")).toBeVisible();
      const detached = await page.evaluate(async () => {
        const f = (window as unknown as PresentationWindow).fixture;
        const before = {
          bells: f.bells,
          background: f.term().options.theme?.background,
        };
        await new Promise<void>((resolve) => f.term().write("\x07", resolve));
        f.colorChanged = new Promise<void>((resolve) =>
          matchMedia("(prefers-color-scheme: light)").addEventListener(
            "change",
            () => resolve(),
            { once: true },
          ),
        );
        return before;
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.evaluate(
        () => (window as unknown as PresentationWindow).fixture.colorChanged,
      );
      assert.deepEqual(
        await page.evaluate(() => {
          const f = (window as unknown as PresentationWindow).fixture;
          return {
            bells: f.bells,
            background: f.term().options.theme?.background,
          };
        }),
        detached,
      );
      await page.evaluate(() => {
        const f = (window as unknown as PresentationWindow).fixture;
        f.show(true);
        f.mount(true);
      });
      await expect(page.locator(".terminal-container .xterm")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as PresentationWindow).fixture
              .term()
              .buffer.active.getLine(0)
              ?.translateToString(true),
          ),
        )
        .toContain("ready> 2");
      await expect.poll(appearance).toEqual({
        terminal: "#10151f",
        container: "rgb(16, 21, 31)",
      });
      assert.equal(await bell(), 3, "a remount must install one bell listener");
    });
  },
);
