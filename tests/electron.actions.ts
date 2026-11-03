import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { localEndpoint } from "../electron/rex/control.js";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS, type Host } from "../src/shared/types.js";

// Opt-in: npm run build && npx tsx tests/electron.actions.ts
// This fixture creates its own profile and sessions, and only destroys returned IDs.
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "test-results-actions-"));
const host: Host = {
  id: "acceptance",
  label: "Acceptance server",
  endpoint: localEndpoint(),
};
const service = new RexService();
const sessions: string[] = [];
let app: ElectronApplication | undefined;
try {
  const stamp = Date.now();
  const firstId = await service.createSession(
    host,
    `action-check-first-${stamp}`,
    root,
  );
  sessions.push(firstId);
  const first = await service.inspect(host, firstId);
  const backgroundTab = first.windows[0],
    backgroundBlock = backgroundTab.panes[0].id;
  await service.createWindow(host, firstId, "Launch target", root);
  const launched = await service.inspect(host, firstId);
  const launchTab = launched.windows.find(
    (tab) => tab.id !== backgroundTab.id,
  )!;
  const launchBlock = launchTab.panes[0].id;
  const secondId = await service.createSession(
    host,
    `action-check-second-${stamp}`,
    root,
  );
  sessions.push(secondId);
  const second = await service.inspect(host, secondId),
    secondTab = second.windows[0],
    secondBlock = secondTab.panes[0].id;

  const profile = join(directory, "custom-preferences.json");
  const config = join(directory, "config");
  await mkdir(config, { recursive: true });
  const label = `Action acceptance ${stamp}`;
  await writeFile(
    profile,
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      hosts: [host],
      clientLabel: label,
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: {
        hostId: host.id,
        sessionId: secondId,
        windowId: secondTab.id,
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
  const executable =
    process.env.LINUSAURUS_EXECUTABLE ||
    (createRequire(import.meta.url)("electron") as string);
  const prefix = process.env.LINUSAURUS_EXECUTABLE ? [] : [root];
  const help = await promisify(execFile)(executable, [...prefix, "--help"], {
    env: environment,
    timeout: 20_000,
  });
  assert.match(help.stdout, /--session LABEL_OR_ID/);
  assert.match(help.stdout, /Only --new creates/);
  app = await electron.launch({
    executablePath: executable,
    args: [
      ...prefix,
      "--endpoint",
      host.endpoint,
      "--session",
      first.label,
      "--block",
      launchBlock,
      "--config",
      profile,
      "--font",
      "DejaVu Sans Mono",
      "--font-size",
      "18",
      "--window-size",
      "1200x760",
    ],
    env: environment,
    timeout: 20_000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visiblePane = (page: Page, block: string) =>
    page.locator(`[data-block-id="${block}"] .terminal-pane:visible`);
  await visiblePane(page, launchBlock).waitFor();
  await page.waitForFunction(
    (block) =>
      document
        .querySelector(`[data-block-id="${block}"] .terminal-pane`)
        ?.classList.contains("is-focused"),
    launchBlock,
  );
  const initialSettings = await page.evaluate(() => window.rex.getSettings());
  assert.equal(initialSettings.fontFamily, "DejaVu Sans Mono");
  assert.equal(initialSettings.fontSize, 18);
  assert.equal(initialSettings.lastSelection?.sessionId, firstId);
  assert.equal(initialSettings.lastSelection?.windowId, launchTab.id);
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize(),
    ),
    [1200, 760],
  );
  assert.equal(JSON.parse(await readFile(profile, "utf8")).fontSize, 18);
  console.log(
    "PASS: real Electron CLI session/block/profile/font/window-size and no-GUI help",
  );

  const clients = await service.callMethod<any>(host, "client.list", {});
  const own = (Array.isArray(clients) ? clients : clients.clients).filter(
    (client: any) =>
      client.info?.label === label && client.connection_state === "connected",
  );
  assert.equal(
    own.length,
    1,
    "Only the fixture client may receive automated actions",
  );
  const clientId = own[0].client_id || own[0].id;
  const perform = (
    action: string,
    args: Record<string, unknown> = {},
    sessionId?: string,
    blockId?: string,
  ) =>
    service.callMethod(host, "client.perform", {
      client_id: clientId,
      action,
      args,
      origin: "api",
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(blockId ? { block_id: blockId } : {}),
      timeout_ms: 5000,
    });
  await perform("client.find.open", {}, firstId, backgroundBlock);
  await visiblePane(page, backgroundBlock).waitFor();
  await page.getByRole("textbox", { name: "Find terminal text" }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).lastSelection
      ?.windowId,
    backgroundTab.id,
  );
  await page.keyboard.press("Escape");
  console.log(
    "PASS: scoped client.perform opens search on its background-tab pane",
  );

  const newWindow = app.waitForEvent("window");
  await perform(
    "client.window.new",
    { window_id: secondTab.id },
    secondId,
    secondBlock,
  );
  const other = await newWindow;
  other.setDefaultTimeout(15_000);
  other.on("pageerror", (error) => errors.push(error.message));
  await visiblePane(other, secondBlock).waitFor();
  assert.equal(
    (await other.evaluate(() => window.rex.getSettings())).lastSelection
      ?.sessionId,
    secondId,
  );
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).lastSelection
      ?.sessionId,
    firstId,
  );

  await perform("client.settings", { tab: "terminal" });
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Font size").selectOption("20");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await other
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await other.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(other.getByLabel("Font size")).toHaveValue("20");
  await other.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).lastSelection
      ?.sessionId,
    firstId,
  );
  assert.equal(
    (await other.evaluate(() => window.rex.getSettings())).lastSelection
      ?.sessionId,
    secondId,
  );
  await visiblePane(page, backgroundBlock).waitFor();
  await visiblePane(other, secondBlock).waitFor();
  assert.equal(JSON.parse(await readFile(profile, "utf8")).fontSize, 20);
  await perform("client.diagnostics");
  await page
    .getByRole("dialog", { name: "Connection diagnostics", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reverse native-window action, diagnostics, and live settings broadcast preserve both selections",
  );
} catch (failure) {
  for (const page of app?.windows() ?? [])
    if (!page.isClosed()) {
      console.error(
        "Action acceptance diagnostics",
        await page
          .evaluate(async () => ({
            title: document.title,
            selection: (await window.rex.getSettings()).lastSelection,
            visiblePanes: [
              ...document.querySelectorAll<HTMLElement>("[data-block-id]"),
            ]
              .filter((element) => element.getClientRects().length)
              .map((element) => element.dataset.blockId),
            errors: [
              ...document.querySelectorAll('.terminal-error,[role="alert"]'),
            ].map((element) => element.textContent),
          }))
          .catch(() => ({ renderer: "unavailable" })),
      );
    }
  throw failure;
} finally {
  await app?.close();
  for (const sessionId of sessions)
    await service.callMethod(host, "session.destroy", {
      session_id: sessionId,
    });
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
