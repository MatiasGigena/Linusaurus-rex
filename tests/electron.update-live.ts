import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  chmod,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import {
  checksumFor,
  sha256,
  newerVersion,
} from "../electron/features/updates.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

// Explicitly opt in: updates only an owned COPY, never an installed application.
const source = process.env.LIVE_UPDATE_FROM;
if (!source?.endsWith(".AppImage"))
  throw new Error(
    "Set LIVE_UPDATE_FROM to a published AppImage; only its temporary copy will be updated.",
  );
const oldTag = process.env.LIVE_UPDATE_FROM_TAG || "v0.3.0";
if (!/^v\d+\.\d+\.\d+$/.test(oldTag))
  throw new Error("LIVE_UPDATE_FROM_TAG must be a stable release tag.");
const api = "https://api.github.com/repos/MatiasGigena/Linusaurus-rex/releases";
const metadata = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, `Release request failed: ${response.status}`);
  return response.json() as Promise<{
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  }>;
};
const [oldRelease, latest] = await Promise.all([
  metadata(`${api}/tags/${oldTag}`),
  metadata(`${api}/latest`),
]);
assert.ok(
  newerVersion(latest.tag_name, oldTag),
  "The public feed must contain a newer stable release.",
);
const manifest = async (release: typeof latest) => {
  const item = release.assets.find((item) => item.name === "SHA256SUMS");
  assert.ok(item);
  const response = await fetch(item.browser_download_url, {
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(response.ok);
  return response.text();
};
const oldManifest = await manifest(oldRelease),
  newManifest = await manifest(latest);
const oldAsset = oldRelease.assets.find((item) =>
    item.name.endsWith(".AppImage"),
  ),
  newAsset = latest.assets.find((item) => item.name.endsWith(".AppImage"));
assert.ok(oldAsset && newAsset);
const oldHash = checksumFor(oldManifest, oldAsset.name),
  newHash = checksumFor(newManifest, newAsset.name);
assert.equal(
  await sha256(source),
  oldHash,
  "Input must match the published old package.",
);
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(join(root, "test-results-live-update-"));
const target = join(directory, "owned-update.AppImage"),
  service = new RexService(),
  host = DEFAULT_SETTINGS.hosts[0];
let browser: Browser | undefined,
  page: Page | undefined,
  sessionId: string | undefined,
  child: ReturnType<typeof spawn> | undefined;
let output = "";
async function connect() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const connected = await chromium.connectOverCDP(
        `http://127.0.0.1:${port}`,
        { timeout: 1500 },
      );
      if (connected.contexts()[0]?.pages()[0]) return connected;
      await connected.close();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Owned AppImage did not expose its renderer: ${output.slice(-2000)}`,
  );
}
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
try {
  await copyFile(source, target);
  await chmod(target, 0o755);
  sessionId = await service.createSession(
    host,
    `update-check-${Date.now()}`,
    root,
  );
  const initial = await service.inspect(host, sessionId),
    blockId = initial.windows[0].panes[0].id;
  const before = await service.callMethod<{ pid: number }>(
    host,
    "server.status",
    {},
  );
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex/settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      autoCheckUpdates: false,
      autoDownloadUpdates: false,
      installUpdatesWhenIdle: false,
      closeToTray: false,
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: {
        hostId: host.id,
        sessionId,
        windowId: initial.activeWindowId,
      },
    }),
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    APPIMAGE_EXTRACT_AND_RUN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.APPIMAGE;
  delete env.APPDIR;
  child = spawn(target, [`--remote-debugging-port=${port}`], {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (data) => {
    output = (output + data.toString()).slice(-8000);
  });
  child.stderr?.on("data", (data) => {
    output = (output + data.toString()).slice(-8000);
  });
  browser = await connect();
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!window.rex);
  await page
    .locator(".terminal-pane:visible .terminal-loading")
    .waitFor({ state: "hidden" });
  const oldState = await page.evaluate(() =>
    window.rex.request("updateStatus", {}),
  );
  assert.equal(oldState.currentVersion, oldTag.slice(1));
  assert.equal(oldState.installKind, "appimage");
  const checked = await page.evaluate(() =>
    window.rex.request("checkUpdates", {}),
  );
  assert.equal(checked.phase, "available");
  assert.equal(checked.version, latest.tag_name.slice(1));
  const downloaded = await page.evaluate(() =>
    window.rex.request("downloadUpdate", {}),
  );
  assert.equal(downloaded.phase, "ready");
  assert.equal(downloaded.canApply, true);
  const disconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "The owned client did not relaunch after applying the update",
          ),
        ),
      60000,
    );
    browser!.once("disconnected", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await page.evaluate(() =>
    window.rex.request("applyUpdate", { whenIdle: false }),
  );
  await disconnected;
  browser = undefined;
  assert.equal(await sha256(target), newHash);
  assert.equal(await sha256(`${target}.previous`), oldHash);
  browser = await connect();
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!window.rex);
  const current = await page.evaluate(() =>
    window.rex.request("updateStatus", {}),
  );
  assert.equal(current.currentVersion, latest.tag_name.slice(1));
  assert.equal(current.installKind, "appimage");
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .waitFor();
  await page
    .locator(`[data-block-id="${blockId}"] .terminal-loading`)
    .waitFor({ state: "hidden" });
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();
  await page.keyboard.type("printf '\\nLIVE_UPDATE_%s\\n' OK");
  await page.keyboard.press("Enter");
  let found = false;
  for (let i = 0; i < 50; i++) {
    if (
      (await service.capture(host, sessionId, blockId)).includes(
        "LIVE_UPDATE_OK",
      )
    ) {
      found = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(found, "The same owned terminal must accept input after relaunch");
  const after = await service.callMethod<{ pid: number }>(
    host,
    "server.status",
    {},
  );
  assert.equal(after.pid, before.pid, "Client update must leave Rex running");
  console.log(
    JSON.stringify({
      result: "PASS",
      from: oldTag,
      to: latest.tag_name,
      pid: before.pid,
      sameSession: sessionId,
      sameBlock: blockId,
      backupSha256: oldHash,
      updatedSha256: newHash,
    }),
  );
  await page.evaluate(() => window.rex.windowControl("close"));
  await new Promise((resolve) => setTimeout(resolve, 300));
} finally {
  await browser?.close().catch(() => {});
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  if (sessionId)
    await service.callMethod(host, "session.destroy", {
      session_id: sessionId,
    });
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
