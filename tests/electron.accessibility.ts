import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

// Opt-in desktop audit: creates one session/profile and destroys only that returned ID.
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "test-results-accessibility-"));
const service = new RexService();
const host = DEFAULT_SETTINGS.hosts[0];
let app: ElectronApplication | undefined;
let sessionId: string | undefined;
const checkedViews: string[] = [];
const manualChecks: {
  view: string;
  id: string;
  nodes: number;
  targets: unknown[];
  reasons: string[];
}[] = [];
const findings: {
  view: string;
  id: string;
  impact: string | null | undefined;
  description: string;
  nodes: { target: unknown; summary: string | undefined }[];
}[] = [];
try {
  sessionId = await service.createSession(
    host,
    `accessibility-check-${Date.now()}`,
    root,
  );
  const view = await service.inspect(host, sessionId);
  const blockId = view.windows[0].panes[0].id;
  const profile = join(directory, "preferences.json");
  await writeFile(
    profile,
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      clientLabel: `Accessibility fixture ${Date.now()}`,
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      autoCheckUpdates: false,
      themeLibrary: [
        {
          id: "accessibility-palette",
          name: "Accessibility palette",
          colors: {
            background: "#102030",
            foreground: "#e0e0e0",
            blue: "#4477bb",
          },
        },
      ],
      lastSelection: {
        hostId: host.id,
        sessionId,
        windowId: view.activeWindowId,
      },
    }),
  );
  const config = join(directory, "config");
  await mkdir(config, { recursive: true });
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
  app = await electron.launch({
    executablePath: executable,
    args: [
      ...(process.env.LINUSAURUS_EXECUTABLE ? [] : [root]),
      "--force-renderer-accessibility",
      "--config",
      profile,
    ],
    env: environment,
    timeout: 20_000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .waitFor();
  await page
    .locator(`[data-block-id="${blockId}"] .terminal-loading`)
    .waitFor({ state: "hidden" });
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();
  await page.keyboard.type("printf '\\nACCESSIBLE_%s\\n' REX_MARKER");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".xterm-accessibility")
      ?.textContent?.includes("ACCESSIBLE_REX_MARKER"),
  );
  const audit = async (view: string) => {
    checkedViews.push(view);
    assert.equal(
      page.frames().length,
      1,
      "The legacy axe aggregation path must not omit cross-origin frames",
    );
    const result = await new AxeBuilder({ page })
      // Electron cannot create the extra Chromium aggregation target. This app has one frame.
      .setLegacyMode()
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "best-practice"])
      .analyze();
    manualChecks.push(
      ...result.incomplete.map((rule) => ({
        view,
        id: rule.id,
        nodes: rule.nodes.length,
        targets: rule.nodes.map((node) => node.target),
        reasons: rule.nodes.flatMap((node) =>
          [...node.any, ...node.all, ...node.none].map(
            (check) => check.message,
          ),
        ),
      })),
    );
    findings.push(
      ...result.violations.map((violation) => ({
        view,
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    );
  };
  const trap = async (dialog: ReturnType<Page["getByRole"]>) => {
    await page.keyboard.press("Tab");
    for (let count = 0; count < 30; count++) {
      assert.equal(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
        "Tab focus must remain inside the modal dialog",
      );
      await page.keyboard.press("Tab");
    }
    for (let count = 0; count < 6; count++) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
        "Backward Tab focus must remain inside the modal dialog",
      );
    }
  };
  await audit("workspace");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const tree = await cdp.send("Accessibility.getFullAXTree");
  const named = tree.nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      role: String(node.role?.value),
      name: String(node.name?.value || ""),
    }));
  assert.ok(
    named.some(
      (node) => node.role === "textbox" && /terminal/i.test(node.name),
    ),
    "Chromium must expose an editable terminal input to assistive technology",
  );
  assert.ok(
    named.some((node) => node.name.includes("ACCESSIBLE_REX_MARKER")),
    "Chromium accessibility tree must contain terminal output",
  );
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await palette.waitFor();
  await page
    .getByRole("combobox", { name: "Search commands and sessions" })
    .fill("Rename Tab");
  await audit("palette");
  await trap(palette);
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  assert.ok(
    await page
      .locator(".xterm-helper-textarea")
      .evaluate((element) => element === document.activeElement),
    "Escape restores terminal focus",
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  const preferences = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await preferences.waitFor();
  for (const category of [
    "Appearance",
    "Terminal",
    "Notifications",
    "Hosts",
    "Agents",
    "Keyboard",
    "Server",
  ]) {
    await preferences
      .getByRole("button", { name: category, exact: true })
      .click();
    await audit(`settings:${category.toLowerCase()}`);
  }
  await trap(preferences);
  await page.keyboard.press("Escape");
  await preferences.waitFor({ state: "hidden" });
  const darkSettings = await page.evaluate(() => window.rex.getSettings());
  await page.evaluate(
    (settings) =>
      window.rex.setSettings({
        ...settings,
        theme: "light",
        appearance: "light",
      }),
    darkSettings,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await audit("workspace:light");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await audit("settings:light");
  await page.keyboard.press("Escape");
  await preferences.waitFor({ state: "hidden" });
  await page.evaluate(
    (settings) => window.rex.setSettings(settings),
    darkSettings,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "graphite",
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await page
    .getByRole("button", { name: "Updates and Linux services…", exact: true })
    .click();
  const services = page.getByRole("dialog", {
    name: "Linux services and updates",
    exact: true,
  });
  await services.waitFor();
  await audit("services:server");
  await services.getByRole("tab", { name: /updates/i }).click();
  await audit("services:updates");
  await trap(services);
  await page.keyboard.press("Escape");
  await services.waitFor({ state: "hidden" });
  await page.evaluate(() =>
    window.rex.request("invokeAction", {
      hostId: "local",
      action: "client.diagnostics",
    }),
  );
  const diagnostics = page.getByRole("dialog", {
    name: "Connection diagnostics",
    exact: true,
  });
  await diagnostics.waitFor();
  await audit("diagnostics");
  await trap(diagnostics);
  await page.keyboard.press("Escape");
  await diagnostics.waitFor({ state: "hidden" });
  await page.evaluate(
    (ref) =>
      window.rex.request("invokeAction", {
        ...ref,
        action: "pane.insert_path",
      }),
    { hostId: "local", sessionId, blockId },
  );
  const directoryDialog = page.getByRole("dialog", {
    name: "Insert path",
    exact: true,
  });
  await directoryDialog.waitFor();
  await page.getByRole("textbox", { name: "Directory path" }).fill(root);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByRole("option").first().waitFor();
  await page.getByRole("option").first().focus();
  await page.keyboard.press("End");
  assert.equal(
    await page
      .getByRole("option")
      .last()
      .evaluate((element) => element === document.activeElement),
    true,
    "End focuses the last file",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .getByRole("option")
      .first()
      .evaluate((element) => element === document.activeElement),
    true,
    "Home focuses the first file",
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("option")
      .nth(1)
      .evaluate((element) => element === document.activeElement),
    true,
    "ArrowDown moves to the next file",
  );
  await page
    .getByRole("textbox", { name: "Filter directory entries" })
    .fill(".github");
  await page.getByRole("option", { name: /^\.github/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLInputElement>('[aria-label="Directory path"]')
      ?.value.endsWith("/.github"),
  );
  await page
    .getByRole("textbox", { name: "Filter directory entries" })
    .fill("");
  await audit("directory");
  await trap(directoryDialog);
  await page.keyboard.press("Escape");
  await directoryDialog.waitFor({ state: "hidden" });
  await page
    .locator(`[data-block-id="${blockId}"] .xterm-helper-textarea`)
    .focus();

  // Query only the owned app's native accessibility subtree. Other app contents are never read.
  const native = await promisify(execFile)(
    "/usr/bin/python3",
    [
      "-c",
      `
import json,os,pyatspi,sys,time
root_pid=int(sys.argv[1])
def owned(pid):
 seen=set()
 while pid>1 and pid not in seen:
  if pid==root_pid:return True
  seen.add(pid)
  try:
   with open('/proc/%d/status'%pid) as file:
    parent=next(line for line in file if line.startswith('PPid:'))
   pid=int(parent.split()[1])
  except:return False
 return False
app=None
for attempt in range(30):
 desktop=pyatspi.Registry.getDesktop(0)
 for candidate in desktop:
  try:
   if owned(candidate.get_process_id()):app=candidate;break
  except:pass
 if app:break
 time.sleep(.1)
if app is None:raise RuntimeError('Owned Electron application missing from AT-SPI registry')
queue=[app];names=[];roles=[];count=0
while queue and count<3000:
 item=queue.pop(0);count+=1
 try:
  names.append(item.name or '');roles.append(item.getRoleName())
  queue.extend(child for child in item if child)
 except:pass
print(json.dumps({'nodes':count,'terminalInput':any('terminal input' in name.lower() for name in names),'marker':any('ACCESSIBLE_REX_MARKER' in name for name in names),'roles':sorted(set(roles))}))
`,
      String(app.process().pid),
    ],
    { timeout: 20_000 },
  );
  const nativeResult = JSON.parse(native.stdout);
  assert.equal(
    nativeResult.terminalInput,
    true,
    "AT-SPI must expose the owned terminal input",
  );
  assert.equal(nativeResult.marker, true, "AT-SPI must expose terminal output");
  console.log("Native AT-SPI:", JSON.stringify(nativeResult));
  assert.deepEqual(errors, []);
  assert.equal(
    findings.length,
    0,
    "WCAG A/AA and best-practice axe audits must pass for each tested view",
  );
  await mkdir(join(root, "test-results"), { recursive: true });
  await rm(join(root, "test-results/accessibility-findings.json"), {
    force: true,
  });
  await writeFile(
    join(root, "test-results/accessibility-report.json"),
    JSON.stringify(
      {
        checkedViews,
        ruleTags: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
        violations: [],
        manualChecks,
        nativeAtspi: nativeResult,
        chromiumTerminalInputAndOutput: true,
        keyboardFocusTrapAndRestore: true,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checkedViews.length} axe views, keyboard focus and native AT-SPI terminal output/input`,
  );
} catch (failure) {
  if (findings.length) {
    await mkdir(join(root, "test-results"), { recursive: true });
    await writeFile(
      join(root, "test-results/accessibility-findings.json"),
      JSON.stringify(findings, null, 2),
    );
    console.error(
      "Accessibility summary:",
      JSON.stringify(
        findings.map(({ view, id, impact, nodes }) => ({
          view,
          id,
          impact,
          targets: nodes.map((node) => node.target),
        })),
      ),
    );
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
