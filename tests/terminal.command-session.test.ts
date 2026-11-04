import assert from "node:assert/strict";
import { test } from "node:test";
import { TerminalCommandSession } from "../src/terminal/command-session.js";
import { RexRequestError } from "../electron/rex/control.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function harness() {
  let visible = true;
  const connected: boolean[] = [];
  const errors: (string | undefined)[] = [];
  const session = new TerminalCommandSession({
    visible: () => visible,
    connected: (value) => connected.push(value),
    error: (message) => errors.push(message),
  });
  const render = () => {
    session.receiveFrame();
    session.beginSnapshot();
    session.frameRendered(session.frameGeneration, false);
  };
  return {
    session,
    connected,
    errors,
    render,
    hide() {
      visible = false;
      session.hide();
    },
    show() {
      visible = true;
    },
  };
}

test("an explicit server rejection mentioning a network keeps the responding connection available", async (t) => {
  const h = harness();
  t.after(() => h.session.dispose());
  h.render();
  const original = new RexRequestError(
    "Lua action: network request denied",
    "lua_error",
    "terminal.key",
  );
  await assert.rejects(
    h.session.sendCommand(
      async () => {
        throw original;
      },
      await h.session.waitUntilReady(),
    ),
    (failure) => failure === original,
  );
  assert.equal(h.session.isOnline, true);
  let sent = 0;
  await h.session.sendCommand(
    async () => {
      sent++;
    },
    await h.session.waitUntilReady(),
  );
  assert.equal(sent, 1);
  assert.deepEqual(h.connected, [true]);
  assert.equal(h.errors.at(-1), original.message);
});

test("late action and clipboard failures reject their callers without replacing current feedback", async (t) => {
  const h = harness();
  t.after(() => h.session.dispose());
  h.render();
  const held = deferred();
  const entered = deferred();
  const original = Object.assign(new Error("Old action rejected"), {
    code: "ACTION_REJECTED",
    method: "block.invoke_action",
  });
  const action = h.session.executeCommand(async () => {
    entered.resolve();
    await held.promise;
  });
  const rejected = assert.rejects(action, (failure) => failure === original);
  await entered.promise;
  h.session.fail(new Error("Connection lost"));
  h.render();
  const errors = [...h.errors];
  held.reject(original);
  await rejected;
  assert.deepEqual(h.errors, errors);
  assert.equal(h.session.isOnline, true);
  let inputSent = false;
  await h.session.executeCommand((generation) =>
    h.session.sendCommand(async () => {
      inputSent = true;
    }, generation),
  );
  assert.equal(inputSent, true);

  const currentFailure = new Error("Clipboard is unavailable");
  await assert.rejects(
    h.session.executeCommand(async () => {
      throw currentFailure;
    }),
    (failure) => failure === currentFailure,
  );
  assert.equal(h.errors.at(-1), currentFailure.message);
});

for (const message of ["Current socket closed", "Current Lua action failed"]) {
  test(`${message} still invalidates queued input and reports after hiding the same connection`, async (t) => {
    const h = harness();
    t.after(() => h.session.dispose());
    h.render();
    const entered = deferred();
    const held = deferred();
    const generation = await h.session.waitUntilReady();
    const original = Object.assign(new Error(message), {
      code: "CURRENT_FAILURE",
      method: "terminal.key",
    });
    const send = h.session.sendCommand(async () => {
      entered.resolve();
      await held.promise;
    }, generation);
    const rejected = assert.rejects(send, (failure) => failure === original);
    await entered.promise;
    let droppedSends = 0;
    const dropped = h.session.sendCommand(async () => {
      droppedSends++;
    }, generation);
    const droppedResult = assert.rejects(
      dropped,
      /connection changed before queued input/,
    );
    h.hide();
    held.reject(original);
    await Promise.all([rejected, droppedResult]);
    assert.equal(droppedSends, 0);
    assert.equal(
      h.errors.at(-1),
      original.message,
      "hiding must not conceal a real failure on this connection",
    );
    assert.equal(h.session.isOnline, !message.includes("socket"));
  });
}

test("settled sends await the original result while reverse-RPC sends acknowledge enqueue and report later", async (t) => {
  const h = harness();
  t.after(() => h.session.dispose());
  h.render();
  const first = deferred();
  const entered = deferred();
  let settled = false;
  const sending = h.session
    .executeCommand((generation) =>
      h.session.sendCommand(async () => {
        entered.resolve();
        await first.promise;
      }, generation),
    )
    .then(() => {
      settled = true;
    });
  await entered.promise;
  assert.equal(settled, false);
  const queued = deferred();
  const queuedEntered = deferred();
  await h.session.executeCommand((generation) =>
    h.session.sendCommand(
      async () => {
        queuedEntered.resolve();
        await queued.promise;
      },
      generation,
      "queued",
    ),
  );
  assert.equal(
    settled,
    false,
    "queued acknowledgment must not release the earlier send",
  );
  first.resolve();
  await sending;
  await queuedEntered.promise;
  const failed = new Error("Reverse paste action rejected");
  queued.reject(failed);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.errors.at(-1), failed.message);
  assert.equal(h.session.isOnline, true);
});

test("a replaced readiness continuation cannot execute or overwrite the replacement feedback", async (t) => {
  const h = harness();
  t.after(() => h.session.dispose());
  h.session.receiveFrame();
  h.session.beginSnapshot();
  let executed = false;
  const command = h.session.executeCommand(async () => {
    executed = true;
  });
  const rejected = assert.rejects(
    command,
    /connection changed before the command/,
  );
  h.session.frameRendered(h.session.frameGeneration, false);
  h.session.fail(new Error("Original connection lost"));
  h.render();
  const errors = [...h.errors];
  await rejected;
  assert.equal(executed, false);
  assert.deepEqual(h.errors, errors);
  assert.equal(
    h.session.isCommandReady(await h.session.waitUntilReady()),
    true,
  );
});

test("snapshot completion while hidden establishes readiness for the same connection when shown", async (t) => {
  const h = harness();
  t.after(() => h.session.dispose());
  h.session.receiveFrame();
  h.session.beginSnapshot();
  const generation = h.session.frameGeneration;
  h.hide();
  h.session.frameRendered(generation, false);
  await assert.rejects(
    h.session.executeCommand(async () => {}),
    /no longer visible/,
  );
  h.show();
  let sends = 0;
  await h.session.executeCommand((inputGeneration) =>
    h.session.sendCommand(async () => {
      sends++;
    }, inputGeneration),
  );
  assert.equal(sends, 1);
});

for (const message of ["Old socket closed", "Old Lua action failed"]) {
  test(`late ${message} preserves replacement readiness and input without replay`, async (t) => {
    const h = harness();
    t.after(() => h.session.dispose());
    h.render();
    const entered = deferred();
    const held = deferred();
    const original = Object.assign(new Error(message), {
      code: "OLD_FAILURE",
      method: "terminal.paste",
    });
    let oldSends = 0;
    const old = h.session.sendCommand(
      async () => {
        oldSends++;
        entered.resolve();
        await held.promise;
      },
      await h.session.waitUntilReady(),
    );
    const rejected = assert.rejects(old, (failure: unknown) => {
      assert.equal(failure, original);
      assert.equal(original.code, "OLD_FAILURE");
      assert.equal(original.method, "terminal.paste");
      return true;
    });
    await entered.promise;

    h.session.fail(new Error("Original connection lost"));
    h.render();
    const errors = [...h.errors];
    const connected = [...h.connected];
    let replacementSends = 0;
    const replacement = h.session.sendCommand(
      async () => {
        replacementSends++;
      },
      await h.session.waitUntilReady(),
    );
    // Observe both results immediately so a baseline failure is not unhandled.
    const replacementResult = replacement.then(
      () => undefined,
      (failure) => failure,
    );
    held.reject(original);
    await rejected;

    assert.equal(
      await replacementResult,
      undefined,
      "replacement input must still send",
    );
    assert.equal(replacementSends, 1);
    assert.equal(oldSends, 1, "the old request must never replay");
    assert.equal(h.session.isOnline, true);
    assert.equal(
      h.session.isCommandReady(await h.session.waitUntilReady()),
      true,
    );
    assert.deepEqual(
      h.connected,
      connected,
      "an old failure cannot disconnect the replacement",
    );
    assert.deepEqual(
      h.errors,
      errors,
      "an old failure cannot overwrite replacement feedback",
    );
  });
}
