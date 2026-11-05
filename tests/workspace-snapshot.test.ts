import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectHostSnapshot,
  reconcileSelection,
} from "../src/core/workspaceSnapshot";
import type { HostState } from "../src/core/workspaceSnapshot";
import type { RexBridge, SessionView } from "../src/shared/types";

const host = { id: "local", label: "Local", endpoint: "" };
const view: SessionView = {
  id: "session",
  label: "Session",
  activeWindowId: "active",
  windows: [
    {
      id: "active",
      label: "Active",
      focusedBlockId: "pane",
      panes: [{ id: "pane", label: "Pane", rect: [0, 0, 1, 1] }],
    },
  ],
};
const connected: HostState = {
  ...host,
  connected: true,
  sessions: [{ id: view.id, label: view.label }],
};
function requester(
  inspect: (sessionId: string) => Promise<SessionView>,
): RexBridge["request"] {
  return (async (method: string, args: { sessionId?: string }) => {
    if (method === "status") return { connected: true };
    if (method === "listSessions")
      return [
        { id: "session", label: "Session" },
        { id: "closed", label: "Closed" },
      ];
    if (method === "inspectSession") return inspect(args.sessionId || "");
    throw new Error(`Unexpected fixture request: ${method}`);
  }) as RexBridge["request"];
}

test("refresh tolerates only an explicitly missing session and removes its stale list entry", async () => {
  const result = await collectHostSnapshot(
    host,
    requester(async (id) => {
      if (id === "closed") throw new Error('Session "closed" not found');
      return view;
    }),
  );
  assert.equal(result.host.connected, true);
  assert.deepEqual(result.host.sessions, [{ id: "session", label: "Session" }]);
  assert.deepEqual(result.views, { "local/session": view });
});

for (const code of ["permission_denied", "future_server_failure", ""]) {
  test(`inspection code ${JSON.stringify(code)} takes precedence over a legacy missing-session message`, async () => {
    const original = Object.assign(new Error('Session "closed" not found'), {
      code,
      method: "session.get",
    });
    const result = await collectHostSnapshot(
      host,
      requester(async (id) => {
        if (id === "closed") throw original;
        return view;
      }),
    );
    assert.equal(result.host.connected, false);
    assert.equal(result.failure, original);
    assert.equal(result.host.error, original.message);
    assert.deepEqual(result.views, {});
  });
}

test("an explicit missing-session code permits concurrent deletion without matching message text", async () => {
  const result = await collectHostSnapshot(
    host,
    requester(async (id) => {
      if (id === "closed")
        throw Object.assign(new Error("It was removed by another client"), {
          code: "session_not_found",
        });
      return view;
    }),
  );
  assert.equal(result.host.connected, true);
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.host.sessions, [{ id: "session", label: "Session" }]);
  assert.deepEqual(result.views, { "local/session": view });
});

test("inspection transport, permission, and decoding failures surface instead of silently removing sessions", async () => {
  for (const message of [
    "Connection closed",
    "Permission denied",
    "Invalid session response",
  ]) {
    const result = await collectHostSnapshot(
      host,
      requester(async () => {
        throw new Error(message);
      }),
    );
    assert.equal(result.host.connected, false);
    assert.equal(result.host.error, message);
    assert.deepEqual(result.views, {});
  }
});

test("selection follows a surviving window and focuses only a surviving requested pane", () => {
  assert.deepEqual(
    reconcileSelection(
      {
        hostId: "local",
        sessionId: "session",
        windowId: "closed",
        blockId: "closed-pane",
      },
      [connected],
      { "local/session": view },
    ),
    {
      selection: { hostId: "local", sessionId: "session", windowId: "active" },
      updateFocus: true,
      focusedPane: "pane",
    },
  );
  const twoPanes = {
    ...view,
    windows: [
      {
        ...view.windows[0],
        panes: [
          ...view.windows[0].panes,
          {
            id: "requested",
            label: "Requested",
            rect: [0, 0, 1, 1] as [number, number, number, number],
          },
        ],
      },
    ],
  };
  assert.equal(
    reconcileSelection(
      {
        hostId: "local",
        sessionId: "session",
        windowId: "active",
        blockId: "requested",
      },
      [connected],
      { "local/session": twoPanes },
    ).focusedPane,
    "requested",
  );
});

test("refresh preserves empty-host and disconnected selections but clears focus when no workspace survives", () => {
  const selection = {
    hostId: "local",
    sessionId: "session",
    windowId: "active",
  };
  assert.deepEqual(
    reconcileSelection(selection, [{ ...connected, connected: false }], {}),
    { selection, updateFocus: false },
  );
  const empty = { ...selection, sessionId: "", windowId: "" };
  assert.deepEqual(
    reconcileSelection(empty, [connected], { "local/session": view }),
    { selection: empty, updateFocus: false },
  );
  assert.deepEqual(
    reconcileSelection(selection, [{ ...connected, sessions: [] }], {}),
    { selection: undefined, updateFocus: true },
  );
});
