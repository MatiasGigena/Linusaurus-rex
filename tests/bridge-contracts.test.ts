import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseLayoutAction,
  parseKeyMode,
  parsePathPicker,
  updateRendererContext,
  parseKeyEvent,
  parsePointerEvent,
} from "../electron/bridge-contracts.js";
import { trustedRenderer } from "../electron/renderer-boundary.js";

test("keyboard actions admit only literal protocol values", () => {
  const event = {
    key: "key_x",
    action: "press",
    mods: "ctrl",
    consumed_mods: "",
    text: "x",
    unshifted_codepoint: 120,
    composing: false,
  };
  for (const action of ["press", "release", "repeat"])
    assert.deepEqual(parseKeyEvent({ ...event, action }), { ...event, action });
  for (const action of [
    ["press"],
    { toString: () => "press" },
    null,
    1,
    "PRESS",
  ])
    assert.throws(
      () => parseKeyEvent({ ...event, action }),
      /Invalid key action/,
    );
});

test("pointer actions admit only literal protocol values", () => {
  for (const action of ["press", "motion", "release"])
    for (const button of [undefined, "left", "middle", "right"])
      assert.equal(
        parsePointerEvent("mouse", { x: 1, y: 2, mods: "", action, button })
          .action,
        action,
      );
  for (const action of [["press"], { toString: () => "press" }, null, 1])
    assert.throws(
      () => parsePointerEvent("mouse", { x: 1, y: 2, mods: "", action }),
      /Invalid pointer action/,
    );
});

test("pointer buttons admit only literal protocol values and wheel deltas stay bounded", () => {
  for (const button of [["left"], { toString: () => "left" }, null, 1])
    assert.throws(
      () =>
        parsePointerEvent("mouse", {
          x: 1,
          y: 2,
          mods: "",
          action: "press",
          button,
        }),
      /Invalid pointer button/,
    );
  assert.deepEqual(
    parsePointerEvent("wheel", {
      x: 0,
      y: 65535,
      delta_x: -1000,
      delta_y: 1000,
    }),
    { x: 0, y: 65535, delta_x: -1000, delta_y: 1000 },
  );
  assert.throws(
    () =>
      parsePointerEvent("wheel", { x: 0, y: 0, delta_x: Infinity, delta_y: 0 }),
    /Invalid wheel delta/,
  );
});

test("key modes require a name only for entry and reject contradictory exit arguments", () => {
  assert.deepEqual(parseKeyMode({ operation: "enter", name: "resize" }), {
    operation: "enter",
    name: "resize",
  });
  assert.deepEqual(parseKeyMode({ operation: "exit" }), { operation: "exit" });
  assert.deepEqual(parseKeyMode({ operation: "exitAll" }), {
    operation: "exitAll",
  });
  for (const args of [
    { operation: "enter" },
    { operation: "enter", name: "" },
    { operation: "enter", name: 42 },
    { operation: "exit", name: "resize" },
    { operation: "exitAll", name: "" },
    { operation: "reset" },
  ])
    assert.throws(() => parseKeyMode(args));
});

test("privileged renderer access rejects unknown senders, subframes and navigated documents", () => {
  const frame = { url: "file:///app/index.html" };
  const context = { allowedUrl: frame.url, identity: "registered" };
  const contexts = new Map([[7, context]]);
  const sender = { id: 7, mainFrame: frame };
  assert.equal(
    trustedRenderer({ sender, senderFrame: frame }, contexts),
    context,
  );
  frame.url += "#settings";
  assert.equal(
    trustedRenderer({ sender, senderFrame: frame }, contexts),
    context,
  );
  assert.throws(
    () =>
      trustedRenderer(
        { sender: { ...sender, id: 8 }, senderFrame: frame },
        contexts,
      ),
    /Untrusted renderer/,
  );
  assert.throws(
    () =>
      trustedRenderer({ sender, senderFrame: { url: frame.url } }, contexts),
    /Untrusted renderer/,
  );
  assert.throws(
    () => trustedRenderer({ sender, senderFrame: null }, contexts),
    /Untrusted renderer/,
  );
  frame.url = "https://untrusted.example/app";
  assert.throws(
    () => trustedRenderer({ sender, senderFrame: frame }, contexts),
    /Untrusted renderer/,
  );
});

test("context selection snapshots clear old panes while independent busy patches preserve selection", () => {
  const selected = updateRendererContext(
    {},
    {
      selection: { hostId: "h", sessionId: "s", windowId: "w", blockId: "b" },
      visible: true,
    },
  );
  const busy = updateRendererContext(selected, { uiBusy: true });
  assert.equal(busy.selection?.blockId, "b");
  const tab = updateRendererContext(busy, {
    selection: { hostId: "h", sessionId: "s", windowId: "other" },
  });
  assert.equal(tab.selection?.blockId, undefined);
  const cleared = updateRendererContext(tab, { selection: null });
  assert.equal(cleared.selection, null);
  assert.equal(cleared.uiBusy, true);
  assert.equal(
    updateRendererContext(cleared, { uiBusy: false }).selection,
    null,
  );
  assert.throws(
    () =>
      updateRendererContext(selected, {
        selection: { hostId: "h", sessionId: "", windowId: "w" },
      }),
    /empty host selection/,
  );
  assert.throws(
    () => updateRendererContext(selected, { visible: "yes" }),
    /visible/,
  );
  assert.equal(selected.selection?.blockId, "b");
});

test("layout requests require exactly the identifiers belonging to their operation", () => {
  assert.deepEqual(
    parseLayoutAction({ operation: "moveToTab", targetWindowId: "w" }),
    { operation: "moveToTab", targetWindowId: "w" },
  );
  assert.deepEqual(parseLayoutAction({ operation: "minimize", layerId: "l" }), {
    operation: "minimize",
    layerId: "l",
  });
  assert.deepEqual(parseLayoutAction({ operation: "balance" }), {
    operation: "balance",
  });
  assert.throws(
    () => parseLayoutAction({ operation: "moveToTab" }),
    /destination tab/,
  );
  assert.throws(
    () => parseLayoutAction({ operation: "restore" }),
    /floating pane ID/,
  );
  assert.throws(
    () =>
      parseLayoutAction({
        operation: "minimize",
        layerId: "l",
        targetWindowId: "w",
      }),
    /destination tab/,
  );
  assert.throws(
    () => parseLayoutAction({ operation: "balance", layerId: "l" }),
    /does not accept/,
  );
  assert.throws(
    () => parseLayoutAction({ operation: "unknown" }),
    /Unsupported/,
  );
});

test("file picker rejects contradictory save and open options before opening a dialog", () => {
  assert.deepEqual(
    parsePathPicker({
      save: true,
      content: "text",
      defaultPath: "capture.txt",
    }),
    { save: true, content: "text", defaultPath: "capture.txt" },
  );
  assert.equal(parsePathPicker({ directory: true }).directory, true);
  assert.throws(
    () => parsePathPicker({ content: "discarded" }),
    /requires a save/,
  );
  assert.throws(
    () => parsePathPicker({ save: true, directory: true }),
    /cannot select a directory/,
  );
  assert.throws(() => parsePathPicker({ save: "true" }), /Invalid save/);
});
