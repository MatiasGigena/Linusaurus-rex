import assert from "node:assert/strict";
import { test } from "node:test";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

test(
  "changing another host keeps an attached Rex terminal stream and its input uninterrupted",
  { skip: process.env.REX_INTEGRATION !== "1" },
  async () => {
    const rex = new RexService(),
      host = DEFAULT_SETTINGS.hosts[0];
    let sessionId: string | undefined, stop: (() => void) | undefined;
    let rejectOutput: (reason: Error) => void = () => {};
    try {
      sessionId = await rex.createSession(host, `host-isolation-${Date.now()}`);
      const view = await rex.inspect(host, sessionId),
        blockId = view.windows[0].panes[0].id;
      let ready!: () => void,
        resolveOutput!: () => void,
        output = "";
      const snapshot = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const marker = `UNINTERRUPTED_${Date.now()}`;
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
      await Promise.race([snapshot, received]);
      rex.reconnect({
        id: "other-host",
        label: "Offline host",
        endpoint: "unix:///tmp/linusaurus-unrelated-missing.sock",
      });
      await rex.input(host, sessionId, blockId, `printf '\\n${marker}\\n'\n`);
      const timer = setTimeout(
        () =>
          rejectOutput(
            new Error("The unaffected terminal stopped receiving output"),
          ),
        5000,
      );
      try {
        await received;
        assert.ok(output.includes(marker));
      } finally {
        clearTimeout(timer);
      }
    } finally {
      stop?.();
      if (sessionId)
        await rex.callMethod(host, "session.destroy", {
          session_id: sessionId,
        });
      rex.dispose();
    }
  },
);
