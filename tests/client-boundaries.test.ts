import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActivityRegistry,
  parseActivity,
} from "../electron/features/activity.js";
import {
  ClientFeatures,
  type FeatureHooks,
} from "../electron/features/client.js";
import { KeymapRouter } from "../electron/features/keymap.js";
import { normalizeKeymap } from "../electron/features/keymap-data.js";
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
    router.mode("enter", "exclusive");
    assert.equal(router.route(key("x")).kind, "consume");
    assert.equal(router.route(key("y")).kind, "consume");
  } finally {
    router.dispose();
  }
  assert.deepEqual(normalizeKeymap({ diagnostics: ["warning"] }).warnings, [
    "warning",
  ]);
});

function fixture(allowServerCall?: FeatureHooks["allowServerCall"]) {
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
  });
  features.bindControl(source, control);
  return {
    features,
    settings,
    source,
    target,
    forwarded,
    emitted,
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
