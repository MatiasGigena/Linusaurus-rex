import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TerminalCommandBroker,
  type TerminalCommandRequest,
} from "../src/terminal/commands.js";
import type { TerminalRef } from "../src/shared/types.js";

const target: TerminalRef = {
  hostId: "host",
  sessionId: "session",
  blockId: "pane",
};
const commands = (
  execute: (
    command: TerminalCommandRequest,
    signal: AbortSignal,
  ) => Promise<void>,
) => ({
  available: () => true,
  focused: () => true,
  onError: () => {},
  execute,
});

test("command handoff waits for full target registration and visibility, accepting once", async () => {
  const broker = new TerminalCommandBroker();
  const received: string[] = [];
  const pending = broker.dispatch("find", target);
  const peers = [
    { ...target, hostId: "other-host" },
    { ...target, sessionId: "other-session" },
    { ...target, blockId: "other-pane" },
  ].map((ref) =>
    broker.register(
      ref,
      commands(async () => {
        throw new Error("wrong target");
      }),
    ),
  );
  assert.equal(received.length, 0);
  let visible = false;
  const registration = broker.register(target, {
    ...commands(async (command) => {
      assert.ok(typeof command === "string");
      received.push(command);
    }),
    available: () => visible,
  });
  registration.activate();
  assert.equal(received.length, 0);
  visible = true;
  registration.activate();
  await pending;
  registration.activate();
  assert.deepEqual(received, ["find"]);
  registration.dispose();
  peers.forEach((peer) => peer.dispose());
});

test("expired handoffs are removed and cannot execute on a later mount", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const broker = new TerminalCommandBroker();
  const rejected = assert.rejects(
    broker.dispatch("paste", target),
    /within 10 seconds/,
  );
  t.mock.timers.tick(10_000);
  await rejected;
  let executed = 0;
  const registration = broker.register(
    target,
    commands(async () => {
      executed++;
    }),
  );
  await Promise.resolve();
  assert.equal(executed, 0);
  await broker.dispatch("find", target);
  assert.equal(executed, 1);
  registration.dispose();
});

test("closing a hidden target rejects its queued handoff instead of replaying after remount", async () => {
  const broker = new TerminalCommandBroker();
  const hidden = broker.register(target, {
    ...commands(async () => {}),
    available: () => false,
  });
  const rejected = assert.rejects(
    broker.dispatch("paste", target),
    /closed before accepting/,
  );
  hidden.dispose();
  await rejected;
  let executed = 0;
  const remount = broker.register(
    target,
    commands(async () => {
      executed++;
    }),
  );
  hidden.activate();
  hidden.dispose();
  await broker.dispatch("find", target);
  assert.equal(
    executed,
    1,
    "an old disposer must not remove the replacement registration",
  );
  remount.dispose();
});

test("disposal aborts accepted execution and an ambiguous failure is never retried", async () => {
  const broker = new TerminalCommandBroker();
  let signal: AbortSignal | undefined;
  let complete: () => void = () => {};
  const first = broker.register(
    target,
    commands((_command, acceptedSignal) => {
      signal = acceptedSignal;
      return new Promise<void>((resolve) => {
        complete = resolve;
      });
    }),
  );
  const rejected = assert.rejects(
    broker.dispatch("paste", target),
    /closed before completing/,
  );
  first.dispose();
  await rejected;
  assert.equal(signal?.aborted, true);
  let replayed = 0;
  const remount = broker.register(
    target,
    commands(async () => {
      replayed++;
    }),
  );
  complete();
  await Promise.resolve();
  assert.equal(replayed, 0);
  await broker.dispatch("find", target);
  assert.equal(replayed, 1);
  remount.dispose();

  let attempts = 0;
  const failed = broker.register(
    target,
    commands(async () => {
      attempts++;
      throw new Error("input generation changed");
    }),
  );
  await assert.rejects(broker.dispatch("paste", target), /generation changed/);
  failed.activate();
  assert.equal(attempts, 1);
  failed.dispose();
});

test("reentrant activation cannot accept another queued command twice", async () => {
  const broker = new TerminalCommandBroker();
  let visible = false;
  const received: string[] = [];
  const registration = broker.register(target, {
    ...commands(async (command) => {
      assert.ok(typeof command === "string");
      received.push(command);
      if (command === "first") registration.activate();
    }),
    available: () => visible,
  });
  const first = broker.dispatch("first", target);
  const second = broker.dispatch("second", target);
  visible = true;
  registration.activate();
  await Promise.all([first, second]);
  assert.deepEqual(received, ["first", "second"]);
  registration.dispose();
});

test("untargeted commands require the visible focused pane", async () => {
  const broker = new TerminalCommandBroker();
  const hidden = broker.register(target, {
    ...commands(async () => {
      throw new Error("hidden");
    }),
    available: () => false,
  });
  await assert.rejects(broker.dispatch("find"), /No visible terminal/);
  const received: string[] = [];
  const focused = broker.register(
    { ...target, blockId: "focused" },
    commands(async (command) => {
      assert.ok(typeof command === "string");
      received.push(command);
    }),
  );
  await broker.dispatch("copy");
  assert.deepEqual(received, ["copy"]);
  hidden.dispose();
  focused.dispose();
});

test("explicit paste handoff snapshots text, targets the full pane identity and settles only after execution", async () => {
  const broker = new TerminalCommandBroker();
  const request = { command: "paste" as const, text: "'/work/quoted path'" };
  const received: TerminalCommandRequest[] = [];
  const pending = broker.dispatch(request, target);
  request.text = "changed after handoff";
  let settled = false;
  const observed = pending.then(() => {
    settled = true;
  });
  let finish!: () => void;
  const wrong = broker.register(
    { ...target, blockId: "other-pane" },
    commands(async () => {
      throw new Error("Wrong pane accepted explicit paste");
    }),
  );
  const registration = broker.register(target, {
    available: () => true,
    focused: () => false,
    onError: () => {},
    execute: async (command, _signal, completion) => {
      assert.equal(completion, "settled");
      received.push(command);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  assert.deepEqual(received, [
    { command: "paste", text: "'/work/quoted path'" },
  ]);
  assert.equal(settled, false);
  finish();
  await observed;
  assert.equal(settled, true);
  registration.dispose();
  wrong.dispose();
});
