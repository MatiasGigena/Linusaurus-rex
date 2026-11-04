import assert from "node:assert/strict";
import { test } from "node:test";
import { TerminalFrameWriter } from "../src/terminal/frame-writer.js";
import { TerminalBoundary } from "../src/terminal/boundary.js";
import { KittyFramer } from "../src/terminal/kitty-protocol.js";
import type { TerminalRuntime } from "../src/terminal/runtime.js";

function harness(command: (data: string) => Promise<string> = async () => "") {
  const writes: string[] = [];
  const callbacks: (() => void)[] = [];
  const completed: {
    data?: string;
    generation: number;
    pendingSnapshot: boolean;
  }[] = [];
  const errors: unknown[] = [];
  const runtime = {
    terminal: {
      cols: 80,
      rows: 24,
      buffer: { active: { viewportY: 0, baseY: 0, length: 24 } },
      getSelectionPosition: () => undefined,
      reset: () => writes.push("RESET"),
      write: (data: string, complete: () => void) => {
        writes.push(data);
        callbacks.push(complete);
      },
    },
    boundary: new TerminalBoundary(),
    kitty: {
      framer: new KittyFramer(),
      reset() {
        this.framer.reset();
      },
      command,
    },
  } as unknown as TerminalRuntime;
  const writer = new TerminalFrameWriter(runtime, {
    scrollOnOutput: () => true,
    error: (error) => errors.push(error),
    complete: (frame, generation) =>
      completed.push({
        data: frame.data,
        generation,
        pendingSnapshot: writer.hasPendingSnapshot,
      }),
  });
  return {
    runtime,
    writer,
    writes,
    completed,
    errors,
    finishWrite() {
      assert.ok(callbacks.length);
      callbacks.shift()!();
    },
  };
}

test("frame completion waits for text, async image work, image cursor movement, and following text in order", async () => {
  let resolveImage!: (move: string) => void;
  const image = new Promise<string>((resolve) => {
    resolveImage = resolve;
  });
  const commands: string[] = [];
  const h = harness((data) => {
    commands.push(data);
    return image;
  });
  h.writer.enqueue(
    { subscriptionId: "test", kind: "output", data: "A\x1b_Gdeferred\x1b\\B" },
    4,
  );
  h.writer.enqueue({ subscriptionId: "test", kind: "output", data: "C" }, 4);
  assert.deepEqual(h.writes, ["A"]);
  assert.deepEqual(commands, []);
  h.finishWrite();
  assert.deepEqual(commands, ["deferred"]);
  assert.equal(h.completed.length, 0);
  resolveImage("MOVE");
  await image;
  assert.deepEqual(h.writes, ["A", "MOVE"]);
  h.finishWrite();
  assert.deepEqual(h.writes, ["A", "MOVE", "B"]);
  h.finishWrite();
  assert.equal(h.completed.length, 1);
  assert.deepEqual(h.writes, ["A", "MOVE", "B", "C"]);
  h.finishWrite();
  assert.deepEqual(
    h.completed.map((frame) => frame.generation),
    [4, 4],
  );
  h.writer.dispose();
});

test("a new snapshot replaces queued stale output while the current write finishes first", () => {
  const h = harness();
  h.writer.enqueue({ subscriptionId: "test", kind: "output", data: "busy" }, 1);
  h.writer.enqueue(
    { subscriptionId: "test", kind: "output", data: "obsolete" },
    1,
  );
  h.writer.enqueue(
    { subscriptionId: "test", kind: "snapshot", data: "fresh" },
    2,
  );
  h.writer.enqueue({ subscriptionId: "test", kind: "output", data: "live" }, 2);
  assert.equal(h.writer.hasPendingSnapshot, true);
  h.finishWrite();
  assert.deepEqual(h.writes, ["busy", "RESET", "fresh"]);
  assert.equal(h.writer.replayingSnapshot, true);
  assert.equal(h.completed[0].pendingSnapshot, true);
  h.finishWrite();
  assert.equal(h.writer.replayingSnapshot, false);
  assert.deepEqual(h.writes, ["busy", "RESET", "fresh", "live"]);
  h.finishWrite();
  assert.deepEqual(
    h.completed.map((frame) => frame.generation),
    [1, 2, 2],
  );
  h.writer.dispose();
});

test("cursor preferences wait for the server escape continuation and its xterm callback", () => {
  const h = harness();
  h.writer.enqueue(
    { subscriptionId: "test", kind: "output", data: "\x1b[" },
    1,
  );
  h.finishWrite();
  h.runtime.cursorResetPending = true;
  h.writer.flush();
  assert.deepEqual(h.writes, ["\x1b["]);
  h.writer.enqueue({ subscriptionId: "test", kind: "output", data: "6 qZ" }, 1);
  assert.deepEqual(h.writes, ["\x1b[", "6 qZ"]);
  h.finishWrite();
  assert.deepEqual(h.writes, ["\x1b[", "6 qZ", "\x1b[0 q"]);
  h.finishWrite();
  assert.equal(h.runtime.cursorResetPending, false);
  h.writer.dispose();
  assert.equal(h.runtime.requestCursorReset, undefined);
});

test("an image rejection reports the error and continues later terminal output", async () => {
  const failure = new Error("unsupported image");
  const h = harness(async () => {
    throw failure;
  });
  h.writer.enqueue(
    { subscriptionId: "test", kind: "output", data: "\x1b_Gbad\x1b\\after" },
    1,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(h.errors, [failure]);
  assert.deepEqual(h.writes, ["after"]);
  h.finishWrite();
  assert.equal(h.completed.length, 1);
  h.writer.dispose();
});

test("the live backlog stays bounded while snapshots remain eligible for replacement", () => {
  const h = harness();
  h.writer.enqueue({ subscriptionId: "test", kind: "output", data: "busy" }, 1);
  const large = "x".repeat(16 * 1024 * 1024 + 1);
  assert.equal(
    h.writer.enqueue(
      { subscriptionId: "test", kind: "output", data: large },
      1,
    ),
    false,
  );
  assert.equal(
    h.writer.enqueue(
      { subscriptionId: "test", kind: "snapshot", data: large },
      2,
    ),
    true,
  );
  h.writer.enqueue(
    { subscriptionId: "test", kind: "snapshot", data: "fresh" },
    3,
  );
  h.finishWrite();
  assert.deepEqual(h.writes, ["busy", "RESET", "fresh"]);
  h.finishWrite();
  assert.deepEqual(
    h.completed.map((frame) => frame.generation),
    [1, 3],
  );
  h.writer.dispose();
});
