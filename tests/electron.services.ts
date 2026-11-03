import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "test-results-services-"));
const service = new RexService();
const host = {
  ...DEFAULT_SETTINGS.hosts[0],
  id: "services",
  label: "Services acceptance",
};
const sessions: string[] = [];
let app: ElectronApplication | undefined;
try {
  const initialId = await service.createSession(
    host,
    `services-check-${Date.now()}`,
    root,
  );
  sessions.push(initialId);
  const initial = await service.inspect(host, initialId);
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex", "settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      hosts: [host],
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: {
        hostId: host.id,
        sessionId: initialId,
        windowId: initial.activeWindowId,
      },
    }),
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;
  environment.XDG_CONFIG_HOME = config;
  environment.LINUSAURUS_TEST_NOTIFICATIONS = "1";
  app = await electron.launch({
    executablePath:
      process.env.LINUSAURUS_EXECUTABLE ||
      (createRequire(import.meta.url)("electron") as string),
    args: process.env.LINUSAURUS_EXECUTABLE ? [] : [root],
    env: environment,
    timeout: 20_000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".terminal-pane:visible").waitFor();
  const before = await page.evaluate(
    (hostId) => window.rex.request("serverManagement", { hostId }),
    host.id,
  );
  assert.equal(before.running, true);
  assert.ok(before.sessionCount > 0);
  assert.equal(before.local, true);
  assert.ok(before.executable?.endsWith("/rex"));
  assert.match(before.binarySha256!, /^[a-f\d]{64}$/);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Server", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Updates and Linux services…" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Linux services and updates",
    exact: true,
  });
  await dialog.waitFor();
  await expect(
    dialog.getByRole("button", { name: "Restart idle server", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Allowed web origins" })
    .fill("https://client.example.com\n*.trusted.example.com");
  await dialog
    .getByRole("button", { name: "Save origin patterns", exact: true })
    .click();
  await page.waitForFunction(async () => {
    const settings = await window.rex.getSettings();
    return settings.hosts[0].websocketOrigins?.[0] === "client.example.com";
  });
  const pending = await page.evaluate(
    (hostId) => window.rex.request("serverManagement", { hostId }),
    host.id,
  );
  assert.deepEqual(pending.origins, before.origins);
  assert.deepEqual(pending.pendingOrigins, [
    "client.example.com",
    "*.trusted.example.com",
  ]);
  await dialog
    .getByRole("button", { name: "Discard pending changes", exact: true })
    .click();
  await page.waitForFunction(
    async () => !(await window.rex.getSettings()).hosts[0].websocketOrigins,
  );
  await dialog
    .getByRole("tab", { name: "Client updates", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Download verified update",
      exact: true,
    }),
  ).toBeDisabled();
  const update = await page.evaluate(() =>
    window.rex.request("updateStatus", {}),
  );
  assert.match(update.currentVersion, /^\d+\.\d+\.\d+/);
  if (process.env.LINUSAURUS_EXECUTABLE?.endsWith(".AppImage"))
    assert.equal(
      update.installKind,
      "appimage",
      "The updater must identify its own AppImage runtime",
    );
  else if (process.env.LINUSAURUS_EXECUTABLE)
    assert.equal(
      update.installKind,
      "deb",
      "An unpacked Debian executable must not inherit an AppImage update target",
    );
  else assert.equal(update.installKind, "development");
  assert.equal(update.phase, "idle");
  assert.equal(update.canApply, false);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const tutorial = await page.evaluate(
    async (hostId) =>
      (await window.rex.request("invokeAction", {
        hostId,
        action: "client.onboarding",
      })) as { sessionId: string; windowId: string; blockId: string },
    host.id,
  );
  sessions.push(tutorial.sessionId);
  await page.getByRole("region", { name: "Rex tutorial" }).waitFor();
  await page
    .getByRole("heading", { name: "Your persistent Linux workspace" })
    .waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("heading", { name: "Make the terminal yours" })
    .waitFor();
  const state = (await service.callMethod(host, "block.method", {
    session_id: tutorial.sessionId,
    block_id: tutorial.blockId,
    method: "state",
    args: {},
  })) as { step: string };
  assert.equal(state.step, "appearance");
  await page.getByRole("button", { name: /Keyboard/ }).click();
  await page
    .getByRole("heading", { name: "Keep your hands on the keyboard" })
    .waitFor();
  const final = await page.evaluate(
    (hostId) => window.rex.request("serverManagement", { hostId }),
    host.id,
  );
  assert.equal(final.pid, before.pid);
  assert.deepEqual(final.origins, before.origins);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Electron service diagnostics, idle restart protection, pending origins save/discard, update state, and server-backed graphical onboarding",
  );
} finally {
  await app?.close();
  for (const sessionId of sessions)
    await service.callMethod(host, "session.destroy", {
      session_id: sessionId,
    });
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
