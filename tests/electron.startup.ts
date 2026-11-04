import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

const directory = await mkdtemp(join(tmpdir(), "linusaurus-startup-"));
const profile = join(directory, "preferences.json");
const config = join(directory, "config");
const execute = promisify(execFile);
await mkdir(config);
await execute("mkfifo", [profile]);
// Hold the real settings read open until a second-instance request arrives.
// Keeping our own read/write descriptor also makes failure cleanup deterministic.
const held = await open(profile, constants.O_RDWR);
const settings = { ...structuredClone(DEFAULT_SETTINGS), fontSize: 18 };
let released = false;
const releaseSettings = async () => {
  if (released) return;
  released = true;
  try {
    await held.writeFile(JSON.stringify(settings));
  } finally {
    await held.close();
  }
};
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
environment.XDG_CONFIG_HOME = config;
environment.LINUSAURUS_TEST_NOTIFICATIONS = "1";
const executablePath =
  process.env.LINUSAURUS_EXECUTABLE ||
  (createRequire(import.meta.url)("electron") as string);
const prefix = process.env.LINUSAURUS_EXECUTABLE
  ? []
  : [resolve(import.meta.dirname, "..")];
let app: ElectronApplication | undefined;
const logs: string[] = [];
try {
  app = await electron.launch({
    executablePath,
    args: [...prefix, "--config", profile],
    env: environment,
    timeout: 20_000,
  });
  const first = app;
  first.process().stderr?.on("data", (chunk) => logs.push(String(chunk)));
  const observed = first.evaluate(
    ({ app }) =>
      new Promise<void>((resolve) =>
        app.once("second-instance", () => resolve()),
      ),
  );
  const second = execute(
    executablePath,
    [...prefix, "--font-size", "22", "--window-size", "1100x700"],
    { env: environment, timeout: 20_000 },
  );
  await Promise.all([observed, second]);
  assert.equal(
    await first.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    0,
    "an early launch must wait for persisted settings and the initial launch",
  );
  await releaseSettings();
  await expect
    .poll(
      () =>
        first.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      { timeout: 20_000 },
    )
    .toBe(2);
  await expect.poll(() => first.windows().length).toBe(2);
  const windows = first.windows();
  for (const page of windows) {
    await page.waitForFunction(() => Boolean(window.rex));
    assert.equal(
      (await page.evaluate(() => window.rex.getSettings())).fontSize,
      22,
    );
  }
  assert.equal(JSON.parse(await readFile(profile, "utf8")).fontSize, 22);
  const sizes = await first.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getSize()),
  );
  assert.ok(sizes.some(([width, height]) => width === 1100 && height === 700));
  assert.ok(sizes.some(([width, height]) => width === 1440 && height === 900));
  console.log(
    "PASS: a real second-instance launch waits for held settings, preserves the requested profile, then applies its overrides",
  );
} catch (error) {
  console.error(logs.join(""));
  throw error;
} finally {
  await releaseSettings();
  if (app) await app.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
