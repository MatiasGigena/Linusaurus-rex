import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { reorderWorkspaceTab } from "../src/workspace/actions/tabActions.js";
import { persistSidebarWidth } from "../src/workspace/actions/clientActions.js";
import type { WorkspaceOperations } from "../src/core/workspaceOperations.js";
import {
  DEFAULT_SETTINGS,
  type RexBridge,
  type Settings,
} from "../src/shared/types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
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

test("tab reordering retains its captured target and awaits the host mutation's reconciliation", async (t) => {
  const admitted = deferred(),
    requested = deferred(),
    reconciled = deferred();
  const calls: { method: string; args: object }[] = [];
  bridge(t, async (method, args) => {
    calls.push({ method, args });
    requested.resolve();
    return undefined;
  });
  const hosts: string[] = [];
  const run: WorkspaceOperations["run"] =
    async (hostId, action) => {
      hosts.push(hostId);
      await admitted.promise;
      const result = await action();
      await reconciled.promise;
      return result;
    };
  const target = {
    hostId: "remote",
    sessionId: "session",
    windowId: "moving",
    beforeWindowId: "anchor",
  };
  let complete = false;
  const reorder = reorderWorkspaceTab({ run }, target).then(
    () => {
      complete = true;
    },
  );
  target.hostId = "changed-selection";
  target.beforeWindowId = "changed-anchor";
  assert.deepEqual(calls, []);
  admitted.resolve();
  await requested.promise;
  assert.deepEqual(hosts, ["remote"]);
  assert.deepEqual(calls, [
    {
      method: "reorderWindow",
      args: {
        hostId: "remote",
        sessionId: "session",
        windowId: "moving",
        beforeWindowId: "anchor",
      },
    },
  ]);
  assert.equal(complete, false);
  reconciled.resolve();
  await reorder;
  assert.equal(complete, true);
});

test("tab reordering preserves the original write failure without retrying", async (t) => {
  const original = Object.assign(new Error("Reorder refused"), {
    code: "DENIED",
    method: "session.reorder_window",
  });
  let requests = 0;
  bridge(t, async () => {
    requests++;
    throw original;
  });
  const run: WorkspaceOperations["run"] =
    async (_hostId, action) => action();
  await assert.rejects(
    reorderWorkspaceTab(
      { run },
      { hostId: "remote", sessionId: "session", windowId: "moving" },
    ),
    (failure) => failure === original,
  );
  assert.equal(requests, 1);
});

test("sidebar width persistence awaits resizing before saving, then waits for the settings write", async (t) => {
  const resized = deferred(),
    resizeEntered = deferred(),
    persisted = deferred(),
    saveEntered = deferred();
  const timeline: string[] = [];
  bridge(t, async (method, args) => {
    assert.equal(method, "resizeWindow");
    assert.deepEqual(args, { deltaWidth: 80 });
    timeline.push("resize");
    resizeEntered.resolve();
    await resized.promise;
    return undefined;
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    preserveWindowWidth: false,
    sidebarWidth: 220,
    fontSize: 19,
  };
  let saved: Settings | undefined;
  let complete = false;
  const saving = persistSidebarWidth(
    {
      saveSettings: async (next) => {
        timeline.push("save");
        saved = next;
        saveEntered.resolve();
        await persisted.promise;
        return next;
      },
    },
    settings,
    300,
  ).then(() => {
    complete = true;
  });
  await resizeEntered.promise;
  assert.deepEqual(timeline, ["resize"]);
  assert.equal(saved, undefined);
  resized.resolve();
  await saveEntered.promise;
  assert.deepEqual(timeline, ["resize", "save"]);
  assert.deepEqual(saved, { ...settings, sidebarWidth: 300 });
  assert.equal(settings.sidebarWidth, 220);
  assert.equal(complete, false);
  persisted.resolve();
  await saving;
  assert.equal(complete, true);
});

test("preserving window width saves the sidebar width without issuing a resize", async (t) => {
  bridge(t, async () => {
    throw new Error("Unexpected resize");
  });
  const settings = { ...DEFAULT_SETTINGS, preserveWindowWidth: true };
  const saved: Settings[] = [];
  await persistSidebarWidth(
    {
      saveSettings: async (next) => {
        saved.push(next);
        return next;
      },
    },
    settings,
    380,
  );
  assert.deepEqual(saved, [{ ...settings, sidebarWidth: 380 }]);
});

for (const failingStep of ["resize", "save"] as const) {
  test(`sidebar ${failingStep} failure preserves identity and never replays earlier work`, async (t) => {
    const original = Object.assign(new Error(`${failingStep} refused`), {
      code: "DENIED",
      method: failingStep,
    });
    const timeline: string[] = [];
    bridge(t, async () => {
      timeline.push("resize");
      if (failingStep === "resize") throw original;
      return undefined;
    });
    const settings = { ...DEFAULT_SETTINGS, preserveWindowWidth: false };
    await assert.rejects(
      persistSidebarWidth(
        {
          saveSettings: async () => {
            timeline.push("save");
            throw original;
          },
        },
        settings,
        390,
      ),
      (failure) => failure === original,
    );
    assert.deepEqual(
      timeline,
      failingStep === "resize" ? ["resize"] : ["resize", "save"],
    );
  });
}
