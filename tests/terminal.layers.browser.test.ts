import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { createRequire } from "node:module";
const { PNG } = createRequire(import.meta.url)("pngjs") as {
  PNG: {
    sync: {
      read(bytes: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};
const source = `import React from'react';import{createRoot}from'react-dom/client';import{TerminalPane}from'/src/terminal/TerminalPane.tsx';import{getCachedTerminal}from'/src/terminal/runtime.ts';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';const ref={hostId:'layers',sessionId:'own',blockId:'test'};let subscription,update;const listeners=new Set();window.rex={request:async(method,args)=>{if(method==='subscribe'){subscription=args.subscriptionId;setTimeout(()=>emit({kind:'snapshot',data:'ready',cols:40,rows:20}),20)}},onTerminal:callback=>{listeners.add(callback);return()=>listeners.delete(callback)},writeClipboard:async()=>{},readClipboard:async()=>''};function emit(frame){for(const callback of listeners)callback({subscriptionId:subscription,...frame})}function Fixture(){const[settings,setSettings]=React.useState({...DEFAULT_SETTINGS,appearance:'dark',fontSize:24,ligatures:false,paddingX:0,paddingY:0,matchProgramBackground:false,cursorEffect:'off',cursorBlink:false,selectionBackground:'#00ff0080',darkThemeId:'layers',themeLibrary:[{id:'layers',name:'Layers',colors:{background:'#101010',foreground:'#ffffff',cursor:'#ffff00',cursorAccent:'#000000'}}]});update=patch=>setSettings(value=>({...value,...patch}));return React.createElement(TerminalPane,{pane:{id:'test',label:'Layers',rect:[0,0,1,1]},terminalRef:ref,settings,visible:true,focused:true,showHeader:false,onFocus(){},onClose(){},onZoom(){}})}createRoot(document.getElementById('root')).render(React.createElement(Fixture));window.fixture={emit,update:patch=>update(patch),runtime:()=>getCachedTerminal(ref)};`;
const html =
  '<!doctype html><style>html,body,#root{height:100%;margin:0}.terminal-pane{position:relative;height:100%;display:flex;flex-direction:column}.terminal-container{flex:1;min-height:0}.terminal-emulator,.xterm{height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>';

test(
  "screenshot pixels prove Kitty images compose below backgrounds, below text, above text and beneath selection/cursor",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: "node_modules/.vite-layer-test",
      plugins: [
        react(),
        {
          name: "fixture",
          configureServer(server) {
            server.middlewares.use("/layers", (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            });
          },
          resolveId(id) {
            return id === "/fixture.js" ? "\0layers-fixture" : undefined;
          },
          load(id) {
            return id === "\0layers-fixture" ? source : undefined;
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
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    });
    try {
      const page = await browser.newPage({
          viewport: { width: 800, height: 480 },
          deviceScaleFactor: 1,
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(`http://127.0.0.1:${address.port}/layers`);
      await page.waitForFunction(() =>
        (window as any).fixture
          ?.runtime()
          ?.terminal.buffer.active.getLine(0)
          ?.translateToString(true)
          .includes("ready"),
      );
      const emit = async (data: string) => {
        await page.evaluate(
          (data) => (window as any).fixture.emit({ kind: "output", data }),
          data,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              (window as any).fixture
                .runtime()
                .terminal.write("", () =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                  ),
                );
            }),
        );
      };
      await emit(
        "\x1b[?25l\x1b[2J\x1b[H\x1b[38;2;255;255;255m\x1b[48;2;0;0;255mM \x1b[0m ",
      );
      const grid = await page.locator(".xterm-screen").boundingBox();
      assert.ok(grid);
      const size = await page.evaluate(() => ({
          cols: (window as any).fixture.runtime().terminal.cols,
          rows: (window as any).fixture.runtime().terminal.rows,
        })),
        cw = grid.width / size.cols,
        ch = grid.height / size.rows;
      const snapshot = async () => PNG.sync.read(await page.screenshot());
      const sample = (
        png: ReturnType<typeof PNG.sync.read>,
        x: number,
        y: number,
      ) =>
        Array.from(
          png.data.subarray(
            (Math.floor(y) * png.width + Math.floor(x)) * 4,
            (Math.floor(y) * png.width + Math.floor(x)) * 4 + 4,
          ),
        );
      const center = (
        png: ReturnType<typeof PNG.sync.read>,
        column: number,
        row = 0,
      ) => sample(png, grid.x + (column + 0.5) * cw, grid.y + (row + 0.5) * ch);
      const near = (
        actual: number[],
        expected: number[],
        message: string,
        tolerance = 3,
      ) => {
        for (let channel = 0; channel < expected.length; channel++)
          assert.ok(
            Math.abs(actual[channel] - expected[channel]) <= tolerance,
            `${message}: actual${actual}, expected${expected}`,
          );
      };
      const whiteInk = (png: ReturnType<typeof PNG.sync.read>) => {
        let count = 0;
        for (let y = Math.ceil(grid.y + ch * 0.1); y < grid.y + ch * 0.9; y++)
          for (
            let x = Math.ceil(grid.x + cw * 0.05);
            x < grid.x + cw * 0.95;
            x++
          ) {
            const pixel = sample(png, x, y);
            if (pixel[0] > 210 && pixel[1] > 210 && pixel[2] > 210) count++;
          }
        return count;
      };
      const payload = (rgba: number[], columns = 3) => {
        const width = Math.ceil(cw * columns),
          height = Math.ceil(ch),
          bytes = Buffer.alloc(width * height * 4);
        for (let offset = 0; offset < bytes.length; offset += 4)
          bytes.set(rgba, offset);
        return { width, height, data: bytes.toString("base64") };
      };
      const red = payload([255, 0, 0, 255]);
      const put = async (z: number) =>
        emit(
          `\x1b[1;1H\x1b_Ga=T,q=2,f=32,s=${red.width},v=${red.height},i=1,p=1,c=3,r=1,C=1,z=${z};${red.data}\x1b\\`,
        );
      await put(-1073741825);

      let png = await snapshot();
      near(
        center(png, 1),
        [0, 0, 255, 255],
        "Deep-negative image must remain below explicit blue cell BG",
      );
      near(
        center(png, 2),
        [255, 0, 0, 255],
        "Deep-negative image must show through default cell BG",
      );
      assert.ok(
        whiteInk(png) > 5,
        "Text must remain visible over a deep-negative image",
      );

      await put(-1073741824);
      png = await snapshot();
      near(
        center(png, 1),
        [255, 0, 0, 255],
        "Exact deep-z threshold stays above explicit backgrounds",
      );
      assert.ok(whiteInk(png) > 5);
      await put(-1);

      png = await snapshot();
      near(
        center(png, 1),
        [255, 0, 0, 255],
        "Negative image must cover explicit cell BG",
      );
      assert.ok(
        whiteInk(png) > 5,
        "Negative image must remain below native glyphs",
      );

      await put(0);

      png = await snapshot();
      near(
        center(png, 1),
        [255, 0, 0, 255],
        "Zero-z image must render above cell backgrounds",
      );
      assert.equal(
        whiteInk(png),
        0,
        "Opaque nonnegative image must cover native glyphs",
      );
      // Alpha blending and z/image-id sorting must not depend on arrival order.
      const halfRed = payload([255, 0, 0, 128], 1),
        halfBlue = payload([0, 0, 255, 128], 1);
      await emit(
        `\x1b[2;6H\x1b_Ga=T,q=2,f=32,s=${halfRed.width},v=${halfRed.height},i=10,p=1,c=1,r=1,C=1,z=2;${halfRed.data}\x1b\\\x1b_Ga=T,q=2,f=32,s=${halfBlue.width},v=${halfBlue.height},i=5,p=1,c=1,r=1,C=1,z=1;${halfBlue.data}\x1b\\`,
      );
      png = await snapshot();
      near(
        center(png, 5, 1),
        [132, 4, 68, 255],
        "Alpha layers must sort by numeric z",
        5,
      );
      await emit(`\x1b_Ga=p,q=2,i=5,p=1,c=1,r=1,C=1,z=2;\x1b\\`);
      png = await snapshot();
      near(
        center(png, 5, 1),
        [132, 4, 68, 255],
        "Equal z must sort by image id",
        5,
      );
      await page.evaluate(() =>
        (window as any).fixture.runtime().terminal.select(0, 0, 2),
      );
      await expect
        .poll(
          async () =>
            center(await snapshot(), 1).every(
              (value, channel) =>
                Math.abs(value - [127, 128, 0, 255][channel]) <= 4,
            ),
          { message: "Selection highlight must paint above opaque images" },
        )
        .toBe(true);
      png = await snapshot();
      near(
        center(png, 1),
        [127, 128, 0, 255],
        "Selection highlight must remain above opaque images",
        4,
      );
      await page.evaluate(() =>
        (window as any).fixture.runtime().terminal.clearSelection(),
      );
      await page.locator(".xterm-helper-textarea").focus();
      await emit("\x1b[?25h\x1b[1;2H");
      await expect
        .poll(
          async () =>
            center(await snapshot(), 1).every(
              (value, channel) =>
                Math.abs(value - [255, 255, 0, 255][channel]) <= 4,
            ),
          { message: "Native block cursor must paint above opaque images" },
        )
        .toBe(true);
      png = await snapshot();
      near(
        center(png, 1),
        [255, 255, 0, 255],
        "Native block cursor must remain above opaque images",
        4,
      );
      await emit("\x1b[1 q");
      await page.waitForFunction(
        () =>
          document
            .querySelector(
              ".xterm-rows:not(.kitty-composition-cursor) .xterm-cursor-blink",
            )
            ?.getAnimations().length,
      );
      const freeze = async (time: number) =>
        page.evaluate((time) => {
          for (const element of document.querySelectorAll(
            ".xterm-cursor-blink",
          ))
            for (const animation of element.getAnimations()) {
              animation.pause();
              animation.currentTime = time;
            }
        }, time);
      await freeze(0);
      png = await snapshot();
      near(
        center(png, 1),
        [255, 255, 0, 255],
        "Blinking cursor on-phase stays above images",
        4,
      );
      await freeze(600);
      png = await snapshot();
      near(
        center(png, 1),
        [255, 0, 0, 255],
        "Blinking cursor off-phase reveals the image",
        4,
      );
      await emit("\x1b[?25l");
      png = await snapshot();
      near(
        center(png, 1),
        [255, 0, 0, 255],
        "Hidden cursor must not leave a stale graphics overlay",
      );
      const green = payload([0, 255, 0, 255], 1);
      await emit(
        `\x1b[3;1H\x1b[48;2;0;0;255m\x1b_Ga=t,q=2,f=32,s=${green.width},v=${green.height},i=40;${green.data}\x1b\\\x1b_Ga=p,q=2,U=1,i=40,p=1,c=1,r=1,z=-1073741825;\x1b\\\x1b[38;5;40m\u{10eeee}\u0305\u0305\x1b[0m`,
      );
      png = await snapshot();
      near(
        center(png, 0, 2),
        [0, 0, 255, 255],
        "Virtual placement deep-z honors explicit background",
      );
      await emit("\x1b_Ga=p,q=2,U=1,i=40,p=1,c=1,r=1,z=-1;\x1b\\");
      png = await snapshot();
      near(
        center(png, 0, 2),
        [0, 255, 0, 255],
        "Virtual negative-z placement appears above cell background",
      );
      const wideGreen = payload([0, 255, 0, 255], 2);
      await emit(
        `\x1b[5;1H\x1b[48;2;0;0;255mM \x1b[0m\x1b[5;1H\x1b_Ga=T,q=2,f=32,s=${red.width},v=${red.height},i=50,p=1,c=2,r=1,C=1,z=-1;${red.data}\x1b\\\x1b_Ga=T,q=2,f=32,s=${wideGreen.width},v=${wideGreen.height},i=51,p=1,c=2,r=1,P=50,Q=1,z=1;${wideGreen.data}\x1b\\`,
      );
      png = await snapshot();
      near(
        center(png, 1, 4),
        [0, 255, 0, 255],
        "Relative child has its own z above parent and text",
      );
      await emit("\x1b_Ga=p,q=2,i=51,p=1,c=2,r=1,P=50,Q=1,z=-2;\x1b\\");
      png = await snapshot();
      near(
        center(png, 1, 4),
        [255, 0, 0, 255],
        "Relative child z can independently move beneath parent",
      );
      await emit("\x1b_Ga=d,d=I,i=50,q=2;\x1b\\");
      assert.equal(
        await page.locator('canvas[data-kitty-image="51"]').count(),
        0,
        "Deleting parent cascades to relative child",
      );
      await emit("\x1b_Ga=d,d=A,q=2;\x1b\\");
      png = await snapshot();
      near(
        center(png, 0, 2),
        [0, 255, 0, 255],
        "Delete-visible preserves virtual prototypes and their placeholder cells",
      );
      await emit("\x1b_Ga=d,d=I,i=40,q=2;\x1b\\");
      assert.equal(
        await page.locator("[data-kitty-composition]").count(),
        0,
        "Removing the last image restores native DOM background painting",
      );
      png = await snapshot();
      near(
        center(png, 1, 4),
        [0, 0, 255, 255],
        "Native explicit background survives compositor disposal",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
