import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeView } from "../electron/rex/normalize.js";
import { layoutAction } from "../electron/features/layout.js";

const host = { id: "local", label: "Local", endpoint: "" };
const valid = () => ({
  session_id: "session",
  windows: [
    {
      window_id: "window",
      focused_block_id: "pane",
      layers: [
        {
          layer_id: "layer",
          blocks: [{ block_id: "pane" }],
          layout: { block_id: "pane", rect: [0, 0, 1, 1] },
        },
      ],
    },
  ],
});

test("session views reject malformed nested records and non-finite geometry", () => {
  const malformed: unknown[] = [
    null,
    { session_id: "s", windows: [{}] },
    { session_id: "s", windows: [null] },
    { session_id: "s", windows: [{ window_id: 1 }] },
    { session_id: "s", windows: [{ window_id: "w", layers: {} }] },
    { session_id: "s", windows: [{ window_id: "w", layers: [null] }] },
    {
      session_id: "s",
      windows: [
        { window_id: "w", layers: [{ blocks: [{ block_id: false }] }] },
      ],
    },
    {
      session_id: "s",
      windows: [{ window_id: "w", layers: [{ bounds: [0, 0, Infinity, 1] }] }],
    },
    {
      session_id: "s",
      windows: [
        {
          window_id: "w",
          layers: [{ layout: { block_id: "b", rect: [0, 0, 1] } }],
        },
      ],
    },
    {
      session_id: "s",
      windows: [
        {
          window_id: "w",
          layers: [{ layout: { split: { before: {}, after: null } } }],
        },
      ],
    },
    {
      session_id: "s",
      windows: [
        {
          window_id: "w",
          layers: [
            { layout: { split: { before: {}, after: {}, ratio: NaN } } },
          ],
        },
      ],
    },
  ];
  for (const value of malformed)
    assert.throws(() => normalizeView(value), /invalid session view/);
  const view = normalizeView(valid());
  assert.equal(view.windows[0].panes[0].id, "pane");
  assert.deepEqual(view.windows[0].panes[0].rect, [0, 0, 1, 1]);
});

test("layout mutation refuses malformed views before sending a destructive request", async () => {
  const calls: string[] = [];
  await assert.rejects(
    layoutAction(
      async (_host, method) => {
        calls.push(method);
        return {
          session_id: "session",
          windows: [
            { window_id: "window", focused_block_id: { invalid: true } },
          ],
        };
      },
      host,
      {
        sessionId: "session",
        blockId: "pane",
        operation: "moveToTab",
        targetWindowId: "window",
      },
    ),
    /invalid session view/,
  );
  assert.deepEqual(calls, ["session.view"]);
});

test("failed moves clean up only a validated empty placeholder window", async () => {
  const calls: string[] = [];
  const wire = valid();
  wire.windows[0].layers[0].blocks = [{ block_id: "placeholder" }];
  await assert.rejects(
    layoutAction(
      async (_host, method) => {
        calls.push(method);
        if (method === "session.new_window")
          return { window_id: "window", block_ids: ["placeholder"] };
        if (method === "session.move_block") throw new Error("move failed");
        if (method === "session.view") return wire;
        return {};
      },
      host,
      { sessionId: "session", blockId: "pane", operation: "moveToNewTab" },
    ),
    /move failed/,
  );
  assert.deepEqual(calls, [
    "session.new_window",
    "session.move_block",
    "session.view",
    "session.close_window",
  ]);

  calls.length = 0;
  wire.windows[0].layers[0].blocks.push({ block_id: "pane" });
  await assert.rejects(
    layoutAction(
      async (_host, method) => {
        calls.push(method);
        if (method === "session.new_window")
          return { window_id: "window", block_ids: ["placeholder"] };
        if (method === "session.move_block")
          throw new Error("move failed after moving");
        if (method === "session.view") return wire;
        return {};
      },
      host,
      { sessionId: "session", blockId: "pane", operation: "moveToNewTab" },
    ),
    /move failed/,
  );
  assert.ok(!calls.includes("session.close_window"));
});
