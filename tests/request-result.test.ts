import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureRequest,
  installRendererBridge,
  type RendererTransport,
} from "../src/shared/requestResult.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

function transport(request: RendererTransport["request"]): RendererTransport {
  return {
    request,
    onTerminal: () => () => {},
    onCommand: () => () => {},
    onClientEvent: () => () => {},
    replyAction: () => {},
    readClipboard: async () => "",
    writeClipboard: async () => {},
    getSettings: async () => DEFAULT_SETTINGS,
    setSettings: async (settings) => settings,
    windowControl: () => {},
  };
}

test("plain request results preserve error identity without exposing stacks or private properties", async () => {
  const failure = Object.assign(new Error("Session is gone"), {
    code: "session_not_found",
    method: "session.view",
    privateValue: "not for renderer",
  });
  const result = await captureRequest(() => Promise.reject(failure));
  assert.deepEqual(result, {
    ok: false,
    error: {
      name: "Error",
      message: "Session is gone",
      code: "session_not_found",
      method: "session.view",
    },
  });
  assert.deepEqual(await captureRequest(() => undefined), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await captureRequest(() => ({ ok: false })), {
    ok: true,
    value: { ok: false },
  });
});

test("renderer request wrapper reconstructs caller-world Error objects and preserves success values", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: target,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let result: unknown = { ok: true, value: { connected: true } };
  installRendererBridge(transport(async () => result));
  assert.deepEqual(await window.rex.request("status", { hostId: "host" }), {
    connected: true,
  });
  result = {
    ok: false,
    error: {
      name: "RexRequestError",
      message: "Session is gone",
      code: "session_not_found",
      method: "session.view",
    },
  };
  await assert.rejects(
    window.rex.request("inspectSession", { hostId: "host", sessionId: "gone" }),
    (failure) => {
      assert.ok(failure instanceof Error);
      assert.equal(failure.name, "RexRequestError");
      assert.equal(failure.message, "Session is gone");
      assert.equal("code" in failure && failure.code, "session_not_found");
      assert.equal("method" in failure && failure.method, "session.view");
      return true;
    },
  );
  result = {
    ok: false,
    error: { message: "Bad metadata", name: "Error", code: {} },
  };
  await assert.rejects(
    window.rex.request("status", { hostId: "host" }),
    /Invalid desktop request error/,
  );
});
