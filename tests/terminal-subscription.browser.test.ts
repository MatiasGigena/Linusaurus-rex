import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import type { TerminalFrame } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';
import{TerminalPane,dispatchTerminalCommandAsync}from'/src/terminal/TerminalPane.tsx';import{getCachedTerminal}from'/src/terminal/runtime.ts';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const style=document.createElement('style');style.textContent='html,body,#root{height:100%;margin:0}.terminal-pane{height:100%;display:flex;flex-direction:column;position:relative}.terminal-container{flex:1;min-height:0}.terminal-emulator,.xterm{height:100%}';document.head.append(style);
const ref={hostId:'subscription',sessionId:'session',blockId:'pane'},settings={...DEFAULT_SETTINGS,cursorBlink:false},listeners=new Set(),calls=[],pending=new Map();let subscription,streams=0,mount,nextId=0;
function emit(frame,id=subscription){for(const listener of listeners)listener({subscriptionId:id,...frame});}
const f=window.fixture={calls,emit,mount:value=>mount(value),listeners:()=>listeners.size,term:()=>getCachedTerminal(ref).terminal,holdUnsubscribe:false,pending:()=>[...pending.keys()],async completeUnsubscribes(){for(const[id,item]of pending){pending.delete(id);item.resolve();await item.promise;}},blockImage(){const kitty=getCachedTerminal(ref).kitty,command=kitty.command;kitty.command=()=>{kitty.command=command;f.imageStarted=true;return new Promise(resolve=>{f.releaseImage=resolve;});};f.imageStarted=false;emit({kind:'output',data:'\\x1b_Gheld\\x1b\\\\'});},overflow(){emit({kind:'output',data:'x'.repeat(16*1024*1024+1)});},paste:()=>dispatchTerminalCommandAsync('paste',ref)};
f.setReporting=value=>{settings.mouseReporting=value;};f.fatalSnapshot=()=>emit({kind:'snapshot',data:'\\x1b_G'+'x'.repeat(24*1024*1024+1)});
window.rex={request(method,args){const id=++nextId;calls.push({id,method,args});if(method==='subscribe'){subscription=args.subscriptionId;const stream=++streams;requestAnimationFrame(()=>{if(!f.holdSnapshots)emit({kind:'snapshot',data:'ready-'+stream+' ',cols:80,rows:24});});}if(method==='unsubscribe'&&f.holdUnsubscribe){let resolve;const promise=new Promise(yes=>{resolve=yes;});pending.set(id,{resolve,promise});return promise;}return Promise.resolve();},onTerminal:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onCommand:()=>()=>{},readClipboard:async()=>'PASTED',writeClipboard:async()=>{}};
function Fixture(){const[mounted,setMounted]=React.useState(true);mount=setMounted;return mounted?React.createElement(TerminalPane,{pane:{id:'pane',label:'Subscription',rect:[0,0,1,1]},terminalRef:ref,settings,visible:true,focused:true,showHeader:false,onFocus(){},onClose(){},onZoom(){}}):React.createElement('p',null,'Terminal unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

interface SubscriptionFixture {
  calls: { id: number; method: string; args: Record<string, unknown> }[];
  emit(frame: Omit<TerminalFrame, "subscriptionId">, id?: string): void;
  mount(value: boolean): void;
  listeners(): number;
  term(): Terminal;
  holdUnsubscribe: boolean;
  holdSnapshots: boolean;
  setReporting(value: boolean): void;
  fatalSnapshot(): void;
  pending(): number[];
  completeUnsubscribes(): Promise<void>;
  blockImage(): void;
  imageStarted: boolean;
  releaseImage(value: string): void;
  overflow(): void;
  paste(): Promise<void>;
  pasteStatus?: string;
}
interface FixtureWindow {
  fixture: SubscriptionFixture;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 20_000 };

async function ready(page: Page, stream: number) {
  await expect
    .poll(async () => {
      await page.clock.runFor(20);
      return page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture
          .term()
          .buffer.active.getLine(0)
          ?.translateToString(true),
      );
    })
    .toContain(`ready-${stream}`);
}
async function setup(page: Page) {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.reload();
  await ready(page, 1);
  await page.clock.pauseAt(new Date("2026-01-02T00:00:00Z"));
  await page.clock.runFor(200);
}
async function overflow(page: Page) {
  await page.evaluate(() => {
    const f = (window as unknown as FixtureWindow).fixture;
    f.holdUnsubscribe = true;
    f.blockImage();
  });
  await expect
    .poll(async () => {
      await page.clock.runFor(10);
      return page.evaluate(
        () => (window as unknown as FixtureWindow).fixture.imageStarted,
      );
    })
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).fixture.overflow(),
  );
  await expect(
    page.getByText(
      "Output exceeded the rendering buffer; resynchronizing with Rex.",
      { exact: true },
    ),
  ).toBeVisible();
}
async function count(page: Page, method: string) {
  return page.evaluate(
    (method) =>
      (window as unknown as FixtureWindow).fixture.calls.filter(
        (call) => call.method === method,
      ).length,
    method,
  );
}

test(
  "a fatal queued snapshot rejects waiting paste and requires a fresh rendered snapshot before new input",
  options,
  async () => {
    await withBrowserFixture("terminal-fatal-frame", source, async (page) => {
      await setup(page);
      await page.evaluate(() => {
        const f = (window as unknown as FixtureWindow).fixture;
        f.holdUnsubscribe = true;
        f.holdSnapshots = true;
        f.blockImage();
      });
      await expect
        .poll(async () => {
          await page.clock.runFor(10);
          return page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.imageStarted,
          );
        })
        .toBe(true);
      await page.evaluate(() => {
        const f = (window as unknown as FixtureWindow).fixture;
        f.fatalSnapshot();
        f.pasteStatus = "pending";
        void f.paste().then(
          () => {
            f.pasteStatus = "complete";
          },
          (error) => {
            f.pasteStatus = String(error);
          },
        );
      });
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.releaseImage(""),
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.pasteStatus,
          ),
        )
        .toContain("exceeds 24 MiB");
      assert.equal(await count(page, "paste"), 0);
      await page.locator(".xterm-helper-textarea").press("x");
      assert.equal(
        await count(page, "key"),
        0,
        "failed framing cannot leave input admitted",
      );
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.completeUnsubscribes(),
      );
      await page.clock.runFor(250);
      assert.equal(await count(page, "subscribe"), 2);
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.emit({
          kind: "output",
          data: "STALE_OUTPUT",
        }),
      );
      await page.locator(".xterm-helper-textarea").press("y");
      assert.equal(
        await count(page, "key"),
        0,
        "ordinary output cannot replace the required recovery snapshot",
      );
      await page.evaluate(() => {
        const f = (window as unknown as FixtureWindow).fixture;
        f.emit({ kind: "snapshot", data: "ready-2 ", cols: 80, rows: 24 });
        f.pasteStatus = "pending";
        void f.paste().then(
          () => {
            f.pasteStatus = "complete";
          },
          (error) => {
            f.pasteStatus = String(error);
          },
        );
      });
      assert.equal(await count(page, "paste"), 0);
      await ready(page, 2);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.pasteStatus,
          ),
        )
        .toBe("complete");
      assert.equal(
        await count(page, "paste"),
        1,
        "only the new command is sent, without replaying the rejected paste",
      );
      await expect(page.locator(".terminal-error")).toHaveCount(0);
    });
  },
);

for (const shift of [false, true]) {
  test(
    `local wheel modes preserve page distances (${shift ? "Shift override" : "reporting disabled"})`,
    options,
    async () => {
      await withBrowserFixture(
        `terminal-wheel-${shift}`,
        source,
        async (page) => {
          await setup(page);
          await page.evaluate((shift) => {
            const f = (window as unknown as FixtureWindow).fixture;
            f.setReporting(shift);
            f.emit({
              kind: "snapshot",
              data:
                Array.from({ length: 300 }, (_, i) => `row-${i}\r\n`).join("") +
                "\x1b[?1000h",
              cols: 80,
              rows: 24,
            });
          }, shift);
          await expect
            .poll(async () => {
              await page.clock.runFor(20);
              return page.evaluate(() => {
                const term = (
                  window as unknown as FixtureWindow
                ).fixture.term();
                return (
                  term.buffer.active.baseY > 200 &&
                  term.modes.mouseTrackingMode !== "none"
                );
              });
            })
            .toBe(true);
          for (const [deltaMode, deltaY] of [
            [2, 1],
            [2, -1],
            [2, 0.5],
            [2, -0.5],
            [1, 2.25],
            [0, 0.25],
          ] as const) {
            const { actual, expected } = await page
              .locator(".xterm-screen")
              .evaluate(
                (screen, { deltaMode, deltaY, shift }) => {
                  const term = (
                    window as unknown as FixtureWindow
                  ).fixture.term();
                  term.scrollToLine(100);
                  const before = term.buffer.active.viewportY;
                  const height =
                    (screen as HTMLElement).clientHeight / term.rows;
                  const lines =
                    deltaMode === 2
                      ? deltaY * term.rows
                      : deltaMode === 1
                        ? deltaY
                        : deltaY / height;
                  screen.dispatchEvent(
                    new WheelEvent("wheel", {
                      bubbles: true,
                      cancelable: true,
                      deltaMode,
                      deltaY,
                      shiftKey: shift,
                    }),
                  );
                  return {
                    actual: term.buffer.active.viewportY,
                    expected:
                      before +
                      Math.sign(lines) *
                        Math.max(1, Math.round(Math.abs(lines))),
                  };
                },
                { deltaMode, deltaY, shift },
              );
            assert.equal(
              actual,
              expected,
              `mode=${deltaMode}, delta=${deltaY}`,
            );
          }
          assert.equal(
            await count(page, "wheel"),
            0,
            "local scrolling must not report server wheel input",
          );
        },
      );
    },
  );
}

test(
  "live backlog recovery waits for unsubscribe and the existing 250ms retry before fresh snapshot readiness",
  options,
  async () => {
    await withBrowserFixture(
      "terminal-subscription-recovery",
      source,
      async (page) => {
        await setup(page);
        const themes = await count(page, "invokeAction");
        await overflow(page);
        assert.equal(await count(page, "subscribe"), 1);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.completeUnsubscribes(),
        );
        await page.clock.runFor(249);
        assert.equal(await count(page, "subscribe"), 1);
        await page.clock.runFor(1);
        assert.equal(await count(page, "subscribe"), 2);
        await page.clock.runFor(20);
        await page.evaluate(() => {
          const f = (window as unknown as FixtureWindow).fixture;
          f.pasteStatus = "pending";
          void f.paste().then(
            () => {
              f.pasteStatus = "complete";
            },
            (error) => {
              f.pasteStatus = String(error);
            },
          );
        });
        assert.equal(await count(page, "paste"), 0);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.releaseImage(""),
        );
        await ready(page, 2);
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as FixtureWindow).fixture.pasteStatus,
            ),
          )
          .toBe("complete");
        assert.equal(await count(page, "paste"), 1);
        assert.equal(
          await count(page, "invokeAction"),
          themes + 1,
          "recovered streams republish the current theme",
        );
        await expect(page.locator(".terminal-error")).toHaveCount(0);
      },
    );
  },
);

test(
  "late overflow unsubscribe settlement cannot resubscribe or deliver frames into a cached remount",
  options,
  async () => {
    await withBrowserFixture(
      "terminal-subscription-disposal",
      source,
      async (page) => {
        await setup(page);
        const oldId = await page.evaluate(
          () =>
            (window as unknown as FixtureWindow).fixture.calls.find(
              (call) => call.method === "subscribe",
            )?.args.subscriptionId,
        );
        assert.equal(typeof oldId, "string");
        await overflow(page);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.mount(false),
        );
        await expect(page.getByText("Terminal unmounted")).toBeVisible();
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture.listeners(),
          ),
          0,
        );
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.completeUnsubscribes(),
        );
        await page.clock.runFor(1000);
        assert.equal(await count(page, "subscribe"), 1);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.mount(true),
        );
        await ready(page, 2);
        await page.evaluate((id) => {
          const f = (window as unknown as FixtureWindow).fixture;
          f.emit({ error: "Old subscription failed" }, String(id));
          f.emit(
            { kind: "output", data: "OLD_SUBSCRIPTION_OUTPUT" },
            String(id),
          );
          f.releaseImage("OLD_IMAGE_CURSOR_MOVE");
        }, oldId);
        await page.clock.runFor(20);
        await expect(page.locator(".terminal-error")).toHaveCount(0);
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture
              .term()
              .buffer.active.getLine(0)
              ?.translateToString(true),
          ),
          "ready-2 ",
        );
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture.listeners(),
          ),
          1,
        );
        assert.equal(await count(page, "subscribe"), 2);
      },
    );
  },
);
