import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

test(
  "changing another host keeps an attached Rex terminal stream and its input uninterrupted",
  { skip: process.env.REX_INTEGRATION !== "1", timeout: 30_000 },
  async () => {
    const rex = new RexService(),
      host = DEFAULT_SETTINGS.hosts[0];
    let sessionId: string | undefined, stop: (() => void) | undefined;
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    let outputTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectOutput: (reason: Error) => void = () => {};
    try {
      sessionId = await rex.createSession(host, `host-isolation-${Date.now()}`);
      const view = await rex.inspect(host, sessionId),
        blockId = view.windows[0].panes[0].id;
      let ready!: () => void,
        resolveOutput!: () => void,
        output = "";
      const snapshot = new Promise<void>((resolve, reject) => {
        ready = resolve;
        snapshotTimer = setTimeout(
          () =>
            reject(
              new Error(
                `The terminal did not deliver its initial snapshot within 5 seconds. Output tail: ${JSON.stringify(output.slice(-2048))}`,
              ),
            ),
          5000,
        );
      });
      const token = randomUUID();
      const marker = `UNINTERRUPTED_${token}`;
      const received = new Promise<void>((resolve, reject) => {
        resolveOutput = resolve;
        rejectOutput = reject;
      });
      // Avoid an unhandled rejection while the input RPC is still completing.
      void received.catch(() => {});
      stop = rex.subscribe(
        host,
        sessionId,
        blockId,
        (data, kind) => {
          output += data;
          if (kind === "snapshot") ready();
          if (output.includes(marker)) resolveOutput();
        },
        (error) => rejectOutput(new Error(error)),
      );
      try {
        await Promise.race([snapshot, received]);
      } finally {
        clearTimeout(snapshotTimer);
        snapshotTimer = undefined;
      }
      rex.reconnect({
        id: "other-host",
        label: "Offline host",
        endpoint: "unix:///tmp/linusaurus-unrelated-missing.sock",
      });
      outputTimer = setTimeout(
        () =>
          rejectOutput(
            new Error("The unaffected terminal stopped receiving output"),
          ),
        5000,
      );
      // The complete marker never occurs in the echoed command, only its output.
      await rex.input(
        host,
        sessionId,
        blockId,
        `printf '\\nUNINTERRUPTED_%s\\n' ${token}\n`,
      );
      await received;
      assert.ok(output.includes(marker));
    } finally {
      clearTimeout(snapshotTimer);
      clearTimeout(outputTimer);
      stop?.();
      try {
        if (sessionId)
          await rex.callMethod(host, "session.destroy", {
            session_id: sessionId,
          });
      } finally {
        rex.dispose();
      }
    }
  },
);
