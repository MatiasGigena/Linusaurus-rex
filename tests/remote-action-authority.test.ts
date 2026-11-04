import { WorkspaceDialogController } from "../src/workspace/dialogs.js";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClientFeatures } from "../electron/client/client.js";
import type { RexControl, RexEvent } from "../electron/rex/control.js";
import type { RexService } from "../electron/rex/service.js";
import { createWorkspaceActions } from "../src/workspace/actions/createWorkspaceActions.js";
import {
  WorkspaceReconciliationError,
  type WorkspaceOperations,
} from "../src/core/workspaceOperations.js";
import {
  DEFAULT_SETTINGS,
  type ClientEvent,
  type RexBridge,
  type RexMethods,
  type SessionView,
} from "../src/shared/types.js";

function fixture(
  t: TestContext,
  configuration: {
    confirmClose?: boolean;
    mutateHostAndRefresh?: WorkspaceOperations["mutateHostAndRefresh"];
  } = {},
) {
  const source = {
    id: "source",
    label: "Source",
    endpoint: "unix:///source.sock",
  };
  const target = {
    id: "other",
    label: "Other",
    endpoint: "unix:///other.sock",
  };
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    hosts: [source, target],
    remoteControl: true,
    confirmClose: configuration.confirmClose ?? DEFAULT_SETTINGS.confirmClose,
  };
  const requests: { method: keyof RexMethods; args: object }[] = [];
  const selected: string[] = [];
  const selectionTargets: { hostId: string; sessionId: string }[] = [];
  const actions: ClientEvent[] = [];
  let nativeCalls = 0;
  let authorizations = 0;
  const responders: Partial<{
    [K in keyof RexMethods]: (
      args: RexMethods[K]["args"],
    ) => Promise<RexMethods[K]["result"]>;
  }> = {
    createSession: async () => ({ sessionId: "created" }),
    closeWindow: async () => {},
    closePane: async () => {},
    destroySession: async () => {},
  };
  const request: RexBridge["request"] = async (method, args) => {
    requests.push({ method, args });
    const respond = responders[method];
    if (!respond) throw new Error(`Unexpected bridge request: ${method}`);
    return respond(args);
  };
  const workspace: WorkspaceOperations = {
    getSettings: () => settings,
    saveSettings: async (value) => value,
    refresh: async () => {},
    mutateHostAndRefresh:
      configuration.mutateHostAndRefresh ??
      (async (_host, operation) => operation()),
    mutateSession: async (plan, operation) => {
      const result = await operation();
      const id =
        typeof plan.sessionId === "function"
          ? plan.sessionId(result)
          : plan.sessionId;
      const view: SessionView = {
        id,
        label: id,
        activeWindowId: "",
        windows: [],
      };
      if (plan.selectActive) selected.push(plan.hostId);
      return { result, view };
    },
    select: (hostId, sessionId) => {
      selected.push(hostId);
      selectionTargets.push({ hostId, sessionId });
    },
    focusPane: async () => {},
    dismissNotices: () => {},
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { rex: { request } },
  });
  const discard = (_value: unknown) => {};
  const dialogs = new WorkspaceDialogController();
  const execute = createWorkspaceActions({
    dialogs,
    workspace,
    settings,
    hosts: settings.hosts.map((host) => ({
      ...host,
      connected: true,
      sessions:
        host.id === source.id
          ? [
              { id: "source-a", label: "Shared" },
              { id: "source-b", label: "Source second" },
            ]
          : [
              { id: "other-a", label: "Other only" },
              { id: "other-shared", label: "Shared" },
            ],
    })),
    views: {
      "source/source-a": {
        id: "source-a",
        label: "Source session",
        activeWindowId: "source-tab",
        windows: [
          {
            id: "source-tab",
            label: "Source tab",
            focusedBlockId: "source-pane",
            panes: [
              { id: "source-pane", label: "Source pane", rect: [0, 0, 1, 1] },
            ],
          },
        ],
      },
    },
    keymaps: {},
    focusedPane: undefined,
    selection: {
      hostId: target.id,
      sessionId: "displayed",
      windowId: "displayed-tab",
    },
    interfaceTheme: "macos",
    workspaceElement: { current: null },
    setCollapsedSessions: discard,
    setActivityOnly: discard,
    setActivityOpen: discard,
    setActivityGroup: discard,
  });
  let incoming: ((event: RexEvent) => void) | undefined;
  let complete: ((reply: Record<string, unknown>) => void) | undefined;
  const replies: Record<string, unknown>[] = [];
  const control = {
    onEvent: (listener: (event: RexEvent) => void) => {
      incoming = listener;
      return () => {};
    },
    readyPublic: async () => ({ protocol: "rex.control.v1", api_revision: 10 }),
    call: async (method: string, args: Record<string, unknown>) => {
      if (method === "client.reply") {
        replies.push(args);
        complete?.(args);
      }
      return {};
    },
  } as unknown as RexControl;
  const features = new ClientFeatures({} as RexService, {
    settings: () => settings,
    notify: () => {},
    native: async () => {
      nativeCalls++;
      return { handled: false };
    },
    allowServerCall: () => {
      authorizations++;
      return true;
    },
    emit: (event) => {
      if (event.type !== "action") return;
      actions.push(event);
      void execute(event.name, event.args, event).then(
        (result) => features.reply(event.requestId, result),
        (error: unknown) =>
          features.reply(
            event.requestId,
            undefined,
            error instanceof Error ? error.message : String(error),
          ),
      );
    },
  });
  features.bindControl(source, control);
  t.after(() => {
    features.dispose();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return {
    source,
    dialogs,
    target,
    requests,
    responders,
    replies,
    selected,
    selectionTargets,
    actions,
    execute,
    nativeCalls: () => nativeCalls,
    authorizations: () => authorizations,
    perform: (
      args: Record<string, unknown>,
      action = "session.new",
      sessionId?: string,
    ) =>
      new Promise<Record<string, unknown>>((resolve) => {
        complete = resolve;
        incoming?.({
          type: "client_perform_requested",
          payload: {
            type: "client_perform_requested",
            payload: {
              call_id: "remote-call",
              action,
              args,
              session_id: sessionId,
            },
          },
        });
      }),
  };
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

for (const [action, method] of [
  ["session.close", "destroySession"],
  ["client.tab.close", "closeWindow"],
  ["pane.close", "closePane"],
] as const) {
  test(`incoming ${action} replies only after the actual dispatcher write and reconciliation settle`, async (t) => {
    const write = latch(),
      enteredWrite = latch(),
      refresh = latch(),
      enteredRefresh = latch();
    const mutateHostAndRefresh: WorkspaceOperations["mutateHostAndRefresh"] =
      async (hostId, operation) => {
        assert.equal(hostId, "source");
        const result = await operation();
        enteredRefresh.release();
        await refresh.promise;
        return result;
      };
    const current = fixture(t, { confirmClose: false, mutateHostAndRefresh });
    current.responders[method] = async () => {
      enteredWrite.release();
      await write.promise;
    };
    const replying = current.perform(
      { block_id: "source-pane" },
      action,
      "source-a",
    );
    await enteredWrite.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const earlyWriteReply = current.replies.length;
    write.release();
    await enteredRefresh.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const earlyRefreshReply = current.replies.length;
    refresh.release();
    const reply = await replying;
    assert.equal(earlyWriteReply, 0);
    assert.equal(earlyRefreshReply, 0);
    assert.deepEqual(reply, { call_id: "remote-call", result: null });
    assert.equal(current.requests.length, 1);
    assert.equal(current.requests[0].method, method);
    assert.equal(Reflect.get(current.requests[0].args, "hostId"), "source");
  });
}

for (const stage of ["write", "refresh"] as const) {
  test(`incoming close ${stage} failure returns an error reply instead of success`, async (t) => {
    const cause = new Error("Close refused");
    const failure =
      stage === "refresh" ? new WorkspaceReconciliationError(cause) : cause;
    const mutateHostAndRefresh: WorkspaceOperations["mutateHostAndRefresh"] =
      async (_hostId, operation) => {
        await operation();
        throw failure;
      };
    const current = fixture(t, { confirmClose: false, mutateHostAndRefresh });
    current.responders.closeWindow = async () => {
      if (stage === "write") throw failure;
    };
    const reply = await current.perform({}, "client.tab.close", "source-a");
    assert.deepEqual(reply, {
      call_id: "remote-call",
      error: { code: "refused", message: failure.message },
    });
    assert.equal(current.requests.length, 1);
  });
}

test("incoming close honors current-host mutation admission without writing", async (t) => {
  const current = fixture(t, {
    confirmClose: false,
    mutateHostAndRefresh: async () => {
      throw new Error("The selected host is no longer configured.");
    },
  });
  const reply = await current.perform({}, "session.close", "source-a");
  assert.deepEqual(reply, {
    call_id: "remote-call",
    error: {
      code: "refused",
      message: "The selected host is no longer configured.",
    },
  });
  assert.deepEqual(current.requests, []);
});

test("incoming close explicitly reports confirmation deferral and starts no early write", async (t) => {
  const current = fixture(t);
  const reply = await current.perform({}, "client.tab.close", "source-a");
  assert.deepEqual(reply, {
    call_id: "remote-call",
    result: { status: "confirmation_required" },
  });
  assert.deepEqual(current.requests, []);
  const confirmation =
    current.dialogs.snapshot.confirmation?.dialog.confirmation;
  assert.ok(confirmation);
  await confirmation.submit();
  assert.deepEqual(current.requests, [
    {
      method: "closeWindow",
      args: { hostId: "source", sessionId: "source-a", windowId: "source-tab" },
    },
  ]);
});

test("incoming server actions cannot mutate another host, while same-host requests traverse the real dispatcher", async (t) => {
  const current = fixture(t);
  const denied = await current.perform({
    host_id: current.target.id,
    label: "Forbidden",
  });
  assert.ok(
    denied.error,
    "Conflicting remote target must be refused before native or renderer execution",
  );
  assert.deepEqual(current.requests, []);
  assert.deepEqual(current.actions, []);
  assert.equal(current.nativeCalls(), 0);
  assert.equal(
    current.authorizations(),
    0,
    "Server-call authorization does not authorize remote renderer actions",
  );
  const accepted = await current.perform({
    host_id: current.source.id,
    label: "Allowed",
  });
  assert.equal(accepted.error, undefined);
  assert.deepEqual(current.requests, [
    {
      method: "createSession",
      args: { hostId: current.source.id, label: "Allowed", cwd: undefined },
    },
  ]);
  assert.deepEqual(current.selected, [current.source.id]);
  await current.perform({ label: "Implicit source" });
  assert.deepEqual(current.requests.at(-1), {
    method: "createSession",
    args: {
      hostId: current.source.id,
      label: "Implicit source",
      cwd: undefined,
    },
  });
});

test("renderer action events remain source-bound even when injected directly; local user targeting still works", async (t) => {
  const current = fixture(t);
  const args = { host_id: current.target.id, label: "Forbidden" };
  const event: ClientEvent = {
    type: "action",
    requestId: "injected",
    name: "session.new",
    hostId: current.source.id,
    args,
  };
  await assert.rejects(
    current.execute(event.name, args, event),
    /another host|source host/,
  );
  assert.deepEqual(current.requests, []);
  await current.execute("session.new", {
    host_id: current.target.id,
    label: "User choice",
  });
  assert.deepEqual(current.requests, [
    {
      method: "createSession",
      args: { hostId: current.target.id, label: "User choice", cwd: undefined },
    },
  ]);
});

for (const session of ["other-a", "Other only"]) {
  test(`remote session selection cannot navigate to another host using ${session}`, async (t) => {
    const current = fixture(t);
    const reply = await current.perform({ session }, "session.select");
    assert.ok(
      reply.error,
      "a source-host action must not select an ID or label owned only by another host",
    );
    assert.equal(current.selectionTargets.length, 0);
    await current.execute("session.select", { session });
    assert.deepEqual(current.selectionTargets, [
      { hostId: "other", sessionId: "other-a" },
    ]);
  });
}

test("remote session labels resolve within their source host while local duplicate labels stay ambiguous", async (t) => {
  const current = fixture(t);
  const reply = await current.perform({ label: "Shared" }, "session.select");
  assert.equal(reply.error, undefined);
  assert.deepEqual(current.selectionTargets, [
    { hostId: "source", sessionId: "source-a" },
  ]);
  await assert.rejects(
    current.execute("session.select", { label: "Shared" }),
    /ambiguous/i,
  );
});

for (const [action, sessionId, remoteTarget, localTarget] of [
  ["session.next", "source-b", "source-a", "other-a"],
  ["session.previous", "source-a", "source-b", "other-shared"],
] as const) {
  test(`remote ${action} wraps within its source host while local navigation may cross hosts`, async (t) => {
    const current = fixture(t);
    const reply = await current.perform({}, action, sessionId);
    assert.equal(reply.error, undefined);
    assert.deepEqual(current.selectionTargets, [
      { hostId: "source", sessionId: remoteTarget },
    ]);
    await current.execute(action, { host_id: "source", session_id: sessionId });
    assert.deepEqual(current.selectionTargets.at(-1), {
      hostId: "other",
      sessionId: localTarget,
    });
  });
}

for (const host of ["other", "Other"]) {
  test(`remote host switching cannot use the ${host} alias to escape its source`, async (t) => {
    const current = fixture(t);
    const denied = await current.perform({ host }, "client.host.switch");
    assert.ok(denied.error);
    assert.equal(current.selectionTargets.length, 0);
    const allowed = await current.perform(
      { host: "Source" },
      "client.host.switch",
    );
    assert.equal(allowed.error, undefined);
    assert.deepEqual(current.selectionTargets, [
      { hostId: "source", sessionId: "source-a" },
    ]);
    await current.execute("client.host.switch", { host });
    assert.deepEqual(current.selectionTargets.at(-1), {
      hostId: "other",
      sessionId: "other-a",
    });
  });
}

for (const [action, kind] of [
  ["client.diagnostics", "diagnostics"],
  ["client.pair_device", "pairing"],
] as const) {
  test(`incoming ${action} opens administration for its source host despite another selection`, async (t) => {
    const current = fixture(t);
    const reply = await current.perform({}, action);
    assert.equal(reply.error, undefined);
    assert.deepEqual(current.dialogs.snapshot.primary?.dialog, {
      kind,
      hostId: current.source.id,
    });
    await current.execute(action, { host_id: current.target.id });
    assert.deepEqual(current.dialogs.snapshot.primary?.dialog, {
      kind,
      hostId: current.target.id,
    });
    assert.deepEqual(current.requests, []);
  });
}
