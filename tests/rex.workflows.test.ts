import assert from "node:assert/strict";
import { test } from "node:test";
import { RexService, type RexServiceOptions } from "../electron/rex/service.js";
import type { RexControl, RexWelcome } from "../electron/rex/control.js";

const host = { id: "owned", label: "Owned", endpoint: "unix:///owned.sock" };
function fixture(
  reply: (method: string) => unknown,
  onControl?: RexServiceOptions["onControl"],
) {
  const calls: { method: string; payload: object }[] = [];
  const controls: { endpoint: string; connected: boolean }[] = [];
  const service = new RexService({
    onControl,
    controlFactory: (endpoint) => {
      const control = {
        endpoint,
        connected: true,
        readyPublic: async () => ({
          protocol: "rex.control.v1",
          api_revision: 10,
        }),
        attach: async () => {},
        call: async (method: string, payload: object) => {
          calls.push({ method, payload });
          return reply(method);
        },
        dispose() {
          control.connected = false;
        },
      };
      controls.push(control);
      return control as unknown as RexControl;
    },
  });
  return { service, calls, controls };
}
const view = {
  session_id: "tutorial",
  active_window_id: "window",
  windows: [
    {
      window_id: "window",
      focused_block_id: "pane",
      layers: [
        { blocks: [{ block_id: "pane" }], layout: { block_id: "pane" } },
      ],
    },
  ],
};

test("tutorial creation validates its selected pane and rolls back only its own failed session", async () => {
  let valid = true;
  const current = fixture((method) =>
    method === "session.create"
      ? { session_id: "tutorial" }
      : method === "session.view"
        ? valid
          ? view
          : { ...view, windows: [] }
        : {},
  );
  try {
    assert.deepEqual(await current.service.createTutorial(host), {
      sessionId: "tutorial",
      windowId: "window",
      blockId: "pane",
    });
    valid = false;
    await assert.rejects(
      current.service.createTutorial(host),
      /did not create a usable pane/,
    );
    assert.deepEqual(current.calls.at(-1), {
      method: "session.destroy",
      payload: { session_id: "tutorial" },
    });
    assert.equal(
      current.calls.filter((call) => call.method === "session.destroy").length,
      1,
    );
  } finally {
    current.service.dispose();
  }
});

test("tutorial cleanup failure preserves the initiating inspection error", async () => {
  const failure = new Error("Tutorial inspection failed");
  const current = fixture((method) => {
    if (method === "session.create") return { session_id: "tutorial" };
    if (method === "session.view") throw failure;
    if (method === "session.destroy") throw new Error("Cleanup also failed");
    return {};
  });
  try {
    await assert.rejects(
      current.service.createTutorial(host),
      (error) => error === failure,
    );
    assert.deepEqual(current.calls.at(-1), {
      method: "session.destroy",
      payload: { session_id: "tutorial" },
    });
  } finally {
    current.service.dispose();
  }
});

test("plugin placement falls back to the target tab's first pane when it has no focused pane", async () => {
  const current = fixture((method) =>
    method === "session.view"
      ? {
          ...view,
          windows: view.windows.map((window) => ({
            ...window,
            focused_block_id: undefined,
          })),
        }
      : {},
  );
  try {
    await current.service.createBlock(host, "tutorial", {
      flavor: "plugin.notes",
      windowId: "window",
    });
    const call = current.calls.at(-1);
    assert.ok(call);
    assert.equal(call.method, "session.new_split");
    assert.equal(
      "anchor_id" in call.payload && call.payload.anchor_id,
      "pane",
    );
  } finally {
    current.service.dispose();
  }
});

test("a control rejected by the host authorization hook closes without publishing a connection", async () => {
  const current = fixture(
    () => ({}),
    () => {
      throw new Error("The host connection is no longer authorized.");
    },
  );
  try {
    await assert.rejects(current.service.control(host), /no longer authorized/);
    assert.deepEqual(
      current.controls.map((control) => control.connected),
      [false],
    );
    assert.deepEqual(current.calls, []);
  } finally {
    current.service.dispose();
  }
});

test("plugin blocks target a validated destination or open a new window without borrowing an anchor", async () => {
  const current = fixture((method) => (method === "session.view" ? view : {}));
  try {
    await current.service.createBlock(host, "tutorial", {
      flavor: "plugin.notes",
      options: { text: "hello" },
      windowId: "window",
    });
    assert.deepEqual(current.calls.at(-1), {
      method: "session.new_split",
      payload: {
        session_id: "tutorial",
        anchor_id: "pane",
        direction: "horizontal",
        side: "after",
        layout: {
          block: { flavor: "plugin.notes", options: { text: "hello" } },
        },
        focus: true,
      },
    });
    const before = current.calls.filter(
      (call) => call.method === "session.new_split",
    ).length;
    await assert.rejects(
      current.service.createBlock(host, "tutorial", {
        flavor: "plugin.notes",
        windowId: "absent",
      }),
      /destination tab has no pane/,
    );
    assert.equal(
      current.calls.filter((call) => call.method === "session.new_split")
        .length,
      before,
    );
    await current.service.createBlock(host, "tutorial", {
      flavor: "plugin.notes",
    });
    assert.equal(current.calls.at(-1)?.method, "session.new_window");
  } finally {
    current.service.dispose();
  }
});

test("disconnect revokes only the requested host transport and leaves other saved hosts connected", async () => {
  const current = fixture(() => ({}));
  const other = { ...host, id: "other", endpoint: "unix:///other.sock" };
  try {
    await current.service.status(host);
    await current.service.status(other);
    current.service.disconnect(host);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(current.controls[0].connected, false);
    assert.equal(current.controls[1].connected, true);
    await current.service.status(other);
    assert.equal(current.controls.length, 2);
  } finally {
    current.service.dispose();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
const welcome: RexWelcome = { protocol: "rex.control.v1", api_revision: 10 };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function pendingConnections(onControl?: RexServiceOptions["onControl"]) {
  const candidates: {
    ready: ReturnType<typeof deferred<RexWelcome>>;
    control: RexControl;
  }[] = [];
  const service = new RexService({
    onControl,
    controlFactory: (endpoint) => {
      const ready = deferred<RexWelcome>();
      const control = {
        endpoint,
        connected: true,
        readyPublic: () => ready.promise,
        dispose() {
          control.connected = false;
        },
      };
      const transport = control as unknown as RexControl;
      candidates.push({ ready, control: transport });
      return transport;
    },
  });
  return {
    service,
    candidates,
    close: () => {
      service.dispose();
      for (const candidate of candidates) candidate.ready.resolve(welcome);
    },
  };
}

test("an old failed waiter cannot erase the replacement connection or create a third transport", async () => {
  const current = pendingConnections();
  const attempts: Promise<unknown>[] = [];
  const observe = (pending: Promise<RexControl>) => {
    const result = pending.then(
      (control) => control,
      (error: unknown) => error,
    );
    attempts.push(result);
    return result;
  };
  try {
    const first = observe(current.service.control(host));
    const waiter = observe(current.service.control(host));
    await turn();
    current.service.reconnect(host);
    const replacement = observe(current.service.control(host));
    await turn();
    assert.equal(current.candidates.length, 2);
    current.candidates[0].ready.reject(new Error("Old handshake failed"));
    await turn();
    assert.equal(
      current.candidates.length,
      2,
      "A stale waiter must not start a third connection",
    );
    current.candidates[1].ready.resolve(welcome);
    assert.ok((await first) instanceof Error);
    assert.ok((await waiter) instanceof Error);
    assert.equal(await replacement, current.candidates[1].control);
    assert.equal(
      await current.service.control(host),
      current.candidates[1].control,
    );
  } finally {
    current.close();
    await Promise.all(attempts);
  }
});

test("disconnect revokes a pending handshake before it can bind or publish its control", async () => {
  const bound: RexControl[] = [];
  const current = pendingConnections((_host, control) => {
    bound.push(control);
  });
  const pending = current.service.control(host).then(
    (control) => control,
    (error: unknown) => error,
  );
  try {
    await turn();
    current.service.disconnect(host);
    assert.equal(
      current.candidates[0].control.connected,
      false,
      "Pending transport closes before its handshake settles",
    );
    current.candidates[0].ready.resolve(welcome);
    const result = await pending;
    assert.deepEqual(
      bound,
      [],
      "Revoked handshakes must not reach the authorization hook",
    );
    assert.ok(result instanceof Error);
    assert.equal(current.candidates[0].control.connected, false);
  } finally {
    current.close();
    await pending;
  }
});

test("revocation during an asynchronous control hook rejects that attempt while explicit retries still work", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let calls = 0;
  const current = pendingConnections(async () => {
    if (++calls === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const old = current.service.control(host).then(
    (control) => control,
    (error: unknown) => error,
  );
  try {
    await turn();
    current.candidates[0].ready.resolve(welcome);
    await entered.promise;
    current.service.disconnect(host);
    const retry = current.service.control(host);
    await turn();
    current.candidates[1].ready.resolve(welcome);
    const control = await retry;
    release.resolve();
    assert.ok((await old) instanceof Error);
    assert.equal(current.candidates[0].control.connected, false);
    assert.equal(await current.service.control(host), control);
    assert.equal(current.candidates.length, 2);
  } finally {
    release.resolve();
    current.close();
    await old;
  }
});

test("a failed current handshake can be retried by a later explicit request", async () => {
  const current = pendingConnections();
  const first = current.service.control(host);
  const rejected = assert.rejects(first, /Handshake unavailable/);
  try {
    await turn();
    current.candidates[0].ready.reject(new Error("Handshake unavailable"));
    await rejected;
    const retry = current.service.control(host);
    await turn();
    current.candidates[1].ready.resolve(welcome);
    assert.equal(await retry, current.candidates[1].control);
    assert.equal(current.candidates.length, 2);
  } finally {
    current.close();
    await rejected;
  }
});
