import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
const source = `import React from 'react';import{createRoot}from'react-dom/client';import{TerminalPane,dispatchTerminalCommandAsync}from'/src/terminal/TerminalPane.tsx';import{getCachedTerminal}from'/src/terminal/runtime.ts';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const ref={hostId:'graphics',sessionId:'test',blockId:'test'};let subscription,update,show;const listeners=new Set(),requests=[];window.rex={request:async(method,args)=>{requests.push({method,args});if(method==='subscribe'){subscription=args.subscriptionId;setTimeout(()=>emit({kind:'snapshot',data:'ready> ',cols:80,rows:24}),20)}},onTerminal:callback=>{listeners.add(callback);return()=>listeners.delete(callback)},writeClipboard:async()=>{},readClipboard:async()=>''};function emit(frame){for(const callback of listeners)callback({subscriptionId:subscription,...frame})}
function Fixture(){const[settings,setSettings]=React.useState({...DEFAULT_SETTINGS,ligatures:false}),[visible,setVisible]=React.useState(true);show=setVisible;update=patch=>setSettings(previous=>({...previous,...patch}));return React.createElement(TerminalPane,{pane:{id:'test',label:'Graphics',rect:[0,0,1,1]},terminalRef:ref,settings,visible,focused:true,showHeader:true,onFocus(){},onClose(){},onZoom(){}})}createRoot(document.getElementById('root')).render(React.createElement(Fixture));window.fixture={emit,show:value=>show(value),update:patch=>update(patch),runtime:()=>getCachedTerminal(ref),command:dispatchTerminalCommandAsync,requests};`;
const html =
  '<!doctype html><style>html,body,#root{height:100%;margin:0}.terminal-pane{height:100%;display:flex;flex-direction:column;position:relative}.terminal-container{flex:1;min-height:0}.terminal-emulator,.xterm{height:100%}.pane-header{height:25px}.terminal-pane[aria-hidden="true"]{display:none}</style><div id="root"></div><script type="module" src="/fixture.js"></script>';

test(
  "real terminal renders Kitty, Sixel and inline PNG images plus Linux visual settings",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 40000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: "node_modules/.vite-graphics-test",
      plugins: [
        react(),
        {
          name: "fixture",
          configureServer(server) {
            server.middlewares.use("/graphics", (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            });
          },
          resolveId(id) {
            return id === "/fixture.js" ? "\0graphics-fixture" : undefined;
          },
          load(id) {
            return id === "\0graphics-fixture" ? source : undefined;
          },
        },
      ],
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        watch: {
          ignored: [
            "**/dist/**",
            "**/dist-electron/**",
            "**/release/**",
            "**/test-results*/**",
          ],
        },
      },
    });
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
    });
    try {
      const page = await browser.newPage({
          viewport: { width: 900, height: 600 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warn"].includes(message.type()))
          console.log("graphics browser", message.text());
      });
      await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await page.goto(`http://127.0.0.1:${address.port}/graphics`);
      await page
        .waitForFunction(
          () =>
            (window as any).fixture
              ?.runtime()
              ?.terminal.buffer.active.getLine(0)
              ?.translateToString(true)
              .includes("ready>"),
          undefined,
          { timeout: 7000 },
        )
        .catch(async (failure) => {
          console.log(
            "Graphics initialization",
            errors,
            await page.evaluate(() => {
              const t = (window as any).fixture?.runtime()?.terminal;
              return (
                t &&
                Array.from(
                  { length: Math.min(t.buffer.active.length, 40) },
                  (_, i) => t.buffer.active.getLine(i)?.translateToString(true),
                )
              );
            }),
          );
          throw failure;
        });
      const emit = async (data: string) => {
        await page.evaluate(
          (data) => (window as any).fixture.emit({ kind: "output", data }),
          data,
        );
      };
      // Raw RGB, with APC boundaries split across frames, and no cursor movement.
      const initialCursor = await page.evaluate(() => {
        const b = (window as any).fixture.runtime().terminal.buffer.active;
        return [b.cursorX, b.cursorY];
      });
      const kitty =
        "\x1b_Ga=T,f=24,s=2,v=1,i=7,c=4,r=2,C=1;" +
        Buffer.from([255, 0, 0, 0, 255, 0]).toString("base64") +
        "\x1b\\";
      for (const part of [
        kitty.slice(0, 1),
        kitty.slice(1, 5),
        kitty.slice(5, -1),
        kitty.slice(-1),
      ])
        await emit(part);
      await page.locator('canvas[data-kitty-image="7"]').waitFor();
      assert.deepEqual(
        await page
          .locator('canvas[data-kitty-image="7"]')
          .evaluate((canvas) =>
            Array.from(
              (canvas as HTMLCanvasElement)
                .getContext("2d")!
                .getImageData(0, 0, 2, 1).data,
            ),
          ),
        [255, 0, 0, 255, 0, 255, 0, 255],
      );
      assert.deepEqual(
        await page.evaluate(() => {
          const b = (window as any).fixture.runtime().terminal.buffer.active;
          return [b.cursorX, b.cursorY];
        }),
        initialCursor,
      );
      // Multipart transfer and zlib decompression are real decoded pixels.
      const encoded = deflateSync(Buffer.from([0, 0, 255, 255])).toString(
        "base64",
      );
      const split = Math.floor(encoded.length / 8) * 4;
      await emit(
        "\x1b_Ga=t,f=32,s=1,v=1,i=8,o=z,m=1;" +
          encoded.slice(0, split) +
          "\x1b\\",
      );
      await emit("\x1b_Gm=0;" + encoded.slice(split) + "\x1b\\");
      await emit("\x1b_Ga=p,i=8,p=2,c=2,r=2,C=1;\x1b\\");
      await page.locator('canvas[data-kitty-image="8"]').waitFor();
      assert.deepEqual(
        await page
          .locator('canvas[data-kitty-image="8"]')
          .evaluate((canvas) =>
            Array.from(
              (canvas as HTMLCanvasElement)
                .getContext("2d")!
                .getImageData(0, 0, 1, 1).data,
            ),
          ),
        [0, 0, 255, 255],
      );
      await page.evaluate(() => (window as any).fixture.show(false));
      await page.waitForFunction(() =>
        (window as any).fixture.requests.some(
          (request: any) => request.method === "releaseViewport",
        ),
      );
      const hiddenResizes = await page.evaluate(
        () =>
          (window as any).fixture.requests.filter(
            (request: any) => request.method === "resize",
          ).length,
      );
      await emit(
        "\x1b_Ga=T,f=24,s=1,v=1,i=9,c=1,r=1,C=1;" +
          Buffer.from([255, 255, 0]).toString("base64") +
          "\x1b\\",
      );
      await page
        .locator('canvas[data-kitty-image="9"]')
        .waitFor({ state: "attached" });
      await page.clock.fastForward(120);
      assert.equal(
        await page.evaluate(
          () =>
            (window as any).fixture.requests.filter(
              (request: any) => request.method === "resize",
            ).length,
        ),
        hiddenResizes,
        "Hidden streams must not claim a viewport",
      );
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.locator('canvas[data-kitty-image="8"]').waitFor();
      await page.locator('canvas[data-kitty-image="9"]').waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            (window as any).fixture.requests.filter(
              (request: any) => request.method === "subscribe",
            ).length,
        ),
        1,
        "Tab switches must preserve the graphics-bearing data channel",
      );
      await emit("\x1b_Ga=d,d=I,i=7;\x1b\\");
      await page
        .locator('canvas[data-kitty-image="7"]')
        .waitFor({ state: "detached" });
      // The released official addon handles Sixel and IIP; it does not generate duplicate program replies.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            (window as any).fixture.runtime().terminal.write("", resolve),
          ),
      );
      await emit('\x1b[1;1H\x1bPq"1;1;8;6#0;2;100;0;0#0!8~\x1b\\');
      await page.waitForFunction(
        () => (window as any).fixture.runtime().images.storageUsage > 0,
      );
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        const c = canvas.getContext("2d")!;
        c.fillStyle = "#0000ff";
        c.fillRect(0, 0, 2, 2);
        return canvas.toDataURL().split(",")[1];
      });
      const usage = await page.evaluate(
        () => (window as any).fixture.runtime().images.storageUsage,
      );
      await emit(
        "\x1b[3;1H\x1b]1337;File=size=" +
          Buffer.from(png, "base64").length +
          ";inline=1;width=3;height=2;preserveAspectRatio=0:" +
          png +
          "\x07",
      );
      await page.waitForFunction(
        (usage) =>
          (window as any).fixture.runtime().images.storageUsage > usage,
        usage,
      );
      await emit("\x1b_Ga=T,f=100,i=10,c=2,r=2,C=1;" + png + "\x1b\\");
      await page.locator('canvas[data-kitty-image="10"]').waitFor();
      assert.deepEqual(
        await page
          .locator('canvas[data-kitty-image="10"]')
          .evaluate((canvas) =>
            Array.from(
              (canvas as HTMLCanvasElement)
                .getContext("2d")!
                .getImageData(0, 0, 1, 1).data,
            ),
          ),
        [0, 0, 255, 255],
      );
      assert.equal(
        await page.evaluate(
          () =>
            (window as any).fixture.requests.filter(
              (request: any) => request.method === "input",
            ).length,
        ),
        0,
      );
      // Color mapping affects existing cells and restores the raw RGB attributes when disabled.
      await emit("\x1b[6;1H\x1b[38;2;254;1;2mRGB_COLOR\x1b[0m");
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".xterm-rows span")].some(
          (span) => span.textContent === "RGB_COLOR",
        ),
      );
      const rgb = page
        .locator(".xterm-rows span")
        .filter({ hasText: "RGB_COLOR" })
        .first();
      const original = await rgb.evaluate(
        (span) => getComputedStyle(span).color,
      );
      await page.evaluate(() =>
        (window as any).fixture.update({ forceThemePalette: true }),
      );
      await page.waitForFunction(() => {
        const span = [...document.querySelectorAll(".xterm-rows span")].find(
          (span) => span.textContent === "RGB_COLOR",
        );
        return span && getComputedStyle(span).color !== "rgb(254, 1, 2)";
      });
      await page.evaluate(() =>
        (window as any).fixture.update({ forceThemePalette: false }),
      );
      await page.waitForFunction(() => {
        const span = [...document.querySelectorAll(".xterm-rows span")].find(
          (span) => span.textContent === "RGB_COLOR",
        );
        return span && getComputedStyle(span).color === "rgb(254, 1, 2)";
      });
      await expect(rgb).toHaveCSS("color", original);
      await page.evaluate(() => {
        const media = window.matchMedia.bind(window);
        window.matchMedia = (query: string) =>
          query === "(color-gamut: p3)"
            ? ({ ...media(query), matches: true } as MediaQueryList)
            : media(query);
        (window as any).fixture.update({ displayP3: true });
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".terminal-emulator")
            ?.getAttribute("data-color-space") === "display-p3",
      );
      assert.match(
        await rgb.evaluate((span) => (span as HTMLElement).style.color),
        /^color\(display-p3/,
      );
      await page.evaluate(() =>
        (window as any).fixture.update({
          displayP3: false,
          boldPolicy: "never",
          italicPolicy: "never",
          matchProgramBackground: true,
          paddingColor: "extend",
          selectionRounded: true,
        }),
      );
      await emit("\x1b[44m\x1b[2J\x1b[H\x1b[1;3mBOLD_ITALIC\x1b[0m");
      await page.waitForFunction(() =>
        document
          .querySelector(".terminal-pane")
          ?.hasAttribute("data-program-background"),
      );
      assert.match(
        await page
          .locator(".terminal-container")
          .evaluate(
            (element) => (element as HTMLElement).style.backgroundImage,
          ),
        /linear-gradient/,
      );
      assert.equal(
        await page
          .locator(".terminal-emulator")
          .getAttribute("data-bold-policy"),
        "never",
      );
      assert.equal(
        await page
          .locator(".terminal-emulator")
          .getAttribute("data-italic-policy"),
        "never",
      );
      const emphasis = page
        .locator(".xterm-rows span")
        .filter({ hasText: "BOLD_ITALIC" })
        .first();
      assert.equal(
        await emphasis.evaluate(
          (element) => getComputedStyle(element).fontStyle,
        ),
        "normal",
      );
      await page.evaluate(() =>
        (window as any).fixture.update({ italicPolicy: "always" }),
      );
      await page.waitForFunction(() => {
        const span = [...document.querySelectorAll(".xterm-rows span")].find(
          (span) => span.textContent === "BOLD_ITALIC",
        );
        return span && getComputedStyle(span).fontStyle === "italic";
      });
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.runtime().terminal.select(0, 0, 4);
      });
      await page.evaluate(() => (window as any).fixture.command("copy"));
      await page.locator(".terminal-copy-shine").waitFor();
      assert.equal(
        await page
          .locator(".xterm-selection div")
          .first()
          .evaluate((element) => getComputedStyle(element).borderRadius),
        "4px",
      );
      assert.equal(
        await page
          .locator(".xterm-selection div")
          .first()
          .evaluate(
            (element) => getComputedStyle(element, "::after").animationName,
          ),
        "terminal-copy-shine",
      );
      await page.evaluate(() =>
        (window as any).fixture.update({ cursorEffect: "comet" }),
      );
      await emit("\x1b[3;12H");
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          ".terminal-cursor-effect",
        );
        return (
          canvas &&
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0)
        );
      });
      // Relative placements follow their parent and cascade deletion, without moving the cursor.
      await emit(
        "\x1b[0m\x1b[2J\x1b[H\x1b_Ga=T,f=24,s=1,v=1,i=201,p=1,c=4,r=4,C=1;/wAA\x1b\\",
      );
      await emit(
        "\x1b_Ga=T,f=24,s=1,v=1,i=202,p=2,c=2,r=2,P=201,Q=1,H=3,V=2;AP8A\x1b\\",
      );
      const parent = page.locator('canvas[data-kitty-image="201"]'),
        relative = page.locator('canvas[data-kitty-image="202"]');
      await relative.waitFor();
      const grid = await page.locator(".xterm-screen").boundingBox();
      assert.ok(grid);
      const columns = await page.evaluate(
          () => (window as any).fixture.runtime().terminal.cols,
        ),
        rows = await page.evaluate(
          () => (window as any).fixture.runtime().terminal.rows,
        );
      let a = await parent.boundingBox(),
        b = await relative.boundingBox();
      assert.ok(a && b);
      assert.ok(Math.abs(b.x - a.x - (3 * grid.width) / columns) < 1);
      assert.ok(Math.abs(b.y - a.y - (2 * grid.height) / rows) < 1);
      await emit("\x1b[5;6H\x1b_Ga=p,i=201,p=1,c=4,r=4,C=1;\x1b\\");
      await page.waitForFunction(() => {
        const parent = document.querySelector(
            'canvas[data-kitty-image="201"]',
          )!,
          child = document.querySelector('canvas[data-kitty-image="202"]')!;
        return (
          parent.getBoundingClientRect().left > 0 &&
          child.getBoundingClientRect().left >
            parent.getBoundingClientRect().left
        );
      });
      const cycle = await page.evaluate(() =>
        (window as any).fixture
          .runtime()
          .kitty.command("a=p,i=201,p=1,P=202,Q=2,C=1;")
          .then(
            () => "",
            (failure: Error) => failure.message,
          ),
      );
      assert.match(cycle, /cycle/);
      await emit("\x1b_Ga=d,d=I,i=201;\x1b\\");
      await relative.waitFor({ state: "detached" });
      // Animation patches, explicit frame selection, clipped replacement, finite loops and stop.
      await page.clock.pauseAt(new Date("2026-01-02T00:00:00Z"));
      await emit(
        "\x1b_Ga=T,f=32,s=2,v=1,i=301,p=1,c=4,r=2,C=1;" +
          Buffer.from([255, 0, 0, 255, 255, 0, 0, 255]).toString("base64") +
          "\x1b\\",
      );
      await emit(
        "\x1b_Ga=f,f=32,s=1,v=1,i=301,x=1,y=0,c=1,z=25,X=1;" +
          Buffer.from([0, 255, 0, 255]).toString("base64") +
          "\x1b\\",
      );
      await emit("\x1b_Ga=a,i=301,c=2;\x1b\\");
      const animated = page.locator('canvas[data-kitty-image="301"]');
      await animated.waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelector('canvas[data-kitty-image="301"]')
            ?.getAttribute("data-kitty-frame") === "2",
      );
      assert.deepEqual(
        await animated.evaluate((canvas) =>
          Array.from(
            (canvas as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(0, 0, 2, 1).data,
          ),
        ),
        [255, 0, 0, 255, 0, 255, 0, 255],
      );
      await emit("\x1b_Ga=a,i=301,c=1,r=1,z=25,s=3,v=2;\x1b\\");
      await page.clock.runFor(50);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas[data-kitty-image="301"]');
        return (
          canvas?.getAttribute("data-kitty-frame") === "2" &&
          canvas?.getAttribute("data-kitty-animation") === "1"
        );
      });
      await page.clock.runFor(200);
      assert.equal(await animated.getAttribute("data-kitty-frame"), "2");
      await emit("\x1b_Ga=a,i=301,c=1,s=3,v=1;\x1b\\");
      await page.clock.runFor(25);
      assert.equal(await animated.getAttribute("data-kitty-frame"), "2");
      await page.clock.runFor(25);
      assert.equal(await animated.getAttribute("data-kitty-frame"), "1");
      await emit("\x1b_Ga=a,i=301,s=1;\x1b\\");
      await page.waitForFunction(
        () =>
          document
            .querySelector('canvas[data-kitty-image="301"]')
            ?.getAttribute("data-kitty-animation") === "1",
      );
      await page.clock.runFor(200);
      assert.equal(await animated.getAttribute("data-kitty-frame"), "1");
      await emit("\x1b_Ga=c,i=301,r=2,c=1,X=1,Y=0,x=0,y=0,w=1,h=1,C=1;\x1b\\");
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-kitty-image="301"]',
        );
        return (
          canvas?.getContext("2d")!.getImageData(0, 0, 1, 1).data[1] === 255
        );
      });
      assert.deepEqual(
        await animated.evaluate((canvas) =>
          Array.from(
            (canvas as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(0, 0, 2, 1).data,
          ),
        ),
        [0, 255, 0, 255, 255, 0, 0, 255],
      );
      await emit("\x1b_Ga=d,d=f,i=301,r=2;\x1b\\");
      await emit("\x1b_Ga=d,d=I,i=301;\x1b\\");
      await animated.waitFor({ state: "detached" });
      await page.clock.resume();
      // Public buffer glyphs drive virtual placements, including omitted column diacritics.
      const quadrants = Buffer.from([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
      ]).toString("base64");
      await emit(
        "\x1b_Ga=t,f=32,s=2,v=2,i=401;" +
          quadrants +
          "\x1b\\\x1b_Ga=p,U=1,i=401,p=9,c=2,r=2;\x1b\\\x1b_Ga=p,U=1,i=401,p=10,c=1,r=1;\x1b\\",
      );
      const placeholder = "\u{10eeee}",
        zero = "\u0305",
        one = "\u030d";
      await emit(
        "\x1b[10;1H\x1b[38;2;0;1;145m\x1b[58;2;0;0;9m" +
          placeholder +
          zero +
          zero +
          placeholder +
          "\x1b[11;1H" +
          placeholder +
          one +
          zero +
          placeholder +
          "\x1b[0m",
      );
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-kitty-virtual="true"]',
        );
        return (
          canvas &&
          canvas.width > 0 &&
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0)
        );
      });
      const virtualPixels = await page
        .locator('canvas[data-kitty-virtual="true"]')
        .evaluate((canvas) => {
          const f = (window as any).fixture,
            t = f.runtime().terminal,
            screen = document.querySelector<HTMLElement>(".xterm-screen")!,
            cw = screen.clientWidth / t.cols,
            ch = screen.clientHeight / t.rows,
            scale = Math.min(cw, ch),
            ox = (2 * cw - 2 * scale) / 2,
            oy = 9 * ch + (2 * ch - 2 * scale) / 2,
            context = (canvas as HTMLCanvasElement).getContext("2d")!;
          return [
            [0.5, 0.5],
            [1.5, 0.5],
            [0.5, 1.5],
            [1.5, 1.5],
          ].map(([x, y]) =>
            Array.from(
              context.getImageData(
                Math.floor(ox + x * scale),
                Math.floor(oy + y * scale),
                1,
                1,
              ).data,
            ),
          );
        });
      const expectedVirtual = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
      ];
      for (let pixel = 0; pixel < 4; pixel++)
        for (let channel = 0; channel < 4; channel++)
          assert.ok(
            Math.abs(
              virtualPixels[pixel][channel] - expectedVirtual[pixel][channel],
            ) <= 12,
            "Bilinear-scaled placeholder tiles must preserve their quadrant color",
          );
      // A nonzero image row is invalid for this one-cell placement. The next
      // unmarked glyph must start at row/column zero after an ordinary cell or
      // a screen-row boundary, rather than inheriting that invalid image row.
      await emit(
        "\x1b_Ga=t,f=24,s=1,v=1,i=501;/wD/\x1b\\\x1b_Ga=p,U=1,i=501,p=1,c=1,r=1;\x1b\\",
      );
      const resetColumns = await page.evaluate(
        () => (window as any).fixture.runtime().terminal.cols,
      );
      await emit(
        "\x1b[12;1H\x1b[38;2;0;1;245m\x1b[58;2;0;0;1m" +
          placeholder +
          one +
          zero +
          "X" +
          placeholder +
          `\x1b[12;${resetColumns}H` +
          placeholder +
          one +
          zero +
          "\x1b[13;1H" +
          placeholder +
          "\x1b[0m",
      );
      await page.waitForFunction(() => {
        const buffer = (window as any).fixture.runtime().terminal.buffer.active;
        return (
          buffer.getLine(11)?.getCell(1)?.getChars() === "X" &&
          buffer.getLine(12)?.getCell(0)?.getChars().startsWith("\u{10eeee}")
        );
      });
      const resetPixels = await page.evaluate(async () => {
        const term = (window as any).fixture.runtime().terminal;
        await new Promise<void>((resolve) => term.write("", resolve));
        await new Promise<void>((resolve) => {
          const listener = term.onRender(() => {
            listener.dispose();
            resolve();
          });
          term.refresh(0, term.rows - 1);
        });
        const screen = document.querySelector<HTMLElement>(".xterm-screen")!;
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-kitty-virtual="true"]',
        )!;
        const context = canvas.getContext("2d")!;
        const cw = screen.clientWidth / term.cols,
          ch = screen.clientHeight / term.rows;
        return [
          [0, 11],
          [1, 11],
          [2, 11],
          [0, 12],
        ].map(([x, y]) =>
          Array.from(
            context.getImageData(
              Math.floor((x + 0.5) * cw),
              Math.floor((y + 0.5) * ch),
              1,
              1,
            ).data,
          ),
        );
      });
      assert.deepEqual(
        resetPixels.slice(0, 2),
        [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        "an invalid placeholder and ordinary text must not paint an image",
      );
      assert.deepEqual(
        resetPixels[2],
        [255, 0, 255, 255],
        "an ordinary-cell gap must reset placeholder continuation",
      );
      assert.deepEqual(
        resetPixels[3],
        [255, 0, 255, 255],
        "a new screen row must reset placeholder continuation",
      );
      await emit("\x1b_Ga=d,d=I,i=501;\x1b\\");
      await emit(
        "\x1b_Ga=T,f=24,s=1,v=1,i=402,p=1,c=1,r=1,P=401,Q=9,H=3,V=1;////\x1b\\",
      );
      await page.locator('canvas[data-kitty-image="402"]').waitFor();
      await emit("\x1b_Ga=d,d=I,i=401;\x1b\\");
      await page
        .locator('canvas[data-kitty-image="402"]')
        .waitFor({ state: "detached" });

      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
