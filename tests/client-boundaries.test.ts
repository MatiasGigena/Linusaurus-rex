import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActivityRegistry,
  parseActivity,
} from "../electron/client/activity.js";
import {
  ClientFeatures,
  type FeatureHooks,
} from "../electron/client/client.js";
import { KeymapRouter } from "../electron/client/keymap.js";
import { normalizeKeymap } from "../electron/client/keymap-data.js";
import type { RexControl, RexEvent } from "../electron/rex/control.js";
import type { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS, type ClientEvent } from "../src/shared/types.js";

const key = (name: string) => ({
  key: name,
  mods: "",
  consumed_mods: "",
  text: "",
  unshifted_codepoint: 0,
  composing: false,
  action: "press" as const,
});

test("typed key input preserves ordering, prefix forwarding and immediate reverse paste", async () => {
  const current = preferenceFixture();
  try {
    await current.connect(current.hosts[0]);
    const control = current.controls.get("first");
    assert.ok(control);
    const original = control.call.bind(control);
    const sent: { method: string; payload: object }[] = [];
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    control.call = async (method, payload) => {
      if (method === "client.key") {
        sent.push({ method, payload });
        if (sent.length === 1) {
          started();
          await held;
        }
      } else if (method === "block.event") sent.push({ method, payload });
      return original(method, payload);
    };
    const first = current.features.inputKey(
      current.hosts[0],
      "s",
      "b",
      key("one"),
      ["prefix"],
    );
    await firstStarted;
    const second = current.features.inputKey(
      current.hosts[0],
      "s",
      "b",
      key("two"),
      [],
    );
    await current.features.input(current.hosts[0], "paste", "s", "b", {
      text: "reverse paste",
    });
    assert.deepEqual(sent, [
      {
        method: "client.key",
        payload: {
          session_id: "s",
          block_id: "b",
          key: key("one"),
          prefix: ["prefix"],
        },
      },
      {
        method: "block.event",
        payload: {
          session_id: "s",
          block_id: "b",
          event: { type: "paste", payload: { text: "reverse paste" } },
        },
      },
    ]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(sent.at(-1), {
      method: "client.key",
      payload: { session_id: "s", block_id: "b", key: key("two") },
    });
  } finally {
    current.features.dispose();
  }
});

test("a failed typed key invalidates queued keys without replay and retains the original failure", async () => {
  const current = preferenceFixture();
  try {
    await current.connect(current.hosts[0]);
    const control = current.controls.get("first");
    assert.ok(control);
    let reject!: (error: Error) => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sent: object[] = [];
    const original = control.call.bind(control);
    control.call = async (method, payload) => {
      if (method !== "client.key") return original(method, payload);
      sent.push(payload);
      started();
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    };
    const failure = Object.assign(new Error("Key write failed"), {
      code: "network_error",
      method: "client.key",
    });
    const first = current.features.inputKey(
      current.hosts[0],
      "s",
      "b",
      key("one"),
      [],
    );
    await firstStarted;
    const second = current.features.inputKey(
      current.hosts[0],
      "s",
      "b",
      key("two"),
      [],
    );
    const firstRejected = assert.rejects(first, (error) => error === failure);
    const secondRejected = assert.rejects(second, /Input discarded/);
    reject(failure);
    await Promise.all([firstRejected, secondRejected]);
    assert.equal(sent.length, 1);
    control.call = original;
    await current.features.inputKey(
      current.hosts[0],
      "s",
      "b",
      key("fresh"),
      [],
    );
    assert.equal(
      sent.length,
      1,
      "A new key may send after failure; an old queued key must never replay",
    );
  } finally {
    current.features.dispose();
  }
});

test("malformed remote keymap entries are filtered before keyboard routing", () => {
  const map = normalizeKeymap({
    actions: [
      null,
      { name: 1 },
      { name: "bad", args: [] },
      { name: "valid", repeats: false },
    ],
    bindings: [
      null,
      { keys: "x", action: "valid" },
      { keys: [null], action: "valid" },
      { keys: ["x"], action: "valid", args: [] },
      { keys: ["x"], action: "valid" },
    ],
    modes: [
      null,
      { name: "bad", blocked: [["x", null]] },
      { name: "exclusive", exclusive: true, blocked: [["x", "y"]] },
    ],
    diagnostics: "invalid warnings",
  });
  assert.deepEqual(
    map.actions.map((action) => action.name),
    ["valid"],
  );
  assert.equal(map.bindings.length, 1);
  assert.deepEqual(map.modes, [
    { name: "exclusive", exclusive: true, blocked: [["x", "y"]] },
  ]);
  assert.deepEqual(map.warnings, []);
  const router = new KeymapRouter(() => {});
  try {
    router.setMap(map);
    const route = router.route(key("x"));
    assert.equal(route.kind, "action");
    router.mode({ operation: "enter", name: "exclusive" });
    assert.equal(router.route(key("x")).kind, "consume");
    assert.equal(router.route(key("y")).kind, "consume");
  } finally {
    router.dispose();
  }
  assert.deepEqual(normalizeKeymap({ diagnostics: ["warning"] }).warnings, [
    "warning",
  ]);
});

function fixture(
  allowServerCall?: FeatureHooks["allowServerCall"],
  native?: FeatureHooks["native"],
) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const source = {
    id: "source",
    label: "Source",
    endpoint: "unix:///source.sock",
  };
  const target = {
    id: "target",
    label: "Target",
    endpoint: "unix:///target.sock",
  };
  settings.hosts = [source, target];
  const forwarded: { hostId: string; method: string }[] = [];
  const emitted: ClientEvent[] = [];
  let listener: ((event: RexEvent) => void) | undefined;
  let nextReply: ((value: Record<string, unknown>) => void) | undefined;
  const control = {
    connected: true,
    onEvent(callback: (event: RexEvent) => void) {
      listener = callback;
      return () => {};
    },
    readyPublic: async () => ({ protocol: "rex.control.v1", api_revision: 10 }),
    call: async (method: string, payload: Record<string, unknown>) => {
      if (method === "client.reply") nextReply?.(payload);
      return {};
    },
  } as unknown as RexControl;
  const service = {
    callMethod: async (host: { id: string }, method: string) => {
      forwarded.push({ hostId: host.id, method });
      return { ok: true };
    },
  } as unknown as RexService;
  let features: ClientFeatures;
  features = new ClientFeatures(service, {
    settings: () => settings,
    notify: () => {},
    emit: (event) => {
      emitted.push(event);
      if (event.type === "action")
        features.reply(event.requestId, { ok: true });
    },
    allowServerCall,
    native,
  });
  features.bindControl(source, control);
  return {
    features,
    settings,
    source,
    target,
    forwarded,
    emitted,
    control,
    emit(type: string, payload: Record<string, unknown>) {
      listener?.({
        type,
        payload: { type, payload: { call_id: "stale-call", ...payload } },
      });
    },
    request(type: string, payload: Record<string, unknown>) {
      return new Promise<Record<string, unknown>>((resolve) => {
        nextReply = resolve;
        listener?.({
          type,
          payload: { type, payload: { call_id: "call", ...payload } },
        });
      });
    },
  };
}

test("disabling remote control refuses both server request variants before authorization or execution", async () => {
  let authorizations = 0;
  const fixtureValue = fixture(() => {
    authorizations++;
    return true;
  });
  fixtureValue.settings.remoteControl = false;
  try {
    for (const type of ["client_perform_requested", "client_call_requested"]) {
      const reply = await fixtureValue.request(type, {
        action: "client.sidebar.toggle",
        server_id: "target",
        method: "server.status",
      });
      assert.deepEqual(reply.error, {
        code: "refused",
        message: "Remote client control is disabled in settings.",
      });
    }
    assert.equal(authorizations, 0);
    assert.deepEqual(fixtureValue.forwarded, []);
    assert.ok(!fixtureValue.emitted.some((event) => event.type === "action"));
  } finally {
    fixtureValue.features.dispose();
  }
});

test("cross-host calls require explicit authorization while same-host requests keep working", async () => {
  const denied = fixture();
  denied.settings.remoteControl = true;
  try {
    const reply = await denied.request("client_call_requested", {
      server_id: "target",
      method: "server.status",
    });
    assert.deepEqual(reply.error, {
      code: "refused",
      message: "This server is not authorized to call another host.",
    });
    assert.deepEqual(denied.forwarded, []);
    await denied.request("client_call_requested", {
      server_id: "source",
      method: "server.status",
    });
    assert.deepEqual(denied.forwarded, [
      { hostId: "source", method: "server.status" },
    ]);
  } finally {
    denied.features.dispose();
  }

  const authorizations: string[][] = [];
  const allowed = fixture((source, target, method) => {
    authorizations.push([source.id, target.id, method]);
    return method === "server.status";
  });
  allowed.settings.remoteControl = true;
  try {
    const reply = await allowed.request("client_call_requested", {
      server_id: "target",
      method: "server.status",
    });
    assert.deepEqual(reply.result, { ok: true });
    assert.deepEqual(authorizations, [["source", "target", "server.status"]]);
    assert.deepEqual(allowed.forwarded, [
      { hostId: "target", method: "server.status" },
    ]);
    await allowed.request("client_call_requested", {
      server_id: "target",
      method: "session.close",
    });
    assert.equal(allowed.forwarded.length, 1);
  } finally {
    allowed.features.dispose();
  }
});

test("malformed activity snapshots cannot crash subsequent live notifications", () => {
  const events: ClientEvent[] = [];
  const registry = new ActivityRegistry(
    (event) => events.push(event),
    () => {},
    () => DEFAULT_SETTINGS.notifications,
  );
  registry.seed(
    "source",
    "session",
    "pane",
    { records: { invalid: true } },
    { title: [] },
    { foreground: null },
  );
  registry.apply("source", "session", {
    creator_name: "com.superlogical.terminal",
    block_id: "pane",
    name: "program_status_removed",
    payload: { ids: [null, {}] },
  });
  assert.equal(parseActivity({ state: {}, progress: Infinity }).state, "idle");
  assert.equal(parseActivity({ progress: Infinity }).progress, undefined);
  registry.apply("source", "session", {
    creator_name: "com.superlogical.terminal",
    block_id: "pane",
    name: "program_status_changed",
    payload: { record: { id: "task", state: "working" } },
  });
  assert.ok(events.some((event) => event.type === "notification"));
});

function preferenceFixture() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const hosts = [
    { id: "first", label: "First", endpoint: "unix:///first.sock" },
    { id: "second", label: "Second", endpoint: "unix:///second.sock" },
  ];
  settings.hosts = hosts;
  const emitted: ClientEvent[] = [];
  const desktop: ClientEvent[] = [];
  const calls: { hostId: string; method: string; payload: object }[] = [];
  const failures = new Set<string>();
  const connected = new Map<string, () => void>();
  const controls = new Map<string, RexControl>();
  const listeners = new Map<string, (event: RexEvent) => void>();
  let saved = false;
  const keymap = () => ({
    actions: [],
    bindings: [{ keys: [saved ? "y" : "x"], action: "client.sidebar.toggle" }],
    modes: [],
    warnings: [],
  });
  const service = {
    control: async (host: { id: string }) => {
      const control = controls.get(host.id);
      assert.ok(control);
      return control;
    },
    callMethod: async (
      host: { id: string },
      method: string,
      payload: object,
    ) => {
      calls.push({ hostId: host.id, method, payload });
      if (failures.has(`${host.id}:${method}`))
        throw new Error("keymap rejected");
      return keymap();
    },
  } as unknown as RexService;
  let features: ClientFeatures;
  features = new ClientFeatures(service, {
    settings: () => settings,
    notify: (event) => desktop.push(event),
    emit: (event) => {
      emitted.push(event);
      if (event.type === "status" && event.connected)
        connected.get(event.hostId)?.();
      if (event.type === "action")
        features.reply(event.requestId, { ok: true });
    },
  });
  return {
    settings,
    hosts,
    features,
    emitted,
    desktop,
    calls,
    failures,
    controls,
    emit(host: (typeof hosts)[number], type: string) {
      listeners.get(host.id)?.({ type, payload: { type, payload: {} } });
    },
    save() {
      saved = true;
      settings.clientLabel = "Saved label";
      settings.shortcuts = { "client.sidebar.toggle": "y" };
    },
    connect(host: (typeof hosts)[number]) {
      const control = {
        connected: true,
        onEvent: (listener: (event: RexEvent) => void) => {
          listeners.set(host.id, listener);
          return () => listeners.delete(host.id);
        },
        readyPublic: async () => ({
          protocol: "rex.control.v1",
          api_revision: 10,
        }),
        attach: async () => {},
        call: async (method: string, payload: object) => {
          calls.push({ hostId: host.id, method, payload });
          if (failures.has(`${host.id}:${method}`))
            throw new Error("label rejected");
          return method === "client.keymap" ? keymap() : {};
        },
      } as unknown as RexControl;
      controls.set(host.id, control);
      return new Promise<void>((resolve) => {
        connected.set(host.id, resolve);
        features.bindControl(host, control);
      });
    },
  };
}

test("saved preference failures are reported per host while other operations and hosts continue", async () => {
  const fixtureValue = preferenceFixture();
  const { features, hosts, calls, failures, emitted, desktop } = fixtureValue;
  try {
    await Promise.all(hosts.map((host) => fixtureValue.connect(host)));
    calls.length = 0;
    fixtureValue.save();
    failures.add("first:client.set_label");
    failures.add("first:client.keymap");
    await features.preferencesChanged();
    assert.ok(
      calls.some(
        (call) => call.hostId === "first" && call.method === "client.keymap",
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.hostId === "second" && call.method === "client.set_label",
      ),
    );
    assert.ok(
      calls.some(
        (call) => call.hostId === "second" && call.method === "client.keymap",
      ),
    );
    const notices = emitted.filter((event) => event.type === "notification");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].hostId, "first");
    assert.match(notices[0].body, /saved.*could not apply/);
    assert.match(notices[0].body, /Client label: label rejected/);
    assert.match(notices[0].body, /Keyboard shortcuts: keymap rejected/);
    assert.match(notices[0].body, /retried.*reconnects/);
    assert.equal(desktop.length, 1);
    const previousActions = emitted.filter(
      (event) => event.type === "action",
    ).length;
    await features.inputKey(hosts[0], "session", "pane", key("x"));
    assert.equal(
      emitted.filter((event) => event.type === "action").length,
      previousActions + 1,
      "A rejected preference update preserves the active keymap",
    );
    failures.clear();
    calls.length = 0;
    await fixtureValue.connect(hosts[0]);
    const label = calls.find((call) => call.method === "client.set_label");
    assert.deepEqual(label?.payload, { label: "Saved label" });
    const configuration = calls.find((call) => call.method === "client.keymap");
    assert.match(JSON.stringify(configuration?.payload), /"keys":\["y"\]/);
    await features.inputKey(hosts[0], "session", "pane", key("y"));
    assert.equal(
      emitted.filter((event) => event.type === "action").length,
      previousActions + 2,
    );
  } finally {
    features.dispose();
  }
});

test("incoming keymap changes report configuration failure, preserve active routing, and can retry", async () => {
  const current = preferenceFixture();
  try {
    await Promise.all(current.hosts.map((host) => current.connect(host)));
    current.save();
    const before = current.emitted.length;
    current.failures.add("first:client.keymap");
    current.emit(current.hosts[0], "keymap_changed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(
      current.emitted
        .slice(before)
        .some(
          (event) =>
            event.type === "status" &&
            event.hostId === "first" &&
            !event.connected &&
            event.message === "keymap rejected",
        ),
    );
    assert.ok(
      !current.emitted
        .slice(before)
        .some(
          (event) =>
            event.type === "status" &&
            event.hostId === "second" &&
            !event.connected,
        ),
    );
    await current.features.inputKey(
      current.hosts[0],
      "session",
      "pane",
      key("x"),
    );
    assert.equal(
      current.emitted.at(-1)?.type,
      "action",
      "Failed configuration retains the previous working keymap",
    );
    current.failures.clear();
    current.emit(current.hosts[0], "keymap_changed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await current.features.inputKey(
      current.hosts[0],
      "session",
      "pane",
      key("y"),
    );
    assert.equal(
      current.emitted.at(-1)?.type,
      "action",
      "A later keymap event can apply the current settings",
    );
  } finally {
    current.features.dispose();
  }
});

test("disconnected hosts retry the latest saved shortcuts when their next control connects", async () => {
  const fixtureValue = preferenceFixture();
  try {
    await fixtureValue.connect(fixtureValue.hosts[0]);
    const control = fixtureValue.controls.get("first");
    assert.ok(control);
    Object.defineProperty(control, "connected", { value: false });
    fixtureValue.save();
    await fixtureValue.features.preferencesChanged();
    fixtureValue.calls.length = 0;
    await fixtureValue.connect(fixtureValue.hosts[0]);
    const configuration = fixtureValue.calls.find(
      (call) => call.method === "client.keymap",
    );
    assert.match(JSON.stringify(configuration?.payload), /"keys":\["y"\]/);
    assert.ok(
      !fixtureValue.emitted.some((event) => event.type === "notification"),
    );
  } finally {
    fixtureValue.features.dispose();
  }
});

test("removed and endpoint-changed hosts lose authority even before disconnect completes", async () => {
  for (const change of ["remove", "endpoint"] as const) {
    const current = fixture(() => true);
    current.settings.remoteControl = true;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const before = current.emitted.length;
    if (change === "remove")
      current.settings.hosts = current.settings.hosts.filter(
        (host) => host.id !== current.source.id,
      );
    else
      current.settings.hosts = current.settings.hosts.map((host) =>
        host.id === current.source.id
          ? { ...host, endpoint: "unix:///replacement.sock" }
          : host,
      );
    current.emit("client_perform_requested", {
      action: "client.sidebar.toggle",
    });
    current.emit("client_call_requested", {
      server_id: "target",
      method: "server.status",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(current.forwarded, []);
    assert.ok(
      !current.emitted.slice(before).some((event) => event.type === "action"),
    );
    current.features.forgetHost(current.source);
    await assert.rejects(
      current.features.invoke(current.source, "client.sidebar.toggle"),
      /no longer authorized/,
    );
    current.features.dispose();
  }
});

test("revocation during a native action cannot accept its result or dispatch a renderer fallback", async () => {
  for (const change of ["remove", "endpoint", "control"] as const) {
    const entered = deferred<void>();
    const release = deferred<{ handled: boolean; result?: unknown }>();
    const current = fixture(undefined, () => {
      entered.resolve();
      return release.promise;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const operation = current.features.invoke(
        current.source,
        "client.sidebar.toggle",
      );
      await entered.promise;
      const before = current.emitted.length;
      if (change === "remove") current.settings.hosts = [current.target];
      else if (change === "endpoint")
        current.settings.hosts = [
          { ...current.source, endpoint: "unix:///replaced-native.sock" },
          current.target,
        ];
      else
        current.features.bindControl(current.source, {
          ...current.control,
        } as RexControl);
      release.resolve({
        handled: change === "remove",
        result: "stale native result",
      });
      await assert.rejects(operation, /no longer authorized/);
      assert.ok(
        !current.emitted.slice(before).some((event) => event.type === "action"),
      );
    } finally {
      current.features.dispose();
    }
  }
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred is not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Deferred is not initialized");
  };
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

test("late ready, attachment and keymap completions cannot resurrect a replaced host binding", async () => {
  for (const phase of [
    "ready",
    "client.set_label",
    "session.attach_all",
    "client.keymap",
  ] as const) {
    const source = { id: "host", label: "Host", endpoint: "unix:///old.sock" };
    const replacement = { ...source, endpoint: "unix:///new.sock" };
    const settings = { ...structuredClone(DEFAULT_SETTINGS), hosts: [source] };
    const entered = deferred<void>();
    const release = deferred<unknown>();
    const connected = deferred<void>();
    const calls: string[] = [];
    const emitted: ClientEvent[] = [];
    const old = {
      onEvent: () => () => {},
      readyPublic: () => {
        if (phase === "ready") {
          entered.resolve();
          return release.promise;
        }
        return Promise.resolve({
          protocol: "rex.control.v1",
          api_revision: 10,
        });
      },
      call: (method: string) => {
        calls.push(method);
        if (method === phase) {
          entered.resolve();
          return release.promise;
        }
        return Promise.resolve({});
      },
    } as unknown as RexControl;
    const next = {
      onEvent: () => () => {},
      readyPublic: async () => ({
        protocol: "rex.control.v1",
        api_revision: 10,
      }),
      call: async (method: string) =>
        method === "client.keymap"
          ? {
              actions: [{ name: "new.action" }],
              bindings: [],
              modes: [],
              warnings: [],
            }
          : {},
    } as unknown as RexControl;
    const features = new ClientFeatures({} as RexService, {
      settings: () => settings,
      notify: () => {},
      emit: (event) => {
        emitted.push(event);
        if (event.type === "status" && event.connected) connected.resolve();
      },
    });
    try {
      features.bindControl(source, old);
      await entered.promise;
      settings.hosts = [replacement];
      features.forgetHost(source);
      features.bindControl(replacement, next);
      await connected.promise;
      release.resolve(
        phase === "ready"
          ? { protocol: "rex.control.v1", api_revision: 10 }
          : {
              actions: [{ name: "stale.action" }],
              bindings: [],
              modes: [],
              warnings: [],
            },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(
        !emitted.some(
          (event) =>
            event.type === "keymap" &&
            event.keymap.actions.some(
              (action) => action.name === "stale.action",
            ),
        ),
      );
      assert.deepEqual(
        calls,
        phase === "ready"
          ? []
          : ["client.set_label", "session.attach_all", "client.keymap"].slice(
              0,
              [
                "client.set_label",
                "session.attach_all",
                "client.keymap",
              ].indexOf(phase) + 1,
            ),
      );
    } finally {
      features.dispose();
    }
  }
});

test("a superseded connection failure cannot mark the current same-endpoint binding disconnected", async () => {
  const source = { id: "host", label: "Host", endpoint: "unix:///same.sock" };
  const settings = { ...structuredClone(DEFAULT_SETTINGS), hosts: [source] };
  const ready = deferred<unknown>();
  const connected = deferred<void>();
  const emitted: ClientEvent[] = [];
  const next = {
    onEvent: () => () => {},
    readyPublic: async () => ({ protocol: "rex.control.v1", api_revision: 10 }),
    call: async () => ({}),
  } as unknown as RexControl;
  const previous = {
    ...next,
    readyPublic: () => ready.promise,
  } as unknown as RexControl;
  const features = new ClientFeatures({} as RexService, {
    settings: () => settings,
    notify: () => {},
    emit: (event) => {
      emitted.push(event);
      if (event.type === "status" && event.connected) connected.resolve();
    },
  });
  try {
    features.bindControl(source, previous);
    features.bindControl(source, next);
    await connected.promise;
    ready.reject(new Error("Old connection failed late"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      emitted
        .filter((event) => event.type === "status")
        .map((event) => event.connected),
      [true],
    );
  } finally {
    features.dispose();
  }
});
