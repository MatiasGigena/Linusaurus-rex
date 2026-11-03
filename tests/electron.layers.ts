import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
const { PNG } = createRequire(import.meta.url)("pngjs") as {
  PNG: {
    sync: {
      read(bytes: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(join(root, "test-results-native-layers-")),
  images = await mkdtemp(join(tmpdir(), "linusaurus-native-images-")),
  shared = `linusaurus-native-${randomUUID()}`,
  host = DEFAULT_SETTINGS.hosts[0],
  service = new RexService();
let app: ElectronApplication | undefined, sessionId: string | undefined;
const quote = (text: string) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
// The renderer receives data through the real installed Rex; the program never exits
// back to a shell while the image is being inspected.
const code = `import os,sys,tty,termios,json,base64\nfd=os.open('/dev/tty',os.O_RDWR);old=termios.tcgetattr(fd);tty.setraw(fd);os.write(fd,b'NATIVE_LAYERS_READY\\r\\n')\nline=b''\nwhile True:\n data=os.read(fd,1)\n if not data: break\n if data!=b'\\n': line+=data;continue\n try:\n  request=json.loads(line);os.write(fd,base64.b64decode(request['data']))\n except Exception: pass\n line=b''`;
try {
  sessionId = await service.createSession(
    host,
    `native-layers-${Date.now()}`,
    root,
    "/usr/bin/python3 -u -c " + quote(code),
  );
  const view = await service.inspect(host, sessionId),
    pane = view.windows[0].panes[0];
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex", "settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      appearance: "dark",
      fontSize: 24,
      displayP3: false,
      ligatures: false,
      paddingX: 0,
      paddingY: 0,
      matchProgramBackground: false,
      cursorEffect: "off",
      cursorBlink: false,
      selectionBackground: "#00ff0080",
      customDarkTheme: {
        background: "#101010",
        foreground: "#ffffff",
        cursor: "#ffff00",
        cursorAccent: "#000000",
      },
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: {
        hostId: host.id,
        sessionId,
        windowId: view.windows[0].id,
      },
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
  // Calibrate encoded screenshot RGB against known CSS colors in the same
  // screenshot. Desktop ICC profiles can transform both even with P3 disabled.
  const palette = [
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [127, 128, 0, 255],
    [255, 255, 0, 255],
    [0, 255, 0, 255],
    [255, 0, 255, 255],
    [0, 255, 255, 255],
  ];
  const references = await page.evaluate((palette) => {
    const strip = document.createElement("div");
    strip.setAttribute("aria-hidden", "true");
    Object.assign(strip.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      display: "flex",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    document.body.append(strip);
    for (const color of palette) {
      const chip = document.createElement("div");
      Object.assign(chip.style, {
        position: "relative",
        width: "16px",
        height: "16px",
        background: `rgb(${color.slice(0, 3).join(" ")})`,
      });
      if (color[0] === 127 && color[1] === 128) {
        // Match the native selection blend before display-profile conversion.
        chip.style.background = "#ff0000";
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
          position: "absolute",
          inset: "0",
          background: "#00ff0080",
        });
        chip.append(overlay);
      }
      strip.append(chip);
    }
    return [...strip.children].map((chip) => {
      const box = chip.getBoundingClientRect();
      return { x: box.x + 8, y: box.y + 8 };
    });
  }, palette);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      (await service.capture(host, sessionId, pane.id)).includes(
        "NATIVE_LAYERS_READY",
      )
    ) {
      ready = true;
      break;
    }
    await page.waitForTimeout(50);
  }
  assert.ok(ready, "The owned image emitter must be ready before test input");
  await page.waitForTimeout(200);
  const emit = async (data: string) => {
    await service.input(
      host,
      sessionId!,
      pane.id,
      JSON.stringify({ data: Buffer.from(data).toString("base64") }) + "\n",
    );
    await page.waitForTimeout(60);
  };
  await emit(
    "\x1b[?25l\x1b[2J\x1b[H\x1b[38;2;255;255;255m\x1b[48;2;0;0;255mM \x1b[0m ",
  );
  const grid = await page
    .locator(".terminal-pane:visible .xterm-screen")
    .boundingBox();
  assert.ok(grid);
  const size = await service.terminalSize(host, sessionId, pane.id),
    cw = grid.width / size.columns,
    ch = grid.height / size.rows;
  const imageWidth = Math.ceil(cw * 3),
    imageHeight = Math.ceil(ch),
    bytes = Buffer.alloc(imageWidth * imageHeight * 4);
  for (let index = 0; index < bytes.length; index += 4)
    bytes.set([255, 0, 0, 255], index);
  const encoded = bytes.toString("base64");
  const snapshot = async () =>
    PNG.sync.read(await page.screenshot({ scale: "css" }));
  const pixel = (png: ReturnType<typeof PNG.sync.read>, x: number, y: number) =>
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
  ) => pixel(png, grid.x + (column + 0.5) * cw, grid.y + ch * (row + 0.5));
  const near = (
    png: ReturnType<typeof PNG.sync.read>,
    actual: number[],
    expected: number[],
    message: string,
  ) => {
    const reference =
      references[
        palette.findIndex((color) =>
          color.every((value, index) => value === expected[index]),
        )
      ];
    assert.ok(
      reference,
      "Every native expected color has a screenshot calibration chip",
    );
    expected = pixel(png, reference.x, reference.y);
    for (let channel = 0; channel < 4; channel++)
      assert.ok(
        Math.abs(actual[channel] - expected[channel]) <= 4,
        `${message}: ${actual} vs ${expected}`,
      );
  };
  const whiteInk = (png: ReturnType<typeof PNG.sync.read>) => {
    let count = 0;
    for (let y = Math.ceil(grid.y + ch * 0.1); y < grid.y + ch * 0.9; y++)
      for (let x = Math.ceil(grid.x + cw * 0.05); x < grid.x + cw * 0.95; x++) {
        const rgba = pixel(png, x, y);
        if (rgba[0] > 210 && rgba[1] > 210 && rgba[2] > 210) count++;
      }
    return count;
  };
  const put = async (z: number) => {
    const [old] = await page
      .locator('canvas[data-kitty-image="1"]')
      .elementHandles();
    await emit(
      `\x1b[1;1H\x1b_Ga=T,q=2,f=32,s=${imageWidth},v=${imageHeight},i=1,p=1,c=3,r=1,C=1,z=${z};${encoded}\x1b\\`,
    );
    if (old)
      await page.waitForFunction((element) => !element?.isConnected, old);
    await page.locator('canvas[data-kitty-image="1"]').waitFor();
    await page.waitForTimeout(30);
  };
  let png = await snapshot();
  near(
    png,
    center(png, 1),
    [0, 0, 255, 255],
    "Native explicit background baseline",
  );
  assert.ok(
    whiteInk(png) > 5,
    "Native baseline glyph must be visible before image placement",
  );
  await put(-1073741825);
  png = await snapshot();
  near(
    png,
    center(png, 1),
    [0, 0, 255, 255],
    "Native deep image below explicit background",
  );
  near(
    png,
    center(png, 2),
    [255, 0, 0, 255],
    "Native deep image visible through default background",
  );
  assert.ok(whiteInk(png) > 5);
  await put(-1);
  png = await snapshot();
  near(
    png,
    center(png, 1),
    [255, 0, 0, 255],
    "Native negative image above background",
  );
  assert.ok(
    whiteInk(png) > 5,
    "Native text must remain above a negative image",
  );
  await put(0);
  png = await snapshot();
  assert.equal(whiteInk(png), 0, "Native nonnegative image covers glyphs");
  await page.mouse.move(grid.x + cw * 0.05, grid.y + ch * 0.5);
  await page.mouse.down();
  await page.mouse.move(grid.x + cw * 1.95, grid.y + ch * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  png = await snapshot();
  near(png, center(png, 1), [127, 128, 0, 255], "Native selection above image");
  await page.mouse.click(grid.x + cw * 5, grid.y + ch * 2);
  await page.locator(".terminal-pane:visible .xterm-helper-textarea").focus();
  await emit("\x1b[?25h\x1b[2 q\x1b[1;2H");
  png = await snapshot();
  near(png, center(png, 1), [255, 255, 0, 255], "Native cursor above image");
  await emit("\x1b[?25l");
  const media = [
    {
      medium: "f",
      path: join(images, "persistent.rgba"),
      file: join(images, "persistent.rgba"),
      color: [0, 255, 0, 255],
    },
    {
      medium: "t",
      path: join(images, "tty-graphics-protocol-temporary.rgba"),
      file: join(images, "tty-graphics-protocol-temporary.rgba"),
      color: [255, 0, 255, 255],
    },
    {
      medium: "s",
      path: "/" + shared,
      file: "/dev/shm/" + shared,
      color: [0, 255, 255, 255],
    },
  ];
  for (let index = 0; index < media.length; index++) {
    const item = media[index];
    await writeFile(item.file, Buffer.from(item.color), { mode: 0o600 });
    await emit(
      `\x1b[4;${index + 1}H\x1b_Ga=T,q=2,t=${item.medium},f=32,s=1,v=1,i=${100 + index},c=1,r=1,C=1;${Buffer.from(item.path).toString("base64")}\x1b\\`,
    );
    await page.locator(`canvas[data-kitty-image="${100 + index}"]`).waitFor();
  }
  png = await snapshot();
  for (let index = 0; index < media.length; index++)
    near(
      png,
      center(png, index, 3),
      media[index].color,
      `Rex-normalized ${media[index].medium} image renders actual native pixels`,
    );
  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".terminal-error:visible").count(), 0);
  await mkdir(join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: join(root, "test-results/native-layers.png"),
    scale: "css",
  });
  console.log(
    "PASS: installed Rex and actual Electron screenshot pixels prove all three Kitty z layers, selection/cursor composition, and server-normalized file/temp/shared-memory images",
  );
} catch (error) {
  await mkdir(join(root, "test-results"), { recursive: true });
  const page = app?.windows()[0];
  await page
    ?.screenshot({
      path: join(root, "test-results/native-layers-failure.png"),
      scale: "css",
    })
    .catch(() => {});
  throw error;
} finally {
  await app?.close();
  if (sessionId)
    await service
      .callMethod(host, "session.destroy", { session_id: sessionId })
      .catch(() => {});
  service.dispose();
  await rm(images, { recursive: true, force: true });
  await rm("/dev/shm/" + shared, { force: true });
  await rm(directory, { recursive: true, force: true });
}
