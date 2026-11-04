import type { WorkspaceOperations } from "../src/core/workspaceOperations";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Dispatch, SetStateAction } from "react";
import type { SettingsTab } from "../src/components/preferences/types.js";
import { createWorkspaceActions } from "../src/workspace/actions/createWorkspaceActions.js";
import type {
  Confirmation,
  Form,
  WorkspaceActionOptions,
} from "../src/workspace/actions/context.js";
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
  const palette = state<"all" | "sessions" | undefined>(undefined);
  const settingsTab = state<SettingsTab | undefined>(undefined);
  const form = state<Form | undefined>(undefined);
  const confirmation = state<Confirmation | undefined>(undefined);
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
    run: async (_hostId, operation) => operation(),
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
    setPalette: palette.set,
    setSettingsTab: settingsTab.set,
    setDiagnostics: discard,
    setPairing: discard,
    setEditingHost: discard,
    setConfirmation: confirmation.set,
    setForm: form.set,
    setCollapsedSessions: discard,
    setActivityOnly: discard,
    setActivityOpen: discard,
    setActivityGroup: discard,
    setDirectoryBrowser: discard,
    onError: discard,
  };
  return {
    initial,
    settings,
    selection,
    focusedPane,
    palette,
    settingsTab,
    form,
    confirmation,
    views,
    keymaps,
    requests,
    selections,
    saved,
    inspections,
    timeline,
    responders,
    execute: (
      name: string,
      args?: Record<string, unknown>,
      event?: ClientEvent,
    ) => createWorkspaceActions(options)(name, args, event),
  };
}

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
    current.confirmation.set(undefined);
    const before = current.requests.length;
    await current.execute(action);
    assert.equal(current.requests.length, before);
    const confirmation = current.confirmation.get();
    assert.ok(confirmation);
    await confirmation.submit();
    assert.equal(current.requests.length, before + 1);
    assert.equal(current.requests.at(-1)?.method, method);
  }
});

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
