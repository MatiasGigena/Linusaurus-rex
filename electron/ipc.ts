import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { readFile } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS } from "./channels.js";
import { captureRequest } from "../src/shared/requestResult.js";
import { trustedRenderer } from "./renderer-boundary.js";
import {
  parseLayoutAction,
  parsePathPicker,
  updateRendererContext,
} from "./bridge-contracts.js";
import { RexService } from "./rex/service.js";
import type {
  ClientEvent,
  Host,
  RexKeyEvent,
  RendererContext,
  Selection,
  Settings,
  TerminalFrame,
} from "../src/shared/types.js";
import { SettingsStore } from "./settings.js";
import { record, string, identifier, integer } from "./validation.js";
import { ClientFeatures } from "./client/client.js";
import { hostCredentials } from "./features/host-credentials.js";
import {
  IntegrationManager,
  type IntegrationChange,
} from "./features/integrations.js";
import { layoutAction, validateBounds } from "./features/layout.js";
import { parseTheme } from "./features/themes.js";
import { isLocalEndpoint } from "./features/config.js";
import { ConfigurationEditor } from "./features/configuration-editor.js";
import { UpdateCoordinator } from "./updates/update-coordinator.js";
import { DesktopNotifications } from "./client/desktop-notifications.js";
import { LinuxServerManager } from "./server-management/lifecycle.js";
import { validateOrigins } from "./server-management/server-origins.js";
import { resolveCurrentAppImage } from "./updates/update-target.js";
import { LinuxUpdateManager } from "./updates/updates.js";
import { ExternalLinks } from "./features/external-links.js";
import { terminalThemeRequest } from "./features/terminal-theme.js";

type SenderEvent = IpcMainInvokeEvent | IpcMainEvent;
type Options = {
  createWindow?: (selection?: Selection) => Promise<void>;
  initialSelection?: Selection;
  onSettings?: (settings: Settings) => void;
};
const contexts = new Map<number, WindowContext>();
const handleChannels = [
  CHANNELS.request,
  CHANNELS.getSettings,
  CHANNELS.setSettings,
  CHANNELS.readClipboard,
  CHANNELS.writeClipboard,
];
let registered = false;
let updateManager: UpdateCoordinator | undefined;
function updates(store: SettingsStore) {
  if (updateManager) return updateManager;
  let appImage: string | undefined;
  if (app.isPackaged && process.env.APPIMAGE && process.env.APPDIR) {
    try {
      const image = realpathSync(process.env.APPIMAGE);
      if (statSync(image).isFile())
        appImage = resolveCurrentAppImage({
          appImage: image,
          appDir: realpathSync(process.env.APPDIR),
          execPath: realpathSync(process.execPath),
          appPath: realpathSync(app.getAppPath()),
        });
    } catch {
      /* An inherited or stale AppImage environment does not identify this package. */
    }
  }
  const manager = new LinuxUpdateManager({
    directory: join(app.getPath("userData"), "updates"),
    version: app.getVersion(),
    appImage,
    development: !app.isPackaged,
    changed: (state) => {
      for (const context of contexts.values())
        context.emit({ type: "update", state });
    },
    idle: () => [...contexts.values()].every((context) => context.isIdle()),
    install: async (path, kind) => {
      if (kind === "appimage") {
        app.relaunch({ execPath: path, args: process.argv.slice(1) });
        setTimeout(() => app.quit(), 100);
      } else {
        const error = await shell.openPath(path);
        if (error) throw new Error(error);
      }
    },
  });
  updateManager = new UpdateCoordinator(manager, store);
  return updateManager;
}

function resolve(event: SenderEvent): WindowContext {
  return trustedRenderer(event, contexts);
}
function fraction(value: unknown, name: string, min = 0, max = 1) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= min ||
    value >= max
  )
    throw new Error(`Invalid ${name}`);
  return value;
}
function ensureRegistered() {
  if (registered) return;
  registered = true;
  ipcMain.handle(CHANNELS.request, (event, method: unknown, args: unknown) =>
    captureRequest(() =>
      resolve(event).request(identifier(method, "operation"), record(args)),
    ),
  );
  ipcMain.handle(CHANNELS.getSettings, (event) => resolve(event).getSettings());
  ipcMain.handle(CHANNELS.setSettings, (event, value: unknown) =>
    resolve(event).saveSettings(value),
  );
  ipcMain.handle(CHANNELS.readClipboard, async (event) => {
    resolve(event);
    return string(
      await clipboard.readText(),
      "clipboard text",
      1024 * 1024,
      true,
    );
  });
  ipcMain.handle(CHANNELS.writeClipboard, async (event, value: unknown) => {
    resolve(event);
    await clipboard.writeText(
      string(value, "clipboard text", 1024 * 1024, true),
    );
  });
  ipcMain.on(CHANNELS.windowControl, windowControl);
  ipcMain.on(CHANNELS.replyAction, replyAction);
}
function windowControl(event: IpcMainEvent, action: unknown) {
  try {
    resolve(event).windowControl(action);
  } catch {
    /* A destroyed or navigated renderer cannot control windows. */
  }
}
function replyAction(
  event: IpcMainEvent,
  requestId: unknown,
  result?: unknown,
  error?: unknown,
) {
  try {
    resolve(event).features.reply(
      identifier(requestId, "request ID"),
      result,
      error === undefined ? undefined : string(error, "action error", 8192),
    );
  } catch {
    /* Replies are accepted only from the owning renderer. */
  }
}

class WindowContext {
  readonly rex: RexService;
  readonly features: ClientFeatures;
  readonly integrations = new IntegrationManager();
  readonly lifecycle: LinuxServerManager;
  private lastInput = Date.now();
  private subscriptions = new Map<string, { host: Host; stop: () => void }>();
  private context: RendererContext = {};
  private disposed = false;
  private notices: DesktopNotifications;
  private links: ExternalLinks;
  private stopSettings?: () => void;
  private readonly contents: WebContents;
  constructor(
    readonly window: BrowserWindow,
    readonly store: SettingsStore,
    readonly allowedUrl: string,
    private options: Options,
  ) {
    this.contents = window.webContents;
    this.rex = new RexService({
      credentials: hostCredentials.get,
      onControl: (host, control) => this.features.bindControl(host, control),
      onMetadata: (host, sessionId, blockId, value) =>
        this.features.metadata(host.id, sessionId, blockId, value),
    });
    this.lifecycle = new LinuxServerManager({
      directory: join(app.getPath("userData"), "managed-rex"),
      call: (host, method, payload) =>
        this.rex.callMethod(host, method, payload),
    });
    this.notices = new DesktopNotifications(
      window,
      () => store.get(),
      {
        select: (value) => this.emit({ type: "select", ...value }),
        openServerSettings: (host) =>
          this.features.invoke(host, "client.settings", { tab: "server" }),
      },
      {
        supported: () => Notification.isSupported(),
        create: (options) =>
          new Notification({
            ...options,
            icon: join(app.getAppPath(), "resources/icon.png"),
          }),
      },
    );
    this.links = new ExternalLinks(
      () => store.get(),
      (value) => this.saveSettings(value),
      {
        confirm: (options) => dialog.showMessageBox(window, options),
        open: (url) => shell.openExternal(url),
      },
    );
    this.features = new ClientFeatures(this.rex, {
      settings: () => store.get(),
      emit: (event) => this.emit(event),
      notify: (event) => this.notices.show(event),
      badge: (count) => {
        if (!this.window.isDestroyed()) {
          this.window.setTitle(
            count ? `Linusaurus Rex (${count})` : "Linusaurus Rex",
          );
          app.setBadgeCount(count);
        }
      },
      native: (name, args, context) => this.native(name, args, context),
    });
    let previousSettings = store.get();
    this.stopSettings = store.onChange((settings) => {
      for (const oldHost of previousSettings.hosts) {
        const current = settings.hosts.find((host) => host.id === oldHost.id);
        if (!current || current.endpoint !== oldHost.endpoint) {
          this.features.forgetHost(oldHost);
          this.rex.disconnect(oldHost);
          this.notices.clearHost(oldHost.id);
        }
      }
      this.emit({ type: "settings", settings });
      this.visibility();
      for (const [id, subscription] of this.subscriptions) {
        const host = settings.hosts.find(
          (host) => host.id === subscription.host.id,
        );
        if (!host || host.endpoint !== subscription.host.endpoint) {
          subscription.stop();
          this.subscriptions.delete(id);
        }
      }
      if (
        previousSettings.clientLabel !== settings.clientLabel ||
        JSON.stringify(previousSettings.shortcuts) !==
          JSON.stringify(settings.shortcuts)
      )
        void this.features.preferencesChanged().catch(() => {});
      previousSettings = settings;
    });
    this.contents.on("before-input-event", this.interaction);
    this.contents.on("input-event", this.interaction);
    this.contents.on("did-start-loading", this.clearSubscriptions);
    window.on("focus", this.visibility);
    window.on("blur", this.visibility);
    window.on("hide", this.visibility);
    window.on("show", this.visibility);
  }
  emit(event: ClientEvent) {
    if (
      !this.disposed &&
      !this.window.isDestroyed() &&
      !this.window.webContents.isDestroyed()
    )
      this.window.webContents.send(CHANNELS.clientEvent, event);
  }
  getSettings() {
    const settings = this.store.get();
    const current = this.context;
    if (current.selection === null) {
      delete settings.lastSelection;
      return settings;
    }
    const selected = current.selection ?? this.options.initialSelection;
    return selected ? { ...settings, lastSelection: selected } : settings;
  }
  async saveSettings(value: unknown) {
    const previous = this.store.get();
    const settings = await this.store.set(value);
    for (const oldHost of previous.hosts) {
      const nextHost = settings.hosts.find((host) => host.id === oldHost.id);
      if (!nextHost || nextHost.endpoint !== oldHost.endpoint) {
        await hostCredentials.remove(oldHost);
      }
    }
    for (const [id, subscription] of this.subscriptions) {
      const host = settings.hosts.find(
        (host) => host.id === subscription.host.id,
      );
      if (!host || host.endpoint !== subscription.host.endpoint) {
        subscription.stop();
        this.subscriptions.delete(id);
      }
    }
    this.options.onSettings?.(settings);
    this.visibility();
    return settings;
  }
  isIdle() {
    return (
      this.context.uiBusy !== true &&
      Date.now() - this.lastInput > 15_000 &&
      this.features.activity.isIdle()
    );
  }
  async request(
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (["input", "key", "paste", "mouse", "wheel"].includes(method))
      this.lastInput = Date.now();
    if (method === "updateStatus") return updates(this.store).status();
    if (method === "checkUpdates") return updates(this.store).check();
    if (method === "downloadUpdate") return updates(this.store).download();
    if (method === "applyUpdate") {
      if (args.whenIdle !== undefined && typeof args.whenIdle !== "boolean")
        throw new Error("Invalid idle-install preference");
      return updates(this.store).apply(args.whenIdle === true);
    }
    if (method === "cancelUpdate") return updates(this.store).cancel();
    if (method === "unsubscribe") {
      const id = identifier(args.subscriptionId, "subscription ID");
      this.subscriptions.get(id)?.stop();
      this.subscriptions.delete(id);
      return;
    }
    if (method === "setContext") {
      this.context = updateRendererContext(this.context, args);
      this.visibility();
      return;
    }
    if (method === "resizeWindow") {
      const delta = integer(
        args.deltaWidth,
        "window width adjustment",
        -500,
        500,
      );
      if (this.window.isMaximized() || this.window.isFullScreen()) return;
      const bounds = this.window.getBounds(),
        area = screen.getDisplayMatching(bounds).workArea;
      const width = Math.min(
        Math.max(760, bounds.width + delta),
        Math.max(760, area.width),
      );
      const x = Math.max(
        area.x,
        Math.min(bounds.x, area.x + area.width - width),
      );
      this.window.setBounds({ ...bounds, x, width });
      return;
    }
    if (method === "integrationsStatus") {
      const result = (await this.integrations.status()) as Record<
        string,
        unknown
      >;
      return {
        output: JSON.stringify(result, null, 2),
        agents: result.harnesses ?? [],
      };
    }
    if (method === "integrationsPreview")
      return this.integrations.preview(args as unknown as IntegrationChange);
    if (method === "integrationsApply")
      return this.integrations.apply(
        identifier(args.previewId, "integration preview"),
      );
    if (method === "openExternal")
      return this.links.open(string(args.url, "URL", 8192));
    if (method === "pickPath") return this.pickPath(parsePathPicker(args));
    if (method === "importTheme") {
      const result = await dialog.showOpenDialog(this.window, {
        title: "Import terminal theme",
        properties: ["openFile"],
        filters: [
          {
            name: "Terminal colors",
            extensions: ["itermcolors", "theme", "conf", "txt"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return parseTheme(await readFile(result.filePaths[0], "utf8"));
    }
    if (method === "diagnostics")
      return this.diagnostics(
        typeof args.hostId === "string" ? this.host(args.hostId) : undefined,
      );
    const host = this.host(args.hostId);
    if (method === "setCredentials") {
      await hostCredentials.set(host, args);
      this.rex.reconnect(host);
      return;
    }
    if (method === "credentialStatus") return hostCredentials.status(host);
    if (method === "removeCredentials") {
      await hostCredentials.remove(host);
      this.rex.reconnect(host);
      return;
    }
    if (method === "serverManagement") return this.lifecycle.status(host);
    if (method === "previewServerOrigins")
      return this.lifecycle.previewOrigins(host, validateOrigins(args.origins));
    if (method === "applyServerOrigins")
      return this.lifecycle.applyOrigins(
        host,
        identifier(args.previewId, "origins preview"),
      );
    if (method === "serverLifecycle") {
      if (!["start", "stop", "restart"].includes(String(args.operation)))
        throw new Error("Invalid server lifecycle operation");
      return this.lifecycle.perform(
        host,
        args.operation as "start" | "stop" | "restart",
      );
    }
    if (method === "createTutorial") return this.rex.createTutorial(host);
    if (method === "status") return this.rex.status(host);
    if (method === "listSessions") return this.rex.sessions(host);
    if (method === "keymap") return this.features.keymap(host);
    if (method === "keyMode") {
      if (!["enter", "exit", "exitAll"].includes(String(args.operation)))
        throw new Error("Invalid key mode operation");
      this.features.keyMode(
        host.id,
        args.operation as "enter" | "exit" | "exitAll",
        args.name === undefined
          ? undefined
          : identifier(args.name, "mode name"),
      );
      return;
    }
    if (method === "configureClient")
      return this.features.configure(
        host,
        Array.isArray(args.actions) ? args.actions : undefined,
        Array.isArray(args.defaults) ? args.defaults : undefined,
      );
    if (method === "invokeAction")
      return this.features.invoke(
        host,
        identifier(args.action, "action"),
        args.args === undefined ? {} : record(args.args),
        typeof args.sessionId === "string" ? args.sessionId : undefined,
        typeof args.blockId === "string" ? args.blockId : undefined,
      );
    if (method === "creators")
      return this.rex.callMethod(host, "block_creator.list", {});
    if (method === "configInfo") return this.configInfo(host);
    if (method === "writeConfig")
      return new ConfigurationEditor(this.rex).write(
        host,
        string(args.content, "configuration", 1024 * 1024),
      );
    if (method === "reloadConfig")
      return this.rex.callMethod(host, "server.config_reload", {});
    if (method === "serverAction") {
      const action = identifier(args.action, "server action");
      if (
        ![
          "status",
          "tailscale.enable",
          "tailscale.disable",
          "tailscale.login",
          "tailscale.logout",
          "tailscale.rename",
        ].includes(action)
      )
        throw new Error("Unsupported server action.");
      return this.rex.callMethod(
        host,
        `server.${action}`,
        args.args === undefined ? {} : record(args.args),
      );
    }
    if (method === "createSession")
      return {
        sessionId: await this.rex.createSession(
          host,
          identifier(args.label, "session name"),
          args.cwd === undefined
            ? undefined
            : string(args.cwd, "working directory"),
          await this.startupCommand(host),
        ),
      };
    const sessionId = identifier(args.sessionId, "session ID");
    if (method === "inspectSession")
      return this.features.enrich(
        host,
        await this.rex.inspect(host, sessionId),
      );
    if (method === "renameSession")
      return this.rex.renameSession(
        host,
        sessionId,
        identifier(args.label, "session name"),
      );
    if (method === "destroySession")
      return this.rex.callMethod(host, "session.destroy", {
        session_id: sessionId,
      });
    if (method === "newWindow")
      return this.rex.createWindow(
        host,
        sessionId,
        args.label === undefined
          ? undefined
          : identifier(args.label, "tab name"),
        args.cwd === undefined
          ? undefined
          : string(args.cwd, "working directory"),
        await this.startupCommand(host),
      );
    if (method === "renameWindow")
      return this.rex.renameWindow(
        host,
        sessionId,
        identifier(args.windowId, "tab ID"),
        identifier(args.label, "tab name"),
      );
    if (method === "focusWindow")
      return this.rex.focusWindow(
        host,
        sessionId,
        identifier(args.windowId, "tab ID"),
      );
    if (method === "closeWindow")
      return this.rex.closeWindow(
        host,
        sessionId,
        identifier(args.windowId, "tab ID"),
      );
    if (method === "reorderWindow")
      return this.rex.callMethod(host, "session.move_window", {
        session_id: sessionId,
        window_id: identifier(args.windowId, "tab ID"),
        ...(args.beforeWindowId
          ? {
              before_window_id: identifier(
                args.beforeWindowId,
                "target tab ID",
              ),
            }
          : {}),
      });
    if (method === "resizeDivider") {
      if (args.direction !== "horizontal" && args.direction !== "vertical")
        throw new Error("Invalid divider direction");
      return this.rex.callMethod(host, "session.resize_pane", {
        session_id: sessionId,
        before_block_id: identifier(args.beforeBlockId, "before pane ID"),
        after_block_id: identifier(args.afterBlockId, "after pane ID"),
        direction: args.direction,
        ratio: fraction(args.ratio, "divider ratio"),
      });
    }
    if (method === "resizeLayer")
      return this.rex.callMethod(host, "session.resize_layer", {
        session_id: sessionId,
        layer_id: identifier(args.layerId, "floating pane ID"),
        bounds: validateBounds(args.bounds),
      });
    if (method === "createBlock")
      return this.rex.createBlock(host, sessionId, {
        flavor: identifier(args.flavor, "block type"),
        options: args.options === undefined ? undefined : record(args.options),
        windowId:
          args.windowId === undefined
            ? undefined
            : identifier(args.windowId, "destination tab ID"),
      });
    const blockId = identifier(args.blockId, "pane ID");
    if (method === "releaseViewport")
      return this.rex.releaseViewport(host, sessionId, blockId);
    if (method === "listDirectory") {
      const path = string(args.path, "directory path", 8192);
      const prefix =
        args.prefix === undefined
          ? undefined
          : string(args.prefix, "directory prefix", 512);
      if (args.files !== undefined && typeof args.files !== "boolean")
        throw new Error("Invalid directory listing mode");
      return this.rex.callMethod(host, "com.superlogical.terminal.list_dir", {
        session_id: sessionId,
        block_id: blockId,
        args: {
          path,
          files: args.files === true,
          limit:
            args.limit === undefined
              ? 2000
              : integer(args.limit, "directory limit", 1, 2000),
          ...(prefix ? { prefix } : {}),
        },
      });
    }
    if (method === "blockInfo")
      return this.rex.callMethod(host, "session.describe_block", {
        session_id: sessionId,
        block_id: blockId,
      });
    if (method === "callBlock") {
      const result = await this.rex.callMethod(host, "block.method", {
        session_id: sessionId,
        block_id: blockId,
        method: identifier(args.method, "block method"),
        args: args.args === undefined ? {} : record(args.args),
      });
      if (Buffer.byteLength(JSON.stringify(result ?? null)) > 16 * 1024 * 1024)
        throw new Error(
          "The block response exceeds the 16 MiB inspector limit.",
        );
      return result ?? null;
    }
    if (method === "terminalTheme")
      return this.rex.callMethod(host, "com.superlogical.terminal.set_theme", {
        session_id: sessionId,
        block_id: blockId,
        args: terminalThemeRequest(args),
      });
    if (method === "closePane")
      return this.rex.closeBlock(host, sessionId, blockId);
    if (method === "focus")
      return this.rex.focusBlock(host, sessionId, blockId);
    if (method === "zoom") return this.rex.zoom(host, sessionId, blockId);
    if (method === "renamePane")
      return this.rex.callMethod(host, "session.set_block_label", {
        session_id: sessionId,
        block_id: blockId,
        label: identifier(args.label, "pane name"),
      });
    if (method === "split") {
      const direction = identifier(args.direction, "split direction");
      if (!["left", "right", "above", "below"].includes(direction))
        throw new Error("Invalid split direction");
      return this.rex.split(
        host,
        sessionId,
        blockId,
        direction as "right" | "below" | "left" | "above",
        {
          ratio:
            args.ratio === undefined
              ? undefined
              : fraction(args.ratio, "split ratio"),
          command: await this.startupCommand(host),
        },
      );
    }
    if (method === "movePane") {
      const direction = identifier(args.direction, "move direction");
      if (!["left", "right", "above", "below"].includes(direction))
        throw new Error("Invalid move direction");
      return this.rex.callMethod(host, "session.move_block", {
        session_id: sessionId,
        block_id: blockId,
        anchor_block_id: identifier(args.anchorBlockId, "target pane ID"),
        direction: ["left", "right"].includes(direction)
          ? "horizontal"
          : "vertical",
        side: ["left", "above"].includes(direction) ? "before" : "after",
      });
    }
    if (method === "swapPanes")
      return this.rex.callMethod(host, "session.swap_blocks", {
        session_id: sessionId,
        block_id: blockId,
        other_block_id: identifier(args.otherBlockId, "other pane ID"),
      });
    if (method === "layoutAction")
      return layoutAction(
        (host, method, payload) => this.rex.callMethod(host, method, payload),
        host,
        {
          sessionId,
          blockId,
          ...parseLayoutAction(args),
        },
      );
    if (method === "input")
      return this.rex.input(
        host,
        sessionId,
        blockId,
        string(args.data, "terminal input", 1024 * 1024, true),
      );
    if (method === "resize")
      return this.rex.resize(
        host,
        sessionId,
        blockId,
        integer(args.cols, "columns", 2, 1000),
        integer(args.rows, "rows", 1, 500),
      );
    if (method === "key")
      return this.features.input(
        host,
        "key",
        sessionId,
        blockId,
        validateKey(args.event),
        Array.isArray(args.prefix)
          ? args.prefix.map((key) => string(key, "key prefix", 128))
          : undefined,
      );
    if (method === "paste")
      return this.features.input(host, "paste", sessionId, blockId, {
        text: string(args.text, "paste", 1024 * 1024, true),
      });
    if (method === "focusEvent") {
      if (typeof args.focused !== "boolean")
        throw new Error("Invalid focus event");
      return this.features.input(host, "focus", sessionId, blockId, {
        action: args.focused ? "in" : "out",
      });
    }
    if (method === "mouse" || method === "wheel")
      return this.features.input(
        host,
        method,
        sessionId,
        blockId,
        validatePointer(method, args.event),
      );
    if (method === "subscribe") {
      const subscriptionId = identifier(args.subscriptionId, "subscription ID");
      if (
        !this.subscriptions.has(subscriptionId) &&
        this.subscriptions.size >= 64
      )
        throw new Error("Too many terminal subscriptions");
      this.subscriptions.get(subscriptionId)?.stop();
      const send = (frame: Omit<TerminalFrame, "subscriptionId">) => {
        if (!this.disposed && !this.window.isDestroyed())
          this.window.webContents.send(CHANNELS.terminal, {
            subscriptionId,
            ...frame,
          });
      };
      this.subscriptions.set(subscriptionId, {
        host,
        stop: this.rex.subscribe(
          host,
          sessionId,
          blockId,
          (data, kind, size) => send({ data, kind, ...size }),
          (error) => send({ error }),
        ),
      });
      return;
    }
    throw new Error("Unsupported Rex operation");
  }
  windowControl(action: unknown) {
    if (this.window.isDestroyed()) return;
    if (action === "minimize") this.window.minimize();
    else if (action === "maximize")
      this.window.isMaximized()
        ? this.window.unmaximize()
        : this.window.maximize();
    else if (action === "close") this.window.close();
    else if (action === "fullscreen")
      this.window.setFullScreen(!this.window.isFullScreen());
    else if (action === "new") void this.options.createWindow?.();
    else if (action === "hide") this.window.hide();
    else if (action === "show") {
      this.window.show();
      this.window.focus();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSettings?.();
    this.clearSubscriptions();
    this.features.dispose();
    this.rex.dispose();
    this.integrations.dispose();
    this.notices.dispose();
    if (!this.contents.isDestroyed()) {
      this.contents.removeListener("before-input-event", this.interaction);
      this.contents.removeListener("input-event", this.interaction);
      this.contents.removeListener(
        "did-start-loading",
        this.clearSubscriptions,
      );
    }
    this.window.removeListener("focus", this.visibility);
    this.window.removeListener("blur", this.visibility);
    this.window.removeListener("hide", this.visibility);
    this.window.removeListener("show", this.visibility);
  }
  private interaction = () => {
    this.lastInput = Date.now();
  };
  private host(value: unknown): Host {
    const id = identifier(value, "host ID");
    const host = this.store.get().hosts.find((host) => host.id === id);
    if (!host) throw new Error("Host no longer exists. Select a saved host.");
    return host;
  }
  private clearSubscriptions = () => {
    for (const subscription of this.subscriptions.values()) subscription.stop();
    this.subscriptions.clear();
  };
  private visibility = () => {
    if (this.disposed || this.window.isDestroyed()) return;
    this.features.setContext({
      ...this.context.selection,
      visible:
        this.context.visible !== false &&
        this.window.isVisible() &&
        this.window.isFocused(),
    });
  };
  private async native(
    name: string,
    args: Record<string, unknown>,
    context: { host: Host; sessionId?: string; blockId?: string },
  ): Promise<{ handled: boolean; result?: unknown }> {
    if (
      name === "client.update.accept" ||
      name === "client.update.accept_when_idle"
    )
      return {
        handled: true,
        result: await updates(this.store).apply(name.endsWith("when_idle")),
      };
    if (name === "client.server.restart")
      return {
        handled: true,
        result: await this.lifecycle.perform(context.host, "restart"),
      };
    if (name === "client.window.new") {
      let initial: Selection | undefined;
      if (context.sessionId) {
        const view = await this.rex.inspect(context.host, context.sessionId);
        const requested =
          typeof args.window_id === "string"
            ? args.window_id
            : typeof this.context.selection?.windowId === "string"
              ? this.context.selection.windowId
              : undefined;
        const window =
          view.windows.find((window) => window.id === requested) ||
          view.windows.find((window) => window.id === view.activeWindowId) ||
          view.windows[0];
        if (window)
          initial = {
            hostId: context.host.id,
            sessionId: view.id,
            windowId: window.id,
          };
      }
      await this.options.createWindow?.(initial);
      return { handled: true };
    }
    if (name === "client.window.close") {
      setTimeout(() => this.window.close(), 50);
      return { handled: true };
    }
    if (name === "client.window.fullscreen.toggle") {
      this.windowControl("fullscreen");
      return { handled: true };
    }
    if (name === "client.visibility.toggle") {
      this.window.isVisible() && this.window.isFocused()
        ? this.window.hide()
        : this.windowControl("show");
      return { handled: true };
    }
    if (name === "client.version.copy") {
      const status = await this.rex.status(context.host);
      await clipboard.writeText(
        `Linusaurus Rex ${app.getVersion()}\nRex server ${status.version || "unavailable"}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
      );
      return { handled: true };
    }
    if (name === "client.debug.copy") {
      await clipboard.writeText(
        JSON.stringify(await this.diagnostics(context.host), null, 2),
      );
      return { handled: true };
    }
    if (name === "client.config.copy_path") {
      await clipboard.writeText((await this.configInfo(context.host)).path);
      return { handled: true };
    }
    if (name === "client.config.reload")
      return {
        handled: true,
        result: await this.rex.callMethod(
          context.host,
          "server.config_reload",
          {},
        ),
      };
    return { handled: false };
  }
  private configInfo(host: Host) {
    return new ConfigurationEditor(this.rex).info(host);
  }
  private async startupCommand(host: Host) {
    if (host.startupCommand !== undefined)
      return host.startupCommand || undefined;
    return isLocalEndpoint((await this.rex.control(host)).endpoint)
      ? this.store.get().startupCommand || undefined
      : undefined;
  }
  private async diagnostics(host?: Host) {
    const status = host ? await this.rex.status(host) : undefined;
    return {
      app: {
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
      server: status,
      hosts: this.store.get().hosts.map((host) => ({
        id: host.id,
        label: host.label,
        endpoint: host.endpoint
          .replace(/\/\/[^/@]+@/, "//[redacted]@")
          .split("?")[0],
      })),
      notificationsAvailable: Notification.isSupported(),
    };
  }
  private async pickPath(
    args: import("../src/shared/types.js").PathPickerArgs,
  ) {
    if (args.save === true) {
      const result = await dialog.showSaveDialog(this.window, {
        title: "Export terminal content",
        defaultPath:
          args.defaultPath === undefined
            ? undefined
            : string(args.defaultPath, "default path"),
      });
      if (result.canceled || !result.filePath) return null;
      if (args.content !== undefined) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          result.filePath,
          string(args.content, "export content", 32 * 1024 * 1024, true),
          "utf8",
        );
      }
      return result.filePath;
    }
    const result = await dialog.showOpenDialog(this.window, {
      title: args.directory ? "Choose directory" : "Choose file",
      defaultPath:
        args.defaultPath === undefined
          ? undefined
          : string(args.defaultPath, "default path"),
      properties: [args.directory ? "openDirectory" : "openFile"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
}

export function validateKey(value: unknown): Record<string, unknown> {
  const event = record(value);
  const key = identifier(event.key, "physical key");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
    throw new Error("Invalid physical key");
  if (!["press", "release", "repeat"].includes(String(event.action)))
    throw new Error("Invalid key action");
  if (typeof event.composing !== "boolean")
    throw new Error("Invalid composing state");
  const mods = string(event.mods, "modifiers", 160),
    consumed = string(event.consumed_mods, "consumed modifiers", 160);
  if (
    !/^(?:[a-z_]+(?:\+[a-z_]+)*)?$/.test(mods) ||
    !/^(?:[a-z_]+(?:\+[a-z_]+)*)?$/.test(consumed)
  )
    throw new Error("Invalid keyboard modifiers");
  return {
    key,
    mods,
    consumed_mods: consumed,
    text: string(event.text, "key text", 65536, true),
    unshifted_codepoint: integer(
      event.unshifted_codepoint,
      "unshifted codepoint",
      0,
      0x10ffff,
    ),
    composing: event.composing,
    action: event.action as RexKeyEvent["action"],
  } satisfies RexKeyEvent;
}
export function validatePointer(
  kind: "mouse" | "wheel",
  value: unknown,
): Record<string, unknown> {
  const event = record(value);
  const result: Record<string, unknown> = {
    x: integer(event.x, "pointer column", 0, 65535),
    y: integer(event.y, "pointer row", 0, 65535),
  };
  if (kind === "mouse") {
    if (!["press", "motion", "release"].includes(String(event.action)))
      throw new Error("Invalid pointer action");
    result.action = event.action;
    if (event.button !== undefined) {
      if (!["left", "middle", "right"].includes(String(event.button)))
        throw new Error("Invalid pointer button");
      result.button = event.button;
    }
    result.mods = string(event.mods, "pointer modifiers", 80);
  } else {
    for (const axis of ["delta_x", "delta_y"]) {
      const value = event[axis];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1000
      )
        throw new Error("Invalid wheel delta");
      result[axis] = value;
    }
  }
  return result;
}

/** One IPC router dispatches to the owning window; multiple windows never overwrite handlers. */
export function registerIpc(
  window: BrowserWindow,
  store: SettingsStore,
  allowedUrl: string,
  options: Options = {},
): () => void {
  ensureRegistered();
  const context = new WindowContext(window, store, allowedUrl, options);
  const id = window.webContents.id;
  contexts.set(id, context);
  return () => {
    contexts.delete(id);
    context.dispose();
    if (!contexts.size) {
      updateManager?.dispose();
      updateManager = undefined;
      for (const channel of handleChannels) ipcMain.removeHandler(channel);
      ipcMain.removeListener(CHANNELS.windowControl, windowControl);
      ipcMain.removeListener(CHANNELS.replyAction, replyAction);
      registered = false;
    }
  };
}
