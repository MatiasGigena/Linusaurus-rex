import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { pickDirectoryPath } from "../src/workspace/actions/directoryActions.js";
import { terminalCommands } from "../src/terminal/commands.js";
import {
  WorkspaceReconciliationError,
  type WorkspaceOperations,
} from "../src/core/workspaceOperations.js";
import {
  DEFAULT_SETTINGS,
  type RexBridge,
  type SessionView,
} from "../src/shared/types.js";

const target = { hostId: "remote", sessionId: "session", blockId: "pane" };
const view: SessionView = {
  id: target.sessionId,
  label: "Session",
  activeWindowId: "",
  windows: [],
};
function bridge(t: TestContext, request: RexBridge["request"]) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { rex: { request } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
}
const unreachableMutation: WorkspaceOperations["mutateSession"] = async () => {
  throw new Error("Unexpected mutation");
};

test("directory insertion is handed to its exact terminal owner with quoted text and settled completion", async (t) => {
  const accepted: unknown[] = [];
  const registration = terminalCommands.register(target, {
    available: () => true,
    focused: () => false,
    execute: async (request, _signal, completion) => {
      accepted.push({ request, completion });
    },
    onError: () => {},
  });
  t.after(() => registration.dispose());
  bridge(t, async () => {
    throw new Error("Directory insertion bypassed the terminal owner");
  });
  const workspace = {
    getSettings: () => DEFAULT_SETTINGS,
    saveSettings: async (settings: typeof DEFAULT_SETTINGS) => settings,
    mutateSession: unreachableMutation,
  };
  await pickDirectoryPath(
    workspace,
    { mode: "insert", ref: target },
    "/work/Pat's project",
  );
  assert.deepEqual(accepted, [
    {
      request: { command: "paste", text: "'/work/Pat'\\''s project'" },
      completion: "settled",
    },
  ]);
});

for (const mode of ["insert", "directory"] as const) {
  test(`a completed ${mode} reports recent-path persistence failure as committed and preserves its cause`, async (t) => {
    let writes = 0;
    bridge(t, async () => {
      writes++;
      return undefined;
    });
    const registration = terminalCommands.register(target, {
      available: () => true,
      focused: () => false,
      execute: async () => {
        writes++;
      },
      onError: () => {},
    });
    t.after(() => registration.dispose());
    const cause = Object.assign(new Error("Settings disk is read-only"), {
      code: "EROFS",
      method: "saveSettings",
    });
    const mutateSession: WorkspaceOperations["mutateSession"] = async (
      _plan,
      action,
    ) => ({ result: await action(), view });
    await assert.rejects(
      pickDirectoryPath(
        {
          getSettings: () => DEFAULT_SETTINGS,
          saveSettings: async () => {
            throw cause;
          },
          mutateSession,
        },
        { mode, ref: target },
        "/work",
      ),
      (failure) => {
        assert.ok(failure instanceof WorkspaceReconciliationError);
        assert.equal(failure.cause, cause);
        assert.equal(failure.code, cause.code);
        assert.equal(failure.method, cause.method);
        assert.match(failure.message, /completed|inserted|opened/i);
        assert.match(failure.message, /recent paths/i);
        return true;
      },
    );
    assert.equal(writes, 1);
  });
}

test("a committed new-window reconciliation failure is preserved without saving history or repeating the write", async (t) => {
  let writes = 0;
  let saved = 0;
  bridge(t, async () => {
    writes++;
    return undefined;
  });
  const original = new WorkspaceReconciliationError(
    new Error("Inspection failed"),
  );
  const mutateSession: WorkspaceOperations["mutateSession"] = async (
    _plan,
    action,
  ) => {
    await action();
    throw original;
  };
  await assert.rejects(
    pickDirectoryPath(
      {
        getSettings: () => DEFAULT_SETTINGS,
        saveSettings: async (settings) => {
          saved++;
          return settings;
        },
        mutateSession,
      },
      { mode: "directory", ref: target },
      "/work",
    ),
    (failure) => failure === original,
  );
  assert.equal(writes, 1);
  assert.equal(saved, 0);
});
