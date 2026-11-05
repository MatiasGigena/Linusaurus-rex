import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { pickDirectoryPath } from "../src/workspace/actions/directoryActions";
import {
  createHostSaver,
  HostSaveIncompleteError,
} from "../src/workspace/actions/hostActions";
import { createServerActions } from "../src/workspace/actions/serverActions";
import { terminalCommands } from "../src/terminal/commands";
import { WorkspaceDialogController } from "../src/workspace/dialogs";
import {
  DEFAULT_SETTINGS,
  type RexBridge,
  type RexMethods,
  type Settings,
} from "../src/shared/types";
import type { WorkspaceOperations } from "../src/core/workspaceOperations";

function installBridge(
  t: TestContext,
  responders: Partial<{
    [K in keyof RexMethods]: (
      args: RexMethods[K]["args"],
    ) => Promise<RexMethods[K]["result"]>;
  }>,
) {
  const request: RexBridge["request"] = async (method, args) => {
    const respond = responders[method];
    if (!respond) throw new Error(`Unexpected request: ${method}`);
    return respond(args);
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { rex: { request } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });
}
function deferred() {
  let complete!: () => void;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
}
function serverSettings(hostId: string) {
  return () => ({
    ...DEFAULT_SETTINGS,
    hosts: [{ id: hostId, label: hostId, endpoint: `unix:///${hostId}.sock` }],
  });
}
const target = { hostId: "remote", sessionId: "session", blockId: "pane" };
const unexpectedMutation: WorkspaceOperations["mutateSession"] = async () => {
  throw new Error("Unexpected session mutation");
};
function installPasteOwner(t: TestContext) {
  const registration = terminalCommands.register(target, {
    available: () => true,
    focused: () => false,
    onError: () => {},
    execute: async (request, _signal, completion) => {
      assert.ok(typeof request !== "string");
      assert.equal(request.command, "paste");
      assert.equal(completion, "settled");
      await window.rex.request("paste", { ...target, text: request.text });
    },
  });
  t.after(() => registration.dispose());
}

test("directory insertion quotes shell paths and merges history into settings current at completion", async (t) => {
  const paste = deferred();
  let pasted: RexMethods["paste"]["args"] | undefined;
  installBridge(t, {
    paste: async (args) => {
      pasted = args;
      await paste.promise;
    },
  });
  installPasteOwner(t);
  let settings = structuredClone(DEFAULT_SETTINGS);
  const path = "/work/Pat's project";
  const choosing = pickDirectoryPath(
    {
      getSettings: () => settings,
      saveSettings: async (next) => {
        settings = next;
        return next;
      },
      mutateSession: unexpectedMutation,
    },
    { mode: "insert", ref: target },
    path,
  );
  assert.deepEqual(pasted, { ...target, text: "'/work/Pat'\\''s project'" });
  settings = {
    ...settings,
    sidebarWidth: 412,
    recentPaths: {
      remote: [
        "/recent",
        path,
        ...Array.from({ length: 25 }, (_, i) => `/old-${i}`),
      ],
      local: ["/local"],
    },
  };
  paste.complete();
  await choosing;
  assert.equal(
    settings.sidebarWidth,
    412,
    "a completed paste must preserve intervening preferences",
  );
  assert.equal(settings.recentPaths.remote.length, 20);
  assert.deepEqual(settings.recentPaths.remote.slice(0, 3), [
    path,
    "/recent",
    "/old-0",
  ]);
  assert.deepEqual(settings.recentPaths.local, ["/local"]);
});

test("failed directory insertion preserves the RPC error and does not remember an unused path", async (t) => {
  const failure = new Error("Permission denied by remote server");
  installBridge(t, {
    paste: async () => {
      throw failure;
    },
  });
  installPasteOwner(t);
  let saved = false;
  await assert.rejects(
    pickDirectoryPath(
      {
        getSettings: () => DEFAULT_SETTINGS,
        saveSettings: async (next) => {
          saved = true;
          return next;
        },
        mutateSession: unexpectedMutation,
      },
      { mode: "insert", ref: target },
      "/private",
    ),
    (error) => error === failure,
  );
  assert.equal(saved, false);
});

test("host saving configures the host before credentials and reconnects only after storage succeeds", async (t) => {
  const host = { id: "remote", label: "Remote", endpoint: "wss://remote.test" };
  const credentials = { token: "token", password: "secret" };
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const timeline: string[] = [];
  let fail = true;
  let expectedHost = host;
  const failure = new Error("Keyring unavailable");
  installBridge(t, {
    setCredentials: async (args) => {
      assert.deepEqual(args, { hostId: "remote", ...credentials });
      assert.deepEqual(
        settings.hosts.find((item) => item.id === host.id),
        expectedHost,
      );
      timeline.push("credentials");
      if (fail) throw failure;
    },
  });
  const save = createHostSaver(
    {
      getSettings: () => settings,
      saveSettings: async (next) => {
        timeline.push("settings");
        settings = next;
        return next;
      },
      refresh: async () => {
        timeline.push("refresh");
      },
    },
    (hostId) => {
      assert.equal(hostId, "remote");
      timeline.push("reconnect");
    },
  );
  await assert.rejects(
    save(host, credentials),
    (error) =>
      error instanceof HostSaveIncompleteError && error.cause === failure,
  );
  assert.deepEqual(timeline, ["settings", "credentials"]);
  fail = false;
  expectedHost = { ...host, label: "Renamed remote" };
  await save(expectedHost, credentials);
  assert.deepEqual(timeline, [
    "settings",
    "credentials",
    "settings",
    "credentials",
    "reconnect",
    "refresh",
  ]);
  assert.equal(settings.hosts.filter((item) => item.id === "remote").length, 1);
});

test("server changes remain deferred until confirmation and retain the confirmed host while awaiting the response", async (t) => {
  const response = deferred();
  const requests: RexMethods["serverAction"]["args"][] = [];
  installBridge(t, {
    serverAction: async (args) => {
      requests.push(args);
      await response.promise;
      return { applied: true };
    },
  });
  const dialogs = new WorkspaceDialogController();
  const origin = dialogs.open({ kind: "diagnostics", hostId: "selected-host" });
  const selected = createServerActions(
    "selected-host",
    dialogs,
    serverSettings("selected-host"),
    origin,
  );
  selected("tailscale.enable", { hostname: "workstation" });
  assert.deepEqual(
    requests,
    [],
    "opening a confirmation must not mutate remote access",
  );
  assert.equal(Boolean(dialogs.snapshot.primary), false);
  const confirmed = dialogs.snapshot.confirmation?.dialog.confirmation;
  assert.ok(confirmed);
  assert.equal(confirmed.label, "Apply change");
  // Creating commands for another selection must not retarget an existing confirmation.
  createServerActions(
    "different-host",
    dialogs,
    serverSettings("different-host"),
  );
  const sending = confirmed.submit();
  assert.deepEqual(requests, [
    {
      hostId: "selected-host",
      action: "tailscale.enable",
      args: { allow_tailnet_members: false, hostname: "workstation" },
    },
  ]);
  assert.equal(
    Boolean(dialogs.snapshot.primary),
    false,
    "a response report must wait for the remote operation",
  );
  response.complete();
  await sending;
  const report = dialogs.snapshot.primary?.dialog;
  assert.ok(report?.kind === "report");
  assert.deepEqual(JSON.parse(report.body), { applied: true });
});

test("server rename waits for form submission and confirmation errors preserve the RPC rejection without a success report", async (t) => {
  const requests: RexMethods["serverAction"]["args"][] = [];
  const failure = new Error("Server denied remote access change");
  installBridge(t, {
    serverAction: async (args) => {
      requests.push(args);
      if (args.action === "tailscale.disable") throw failure;
      return { renamed: true };
    },
  });
  const dialogs = new WorkspaceDialogController();
  const origin = dialogs.open({ kind: "diagnostics", hostId: "rename-host" });
  const invoke = createServerActions(
    "rename-host",
    dialogs,
    serverSettings("rename-host"),
    origin,
  );
  invoke("tailscale.rename");
  assert.deepEqual(requests, []);
  const form = dialogs.snapshot.form?.dialog.form;
  assert.ok(form);
  assert.equal(form.fields[0].name, "hostname");
  await form.submit({ hostname: "new-hostname" });
  dialogs.close(dialogs.snapshot.form);
  assert.deepEqual(requests, [
    {
      hostId: "rename-host",
      action: "tailscale.rename",
      args: { hostname: "new-hostname" },
    },
  ]);
  createServerActions(
    "rename-host",
    dialogs,
    serverSettings("rename-host"),
  )("tailscale.disable");
  assert.equal(requests.length, 1);
  const confirmation = dialogs.snapshot.confirmation?.dialog.confirmation;
  assert.ok(confirmation);
  await assert.rejects(confirmation.submit(), (error) => error === failure);
  assert.equal(dialogs.snapshot.primary, undefined);
});

for (const disposition of ["closed", "replaced"] as const) {
  test(`a ${disposition} server confirmation cannot publish a late response report`, async (t) => {
    const response = deferred();
    const requests: RexMethods["serverAction"]["args"][] = [];
    installBridge(t, {
      serverAction: async (args) => {
        requests.push(args);
        await response.promise;
        return { applied: true };
      },
    });
    const dialogs = new WorkspaceDialogController();
    createServerActions(
      "confirmed-host",
      dialogs,
      serverSettings("confirmed-host"),
    )("tailscale.disable");
    const owner = dialogs.snapshot.confirmation;
    assert.ok(owner);
    const sending = owner.dialog.confirmation.submit();
    const replacement =
      disposition === "replaced"
        ? dialogs.open({
            kind: "confirmation",
            confirmation: {
              title: "A newer change",
              description: "Preserve this confirmation",
              submit: async () => {},
            },
          })
        : undefined;
    if (disposition === "closed") dialogs.close(owner);
    response.complete();
    await sending;
    await owner.dialog.confirmation.submit();
    assert.equal(Boolean(dialogs.snapshot.primary), false);
    assert.equal(dialogs.snapshot.confirmation, replacement);
    assert.deepEqual(requests, [
      { hostId: "confirmed-host", action: "tailscale.disable" },
    ]);
  });
}

test("a pending server response cannot replace a newly opened primary dialog", async (t) => {
  const response = deferred();
  installBridge(t, {
    serverAction: async () => {
      await response.promise;
      return { applied: true };
    },
  });
  const dialogs = new WorkspaceDialogController();
  const origin = dialogs.open({
    kind: "diagnostics",
    hostId: "confirmed-host",
  });
  createServerActions(
    "confirmed-host",
    dialogs,
    serverSettings("confirmed-host"),
    origin,
  )("tailscale.disable");
  const confirmation = dialogs.snapshot.confirmation;
  assert.ok(confirmation);
  const sending = confirmation.dialog.confirmation.submit();
  const replacement = dialogs.open({ kind: "settings", tab: "appearance" });
  response.complete();
  await sending;
  assert.equal(dialogs.snapshot.primary, replacement);
  assert.equal(dialogs.snapshot.confirmation, confirmation);
});

test("stale originating diagnostics cannot open server-action forms or confirmations", async (t) => {
  const requests: string[] = [];
  installBridge(t, {
    serverAction: async () => {
      requests.push("serverAction");
      return {};
    },
  });
  const dialogs = new WorkspaceDialogController();
  const origin = dialogs.open({ kind: "diagnostics", hostId: "old-host" });
  const stale = createServerActions(
    "old-host",
    dialogs,
    serverSettings("old-host"),
    origin,
  );
  const replacement = dialogs.open({ kind: "diagnostics", hostId: "new-host" });
  stale("tailscale.rename");
  stale("tailscale.enable", { hostname: "old-hostname" });
  assert.equal(dialogs.snapshot.primary, replacement);
  assert.equal(Boolean(dialogs.snapshot.form), false);
  assert.equal(Boolean(dialogs.snapshot.confirmation), false);
  assert.deepEqual(requests, []);
});

test("an empty successful server result produces a string report body", async (t) => {
  installBridge(t, { serverAction: async () => undefined });
  const dialogs = new WorkspaceDialogController();
  createServerActions(
    "host",
    dialogs,
    serverSettings("host"),
  )("tailscale.disable");
  const confirmation = dialogs.snapshot.confirmation;
  assert.ok(confirmation);
  await confirmation.dialog.confirmation.submit();
  const report = dialogs.snapshot.primary?.dialog;
  assert.ok(report?.kind === "report");
  assert.equal(report.body, "null");
});
