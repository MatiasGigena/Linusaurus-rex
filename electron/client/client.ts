import { randomUUID } from "node:crypto";
import type {
  ActionDefinition,
  ClientEvent,
  Host,
  KeymapResult,
  RexKeyEvent,
  Selection,
  SessionView,
  Settings,
} from "../../src/shared/types.js";
import type { RexService } from "../rex/service.js";
import type { RexControl, RexEvent } from "../rex/control.js";
import {
  CLIENT_ACTIONS,
  configuredShortcutEntries,
  serverShortcut,
} from "../../src/shared/actions.js";
import { ActivityRegistry } from "./activity.js";
import { KeymapRouter } from "./keymap.js";
import { normalizeKeymap } from "./keymap-data.js";
import { TailscaleNotices } from "./tailscale.js";

export interface FeatureHooks {
  settings(): Settings;
  emit(event: ClientEvent): void;
  notify(event: Extract<ClientEvent, { type: "notification" }>): void;
  badge?(count: number): void;
  /** Cross-host forwarding requires an explicit source-to-target authorization. */
  allowServerCall?(source: Host, target: Host, method: string): boolean;
  native?(
    name: string,
    args: Record<string, unknown>,
    context: { host: Host; sessionId?: string; blockId?: string },
  ): Promise<{ handled: boolean; result?: unknown }>;
}
const MAX_QUEUED_KEYS = 1024;
const CLIENT_ACTION_TIMEOUT_MS = 25_000;

type PendingAction = {
  hostId: string;
  endpoint: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type ClientConfiguration = { actions: ActionDefinition[]; defaults: unknown[] };
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export class ClientFeatures {
  readonly activity: ActivityRegistry;
  private tailscale: TailscaleNotices;
  private pending = new Map<string, PendingAction>();
  private configured = new Map<string, ClientConfiguration>();
  private controls = new Map<string, RexControl>();
  private boundHosts = new Map<string, Host>();
  private queried = new Set<string>();
  private keymaps = new Map<string, KeymapResult>();
  private routers = new Map<string, KeymapRouter>();
  private inputQueues = new Map<
    string,
    { tail: Promise<unknown>; generation: number; count: number }
  >();
  private disposed = false;
  constructor(
    private rex: RexService,
    private hooks: FeatureHooks,
  ) {
    this.activity = new ActivityRegistry(
      (event) => hooks.emit(event),
      (event) => hooks.notify(event),
      () => hooks.settings().notifications,
      (count) => hooks.badge?.(count),
    );
    this.tailscale = new TailscaleNotices(
      (event) => hooks.emit(event),
      (event) => hooks.notify(event),
      () => hooks.settings().notifications,
    );
  }
  bindControl(source: Host, control: RexControl) {
    const host = { ...source };
    if (!this.acceptsHost(host))
      throw new Error("The host connection is no longer authorized.");
    this.boundHosts.set(host.id, host);
    if (this.controls.has(host.id)) this.resetKeys(host.id);
    this.controls.set(host.id, control);
    for (const key of this.queried)
      if (key.startsWith(`${host.id}/`)) this.queried.delete(key);
    control.onEvent((event) => {
      void this.event(host, control, event).catch((error) => {
        if (this.controls.get(host.id) === control)
          this.status(host, false, error);
      });
    });
    void control
      .readyPublic()
      .then(async () => {
        if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
          return;
        await control.call("client.set_label", {
          label: this.hooks.settings().clientLabel,
        });
        if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
          return;
        await control.call("session.attach_all", { event_scope: "all" });
        if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
          return;
        const config =
          this.configured.get(host.id) ?? this.defaultConfiguration();
        const result = await control.call("client.keymap", config);
        if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
          return;
        const keymap = normalizeKeymap(result, config.actions);
        this.keymaps.set(host.id, keymap);
        this.router(host.id).setMap(keymap);
        this.hooks.emit({ type: "keymap", hostId: host.id, keymap });
        void control
          .call("server.status", {})
          .then((status) => {
            if (
              this.acceptsHost(host) &&
              this.controls.get(host.id) === control
            )
              this.tailscale.apply(host.id, host.label, status, false);
          })
          .catch(() => {});
        this.status(host, true);
      })
      .catch((error) => {
        if (this.controls.get(host.id) === control)
          this.status(host, false, error);
      });
  }
  forgetHost(host: Host) {
    for (const [id, pending] of this.pending) {
      if (pending.hostId !== host.id || pending.endpoint !== host.endpoint)
        continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new Error("The host connection is no longer authorized."));
    }
    if (this.boundHosts.get(host.id)?.endpoint !== host.endpoint) return;
    this.resetKeys(host.id);
    this.controls.delete(host.id);
    this.boundHosts.delete(host.id);
    this.configured.delete(host.id);
    this.keymaps.delete(host.id);
    this.routers.get(host.id)?.dispose();
    this.routers.delete(host.id);
    for (const key of this.queried)
      if (key.startsWith(`${host.id}/`)) this.queried.delete(key);
    this.activity.clearHost(host.id);
  }

  async configure(
    host: Host,
    actions?: ActionDefinition[],
    defaults?: unknown[],
  ): Promise<KeymapResult> {
    const configuration = this.defaultConfiguration();
    if (actions) configuration.actions = actions;
    if (defaults) configuration.defaults = defaults;
    this.configured.set(host.id, configuration);
    const result = await this.rex.callMethod(
      host,
      "client.keymap",
      configuration,
    );
    const keymap = normalizeKeymap(result, configuration.actions);
    this.keymaps.set(host.id, keymap);
    this.router(host.id).setMap(keymap);
    this.hooks.emit({ type: "keymap", hostId: host.id, keymap });
    return keymap;
  }
  async keymap(host: Host): Promise<KeymapResult> {
    return this.configure(
      host,
      this.configured.get(host.id)?.actions,
      this.configured.get(host.id)?.defaults,
    );
  }
  async invoke(
    host: Host,
    action: string,
    args: Record<string, unknown> = {},
    sessionId?: string,
    blockId?: string,
  ): Promise<unknown> {
    if (action === "client.mode.enter") {
      this.router(host.id).mode(
        "enter",
        String(args.name || ""),
        args.once === true,
      );
      return null;
    }
    if (action === "client.mode.exit") {
      this.router(host.id).mode("exit");
      return null;
    }
    if (action === "client.mode.exit_all") {
      this.router(host.id).mode("exitAll");
      return null;
    }
    if (
      action === "pane.send_key" &&
      typeof args.key === "string" &&
      sessionId &&
      blockId
    ) {
      const chunks = args.key.split("+");
      const name = chunks.pop() || "";
      const names: Record<string, string> = {
        left: "arrow_left",
        right: "arrow_right",
        up: "arrow_up",
        down: "arrow_down",
        esc: "escape",
        return: "enter",
        home: "home",
        end: "end",
      };
      const key =
        names[name] ||
        (/^[a-z]$/i.test(name) ? `key_${name.toLowerCase()}` : name);
      const control = await this.rex.control(host);
      await control.attach(sessionId);
      return control.call("block.event", {
        session_id: sessionId,
        block_id: blockId,
        event: {
          type: "key",
          payload: {
            key,
            mods: typeof args.mods === "string" ? args.mods : chunks.join("+"),
            consumed_mods: "",
            text: typeof args.text === "string" ? args.text : "",
            unshifted_codepoint:
              name.length === 1 ? name.toLowerCase().codePointAt(0) : 0,
            composing: false,
            action: "press",
          },
        },
      });
    }
    if (CLIENT_ACTIONS.some((candidate) => candidate.name === action))
      return this.dispatch(host, action, args, sessionId, blockId);
    const control = await this.rex.control(host);
    if (sessionId) await control.attach(sessionId);
    const result = object(
      await control.call("client.action", {
        action,
        ...(Object.keys(args).length ? { args } : {}),
        origin: "palette",
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(blockId ? { block_id: blockId } : {}),
      }),
    );
    for (const queued of Array.isArray(result.client_actions)
      ? result.client_actions
      : []) {
      const action = object(queued);
      if (typeof action.action === "string")
        await this.dispatch(
          host,
          action.action,
          object(action.args),
          sessionId,
          blockId,
        );
    }
    return result.result;
  }
  async input(
    host: Host,
    method: "key" | "paste" | "mouse" | "wheel" | "focus",
    sessionId: string,
    blockId: string,
    value: Record<string, unknown>,
    prefix?: string[],
  ) {
    // Paste/pointer/focus calls can be the result of a client shortcut. They must
    // not wait behind the shortcut awaiting that same renderer action's reply.
    if (method !== "key")
      return this.inputNow(host, method, sessionId, blockId, value, prefix);
    let queue = this.inputQueues.get(host.id);
    if (!queue) {
      queue = { tail: Promise.resolve(), generation: 0, count: 0 };
      this.inputQueues.set(host.id, queue);
    }
    if (queue.count >= MAX_QUEUED_KEYS)
      throw new Error("Too much terminal input is waiting.");
    const generation = queue.generation;
    queue.count++;
    const pending = queue.tail.then(async () => {
      if (queue.generation !== generation || this.disposed)
        throw new Error("Input discarded after the connection failed.");
      try {
        return await this.inputNow(
          host,
          method,
          sessionId,
          blockId,
          value,
          prefix,
        );
      } catch (error) {
        queue.generation++;
        throw error;
      }
    });
    queue.tail = pending.catch(() => {});
    try {
      return await pending;
    } finally {
      queue.count--;
      if (!queue.count && this.inputQueues.get(host.id) === queue)
        this.inputQueues.delete(host.id);
    }
  }
  private async inputNow(
    host: Host,
    method: "key" | "paste" | "mouse" | "wheel" | "focus",
    sessionId: string,
    blockId: string,
    value: Record<string, unknown>,
    prefix?: string[],
  ) {
    const control = await this.rex.control(host);
    await control.attach(sessionId);
    if (method === "key") {
      if (!this.keymaps.has(host.id)) await this.keymap(host);
      const route = prefix
        ? { kind: "forward" as const, prefix }
        : this.router(host.id).route(value as unknown as RexKeyEvent);
      if (route.kind === "consume") return { handled: true };
      if (route.kind === "action") {
        if (route.action === "client.key.forward")
          return control.call("client.key", {
            session_id: sessionId,
            block_id: blockId,
            key: value,
            ...(route.prefix.length ? { prefix: route.prefix } : {}),
          });
        await this.invoke(host, route.action, route.args, sessionId, blockId);
        return { handled: true };
      }
      return control.call("client.key", {
        session_id: sessionId,
        block_id: blockId,
        key: value,
        ...(route.prefix?.length ? { prefix: route.prefix } : {}),
      });
    }
    return control.call("block.event", {
      session_id: sessionId,
      block_id: blockId,
      event: { type: method, payload: value },
    });
  }
  keyMode(
    hostId: string,
    operation: "enter" | "exit" | "exitAll",
    name?: string,
  ) {
    this.router(hostId).mode(operation, name);
  }
  metadata(
    hostId: string,
    sessionId: string,
    blockId: string,
    value: Record<string, unknown>,
  ) {
    // Initial data-channel metadata is a snapshot, never news worth a desktop notification.
    if (value.type === "title")
      this.activity.seed(
        hostId,
        sessionId,
        blockId,
        undefined,
        value,
        undefined,
      );
    else if (value.type === "process")
      this.activity.seed(
        hostId,
        sessionId,
        blockId,
        undefined,
        undefined,
        value,
      );
  }
  async enrich(host: Host, view: SessionView) {
    this.activity.track(host.id, view);
    const control = await this.rex.control(host);
    if ((control.welcome?.api_revision ?? 0) < 8) return view;
    for (const window of view.windows)
      for (const pane of window.panes) {
        if (pane.creator && pane.creator !== "com.superlogical.terminal")
          continue;
        const key = `${host.id}/${pane.id}`;
        if (this.queried.has(key)) continue;
        this.queried.add(key);
        const args = { session_id: view.id, block_id: pane.id, args: {} };
        void Promise.allSettled(
          ["program_status", "title", "process"].map((method) =>
            control.call(`com.superlogical.terminal.${method}`, args),
          ),
        )
          .then((results) => {
            if (
              !this.acceptsHost(host) ||
              this.controls.get(host.id) !== control
            )
              return;
            this.activity.seed(
              host.id,
              view.id,
              pane.id,
              ...(results.map((result) =>
                result.status === "fulfilled" ? result.value : undefined,
              ) as [unknown, unknown, unknown]),
            );
          })
          .catch(() => {});
      }
    return view;
  }
  setContext(
    context: Partial<Selection> & { blockId?: string; visible?: boolean },
  ) {
    this.activity.setContext(context);
  }
  reply(requestId: string, result?: unknown, error?: string) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result ?? null);
  }
  async preferencesChanged() {
    const settings = this.hooks.settings();
    // Remember desired preferences even for disconnected hosts. Rebinding a
    // control must retry them rather than reuse its last accepted keymap.
    for (const host of settings.hosts)
      this.configured.set(host.id, this.defaultConfiguration());
    await Promise.all(
      [...this.controls].map(async ([hostId, control]) => {
        const host = settings.hosts.find((host) => host.id === hostId);
        if (!host || !control.connected) return;
        const failures: string[] = [];
        try {
          await control.call("client.set_label", {
            label: settings.clientLabel,
          });
        } catch (error) {
          failures.push(
            `Client label: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        try {
          await this.configure(host);
        } catch (error) {
          failures.push(
            `Keyboard shortcuts: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!failures.length) return;
        const event: Extract<ClientEvent, { type: "notification" }> = {
          type: "notification",
          id: randomUUID(),
          hostId: host.id,
          kind: "error",
          title: `Preferences could not be applied to ${host.label}`,
          body: `Your preferences were saved, but this host could not apply all changes. ${failures.join("; ")}. They will be retried when the host reconnects.`,
        };
        this.hooks.emit(event);
        this.hooks.notify(event);
      }),
    );
  }

  dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The client window was closed."));
    }
    this.pending.clear();
    this.controls.clear();
    this.boundHosts.clear();
    this.keymaps.clear();
    this.queried.clear();
    for (const router of this.routers.values()) router.dispose();
    this.routers.clear();
    this.inputQueues.clear();
  }
  private async dispatch(
    source: Host,
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
    blockId?: string,
  ): Promise<unknown> {
    const host = { ...source };
    if (this.disposed) throw new Error("The client window was closed.");
    if (!this.acceptsHost(host))
      throw new Error("The host connection is no longer authorized.");
    if (args.host_id !== undefined && args.host_id !== host.id)
      throw new Error("A server-originated action cannot target another host.");
    const control = this.controls.get(host.id);
    const native = await this.hooks.native?.(name, args, {
      host,
      sessionId,
      blockId,
    });
    if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
      throw new Error("The host connection is no longer authorized.");
    if (native?.handled) return native.result ?? null;
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The client action did not receive a response."));
      }, CLIENT_ACTION_TIMEOUT_MS);
      this.pending.set(requestId, {
        hostId: host.id,
        endpoint: host.endpoint,
        resolve,
        reject,
        timer,
      });
      this.hooks.emit({
        type: "action",
        requestId,
        name,
        args,
        hostId: host.id,
        sessionId,
        blockId,
      });
    });
  }
  private async event(host: Host, control: RexControl, wire: RexEvent) {
    if (!this.acceptsHost(host) || this.controls.get(host.id) !== control)
      return;
    if (wire.type === "disconnected") {
      this.resetKeys(host.id);
      this.status(host, false, wire.error);
      return;
    }
    let event = object(wire.payload);
    let sessionId: string | undefined;
    if (event.type === "session_event") {
      const body = object(event.payload);
      sessionId = text(body.session_id);
      event = object(body.event);
    }
    const name = String(event.type || wire.type);
    const payload = object(event.payload);
    if (name === "tailscale_status_changed") {
      this.tailscale.apply(host.id, host.label, payload, true);
      this.hooks.emit({ type: "layout", hostId: host.id });
      return;
    }
    if (name === "block_event" && sessionId) {
      this.activity.apply(host.id, sessionId, payload);
      return;
    }
    if (name === "client_perform_requested") {
      const callId = String(payload.call_id || "");
      if (!callId) return;
      try {
        if (!this.hooks.settings().remoteControl)
          throw new Error("Remote client control is disabled in settings.");
        const result = await this.dispatch(
          host,
          String(payload.action || ""),
          object(payload.args),
          text(payload.session_id),
          text(payload.block_id),
        );
        await control.call("client.reply", {
          call_id: callId,
          result: result ?? null,
        });
      } catch (error) {
        await control
          .call("client.reply", {
            call_id: callId,
            error: {
              code: "refused",
              message: error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => {});
      }
      return;
    }
    if (name === "client_call_requested") {
      const callId = String(payload.call_id || "");
      if (!callId) return;
      try {
        if (!this.hooks.settings().remoteControl)
          throw new Error("Remote client control is disabled in settings.");
        const server = object(payload.server);
        const target = this.hooks
          .settings()
          .hosts.find(
            (candidate) =>
              candidate.id === (payload.server_id || server.id) ||
              candidate.label === (server.name || payload.server),
          );
        if (!target || typeof payload.method !== "string")
          throw new Error(
            "The requested server is not connected in this client.",
          );
        if (
          (target.id !== host.id || target.endpoint !== host.endpoint) &&
          !this.hooks.allowServerCall?.(host, target, payload.method)
        )
          throw new Error(
            "This server is not authorized to call another host.",
          );
        const result = await this.rex.callMethod(
          target,
          payload.method,
          object(payload.args || payload.payload),
        );
        await control.call("client.reply", {
          call_id: callId,
          result: result ?? null,
        });
      } catch (error) {
        await control
          .call("client.reply", {
            call_id: callId,
            error: {
              code: "refused",
              message: error instanceof Error ? error.message : String(error),
            },
          })
          .catch(() => {});
      }
      return;
    }
    if (name === "keymap_changed") {
      void this.configure(host).catch(() => {});
    }
    if (
      name.startsWith("session_") ||
      name.startsWith("window_") ||
      name === "block_closed" ||
      name === "keymap_changed" ||
      name === "hosts_changed"
    )
      this.hooks.emit({ type: "layout", hostId: host.id, sessionId });
  }

  private defaultConfiguration(): ClientConfiguration {
    const settings = this.hooks.settings();
    return {
      actions: CLIENT_ACTIONS,
      defaults: [
        {
          name: "linux",
          bindings: configuredShortcutEntries(settings.shortcuts)
            .filter(([, keys]) => keys)
            .map(([name, shortcut]) => ({
              keys: serverShortcut(shortcut).split(">"),
              action: name,
            })),
        },
      ],
    };
  }
  private acceptsHost(host: Host): boolean {
    return (
      !this.disposed &&
      this.hooks
        .settings()
        .hosts.some(
          (current) =>
            current.id === host.id && current.endpoint === host.endpoint,
        )
    );
  }
  private status(host: Host, connected: boolean, error?: unknown) {
    if (!this.acceptsHost(host)) return;
    this.hooks.emit({
      type: "status",
      hostId: host.id,
      connected,
      message: error
        ? error instanceof Error
          ? error.message
          : String(error)
        : undefined,
    });
  }
  private router(hostId: string) {
    let router = this.routers.get(hostId);
    if (!router) {
      router = new KeymapRouter((state) =>
        this.hooks.emit({ type: "keys", hostId, ...state }),
      );
      this.routers.set(hostId, router);
    }
    return router;
  }
  private resetKeys(hostId: string) {
    this.routers.get(hostId)?.reset();
    const queue = this.inputQueues.get(hostId);
    if (queue) queue.generation++;
  }
}
