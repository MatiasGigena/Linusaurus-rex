import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

// Opt-in end-to-end verification. Only the sessions returned here are destroyed.
const root = resolve(import.meta.dirname, "..");
const local = DEFAULT_SETTINGS.hosts[0];
const service = new RexService();
const directory = await mkdtemp(join(root, "test-results-"));
const sessionIds: string[] = [];
let app: ElectronApplication | undefined;
try {
  const sessionId = await service.createSession(
    local,
    `interface-check-${Date.now()}`,
    root,
  );
  sessionIds.push(sessionId);
  const initial = await service.inspect(local, sessionId);
  const blockId = initial.windows[0].panes[0].id;
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex", "settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      lastSelection: {
        hostId: local.id,
        sessionId,
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
  const rendererErrors: string[] = [];
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page
    .getByRole("button", { name: initial.label, exact: true })
    .first()
    .waitFor({ timeout: 15_000 });
  await page.locator(".terminal-container .xterm").first().waitFor();
  const waitForTerminal = async (text: string) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const screen = await service.capture(local, sessionId, blockId);
      if (
        screen
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/[\r\n]/g, "")
          .includes(text)
      )
        return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Terminal did not display ${text}`);
  };
  await page.waitForTimeout(500);
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.type("printf '\\nGUI_INPUT_%s\\n' OK");
  await page.keyboard.press("Enter");
  await waitForTerminal("GUI_INPUT_OK");
  assert.equal(await page.locator(".terminal-error").count(), 0);

  await page.getByRole("button", { name: /Split right/ }).click();
  await page
    .locator(".terminal-pane:visible")
    .nth(1)
    .waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".terminal-pane:visible").count(), 2);
  await page
    .locator(".terminal-pane:visible")
    .first()
    .click({ position: { x: 35, y: 65 } });
  await page
    .getByRole("button", { name: /^Maximize pane/ })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".terminal-pane")].filter(
        (element) => element.getClientRects().length,
      ).length === 1,
  );
  await page.keyboard.press("Control+Shift+Enter");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".terminal-pane")].filter(
        (element) => element.getClientRects().length,
      ).length === 2,
  );

  await page.keyboard.press("Control+Shift+P");
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .fill("Rename Tab");
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .press("Enter");
  await page.getByRole("textbox", { name: "Tab name" }).fill("Development");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await service.inspect(local, sessionId)).windows[0].label,
    "Development",
  );

  await page
    .getByRole("button", { name: /^Settings$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByRole("button", { name: "Browse installed fonts" }).click();
  await page.getByLabel("Installed font face").waitFor();
  assert.ok(
    (await page.getByLabel("Installed font face").locator("option").count()) >
      1,
    "Native font browser must enumerate installed faces",
  );
  await page.getByLabel("Font size").selectOption("16");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).fontSize,
    16,
  );

  await page
    .locator(`[data-block-id="${blockId}"] .terminal-pane:visible`)
    .click({ position: { x: 40, y: 65 } });
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-block-id="${id}"] .terminal-pane`)
        ?.classList.contains("is-focused"),
    blockId,
  );
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const items = await clipboard.read();
    const backup = await Promise.all(
      items.map(
        async (item) =>
          new ClipboardItem(
            Object.fromEntries(
              await Promise.all(
                item.types.map(async (type) => [
                  type,
                  await item.getType(type),
                ]),
              ),
            ),
          ),
      ),
    );
    (
      globalThis as typeof globalThis & {
        clipboardBackup?: Electron.ClipboardItem[];
      }
    ).clipboardBackup = backup;
  });
  try {
    await page.evaluate(() =>
      window.rex.writeClipboard("printf '\\nCLIPBOARD_%s\\n' OK"),
    );
    assert.equal(
      await page.evaluate(() => window.rex.readClipboard()),
      "printf '\\nCLIPBOARD_%s\\n' OK",
    );
    await page.keyboard.press("Control+Shift+V");
    await waitForTerminal("CLIPBOARD_%s");
    await page.keyboard.press("Enter");
    await waitForTerminal("CLIPBOARD_OK");
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      const state = globalThis as typeof globalThis & {
        clipboardBackup?: Electron.ClipboardItem[];
      };
      if (state.clipboardBackup?.length)
        await clipboard.write(state.clipboardBackup);
      else clipboard.clear();
      delete state.clipboardBackup;
    });
  }

  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();
  await page.keyboard.press("Control+Shift+F");
  await page
    .getByRole("textbox", { name: "Find terminal text" })
    .fill("GUI_INPUT_OK");
  await page.waitForFunction(() => {
    const count = document.querySelector(".terminal-search-count")?.textContent;
    return !!count && !count.startsWith("0/");
  });
  await page.getByRole("button", { name: "Close terminal search" }).click();

  await page.keyboard.press("Control+Shift+P");
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .fill("Insert Path");
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .press("Enter");
  await page.getByRole("textbox", { name: "Directory path" }).fill(root);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Filter directory entries" })
    .fill("README.md");
  await page.getByRole("option", { name: /README.md/ }).click();
  await page.getByRole("button", { name: "Insert selected path" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await waitForTerminal("README.md");
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();
  await page.keyboard.press("Control+U");
  assert.ok(
    (
      await page.evaluate(() => window.rex.getSettings())
    ).recentPaths.local.some((path) => path.endsWith("/README.md")),
  );

  const border = page.locator(".split-divider:visible").first();
  const before = (await service.inspect(local, sessionId)).windows[0]
    .dividers![0].ratio;
  await border.press("ArrowRight");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      (await service.inspect(local, sessionId)).windows[0].dividers![0].ratio >
      before
    )
      break;
    await page.waitForTimeout(100);
  }
  assert.ok(
    (await service.inspect(local, sessionId)).windows[0].dividers![0].ratio >
      before,
    "Keyboard resizing must update Rex split geometry",
  );
  console.log(
    "PASS: installed fonts, terminal search, remote directory listing/path insertion, and split resizing",
  );

  await page.keyboard.press("Control+Shift+N");
  await page
    .getByRole("textbox", { name: "Session name" })
    .fill(`created-in-ui-${Date.now()}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const created = (await service.sessions(local)).filter((session) =>
    session.label.startsWith("created-in-ui-"),
  );
  assert.equal(created.length, 1);
  sessionIds.push(created[0].id);
  await page
    .getByRole("button", { name: initial.label, exact: true })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".terminal-pane")].filter(
        (element) => element.getClientRects().length,
      ).length === 2,
  );

  // An error on a separate saved host must not interrupt the connected terminal.
  const previous = await page.evaluate(() => window.rex.getSettings());
  await page.evaluate(
    (settings) =>
      window.rex.setSettings({
        ...settings,
        hosts: [
          ...settings.hosts,
          {
            id: "missing",
            label: "Offline test",
            endpoint: "unix:///tmp/linusaurus-nonexistent.sock",
          },
        ],
      }),
    previous,
  );
  await page
    .locator(".terminal-pane:visible")
    .first()
    .click({ position: { x: 40, y: 65 } });
  await page.keyboard.type("printf '\\nAFTER_HOST_CHANGE_%s\\n' OK");
  await page.keyboard.press("Enter");
  await waitForTerminal("AFTER_HOST_CHANGE_OK");
  await page.evaluate((settings) => window.rex.setSettings(settings), previous);

  await page.waitForTimeout(350);
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();
  await page.keyboard.press("Control+Shift+B");
  await page.locator(".sidebar").waitFor({ state: "hidden" });
  console.log("PASS: terminal, session and host workflows");
  assert.equal(await page.locator(".sidebar").count(), 0);
  await page.keyboard.press("Control+Shift+B");
  await page.locator(".sidebar").waitFor();
  await page
    .getByRole("button", { name: "Command palette", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .fill("Connection diagnostics");
  // Diagnostics has a native action; invoke the same trusted bridge to avoid title-dependent matching.
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.rex.request("invokeAction", {
      hostId: "local",
      action: "client.diagnostics",
    }),
  );
  await page.getByRole("dialog", { name: "Connection diagnostics" }).waitFor();
  await page.getByText("API compatibility", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.deepEqual(rendererErrors, []);

  if (process.env.LINUSAURUS_SCREENSHOT) {
    await page
      .locator(".terminal-pane:visible")
      .first()
      .click({ position: { x: 40, y: 65 } });
    await page.keyboard.type(
      "printf '\\033[2J\\033[H\\033[1;32mLinusaurus Rex\\033[0m\\nYour terminals, together.\\n\\n'; pwd; git log -3 --oneline",
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    await page.screenshot({ path: process.env.LINUSAURUS_SCREENSHOT });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(760, 600),
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page
      .getByRole("button", { name: "Close application" })
      .evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.x >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight
        );
      }),
    true,
    "Window controls must remain reachable at the minimum window size",
  );
  await app.close();
  app = undefined;
  assert.equal(
    (await service.inspect(local, sessionId)).windows.length,
    1,
    "Closing the desktop app must preserve its session",
  );
  console.log(
    "PASS: real Electron typing, split/zoom, palette, rename, font settings, clipboard, session creation, sidebar, saved-host changes, persistence, and renderer errors.",
  );
} catch (failure) {
  if (app) {
    const page = await app.firstWindow();
    await mkdir(join(root, "test-results"), { recursive: true });
    await page.screenshot({ path: join(root, "test-results/failure.png") });
    console.log(
      "GUI errors:",
      await page
        .locator(".terminal-error,.connection-banner")
        .allTextContents(),
    );
    const state = await service.inspect(local, sessionIds[0]);
    for (const pane of state.windows[0].panes) {
      const capture = await service.capture(local, state.id, pane.id);
      console.log(
        "Test pane diagnostics",
        JSON.stringify({
          blockId: pane.id,
          focused: pane.id === state.windows[0].focusedBlockId,
          clipboardTyped: capture.includes("CLIPBOARD_%s"),
          clipboardDone: capture.includes("CLIPBOARD_OK"),
        }),
      );
    }
  }
  throw failure;
} finally {
  await app?.close();
  for (const sessionId of sessionIds)
    await service.callMethod(local, "session.destroy", {
      session_id: sessionId,
    });
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
