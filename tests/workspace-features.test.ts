import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { pickDirectoryPath } from "../src/workspace/actions/directoryActions";
import { createHostSaver } from "../src/workspace/actions/hostActions";
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
const target = { hostId: "remote", sessionId: "session", blockId: "pane" };
const unexpectedMutation: WorkspaceOperations["mutateSession"] = async () => {
  throw new Error("Unexpected session mutation");
};

test("directory insertion quotes shell paths and merges history into settings current at completion", async (t) => {
  const paste = deferred();
  let pasted: RexMethods["paste"]["args"] | undefined;
  installBridge(t, {
    paste: async (args) => {
      pasted = args;
      await paste.promise;
    },
  });
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
  await assert.rejects(save(host, credentials), (error) => error === failure);
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
