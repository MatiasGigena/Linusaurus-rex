import assert from "node:assert/strict";
import { test } from "node:test";
import { UpdateCoordinator } from "../electron/features/update-coordinator.js";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type UpdateState,
} from "../src/shared/types.js";

function fixture(kind: UpdateState["installKind"] = "appimage") {
  let settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    autoCheckUpdates: false,
    autoDownloadUpdates: false,
    installUpdatesWhenIdle: false,
  };
  let listener: ((settings: Settings) => void) | undefined;
  const calls: string[] = [];
  let state: UpdateState = {
    phase: "idle",
    installKind: kind,
    currentVersion: "1.0.0",
    canApply: false,
  };
  const manager = {
    status: () => state,
    check: async (): Promise<UpdateState> => {
      calls.push("check");
      return (state = { ...state, phase: "available" });
    },
    download: async () => {
      calls.push("download");
      return (state = { ...state, phase: "ready" });
    },
    apply: async (idle = false) => {
      calls.push(`apply:${idle}`);
      return (state = { ...state, phase: idle ? "scheduled" : "ready" });
    },
    cancel: () => {
      calls.push("cancel");
      return (state = { ...state, phase: "ready" });
    },
    dispose: () => {
      calls.push("dispose");
    },
  };
  const source = {
    get: () => settings,
    onChange: (callback: (settings: Settings) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    manager,
    source,
    calls,
    change: (patch: Partial<Settings>) => {
      settings = { ...settings, ...patch };
      listener?.(settings);
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("manual checks and preference changes share download and idle-install policy", async () => {
  const f = fixture();
  const coordinator = new UpdateCoordinator(f.manager, f.source);
  try {
    assert.equal((await coordinator.check()).phase, "available");
    f.change({ autoDownloadUpdates: true, installUpdatesWhenIdle: true });
    await settle();
    assert.deepEqual(f.calls, ["check", "download", "apply:true"]);
    f.change({ installUpdatesWhenIdle: false });
    assert.equal(coordinator.status().phase, "ready");
    assert.equal(f.calls.at(-1), "cancel");
  } finally {
    coordinator.dispose();
  }
  f.change({ autoCheckUpdates: true });
  assert.equal(f.calls.at(-1), "dispose");
});

test("automatic checks respect disabling updates while a check is in flight", async () => {
  const f = fixture();
  let finish!: (state: UpdateState) => void;
  f.manager.check = () =>
    new Promise((resolve) => {
      f.calls.push("check");
      finish = resolve;
    });
  const coordinator = new UpdateCoordinator(f.manager, f.source);
  try {
    f.change({
      autoCheckUpdates: true,
      autoDownloadUpdates: true,
      installUpdatesWhenIdle: true,
    });
    f.change({ autoCheckUpdates: false });
    finish({ ...f.manager.status(), phase: "available" });
    await settle();
    assert.deepEqual(f.calls, ["check"]);
  } finally {
    coordinator.dispose();
  }
});

test("Debian downloads require explicit installation even when idle installation is enabled", async () => {
  const f = fixture("deb");
  f.change({ autoDownloadUpdates: true, installUpdatesWhenIdle: true });
  const coordinator = new UpdateCoordinator(f.manager, f.source);
  try {
    assert.equal((await coordinator.check()).phase, "ready");
    assert.deepEqual(f.calls, ["check", "download"]);
    await coordinator.apply();
    assert.equal(f.calls.at(-1), "apply:false");
  } finally {
    coordinator.dispose();
  }
});
