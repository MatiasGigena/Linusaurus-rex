import {
  WorkspaceReconciliationError,
  type WorkspaceOperations,
} from "../src/core/workspaceOperations";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Dispatch, SetStateAction } from "react";
import { createWorkspaceActions } from "../src/workspace/actions/createWorkspaceActions.js";
import type { WorkspaceActionOptions } from "../src/workspace/actions/context.js";
import { WorkspaceDialogController } from "../src/workspace/dialogs.js";
import {
  terminalCommands,
  type TerminalCommandCompletion,
} from "../src/terminal/commands.js";
import {
  DEFAULT_SETTINGS,
  type ClientEvent,
  type RexBridge,
  type RexMethods,
  type Selection,
  type SessionView,
  type Settings,
} from "../src/shared/types.js";

function state<T>(initial: T) {
  let current = initial;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    current =
      typeof next === "function" ? (next as (value: T) => T)(current) : next;
  };
  return { get: () => current, set };
}
function session(id: string, label = "Shared"): SessionView {
  return {
    id,
    label,
    activeWindowId: `${id}-first`,
    windows: [
      {
        id: `${id}-first`,
        label: "First",
        focusedBlockId: `${id}-left`,
        panes: [
          { id: `${id}-left`, label: "Left", rect: [0, 0, 0.5, 1] },
          { id: `${id}-right`, label: "Right", rect: [0.5, 0, 0.5, 1] },
        ],
      },
      {
        id: `${id}-last`,
        label: "Last",
        focusedBlockId: `${id}-last-pane`,
        panes: [{ id: `${id}-last-pane`, label: "Shell", rect: [0, 0, 1, 1] }],
      },
    ],
  };
}
function fixture(t: TestContext) {
  const initial = {
    ...structuredClone(DEFAULT_SETTINGS),
    hosts: [
      { id: "local", label: "Local", endpoint: "" },
      { id: "remote", label: "Remote", endpoint: "https://remote.test" },
    ],
  };
  const settings = state<Settings>(initial);
  const selection = state<Selection | undefined>({
    hostId: "local",
    sessionId: "local-session",
    windowId: "local-session-first",
  });
  const focusedPane = state<string | undefined>("local-session-right");
  const dialogs = new WorkspaceDialogController();
  const palette = {
    get: () => {
      const p = dialogs.snapshot.primary?.dialog;
      return p?.kind === "palette" ? p.scope : undefined;
    },
  };
  const settingsTab = {
    get: () => {
      const p = dialogs.snapshot.primary?.dialog;
      return p?.kind === "settings" ? p.tab : undefined;
    },
  };
  const form = { get: () => dialogs.snapshot.form?.dialog.form };
  const confirmation = {
    get: () => dialogs.snapshot.confirmation?.dialog.confirmation,
  };
  const views = {
    "local/local-session": session("local-session"),
    "remote/remote-session": session("remote-session"),
  } satisfies Record<string, SessionView>;
  const hosts: WorkspaceActionOptions["hosts"] = initial.hosts.map((host) => ({
    ...host,
    connected: true,
    sessions: [
      {
        id: host.id === "local" ? "local-session" : "remote-session",
        label: "Shared",
      },
    ],
  }));
  const keymaps: WorkspaceActionOptions["keymaps"] = {};
  const requests: { method: keyof RexMethods; args: object }[] = [];
  const selections: (Selection & { blockId?: string })[] = [];
  const saved: Settings[] = [];
  const inspections: {
    hostId: string;
    sessionId: string;
    selectActive?: boolean;
  }[] = [];
  const timeline: string[] = [];
  const dispatches: {
    name: string;
    args?: Record<string, unknown>;
    event?: ClientEvent;
  }[] = [];
  type Responders = {
    [K in keyof RexMethods]: (
      args: RexMethods[K]["args"],
    ) => Promise<RexMethods[K]["result"]>;
  };
  const responders: Partial<Responders> = {
    split: async () => {},
    zoom: async () => {},
    layoutAction: async () => {},
    closePane: async () => {},
    closeWindow: async () => {},
    destroySession: async () => {},
    createSession: async () => ({ sessionId: "created" }),
    renameSession: async () => {},
    renameWindow: async () => {},
    renamePane: async () => {},
    keyMode: async () => {},
    newWindow: async () => {},
    resizeWindow: async () => {},
    movePane: async () => {},
    creators: async () => ({}),
    createBlock: async () => ({}),
    removeCredentials: async () => {},
    invokeAction: async () => ({ accepted: true }),
  };
  const request: RexBridge["request"] = async (method, args) => {
    requests.push({ method, args });
    timeline.push(`rpc:${method}`);
    const respond = responders[method];
    if (!respond) throw new Error(`Unexpected bridge request: ${method}`);
    return respond(args);
  };
  const discard = (_value: unknown) => {};
  const workspace: WorkspaceOperations = {
    getSettings: () => settings.get(),
    saveSettings: async (next) => {
      const copy = structuredClone(next);
      saved.push(copy);
      settings.set(copy);
      timeline.push("settings");
      return copy;
    },
    refresh: async () => {},
    mutateHostAndRefresh: async (_hostId, operation) => operation(),
    mutateSession: async (plan, operation) => {
      const result = await operation();
      const sessionId =
        typeof plan.sessionId === "function"
          ? plan.sessionId(result)
          : plan.sessionId;
      inspections.push({
        hostId: plan.hostId,
        sessionId,
        selectActive: plan.selectActive,
      });
      const view = session(sessionId, "Created");
      if (plan.selectActive)
        workspace.select(plan.hostId, sessionId, view.activeWindowId);
      return { result, view };
    },
    select: (hostId, sessionId, windowId, blockId) => {
      const next = {
        hostId,
        sessionId,
        windowId: windowId ?? "",
        ...(blockId ? { blockId } : {}),
      };
      selections.push(next);
      selection.set(next);
      focusedPane.set(blockId);
    },
    focusPane: async (target) => {
      const view = Object.entries(views).find(
        ([key]) => key === `${target.hostId}/${target.sessionId}`,
      )?.[1];
      const window = view?.windows.find((window) =>
        window.panes.some((pane) => pane.id === target.blockId),
      );
      workspace.select(
        target.hostId,
        target.sessionId,
        window?.id,
        target.blockId,
      );
    },
    dismissNotices: () => {},
  };
  const bridge: RexBridge = {
    request,
    onTerminal: () => () => {},
    onCommand: () => () => {},
    onClientEvent: () => () => {},
    replyAction: () => {},
    readClipboard: async () => "",
    writeClipboard: async () => {},
    getSettings: async () => settings.get(),
    setSettings: workspace.saveSettings,
    windowControl: () => {},
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { rex: bridge },
  });
  t.after(() => {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const options: WorkspaceActionOptions = {
    executeCurrent,
    dialogs,
    workspace,
    hosts,
    views,
    keymaps,
    get settings() {
      return settings.get();
    },
    get selection() {
      return selection.get();
    },
    get focusedPane() {
      return focusedPane.get();
    },
    interfaceTheme: "macos",
    workspaceElement: { current: null },
    setCollapsedSessions: discard,
    setActivityOnly: discard,
    setActivityOpen: discard,
    setActivityGroup: discard,
  };
  function executeCurrent(
    name: string,
    args?: Record<string, unknown>,
    event?: ClientEvent,
  ) {
    dispatches.push({ name, args, event });
    // Each call models a rendered snapshot; retained forms must cross the same
    // current-executor seam that App supplies instead of reusing this snapshot.
    return createWorkspaceActions({
      ...options,
      views: { ...views },
      settings: settings.get(),
      selection: selection.get(),
      focusedPane: focusedPane.get(),
    })(name, args, event);
  }
  return {
    initial,
    dialogs,
    settings,
    selection,
    focusedPane,
    palette,
    settingsTab,
    form,
    confirmation,
    views,
    hosts,
    keymaps,
    requests,
    selections,
    saved,
    inspections,
    timeline,
    dispatches,
    workspace,
    responders,
    execute: executeCurrent,
  };
}

test("open-on-web maps WebSocket endpoints and retains exact session escaping", async (t) => {
  for (const [scheme, webScheme] of [
    ["ws", "http"],
    ["wss", "https"],
    ["http", "http"],
    ["https", "https"],
  ]) {
    await t.test(scheme, async (t) => {
      const current = fixture(t);
      const host = current.hosts.find((host) => host.id === "remote");
      assert.ok(host);
      host.status = {
        connected: true,
        endpoint: `${scheme}://remote.test:7297/base?old=1#fragment`,
      };
      current.responders.openExternal = async () => {};
      await current.execute("session.open_on_web", {
        host_id: "remote",
        session_id: "a &/?#%",
      });
      assert.deepEqual(current.requests, [
        {
          method: "openExternal",
          args: {
            url: `${webScheme}://remote.test:7297/?session=a%20%26%2F%3F%23%25`,
          },
        },
      ]);
    });
  }
});

test("open-on-web rejects endpoints without a supported web address", async (t) => {
  for (const endpoint of [
    "unix:///tmp/rex.sock",
    "tcp://remote.test:7297",
    undefined,
  ]) {
    await t.test(endpoint ?? "missing", async (t) => {
      const current = fixture(t);
      const host = current.hosts.find((host) => host.id === "remote");
      assert.ok(host);
      if (endpoint) host.status = { connected: true, endpoint };
      await assert.rejects(
        current.execute("session.open_on_web", {
          host_id: "remote",
          session_id: "remote-session",
        }),
        /This host has no web address\. Configure remote serving first\./,
      );
      assert.deepEqual(current.requests, []);
    });
  }
});

test("remote host-only mutations cannot borrow the displayed local session or pane", async (t) => {
  const current = fixture(t);
  await assert.rejects(
    current.execute("session.rename", {
      host_id: "remote",
      label: "Wrong host",
    }),
    /Choose a session first/,
  );
  await assert.rejects(
    current.execute("zoom", {
      host_id: "remote",
      block_id: "remote-session-left",
    }),
    /Select a terminal pane first/,
  );
  await assert.rejects(
    current.execute(
      "session.rename",
      { label: "Wrong host" },
      {
        type: "action",
        requestId: "remote-only",
        name: "session.rename",
        args: {},
        hostId: "remote",
      },
    ),
    /Choose a session first/,
  );
  assert.deepEqual(current.requests, []);
});

test("pane closure reports balancing as partial failure without suggesting another close", async (t) => {
  const current = fixture(t);
  current.settings.set({ ...current.settings.get(), autobalanceSplits: true });
  const failure = new Error("balance permission denied");
  current.responders.layoutAction = async () => {
    throw failure;
  };
  await current.execute("pane.close");
  assert.equal(current.requests.length, 0);
  const confirmation = current.confirmation.get();
  assert.ok(confirmation);
  await assert.rejects(confirmation.submit(), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /pane closed.*balanc.*failed/i);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.deepEqual(
    current.requests.map((request) => request.method),
    ["closePane", "layoutAction"],
  );
});

test("closing the last pane does not balance a pane that no longer exists", async (t) => {
  const current = fixture(t);
  current.settings.set({ ...current.settings.get(), autobalanceSplits: true });
  const window = current.views["local/local-session"].windows[0];
  window.panes = window.panes.filter(
    (pane) => pane.id === "local-session-right",
  );
  await current.execute("pane.close");
  const confirmation = current.confirmation.get();
  assert.ok(confirmation);
  await confirmation.submit();
  assert.deepEqual(
    current.requests.map((request) => request.method),
    ["closePane"],
  );
});

test("block creation presents advertised flavors before creating the chosen block", async (t) => {
  const current = fixture(t);
  current.responders.creators = async () => ({
    creators: [
      {
        name: "example",
        flavors: [{ flavor: "example.chart" }, { flavor: "example.notes" }],
      },
      { name: "invalid", flavors: [null, { flavor: 42 }] },
    ],
  });
  await current.execute("pane.new_block");
  const form = current.form.get();
  assert.ok(form);
  assert.match(form.description ?? "", /example\.chart/);
  assert.match(form.description ?? "", /example\.notes/);
  assert.equal(
    current.requests.length,
    1,
    "choosing a type must not create a block",
  );
});

test("dynamic pane directions are validated before focus or mutation", async (t) => {
  for (const [name, direction] of [
    ["pane.focus", "diagonal"],
    ["pane.move", "diagonal"],
    ["pane.split", "diagonal"],
    ["pane.focus", null],
    ["pane.split", {}],
  ]) {
    await t.test(`${name}: ${JSON.stringify(direction)}`, async (t) => {
      const current = fixture(t);
      await assert.rejects(
        current.execute(String(name), {
          direction,
          anchor_id: "local-session-left",
        }),
        /direction|Use left/i,
      );
      assert.deepEqual(current.requests, []);
      assert.deepEqual(current.selections, []);
    });
  }
});

test("direct and form pane movement share direction normalization", async (t) => {
  const current = fixture(t);
  await current.execute("pane.move", {
    anchor_id: "local-session-left",
    direction: "up",
  });
  assert.equal(
    (current.requests.at(-1)?.args as RexMethods["movePane"]["args"]).direction,
    "above",
  );
  await current.execute("pane.move");
  const form = current.form.get();
  assert.ok(form);
  await form.submit({ anchor: "local-session-left", direction: "down" });
  assert.equal(
    (current.requests.at(-1)?.args as RexMethods["movePane"]["args"]).direction,
    "below",
  );
});

test("block options require a JSON object before the creation RPC", async (t) => {
  const current = fixture(t);
  await current.execute("pane.new_block");
  const form = current.form.get();
  assert.ok(form);
  for (const options of ["null", "[]", '"text"', "42"]) {
    await assert.rejects(
      form.submit({ flavor: "example.block", options }),
      /JSON object/,
    );
  }
  assert.equal(
    current.requests.filter((request) => request.method === "createBlock")
      .length,
    0,
  );
  await form.submit({ flavor: "example.block", options: '{"count":2}' });
  assert.deepEqual(
    (current.requests.at(-1)?.args as RexMethods["createBlock"]["args"])
      .options,
    { count: 2 },
  );
});

test("aliases and remote events retain explicit targets without borrowing a local window", async (t) => {
  const current = fixture(t);
  current.views["remote/remote-session"].windows.unshift({
    id: "local-session-first",
    label: "Remote window with matching ID",
    focusedBlockId: "remote-collision",
    panes: [{ id: "remote-collision", label: "Remote", rect: [0, 0, 1, 1] }],
  });
  const event: ClientEvent = {
    type: "action",
    requestId: "remote-action",
    name: "zoom",
    args: {},
    hostId: "remote",
    sessionId: "remote-session",
    blockId: "remote-session-right",
  };
  await current.execute("zoom", {}, event);
  assert.deepEqual(current.requests.at(-1), {
    method: "zoom",
    args: {
      hostId: "remote",
      sessionId: "remote-session",
      blockId: "remote-session-right",
    },
  });
  for (const window_id of [undefined, "absent-window"]) {
    await current.execute("zoom", {
      host_id: "remote",
      session_id: "remote-session",
      window_id,
    });
    assert.deepEqual(current.requests.at(-1), {
      method: "zoom",
      args: {
        hostId: "remote",
        sessionId: "remote-session",
        blockId: "remote-session-left",
      },
    });
  }
  const localSplit = {
    host_id: "local",
    session_id: "local-session",
    block_id: "local-session-left",
    ratio: 0.4,
  };
  await assert.rejects(
    current.execute("split-right", localSplit, event),
    /another host/,
  );
  await current.execute("split-right", localSplit);
  assert.deepEqual(current.requests.at(-1), {
    method: "split",
    args: {
      hostId: "local",
      sessionId: "local-session",
      blockId: "local-session-left",
      direction: "right",
      ratio: 0.4,
    },
  });
  await current.execute("zoom");
  assert.deepEqual(current.requests.at(-1), {
    method: "zoom",
    args: {
      hostId: "local",
      sessionId: "local-session",
      blockId: "local-session-right",
    },
  });
});

test("terminal aliases select and address only the requested pane before command handoff", async (t) => {
  const current = fixture(t);
  const received: string[] = [];
  const failures: unknown[] = [];
  const local = terminalCommands.register(
    {
      hostId: "local",
      sessionId: "local-session",
      blockId: "local-session-right",
    },
    {
      available: () => true,
      focused: () => true,
      execute: async (command) => {
        received.push(`local:${command}`);
      },
      onError: (failure) => failures.push(failure),
    },
  );
  const remote = terminalCommands.register(
    {
      hostId: "remote",
      sessionId: "remote-session",
      blockId: "remote-session-right",
    },
    {
      available: () => true,
      focused: () => false,
      execute: async (command) => {
        received.push(`remote:${command}`);
      },
      onError: (failure) => failures.push(failure),
    },
  );
  t.after(() => {
    local.dispose();
    remote.dispose();
  });
  await current.execute("find", {
    host_id: "remote",
    session_id: "remote-session",
    block_id: "remote-session-right",
  });
  assert.deepEqual(received, ["remote:find"]);
  assert.deepEqual(current.selections, [
    {
      hostId: "remote",
      sessionId: "remote-session",
      windowId: "remote-session-first",
      blockId: "remote-session-right",
    },
  ]);
  assert.deepEqual(current.requests, []);
  assert.deepEqual(failures, []);
});

test("session selection reports ambiguity and missing context without issuing mutations", async (t) => {
  const current = fixture(t);
  await assert.rejects(
    current.execute("session.select", { label: "Shared" }),
    /ambiguous/,
  );
  await assert.rejects(
    current.execute("session.select", { session: "missing" }),
    /not found/,
  );
  await current.execute("session.select");
  assert.equal(current.palette.get(), "sessions");
  await current.execute("session.select", {
    session_id: "remote-session",
    window_id: "remote-session-last",
  });
  assert.deepEqual(current.selections.at(-1), {
    hostId: "remote",
    sessionId: "remote-session",
    windowId: "remote-session-last",
  });
  current.selection.set(undefined);
  current.focusedPane.set(undefined);
  await assert.rejects(current.execute("zoom"), /Select a terminal pane first/);
  assert.deepEqual(current.requests, []);
});

test("tab indexes are bounded and navigation wraps within the selected session", async (t) => {
  const current = fixture(t);
  for (const index of [0, 1.5, Infinity, "two", 3, -3])
    await assert.rejects(
      current.execute("client.tab.goto", { index }),
      /index/,
    );
  assert.equal(current.selections.length, 0);
  await current.execute("client.tab.goto", { index: -1 });
  assert.equal(current.selections.at(-1)?.windowId, "local-session-last");
  await current.execute("next-tab");
  assert.equal(current.selections.at(-1)?.windowId, "local-session-first");
  await current.execute("previous-tab");
  assert.equal(current.selections.at(-1)?.windowId, "local-session-last");
  assert.deepEqual(current.requests, []);
});

test("destructive session, tab and pane actions wait for explicit confirmation", async (t) => {
  const current = fixture(t);
  for (const [action, method] of [
    ["session.close", "destroySession"],
    ["close-window", "closeWindow"],
    ["close-pane", "closePane"],
  ] as const) {
    current.dialogs.close(current.dialogs.snapshot.confirmation);
    const before = current.requests.length;
    const result = await current.execute(action);
    assert.deepEqual(result, { status: "confirmation_required" });
    assert.equal(current.requests.length, before);
    const confirmation = current.confirmation.get();
    assert.ok(confirmation);
    await confirmation.submit();
    assert.equal(current.requests.length, before + 1);
    assert.equal(current.requests.at(-1)?.method, method);
  }
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function floatingPanes(current: ReturnType<typeof fixture>) {
  const view = current.views["local/local-session"];
  view.windows[0].panes = ["one", "two", "three"].map((id) => ({
    id,
    label: id,
    rect: [0, 0, 1, 1],
    layerKind: "floating",
    layerId: `layer-${id}`,
  }));
}

test("bulk minimize awaits its captured session reconciliation", async (t) => {
  const current = fixture(t);
  floatingPanes(current);
  const read = gate();
  let inspecting = false,
    completed = false;
  const mutate = current.workspace.mutateSession;
  current.workspace.mutateSession = async (plan, operation) => {
    const result = await mutate(plan, operation);
    inspecting = true;
    await read.promise;
    return result;
  };
  const pending = current.execute("pane.minimize_all_floating").then(() => {
    completed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(inspecting, true);
    assert.equal(completed, false);
    assert.deepEqual(current.inspections, [
      { hostId: "local", sessionId: "local-session", selectActive: undefined },
    ]);
    assert.equal(current.requests.length, 3);
  } finally {
    read.open();
    await pending;
  }
});

for (const inspectionFails of [false, true]) {
  test(`bulk minimize reconciles partial success without replay when inspection fails=${inspectionFails}`, async (t) => {
    const current = fixture(t);
    floatingPanes(current);
    const failure = Object.assign(new Error("Second minimize denied"), {
      code: "DENIED",
      method: "session.minimize_layer",
    });
    let writes = 0,
      inspected = false;
    current.responders.layoutAction = async () => {
      if (++writes === 2) throw failure;
    };
    const mutate = current.workspace.mutateSession;
    current.workspace.mutateSession = async (plan, operation) => {
      const result = await mutate(plan, operation);
      inspected = true;
      if (inspectionFails) throw new Error("Inspection unavailable");
      return result;
    };
    await assert.rejects(
      current.execute("pane.minimize_all_floating"),
      (error) => {
        assert.ok(error instanceof WorkspaceReconciliationError);
        assert.equal(error.cause, failure);
        assert.equal(error.code, "DENIED");
        assert.match(error.message, /minimized.*remaining|remaining.*minimiz/i);
        if (inspectionFails)
          assert.match(error.message, /Inspection unavailable/);
        return true;
      },
    );
    assert.equal(inspected, true);
    assert.equal(writes, 2);
    await current.workspace.refresh();
    assert.equal(
      writes,
      2,
      "Recovery must read state without replaying either minimize",
    );
  });
}

test("bulk minimize preserves its first write failure and refuses replacement endpoints between writes", async (t) => {
  const current = fixture(t);
  floatingPanes(current);
  const failure = new Error("First minimize denied");
  current.responders.layoutAction = async () => {
    throw failure;
  };
  await assert.rejects(
    current.execute("pane.minimize_all_floating"),
    (error) => error === failure,
  );
  assert.deepEqual(current.inspections, []);
  const started = gate(),
    release = gate();
  current.responders.layoutAction = async () => {
    started.open();
    await release.promise;
  };
  const pending = current.execute("pane.minimize_all_floating");
  const rejected = assert.rejects(pending, /host configuration changed/i);
  await started.promise;
  current.settings.set({
    ...current.settings.get(),
    hosts: current.settings
      .get()
      .hosts.map((host) =>
        host.id === "local"
          ? { ...host, endpoint: "https://replacement.test" }
          : host,
      ),
  });
  release.open();
  await rejected;
  assert.equal(
    current.requests.length,
    2,
    "Only the first attempted write in each run may reach a server",
  );
});

for (const [action, method] of [
  ["session.close", "destroySession"],
  ["client.tab.close", "closeWindow"],
  ["pane.close", "closePane"],
] as const) {
  test(`${action} waits for its write and reconciliation when confirmation is disabled`, async (t) => {
    const current = fixture(t);
    current.settings.set({
      ...current.initial,
      confirmClose: false,
      autobalanceSplits: false,
    });
    const wrote = gate(),
      releaseWrite = gate(),
      refreshing = gate(),
      releaseRefresh = gate();
    current.responders[method] = async () => {
      wrote.open();
      await releaseWrite.promise;
    };
    const mutationHosts: string[] = [];
    current.workspace.mutateHostAndRefresh = async (hostId, operation) => {
      mutationHosts.push(hostId);
      const result = await operation();
      refreshing.open();
      await releaseRefresh.promise;
      return result;
    };
    let completed = false;
    const closing = current.execute(action).then(() => {
      completed = true;
    });
    await wrote.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedBeforeWrite = completed;
    current.selection.set({
      hostId: "remote",
      sessionId: "remote-session",
      windowId: "remote-session-first",
    });
    releaseWrite.open();
    await refreshing.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedBeforeRefresh = completed;
    releaseRefresh.open();
    await closing;
    assert.equal(
      completedBeforeWrite,
      false,
      "a pending close must not be acknowledged",
    );
    assert.equal(
      completedBeforeRefresh,
      false,
      "a successful write still awaits target reconciliation",
    );
    assert.deepEqual(mutationHosts, ["local"]);
    assert.equal(current.requests[0].method, method);
    assert.equal(Reflect.get(current.requests[0].args, "hostId"), "local");
    assert.equal(current.confirmation.get(), undefined);
  });
}

for (const stage of ["write", "refresh", "unavailable host"] as const) {
  test(`immediate close preserves the original ${stage} rejection`, async (t) => {
    const current = fixture(t);
    current.settings.set({ ...current.initial, confirmClose: false });
    const cause = Object.assign(new Error(`${stage} denied`), {
      code: "DENIED",
      method: stage,
    });
    const failure =
      stage === "refresh" ? new WorkspaceReconciliationError(cause) : cause;
    current.responders.closeWindow = async () => {
      if (stage === "write") throw failure;
    };
    current.workspace.mutateHostAndRefresh = async (_hostId, operation) => {
      if (stage === "unavailable host") throw failure;
      const result = await operation();
      if (stage === "refresh") throw failure;
      return result;
    };
    const result = await current.execute("client.tab.close").then(
      () => undefined,
      (error) => error,
    );
    assert.equal(result, failure);
    assert.equal(current.requests.length, stage === "unavailable host" ? 0 : 1);
  });
}

test("new-tab fallback prompts for a session on the requested host before creating anything", async (t) => {
  const current = fixture(t);
  current.selection.set(undefined);
  current.focusedPane.set(undefined);
  await current.execute("new-window", { host_id: "remote" });
  const form = current.form.get();
  assert.equal(form?.title, "New session");
  assert.deepEqual(current.requests, []);
  assert.ok(form);
  await form.submit({ label: "New workspace", cwd: "/project" });
  assert.deepEqual(current.requests, [
    {
      method: "createSession",
      args: { hostId: "remote", label: "New workspace", cwd: "/project" },
    },
  ]);
  assert.deepEqual(current.inspections, [
    { hostId: "remote", sessionId: "created", selectActive: true },
  ]);
  assert.equal(current.selections.at(-1)?.hostId, "remote");
  assert.equal(current.selections.at(-1)?.sessionId, "created");
});

test("a deferred tab number uses current windows in its original session after another host is selected", async (t) => {
  const current = fixture(t);
  await current.execute("client.tab.goto");
  const form = current.form.get();
  assert.ok(form);
  const view = current.views["local/local-session"];
  current.views["local/local-session"] = {
    ...view,
    windows: [
      { id: "new-first", label: "New tab", panes: [], focusedBlockId: "" },
      ...view.windows,
    ],
  };
  current.selection.set({
    hostId: "remote",
    sessionId: "remote-session",
    windowId: "remote-session-first",
  });
  await form.submit({ index: "1" });
  assert.deepEqual(current.selections.at(-1), {
    hostId: "local",
    sessionId: "local-session",
    windowId: "new-first",
  });
  assert.deepEqual(current.requests, []);
});

test("a deferred tab move resolves its captured window against the current tab order", async (t) => {
  const current = fixture(t);
  await current.execute("client.tab.move");
  const form = current.form.get();
  assert.ok(form);
  const view = current.views["local/local-session"];
  current.views["local/local-session"] = {
    ...view,
    windows: [
      { id: "new-first", label: "New tab", panes: [], focusedBlockId: "" },
      ...view.windows,
    ],
  };
  current.selection.set({
    hostId: "remote",
    sessionId: "remote-session",
    windowId: "remote-session-first",
  });
  current.responders.reorderWindow = async () => {};
  await form.submit({ index: "3" });
  assert.deepEqual(current.requests, [
    {
      method: "reorderWindow",
      args: {
        hostId: "local",
        sessionId: "local-session",
        windowId: "local-session-first",
        beforeWindowId: undefined,
      },
    },
  ]);
});

test("a removed deferred tab target cannot borrow its session's active window", async (t) => {
  const current = fixture(t);
  current.responders.reorderWindow = async () => {};
  await current.execute("client.tab.move");
  const form = current.form.get();
  assert.ok(form);
  const view = current.views["local/local-session"];
  current.views["local/local-session"] = {
    ...view,
    activeWindowId: view.windows[1].id,
    windows: view.windows.slice(1),
  };
  await assert.rejects(
    form.submit({ index: "1" }),
    /target tab.*no longer available/i,
  );
  assert.deepEqual(current.requests, []);
});

test("a deferred form refuses an endpoint replacement even when the new server has colliding target IDs", async (t) => {
  const current = fixture(t);
  current.responders.reorderWindow = async () => {};
  await current.execute("client.tab.move");
  const form = current.form.get();
  assert.ok(form);
  const settings = current.settings.get();
  current.settings.set({
    ...settings,
    hosts: settings.hosts.map((host) =>
      host.id === "local"
        ? { ...host, endpoint: "https://replacement.example" }
        : host,
    ),
  });
  await assert.rejects(
    form.submit({ index: "2" }),
    /host configuration changed|selected host changed/i,
  );
  assert.deepEqual(current.requests, []);
});

for (const [action, values] of [
  ["session.new", { label: "New" }],
  ["session.rename", { label: "Renamed" }],
  ["client.tab.rename", { label: "Renamed" }],
  ["pane.rename", { label: "Renamed" }],
  ["pane.send_key", { key: "enter", mods: "" }],
  ["pane.new_block", { flavor: "example.block", options: "{}" }],
  ["pane.move", { anchor: "local-session-left", direction: "right" }],
  ["pane.move_to_tab", { windowId: "local-session-last" }],
  ["client.mode.enter", { name: "main" }],
] satisfies [string, Record<string, string>][]) {
  test(`${action} form cannot write to a replacement endpoint with the same target IDs`, async (t) => {
    const current = fixture(t);
    await current.execute(action);
    const form = current.form.get();
    assert.ok(form);
    const before = current.requests.length;
    const settings = current.settings.get();
    current.settings.set({
      ...settings,
      hosts: settings.hosts.map((host) =>
        host.id === "local"
          ? { ...host, endpoint: "https://replacement.example" }
          : host,
      ),
    });
    await assert.rejects(form.submit(values), /host configuration changed/i);
    assert.equal(
      current.requests.length,
      before,
      "rejection must happen before any mutation reaches the new endpoint",
    );
  });
}

for (const action of [
  "session.close",
  "client.tab.close",
  "pane.close",
  "pane.reset_terminal",
  "client.host.remove",
]) {
  test(`${action} confirmation cannot mutate a same-ID replacement server`, async (t) => {
    const current = fixture(t);
    const targetHost = action === "client.host.remove" ? "remote" : "local";
    await current.execute(action, { host_id: targetHost });
    const confirmation = current.confirmation.get();
    assert.ok(confirmation);
    assert.deepEqual(current.requests, []);
    const settings = current.settings.get();
    current.settings.set({
      ...settings,
      hosts: settings.hosts.map((host) =>
        host.id === targetHost
          ? { ...host, endpoint: "https://replacement.example" }
          : host,
      ),
    });
    await assert.rejects(confirmation.submit(), /host configuration changed/i);
    assert.deepEqual(current.requests, []);
  });
}

test("deferred host removal preserves settings and hosts added after confirmation opened", async (t) => {
  const current = fixture(t);
  await current.execute("client.host.remove", { host_id: "remote" });
  const confirmation = current.confirmation.get();
  assert.ok(confirmation);
  const latest = {
    ...current.settings.get(),
    fontSize: 23,
    hosts: [
      ...current.settings.get().hosts,
      { id: "new-host", label: "New host", endpoint: "https://new.example" },
    ],
  };
  current.settings.set(latest);
  await confirmation.submit();
  assert.equal(current.settings.get().fontSize, 23);
  assert.deepEqual(
    current.settings.get().hosts.map((host) => host.id),
    ["local", "new-host"],
  );
});

test("a source-bound deferred pane choice finds new panes without adopting the newly displayed host", async (t) => {
  const current = fixture(t);
  const source: ClientEvent = {
    type: "action",
    requestId: "focus-form",
    hostId: "local",
    sessionId: "local-session",
    name: "pane.focus",
    args: {},
  };
  await current.execute("pane.focus", {}, source);
  const form = current.form.get();
  assert.ok(form);
  const view = current.views["local/local-session"];
  current.views["local/local-session"] = {
    ...view,
    windows: view.windows.map((window, index) =>
      index
        ? window
        : {
            ...window,
            focusedBlockId: "fresh-pane",
            panes: [
              { id: "fresh-pane", label: "Fresh pane", rect: [0, 0, 1, 1] },
            ],
          },
    ),
  };
  current.selection.set({
    hostId: "remote",
    sessionId: "remote-session",
    windowId: "remote-session-first",
  });
  await form.submit({ block: "fresh-pane" });
  assert.equal(
    current.dispatches.at(-1)?.event,
    source,
    "deferred dispatch retains the original source authority",
  );
  assert.deepEqual(current.selections.at(-1), {
    hostId: "local",
    sessionId: "local-session",
    windowId: "local-session-first",
    blockId: "fresh-pane",
  });
});

test("a deferred tab move retains its tab even when the originating pane has moved elsewhere", async (t) => {
  const current = fixture(t);
  current.responders.reorderWindow = async () => {};
  const source: ClientEvent = {
    type: "action",
    requestId: "tab-form",
    hostId: "local",
    sessionId: "local-session",
    blockId: "local-session-right",
    name: "client.tab.move",
    args: {},
  };
  await current.execute(source.name, source.args, source);
  const form = current.form.get();
  assert.ok(form);
  const view = current.views["local/local-session"];
  const moved = view.windows[0].panes[1];
  current.views["local/local-session"] = {
    ...view,
    windows: [
      {
        ...view.windows[0],
        focusedBlockId: view.windows[0].panes[0].id,
        panes: view.windows[0].panes.slice(0, 1),
      },
      { ...view.windows[1], panes: [...view.windows[1].panes, moved] },
    ],
  };
  await form.submit({ index: "2" });
  assert.deepEqual(current.requests, [
    {
      method: "reorderWindow",
      args: {
        hostId: "local",
        sessionId: "local-session",
        windowId: "local-session-first",
        beforeWindowId: undefined,
      },
    },
  ]);
  assert.equal(current.dispatches.at(-1)?.event, source);
});

test("a deferred resize cannot resize another pane after its original target disappears", async (t) => {
  const current = fixture(t);
  const view = current.views["local/local-session"];
  const original = view.windows[0];
  original.dividers = [
    {
      beforeBlockId: original.panes[0].id,
      afterBlockId: original.panes[1].id,
      direction: "horizontal",
      ratio: 0.5,
      rect: [0, 0, 1, 1],
    },
  ];
  current.responders.resizeDivider = async () => {};
  await current.execute("pane.resize");
  const form = current.form.get();
  assert.ok(form);
  current.views["local/local-session"] = {
    ...view,
    windows: [
      {
        ...original,
        focusedBlockId: original.panes[0].id,
        panes: original.panes.slice(0, 1),
      },
      ...view.windows.slice(1),
    ],
  };
  await assert.rejects(
    form.submit({ border: "1", ratio: "40" }),
    /target pane.*no longer available/i,
  );
  assert.deepEqual(current.requests, []);
});

test("a deferred pane resize resolves current dividers and preserves the actual RPC rejection", async (t) => {
  const current = fixture(t);
  const view = current.views["local/local-session"];
  const divider = {
    beforeBlockId: "local-session-left",
    afterBlockId: "local-session-right",
    direction: "horizontal" as const,
    ratio: 0.5,
    rect: [0, 0, 1, 1] as [number, number, number, number],
  };
  view.windows[0].dividers = [divider];
  await current.execute("pane.resize");
  const form = current.form.get();
  assert.ok(form);
  current.views["local/local-session"] = {
    ...view,
    windows: view.windows.map((window, index) =>
      index
        ? window
        : {
            ...window,
            dividers: [
              {
                ...divider,
                beforeBlockId: "fresh-before",
                afterBlockId: "fresh-after",
              },
            ],
          },
    ),
  };
  current.selection.set({
    hostId: "remote",
    sessionId: "remote-session",
    windowId: "remote-session-first",
  });
  const original = Object.assign(new Error("Resize denied"), {
    code: "DENIED",
    method: "session.resize_divider",
  });
  current.responders.resizeDivider = async () => {
    throw original;
  };
  await assert.rejects(
    form.submit({ border: "1", ratio: "40" }),
    (error) => error === original,
  );
  assert.deepEqual(current.requests, [
    {
      method: "resizeDivider",
      args: {
        hostId: "local",
        sessionId: "local-session",
        ...divider,
        beforeBlockId: "fresh-before",
        afterBlockId: "fresh-after",
        ratio: 0.4,
      },
    },
  ]);
});

test("only source-bound paste uses queued terminal completion and conflicting sources never reach an executor", async (t) => {
  const current = fixture(t);
  const received: {
    hostId: string;
    command: string;
    completion: TerminalCommandCompletion;
  }[] = [];
  const registrations = ["local", "remote"].map((hostId) =>
    terminalCommands.register(
      {
        hostId,
        sessionId: `${hostId}-session`,
        blockId: `${hostId}-session-right`,
      },
      {
        available: () => true,
        focused: () => hostId === "local",
        execute: async (command, _signal, completion) => {
          assert.ok(typeof command === "string");
          received.push({ hostId, command, completion });
        },
        onError: () => {},
      },
    ),
  );
  t.after(() =>
    registrations.forEach((registration) => registration.dispose()),
  );
  const source: ClientEvent = {
    type: "action",
    requestId: "server-paste",
    name: "client.paste",
    args: {},
    hostId: "remote",
    sessionId: "remote-session",
    blockId: "remote-session-right",
  };
  // The legacy spelling must receive the same policy as the canonical action.
  await current.execute("paste", {}, source);
  const localTarget = {
    host_id: "local",
    session_id: "local-session",
    block_id: "local-session-right",
  };
  await current.execute("client.paste", localTarget);
  await current.execute("client.copy", {}, { ...source, name: "client.copy" });
  await assert.rejects(
    current.execute("client.paste", localTarget, source),
    /another host/,
  );
  assert.deepEqual(received, [
    { hostId: "remote", command: "paste", completion: "queued" },
    { hostId: "local", command: "paste", completion: "settled" },
    { hostId: "remote", command: "copy", completion: "settled" },
  ]);
  assert.deepEqual(
    current.requests,
    [],
    "Rejected source overrides cannot fall through to a bridge RPC",
  );
});

test("settings actions preserve unrelated state and unknown commands require an advertised server action", async (t) => {
  const current = fixture(t);
  const initial = structuredClone(current.initial);
  await current.execute("font-increase");
  assert.deepEqual(current.saved.at(-1), {
    ...initial,
    fontSize: initial.fontSize + 1,
  });
  await current.execute("toggle-sidebar");
  assert.deepEqual(current.saved.at(-1), {
    ...initial,
    fontSize: initial.fontSize + 1,
    sidebarCollapsed: true,
  });
  assert.deepEqual(
    current.initial,
    initial,
    "The settings object supplied by the workspace stays immutable",
  );
  await current.execute("settings", { tab: "notifications" });
  assert.equal(current.settingsTab.get(), "notifications");
  await assert.rejects(
    current.execute("unknown.command"),
    /not available on this client/,
  );
  current.keymaps.local = {
    actions: [
      { name: "server.custom", kind: "server" },
      { name: "client.future", kind: "client" },
    ],
    bindings: [],
    modes: [],
    warnings: [],
  };
  await assert.rejects(
    current.execute("client.future"),
    /not available on this client/,
  );
  assert.deepEqual(current.requests, []);
  await current.execute("server.custom", { value: 42 });
  assert.deepEqual(current.requests, [
    {
      method: "invokeAction",
      args: {
        hostId: "local",
        sessionId: "local-session",
        blockId: "local-session-right",
        action: "server.custom",
        args: { value: 42 },
      },
    },
  ]);
});

test("a held theme import preserves external settings and themes while retaining its intended appearance", async (t) => {
  const current = fixture(t);
  current.settings.set({ ...current.initial, appearance: "dark" });
  const entered = gate(),
    release = gate();
  const colors = { background: "#112233", foreground: "#ddeeff" };
  current.responders.importTheme = async () => {
    entered.open();
    await release.promise;
    return colors;
  };
  const importing = current.execute("client.theme.import");
  await entered.promise;
  const externallySaved = {
    ...current.settings.get(),
    fontSize: 21,
    sidebarWidth: 417,
    appearance: "light" as const,
    themeLibrary: [
      {
        id: "external",
        name: "Imported dark",
        colors: { background: "#010203" },
      },
    ],
    lightThemeId: "external",
  };
  current.settings.set(externallySaved);
  release.open();
  await importing;
  const saved = current.settings.get();
  assert.equal(saved.fontSize, 21);
  assert.equal(saved.sidebarWidth, 417);
  assert.equal(saved.appearance, "light");
  assert.equal(saved.lightThemeId, "external");
  assert.deepEqual(saved.themeLibrary[0], externallySaved.themeLibrary[0]);
  const imported = saved.themeLibrary.find((theme) => theme.id !== "external");
  assert.ok(imported);
  assert.equal(imported.name, "Imported dark 2");
  assert.deepEqual(imported.colors, colors);
  assert.equal(saved.darkThemeId, imported.id);
});

test("a held theme import validates the latest library capacity before saving", async (t) => {
  const current = fixture(t);
  current.settings.set({ ...current.initial, appearance: "dark" });
  const entered = gate(),
    release = gate();
  current.responders.importTheme = async () => {
    entered.open();
    await release.promise;
    return { background: "#112233" };
  };
  const importing = current.execute("client.theme.import");
  const result = importing.then(
    () => undefined,
    (failure) => failure,
  );
  await entered.promise;
  const latest = {
    ...current.settings.get(),
    themeLibrary: Array.from({ length: 64 }, (_, i) => ({
      id: `external-${i}`,
      name: `External ${i}`,
      colors: { background: "#010203" },
    })),
  };
  current.settings.set(latest);
  release.open();
  const failure = await result;
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /64 themes/);
  assert.equal(current.settings.get(), latest);
  assert.deepEqual(current.saved, []);
});

test("theme import preserves settings persistence rejection identity and cancellation performs no write", async (t) => {
  const current = fixture(t);
  current.settings.set({ ...current.initial, appearance: "dark" });
  const original = Object.assign(new Error("Theme persistence denied"), {
    code: "DENIED",
    method: "saveSettings",
  });
  let writes = 0;
  current.workspace.saveSettings = async () => {
    writes++;
    throw original;
  };
  current.responders.importTheme = async () => ({ background: "#112233" });
  await assert.rejects(
    current.execute("client.theme.import"),
    (failure) => failure === original,
  );
  assert.equal(writes, 1);
  current.responders.importTheme = async () => null;
  current.workspace.getSettings = () => undefined;
  await current.execute("client.theme.import");
  assert.equal(writes, 1);
});
