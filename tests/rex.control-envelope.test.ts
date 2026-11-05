import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";
import { RexControl, RexRequestError } from "../electron/rex/control.js";

async function fixture(
  response: (id: unknown) => unknown = (id) => ({
    type: "response",
    id,
    payload: {},
  }),
) {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    handleProtocols: () => "rex.control.v1",
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let accept!: (socket: WebSocket) => void;
  const peer = new Promise<WebSocket>((resolve) => {
    accept = resolve;
  });
  server.on("connection", (socket) => {
    accept(socket);
    socket.on("message", (bytes) => {
      const message: unknown = JSON.parse(bytes.toString());
      assert.ok(message && typeof message === "object" && "type" in message);
      if (message.type === "hello")
        socket.send(
          JSON.stringify({
            type: "welcome",
            protocol: "rex.control.v1",
            api_revision: 10,
          }),
        );
      else if (message.type === "request" && "id" in message)
        socket.send(JSON.stringify(response(message.id)));
    });
  });
  const control = new RexControl(`http://127.0.0.1:${address.port}`);
  await control.readyPublic();
  return {
    control,
    peer: await peer,
    close: async () => {
      control.dispose();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test(
  "malformed server request payloads never enter the typed request handler",
  { timeout: 5000 },
  async (t) => {
    for (const payload of [[], "text", 42, null])
      await t.test(JSON.stringify(payload), async () => {
        const current = await fixture();
        let settle!: (outcome: string) => void;
        const outcome = new Promise<string>((resolve) => {
          settle = resolve;
        });
        current.control.setRequestHandler(async () => {
          settle("handler entered");
          return {};
        });
        current.control.onEvent((event) => {
          if (event.type === "disconnected") settle("connection rejected");
        });
        try {
          current.peer.send(
            JSON.stringify({
              type: "request",
              id: "server-call",
              method: "client.inspect",
              payload,
            }),
          );
          assert.equal(await outcome, "connection rejected");
          assert.equal(current.control.connected, false);
        } finally {
          await current.close();
        }
      });
  },
);

test(
  "malformed RPC error metadata rejects its pending request without publishing a typed invalid code",
  { timeout: 5000 },
  async (t) => {
    for (const error of [{ message: 42 }, { code: 42 }, "refused", [], false])
      await t.test(JSON.stringify(error), async () => {
        const current = await fixture((id) => ({
          type: "response",
          id,
          error,
        }));
        try {
          await assert.rejects(
            current.control.call("server.status", {}),
            /invalid.*error/i,
          );
          assert.equal(current.control.connected, false);
        } finally {
          await current.close();
        }
      });
  },
);

test("checked RPC errors preserve identity and valid unknown event/result payloads stay intact", async () => {
  const current = await fixture((id) => ({
    type: "response",
    id,
    error: { message: "Policy denied", code: "refused" },
  }));
  try {
    await assert.rejects(current.control.call("server.status", {}), (error) => {
      assert.ok(error instanceof RexRequestError);
      assert.equal(error.message, "Policy denied");
      assert.equal(error.code, "refused");
      assert.equal(error.method, "server.status");
      return true;
    });
    assert.equal(current.control.connected, true);
    const received = new Promise<unknown>((resolve) =>
      current.control.onEvent((event) => {
        if (event.type === "future_event") resolve(event);
      }),
    );
    current.peer.send(
      JSON.stringify({
        type: "future_event",
        seq: "future-sequence",
        payload: ["extension"],
        future: true,
      }),
    );
    assert.deepEqual(await received, {
      type: "future_event",
      seq: "future-sequence",
      payload: ["extension"],
      future: true,
    });
  } finally {
    await current.close();
  }
});

test("server requests accept checked object payloads and an omitted payload defaults to an empty object", async () => {
  const current = await fixture();
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  current.control.setRequestHandler(async (method, payload) => {
    calls.push({ method, payload });
    return { accepted: true };
  });
  try {
    for (const payload of [undefined, { future: [1, 2] }]) {
      const response = new Promise<unknown>((resolve) =>
        current.peer.once("message", (bytes) =>
          resolve(JSON.parse(bytes.toString())),
        ),
      );
      current.peer.send(
        JSON.stringify({
          type: "request",
          id: "server-request",
          method: "client.inspect",
          payload,
        }),
      );
      assert.deepEqual(await response, {
        type: "response",
        id: "server-request",
        payload: { accepted: true },
      });
    }
    assert.deepEqual(calls, [
      { method: "client.inspect", payload: {} },
      { method: "client.inspect", payload: { future: [1, 2] } },
    ]);
  } finally {
    await current.close();
  }
});
