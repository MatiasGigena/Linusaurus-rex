import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createOwnedSystemdFixture } from "./owned-systemd.js";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS, type Host } from "../src/shared/types.js";

// An optional supplying harness owns its fixture; otherwise this test creates one.
const fixturePath = process.env.LINUSAURUS_SYSTEMD_FIXTURE;
const owned = fixturePath ? undefined : await createOwnedSystemdFixture();
const fixture =
  owned?.fixture ??
  (JSON.parse(await readFile(fixturePath!, "utf8")) as {
    unit: string;
    host: Host;
    sessionId: string;
    pid: number;
    configDropIn: string;
  });
assert.match(fixture.unit, /^linusaurus-native-test-[\da-f-]+\.service$/);
assert.equal(fixture.host.id, "native-service-owned");
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(join(root, "test-results-systemd-ui-"));
const rex = new RexService();
let app: ElectronApplication | undefined;
try {
  const inspected = await rex.inspect(fixture.host, fixture.sessionId);
  const original = await rex.callMethod<{ pid: number }>(
    DEFAULT_SETTINGS.hosts[0],
    "server.status",
    {},
  );
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  await writeFile(
    join(config, "Linusaurus Rex/settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      hosts: [fixture.host],
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      lastSelection: {
        hostId: fixture.host.id,
        sessionId: fixture.sessionId,
        windowId: inspected.activeWindowId,
      },
    }),
  );
  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({
    executablePath:
      process.env.LINUSAURUS_EXECUTABLE ||
      (createRequire(import.meta.url)("electron") as string),
    args: [
      ...(process.env.LINUSAURUS_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${join(directory, "profile")}`,
      "--config",
      join(config, "Linusaurus Rex/settings.json"),
    ],
    env: env as Record<string, string>,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".terminal-pane:visible").waitFor();
  const before = await page.evaluate(
    (hostId) => window.rex.request("serverManagement", { hostId }),
    fixture.host.id,
  );
  assert.equal(before.service?.unit, fixture.unit);
  assert.equal(before.service?.restart, "always");
  assert.equal(before.pid, fixture.pid);
  assert.ok(before.sessionCount > 0);
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
  await dialog.getByText(`${fixture.unit} (user)`, { exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Restart idle server", exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .getByRole("textbox", { name: "Allowed web origins" })
    .fill("native-ui.example");
  await dialog.getByRole("button", { name: "Review service override" }).click();
  const preview = dialog.getByRole("region", {
    name: "Service origin override preview",
  });
  await preview.waitFor();
  assert.ok((await preview.innerText()).includes("--websocket-origin-pattern"));
  await preview
    .getByRole("button", { name: "Apply reviewed override" })
    .click();
  await dialog
    .getByRole("status")
    .filter({ hasText: "Service override saved" })
    .waitFor();
  const after = await page.evaluate(
    (hostId) => window.rex.request("serverManagement", { hostId }),
    fixture.host.id,
  );
  assert.equal(after.pid, before.pid);
  assert.deepEqual(after.origins, before.origins);
  assert.deepEqual(after.service?.configuredOrigins, ["native-ui.example"]);
  assert.deepEqual(after.pendingOrigins, ["native-ui.example"]);
  assert.equal(after.service?.restart, "always");
  assert.match(
    await readFile(fixture.configDropIn, "utf8"),
    /native-ui\.example/,
  );
  assert.equal(
    (
      await rex.callMethod<{ pid: number }>(
        DEFAULT_SETTINGS.hosts[0],
        "server.status",
        {},
      )
    ).pid,
    original.pid,
  );
  assert.deepEqual(errors, []);
  await mkdir(join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: join(root, "test-results/systemd-review.png"),
  });
  console.log(
    "PASS: native user-service diagnostics, disabled busy restart, reviewed persistent origins, unchanged Rex processes and sessions",
  );
} finally {
  await app?.close();
  rex.dispose();
  await owned?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
