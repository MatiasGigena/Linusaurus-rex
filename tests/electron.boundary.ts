import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  const failure = await page.evaluate(async () => {
    try {
      await window.rex.request("setContext", { uiBusy: true });
      throw new Error("Unauthorized request succeeded");
    } catch (error) {
      return error instanceof Error
        ? { name: error.name, message: error.message }
        : null;
    }
  });
  assert.deepEqual(
    failure,
    { name: "Error", message: "Untrusted renderer" },
    "Sender admission uses the same renderer-world error contract",
  );
}

async function verifyCredentialAdapter(app: ElectronApplication, page: Page) {
  const secret = "native-boundary-fixture-token";
  const host = {
    id: "boundary-credentials",
    label: "Credential fixture",
    endpoint: "http://127.0.0.1:1",
  };
  const key = (endpoint: string) =>
    `${host.id}:${createHash("sha256").update(endpoint).digest("hex")}`;
  const path = join(
    await app.evaluate(({ app }) => app.getPath("userData")),
    "host-credentials.json",
  );
  const entries = async () => {
    const text = await readFile(path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      },
    );
    assert.equal(
      text.includes(secret),
      false,
      "Credential storage must never contain plaintext fixture secrets",
    );
    const value: unknown = JSON.parse(text);
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  const status = () =>
    page.evaluate(
      (hostId) => window.rex.request("credentialStatus", { hostId }),
      host.id,
    );
  const save = () =>
    page.evaluate(
      ({ hostId, token }) =>
        window.rex.request("setCredentials", { hostId, token }),
      { hostId: host.id, token: secret },
    );
  await assert.rejects(
    page.evaluate(
      (token) =>
        window.rex.request("setCredentials", { hostId: "local", token }),
      secret,
    ),
    /explicit HTTP/,
  );
  await page.evaluate(async (host) => {
    const settings = await window.rex.getSettings();
    await window.rex.setSettings({
      ...settings,
      hosts: [...settings.hosts, host],
    });
  }, host);
  try {
    const initial = await status();
    const native = await app.evaluate(async ({ safeStorage }) => ({
      available: await safeStorage.isAsyncEncryptionAvailable(),
      backend: safeStorage.getSelectedStorageBackend(),
    }));
    assert.deepEqual(initial, {
      stored: false,
      secureStorageAvailable:
        native.available && native.backend !== "basic_text",
    });
    if (initial.secureStorageAvailable) {
      await save();
      assert.equal((await status()).stored, true);
      const encrypted = (await entries())[key(host.endpoint)];
      assert.ok(typeof encrypted === "string");
      assert.equal(
        await app.evaluate(
          async ({ safeStorage }, { encrypted, expected }) => {
            const decoded: unknown = JSON.parse(
              (
                await safeStorage.decryptStringAsync(
                  Buffer.from(encrypted, "base64"),
                )
              ).result,
            );
            return (
              decoded !== null &&
              typeof decoded === "object" &&
              "token" in decoded &&
              decoded.token === expected
            );
          },
          { encrypted, expected: secret },
        ),
        true,
        "The real safeStorage adapter must round-trip without returning a secret to the renderer",
      );
      const replacement = "http://127.0.0.1:2";
      await page.evaluate(
        async ({ hostId, endpoint }) => {
          const settings = await window.rex.getSettings();
          await window.rex.setSettings({
            ...settings,
            hosts: settings.hosts.map((host) =>
              host.id === hostId ? { ...host, endpoint } : host,
            ),
          });
        },
        { hostId: host.id, endpoint: replacement },
      );
      assert.equal((await status()).stored, false);
      assert.equal(
        Object.hasOwn(await entries(), key(host.endpoint)),
        false,
        "Endpoint replacement removes the old namespace",
      );
      await save();
      assert.ok(
        Object.hasOwn(await entries(), key(replacement)),
        "Saved keys remain compatible with the endpoint-bound namespace",
      );
    } else {
      await assert.rejects(save(), /secure desktop secret store|keyring/i);
      assert.equal((await status()).stored, false);
      console.log(
        `Credential adapter correctly refuses unavailable secure storage (${native.backend}); encrypted round-trip is not available in this environment.`,
      );
    }
    assert.equal(
      JSON.stringify(
        await page.evaluate(() => window.rex.getSettings()),
      ).includes(secret),
      false,
      "Renderer settings never reveal stored secrets",
    );
    await page.evaluate(
      (hostId) => window.rex.request("removeCredentials", { hostId }),
      host.id,
    );
    assert.equal((await status()).stored, false);
    assert.ok(
      !Object.keys(await entries()).some((entry) =>
        entry.startsWith(`${host.id}:`),
      ),
    );
  } finally {
    await page.evaluate(async (hostId) => {
      const settings = await window.rex.getSettings();
      await window.rex.setSettings({
        ...settings,
        hosts: settings.hosts.filter((host) => host.id !== hostId),
      });
    }, host.id);
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
  await verifyCredentialAdapter(app, page);
  assert.equal(
    await page.evaluate(() =>
      window.rex.request("setContext", { uiBusy: false }),
    ),
    undefined,
  );
  const malformed = await page.evaluate(async () => {
    try {
      await window.rex.request("status", null as unknown as { hostId: string });
      throw new Error("Malformed request unexpectedly succeeded");
    } catch (error) {
      return error instanceof Error
        ? { name: error.name, message: error.message }
        : null;
    }
  });
  assert.deepEqual(malformed, { name: "Error", message: "Expected an object" });
  const remoteError = await page.evaluate(async () => {
    try {
      await window.rex.request("inspectSession", {
        hostId: "local",
        sessionId: "missing-boundary-session",
      });
      throw new Error("Missing session unexpectedly succeeded");
    } catch (failure) {
      if (!(failure instanceof Error))
        throw new Error(
          "Bridge rejection was not an Error in the renderer world",
        );
      return {
        message: failure.message,
        code: "code" in failure ? failure.code : undefined,
        method: "method" in failure ? failure.method : undefined,
      };
    }
  });
  assert.equal(
    typeof remoteError.code,
    "string",
    "Rex rejection identity survives IPC and context isolation",
  );
  assert.ok(
    ["session.attach", "session.view"].includes(String(remoteError.method)),
  );
  const windowId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
  );

  // The shared settings listener must revoke host authority in every window.
  const clientCount = async () => {
    const response = await service.callMethod<
      RemoteClient[] | { clients: RemoteClient[] }
    >(DEFAULT_SETTINGS.hosts[0], "client.list", {});
    return (Array.isArray(response) ? response : response.clients).filter(
      (client) =>
        client.info?.label === label && client.connection_state === "connected",
    ).length;
  };
  const secondOpening = app.waitForEvent("window");
  await page.evaluate(() => window.rex.windowControl("new"));
  const second = await secondOpening;
  await second.waitForFunction(() => Boolean(window.rex));
  await expect.poll(clientCount).toBe(2);
  const endpoint = (await service.control(DEFAULT_SETTINGS.hosts[0])).endpoint;
  const revokedHost = {
    id: "boundary-revoked",
    label: "Revoked test host",
    endpoint,
  };
  await page.evaluate(async (host) => {
    const settings = await window.rex.getSettings();
    await window.rex.setSettings({
      ...settings,
      hosts: [...settings.hosts, host],
    });
  }, revokedHost);
  await expect.poll(clientCount).toBe(4);
  await page.evaluate(async () => {
    const settings = await window.rex.getSettings();
    await window.rex.setSettings({
      ...settings,
      hosts: settings.hosts.filter((host) => host.id !== "boundary-revoked"),
    });
  });
  await expect.poll(clientCount).toBe(2);
  const closeFailures: string[] = [];
  let closeCompleted = false;
  const stderr = app.process().stderr;
  assert.ok(stderr);
  const observeClose = (bytes: Buffer) => {
    const message = bytes.toString();
    if (message.includes("BOUNDARY_MAIN_EXCEPTION"))
      closeFailures.push(message);
    if (message.includes("BOUNDARY_WINDOW_CLOSED")) closeCompleted = true;
  };
  stderr.on("data", observeClose);
  await app.evaluate(({ BrowserWindow }, ownerId) => {
    process.on("uncaughtExceptionMonitor", (error) =>
      console.error("BOUNDARY_MAIN_EXCEPTION", error.stack || error.message),
    );
    const closing = BrowserWindow.getAllWindows().find(
      (window) => window.id !== ownerId,
    );
    if (!closing) throw new Error("The second test window is missing");
    closing.once("closed", () => console.error("BOUNDARY_WINDOW_CLOSED"));
  }, windowId);
  await second.close();
  await expect
    .poll(() => closeCompleted || closeFailures.length > 0)
    .toBeTruthy();
  stderr.removeListener("data", observeClose);
  // Electron's native exception dialog blocks graceful shutdown after a fatal cleanup error.
  if (closeFailures.length) app.process().kill("SIGKILL");
  assert.deepEqual(
    closeFailures,
    [],
    "Closing a registered window must dispose its context without an uncaught main-process exception",
  );
  await expect.poll(clientCount).toBe(1);

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
