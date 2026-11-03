import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

// Opt-in real Rex + Electron proof. The fixture destroys only its returned session.
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "test-results-graphics-"));
const host = DEFAULT_SETTINGS.hosts[0];
const service = new RexService();
let app: ElectronApplication | undefined, sessionId: string | undefined;
try {
  sessionId = await service.createSession(
    host,
    `graphics-proof-${Date.now()}`,
    root,
  );
  const view = await service.inspect(host, sessionId),
    initialWindow = view.windows[0],
    block = initialWindow.panes[0];
  await service.renameWindow(
    host,
    sessionId,
    initialWindow.id,
    "Graphics proof",
  );
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex", "settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: { hostId: host.id, sessionId, windowId: initialWindow.id },
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.XDG_CONFIG_HOME = config;
  env.LINUSAURUS_TEST_NOTIFICATIONS = "1";
  app = await electron.launch({
    executablePath:
      process.env.LINUSAURUS_EXECUTABLE ||
      createRequire(import.meta.url)("electron"),
    args: process.env.LINUSAURUS_EXECUTABLE ? [] : [root],
    env,
    timeout: 20000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".terminal-pane:visible .xterm").waitFor();
  await page.locator(".terminal-loading:visible").waitFor({ state: "hidden" });
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      graphicsFrames?: unknown[];
    };
    state.graphicsFrames = [];
    window.rex.onTerminal((frame) => {
      state.graphicsFrames!.push({
        kind: frame.kind,
        error: frame.error,
        length: frame.data?.length,
        image102: frame.data?.includes("i=102"),
        kitty: frame.data?.includes("\x1b_G"),
      });
      if (state.graphicsFrames!.length > 30) state.graphicsFrames!.shift();
    });
  });
  const emit = async (data: string, hold = false) => {
    const encoded = Buffer.from(data).toString("base64");
    await service.input(
      host,
      sessionId!,
      block.id,
      `python3 -c 'import base64,sys;sys.stdout.buffer.write(base64.b64decode("${encoded}"));sys.stdout.flush()${hold ? ";input()" : ""}'\n`,
    );
  };
  await emit(
    "\x1b[2J\x1b[H\x1b_Ga=T,q=2,f=24,s=2,v=1,i=101,c=8,r=3,C=1;/wAAAP8A\x1b\\",
  );
  await page.locator('canvas[data-kitty-image="101"]').waitFor();
  const pixels = async (id: number) =>
    page
      .locator(`canvas[data-kitty-image="${id}"]`)
      .evaluate((canvas) =>
        Array.from(
          (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 2, 1).data,
        ),
      );
  assert.deepEqual(await pixels(101), [255, 0, 0, 255, 0, 255, 0, 255]);
  await page.waitForTimeout(250);
  const originalOwner = (
    await service.callMethod<{ owner: string | null }>(
      host,
      "com.superlogical.terminal.size",
      { session_id: sessionId, block_id: block.id, args: {} },
    )
  ).owner;
  await service.createWindow(host, sessionId, "Background tab", root);
  await page
    .getByRole("button", { name: "Background tab", exact: true })
    .click();
  await page.waitForFunction(
    (id) =>
      !document.querySelector(`[data-block-id="${id}"]`)?.getClientRects()
        .length,
    block.id,
  );
  // A second image arrives while the pane is hidden. The graphics stream must
  // remain live, but it must release its server viewport ownership.
  await emit("\x1b_Ga=T,q=2,f=24,s=2,v=1,i=102,c=8,r=3,C=1;AAD/////\x1b\\");
  await page
    .locator('canvas[data-kitty-image="102"]')
    .waitFor({ state: "attached" });
  const size = await service.callMethod<{ owner: string | null }>(
    host,
    "com.superlogical.terminal.size",
    { session_id: sessionId, block_id: block.id, args: {} },
  );
  assert.notEqual(
    size.owner,
    originalOwner,
    "A hidden graphics stream must release its own viewport claim without removing another client's claim",
  );
  await page
    .getByRole("button", { name: "Graphics proof", exact: true })
    .click();
  await page.locator('canvas[data-kitty-image="102"]').waitFor();
  assert.deepEqual(await pixels(101), [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual(await pixels(102), [0, 0, 255, 255, 255, 255, 255, 255]);
  const png = await page
    .locator('canvas[data-kitty-image="101"]')
    .evaluate(
      (canvas) =>
        (canvas as HTMLCanvasElement).toDataURL("image/png").split(",")[1],
    );
  const hasColor = async (color: [number, number, number]) =>
    page
      .locator(".terminal-pane:visible canvas.xterm-image-layer")
      .first()
      .evaluate((canvas, color) => {
        const image = (canvas as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(
            0,
            0,
            (canvas as HTMLCanvasElement).width,
            (canvas as HTMLCanvasElement).height,
          ).data;
        for (let i = 0; i < image.length; i += 4)
          if (
            Math.abs(image[i] - color[0]) < 15 &&
            Math.abs(image[i + 1] - color[1]) < 15 &&
            Math.abs(image[i + 2] - color[2]) < 15 &&
            image[i + 3] > 240
          )
            return true;
        return false;
      }, color);
  const hasRed = () => hasColor([255, 0, 0]);
  const hasGreen = () => hasColor([0, 255, 0]);
  await emit('\x1b[2J\x1b[H\x1bPq"1;1;2;6#1;2;100;0;0#1~~\x1b\\', true);
  await page
    .locator(".terminal-pane:visible canvas.xterm-image-layer")
    .first()
    .waitFor();
  for (let attempt = 0; attempt < 40 && !(await hasRed()); attempt++)
    await page.waitForTimeout(100);
  assert.ok(
    await hasRed(),
    "Sixel pixels must render through the installed Rex and packaged-content CSP",
  );
  await service.input(host, sessionId, block.id, "\n");
  await page.waitForTimeout(200);
  assert.equal(
    await hasGreen(),
    false,
    "Sixel fixture contains no green before PNG transmission",
  );
  await emit(
    `\x1b[2J\x1b[H\x1b]1337;File=name=cmV4LnBuZw==;size=${Buffer.from(png, "base64").length};inline=1;width=32px;height=16px;preserveAspectRatio=0:${png}\x07`,
    true,
  );
  for (let attempt = 0; attempt < 40 && !(await hasGreen()); attempt++)
    await page.waitForTimeout(100);
  assert.ok(
    await hasGreen(),
    "Inline PNG pixels must render through installed Rex",
  );
  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".terminal-error:visible").count(), 0);
  if (process.env.LINUSAURUS_GRAPHICS_SCREENSHOT)
    await page.screenshot({ path: process.env.LINUSAURUS_GRAPHICS_SCREENSHOT });
  console.log(
    "PASS: installed Rex Kitty/Sixel/inline PNG pixels, hidden-stream image delivery, tab restoration, and viewport release",
  );
} catch (failure) {
  if (app) {
    const page = await app.firstWindow();
    console.log(
      "Graphics diagnostics",
      await page.evaluate(() => ({
        frames: (
          globalThis as typeof globalThis & { graphicsFrames?: unknown[] }
        ).graphicsFrames,
        canvases: [
          ...document.querySelectorAll("canvas[data-kitty-image]"),
        ].map((canvas) => (canvas as HTMLElement).dataset.kittyImage),
        errors: [...document.querySelectorAll(".terminal-error")].map(
          (element) => element.textContent,
        ),
      })),
    );
  }
  if (sessionId) {
    const current = await service.inspect(host, sessionId);
    for (const pane of current.windows.flatMap((window) => window.panes)) {
      const text = await service.capture(host, sessionId, pane.id);
      console.log(
        "Owned graphics pane",
        JSON.stringify({
          id: pane.id,
          hasPythonError: /Traceback|SyntaxError/.test(text),
          has102: text.includes("102"),
        }),
      );
    }
  }
  throw failure;
} finally {
  await app?.close();
  if (sessionId)
    await service.callMethod(host, "session.destroy", {
      session_id: sessionId,
    });
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
