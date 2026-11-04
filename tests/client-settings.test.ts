import assert from "node:assert/strict";
import { test } from "node:test";
import { createClientActions } from "../src/workspace/actions/clientActions.js";
import { WorkspaceDialogController } from "../src/workspace/dialogs.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

test("settings actions accept only actual tab strings and default malformed values", async () => {
  const dialogs = new WorkspaceDialogController();
  const unexpected = (): never => {
    throw new Error("Opening settings must not perform a workspace operation");
  };
  const execute = createClientActions({
    dialogs,
    hosts: [],
    interfaceTheme: "linux",
    settings: DEFAULT_SETTINGS,
    workspace: {
      mutateHostAndRefresh: unexpected,
      mutateSession: unexpected,
      select: unexpected,
      dismissNotices: unexpected,
      saveSettings: unexpected,
      refresh: unexpected,
    },
    setActivityOnly: unexpected,
    setActivityOpen: unexpected,
    setActivityGroup: unexpected,
  });
  const valid = [
    "appearance",
    "terminal",
    "notifications",
    "hosts",
    "integrations",
    "shortcuts",
    "server",
  ];
  for (const tab of [
    ...valid,
    ["terminal"],
    ["server"],
    [],
    null,
    undefined,
    1,
    {},
    "missing",
  ]) {
    await execute({
      name: "client.settings",
      args: { tab },
      hostId: "local",
      sourceHostId: undefined,
    });
    assert.deepEqual(dialogs.snapshot.primary?.dialog, {
      kind: "settings",
      tab: typeof tab === "string" && valid.includes(tab) ? tab : "appearance",
    });
  }
});
