import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { CHANNELS } from "../electron/channels.js";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

type RemoteClient = {
  client_id?: string;
  id?: string;
  info?: { label?: string };
  connection_state?: string;
};
type CapturedContents = Electron.WebContents & {
  boundaryAction?: { requestId: string };
};
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, "test-results-boundary-"));
const service = new RexService();
let app: ElectronApplication | undefined;

async function rejectedBridge(page: Page) {
  // Each operation crosses the real production preload and ipcMain handler.
  for (const operation of [
    "settings",
    "save",
    "readClipboard",
    "writeClipboard",
    "request",
  ] as const) {
    await assert.rejects(
      page.evaluate(async (operation) => {
        switch (operation) {
          case "settings":
            return window.rex.getSettings();
          case "save":
            return window.rex.setSettings({} as typeof DEFAULT_SETTINGS);
          case "readClipboard":
            return window.rex.readClipboard();
          case "writeClipboard":
            return window.rex.writeClipboard("forged clipboard");
          case "request":
            return window.rex.request("setContext", { uiBusy: true });
        }
      }, operation),
      /Untrusted renderer/,
    );
  }
}

try {
  const config = join(directory, "config");
  await mkdir(join(config, "Linusaurus Rex"), { recursive: true });
  const label = `IPC boundary fixture ${Date.now()}`;
  await writeFile(
    join(config, "Linusaurus Rex", "settings.json"),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      clientLabel: label,
      notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false },
      autoCheckUpdates: false,
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
  app = await electron.launch({
    executablePath:
      process.env.LINUSAURUS_EXECUTABLE ||
      (createRequire(import.meta.url)("electron") as string),
    args: process.env.LINUSAURUS_EXECUTABLE ? [] : [root],
    env: environment,
    timeout: 20_000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.waitForFunction(() => Boolean(window.rex));
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).clientLabel,
    label,
  );
  await page.evaluate(() => window.rex.writeClipboard("trusted clipboard"));
  assert.equal(
    await page.evaluate(() => window.rex.readClipboard()),
    "trusted clipboard",
  );
  const windowId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
  );

  const opened = app.waitForEvent("window");
  const unregisteredId = await app.evaluate(
    async ({ BrowserWindow }, preload) => {
      const unregistered = new BrowserWindow({
        show: false,
        webPreferences: {
          preload,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      await unregistered.loadURL(
        "data:text/html,<html><body>Unregistered renderer</body></html>",
      );
      return unregistered.id;
    },
    join(root, "dist-electron/preload.cjs"),
  );
  const unregistered = await opened;
  await unregistered.waitForFunction(() => Boolean(window.rex));
  await rejectedBridge(unregistered);
  await unregistered.evaluate(async () => {
    window.rex.windowControl("show");
    await window.rex.getSettings().catch(() => {}); // IPC ordering barrier.
  });
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible(),
      unregisteredId,
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.rex.readClipboard()),
    "trusted clipboard",
  );
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).clientLabel,
    label,
  );

  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.srcdoc = "<html><body>Untrusted subframe</body></html>";
    frame.id = "boundary-subframe";
    document.body.append(frame);
  });
  await expect.poll(() => page.frames().length).toBe(2);
  const subframe = page.frames().find((frame) => frame !== page.mainFrame());
  assert.ok(subframe);
  assert.equal(
    await subframe.evaluate(() => typeof window.rex),
    "undefined",
    "production preload must not expose the bridge in subframes",
  );
  // Electron does not expose Node/preload APIs in production subframes. Use
  // its actual WebFrameMain object to exercise the installed handlers as well.
  const frameRejection = await app.evaluate(
    async ({ BrowserWindow, ipcMain }, { id, channels }) => {
      const window = BrowserWindow.fromId(id)!;
      const event = {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame.frames[0],
      };
      if (!event.senderFrame)
        throw new Error("The native subframe was not created.");
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (event: unknown) => unknown>;
        }
      )._invokeHandlers;
      try {
        await handlers.get(channels.getSettings)!(event);
        return "accepted";
      } catch (failure) {
        ipcMain.emit(channels.windowControl, event, "hide");
        return failure instanceof Error ? failure.message : String(failure);
      }
    },
    { id: windowId, channels: CHANNELS },
  );
  assert.match(frameRejection, /Untrusted renderer/);
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible(),
      windowId,
    ),
    true,
  );

  // Hold one genuine server-originated action at the renderer delivery point.
  // A forged reply must not beat the owning main frame's legitimate reply.
  await app.evaluate(
    ({ BrowserWindow }, { id, channel }) => {
      const contents = BrowserWindow.fromId(id)!
        .webContents as CapturedContents;
      const send = contents.send.bind(contents);
      contents.send = (name, ...args) => {
        const event = args[0];
        if (name === channel && event?.type === "action") {
          contents.boundaryAction = event;
          return;
        }
        send(name, ...args);
      };
    },
    { id: windowId, channel: CHANNELS.clientEvent },
  );
  const host = DEFAULT_SETTINGS.hosts[0];
  const ownClient = async () => {
    const response = await service.callMethod<
      RemoteClient[] | { clients: RemoteClient[] }
    >(host, "client.list", {});
    return (Array.isArray(response) ? response : response.clients).find(
      (client) =>
        client.info?.label === label && client.connection_state === "connected",
    );
  };
  await expect.poll(ownClient).toBeTruthy();
  const client = await ownClient();
  assert.ok(client);
  const interceptAction = async () => {
    await app!.evaluate(({ BrowserWindow }, id) => {
      (
        BrowserWindow.fromId(id)!.webContents as CapturedContents
      ).boundaryAction = undefined;
    }, windowId);
    const performed = service.callMethod(host, "client.perform", {
      client_id: client.client_id || client.id,
      action: "client.sidebar.toggle",
      args: {},
      timeout_ms: 10_000,
    });
    void performed.catch(() => {});
    await expect
      .poll(() =>
        app!.evaluate(
          ({ BrowserWindow }, id) =>
            (BrowserWindow.fromId(id)!.webContents as CapturedContents)
              .boundaryAction?.requestId,
          windowId,
        ),
      )
      .toBeTruthy();
    const requestId = await app!.evaluate(
      ({ BrowserWindow }, id) =>
        (BrowserWindow.fromId(id)!.webContents as CapturedContents)
          .boundaryAction!.requestId,
      windowId,
    );
    return { performed, requestId };
  };
  const { performed, requestId } = await interceptAction();
  await unregistered.evaluate(async (requestId) => {
    window.rex.replyAction(requestId, { source: "unregistered" });
    await window.rex.getSettings().catch(() => {});
  }, requestId);
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { id, channel, requestId }) => {
      const window = BrowserWindow.fromId(id)!;
      ipcMain.emit(
        channel,
        {
          sender: window.webContents,
          senderFrame: window.webContents.mainFrame.frames[0],
        },
        requestId,
        { source: "subframe" },
      );
    },
    { id: windowId, channel: CHANNELS.replyAction, requestId },
  );
  await page.evaluate(
    (requestId) => window.rex.replyAction(requestId, { source: "allowed" }),
    requestId,
  );
  const result = await performed;
  assert.match(JSON.stringify(result), /allowed/);
  assert.doesNotMatch(JSON.stringify(result), /unregistered|subframe/);

  // A BrowserWindow remains registered after main-frame navigation, but its new
  // document loses every bridge capability granted to the original URL.
  const navigationAction = await interceptAction();
  const allowedUrl = page.url();
  await app.evaluate(async ({ BrowserWindow }, id) => {
    await BrowserWindow.fromId(id)!.loadURL(
      "data:text/html,<html><body>Navigated renderer</body></html>",
    );
  }, windowId);
  await page.waitForFunction(() => Boolean(window.rex));
  await rejectedBridge(page);
  await page.evaluate(async (requestId) => {
    window.rex.replyAction(requestId, { source: "navigated" });
    window.rex.windowControl("hide");
    await window.rex.getSettings().catch(() => {});
  }, navigationAction.requestId);
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible(),
      windowId,
    ),
    true,
  );
  await app.evaluate(
    async ({ BrowserWindow }, { id, url }) => {
      await BrowserWindow.fromId(id)!.loadURL(url);
    },
    { id: windowId, url: allowedUrl },
  );
  await page.waitForFunction(() => Boolean(window.rex));
  assert.equal(
    (await page.evaluate(() => window.rex.getSettings())).clientLabel,
    label,
  );
  await page.evaluate(
    (requestId) =>
      window.rex.replyAction(requestId, { source: "restored-owner" }),
    navigationAction.requestId,
  );
  const navigationResult = JSON.stringify(await navigationAction.performed);
  assert.match(navigationResult, /restored-owner/);
  assert.doesNotMatch(navigationResult, /navigated/);
  console.log(
    "PASS: production Electron IPC permits its owning main frame and rejects unregistered, subframe, and navigated senders; forged window controls and action replies have no effects.",
  );
} finally {
  if (app) await app.close();
  service.dispose();
  await rm(directory, { recursive: true, force: true });
}
