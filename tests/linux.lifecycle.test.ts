import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LinuxServerManager,
  originPatterns,
  validateOrigins,
  withOrigins,
} from "../electron/features/lifecycle.js";
import { RexControl } from "../electron/rex/control.js";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

test("origin overrides replace only startup origin flags and reject blanket/control patterns", () => {
  const args = [
    "server",
    "run",
    "--listen",
    "unix:///tmp/rex.sock",
    "--state-dir",
    "/safe/state",
    "--websocket-origin-pattern",
    "old.example.com",
    "--max-sessions",
    "9",
    "--websocket-origin-pattern=other.example.com",
  ];
  assert.deepEqual(originPatterns(args), [
    "old.example.com",
    "other.example.com",
  ]);
  const edited = withOrigins(
    args,
    validateOrigins(["localhost:3000", "*.example.com", "localhost:3000"]),
  );
  assert.deepEqual(originPatterns(edited), ["localhost:3000", "*.example.com"]);
  assert.deepEqual(edited.slice(0, 8), [
    "server",
    "run",
    "--listen",
    "unix:///tmp/rex.sock",
    "--state-dir",
    "/safe/state",
    "--max-sessions",
    "9",
  ]);
  assert.deepEqual(
    validateOrigins(["https://example.com:444", "https://*.example.com"]),
    ["example.com:444", "*.example.com"],
  );
  for (const bad of [
    "*",
    "https://user:secret@example.com",
    "bad\nsite",
    "example.com/path",
  ])
    assert.throws(() => validateOrigins([bad]));
});

test("lifecycle never force-stops a server with existing sessions and preserves exact launch arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-life-"));
  const calls: string[] = [];
  try {
    const manager = new LinuxServerManager({
      directory,
      call: async (_host, method, payload) => {
        calls.push(method);
        if (method === "server.status") return { pid: 100, session_count: 4 };
        throw new Error("Should never stop");
      },
      process: async () => ({
        endpoint: "unix:///tmp/owned.sock",
        executable: "/usr/bin/rex",
        args: [
          "server",
          "run",
          "--listen",
          "unix:///tmp/owned.sock",
          "--max-sessions",
          "9",
        ],
        env: { PATH: "/usr/bin", PRIVATE_TEST_TOKEN: "secret" },
      }),
    });
    const host = {
      id: "test",
      label: "Test",
      endpoint: "unix:///tmp/owned.sock",
    };
    await assert.rejects(
      manager.perform(host, "restart"),
      /4 existing sessions/,
    );
    assert.equal(calls.includes("server.stop"), false);
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(directory),
    );
    const stored = await readFile(join(directory, files[0]), "utf8");
    assert.equal(stored.includes("PRIVATE_TEST_TOKEN"), false);
    assert.match(stored, /max-sessions/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "installed Rex lifecycle and origins run only on an isolated server and preserve the real sessions",
  { skip: process.env.REX_INTEGRATION !== "1" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "linusaurus-life-live-"));
    const service = new RexService();
    const originalService = new RexService();
    const host = {
      id: "owned",
      label: "Owned lifecycle test",
      endpoint: `unix://${join(directory, "server.sock")}`,
    };
    const original = (await originalService.callMethod(
      DEFAULT_SETTINGS.hosts[0],
      "server.status",
      {},
    )) as { instance_id: string };
    const manager = new LinuxServerManager({
      directory: join(directory, "manager"),
      call: (host, method, payload) =>
        service.callMethod(host, method, payload),
    });
    let running = false;
    let ownSession: string | undefined;
    try {
      const started = await manager.perform(host, "start");
      running = true;
      assert.equal(started.running, true);
      assert.ok(started.stateDirectory?.startsWith(directory));
      ownSession = await service.createSession(
        host,
        "linux-lifecycle-owned",
        directory,
      );
      await assert.rejects(
        manager.perform(host, "restart"),
        /existing session/,
      );
      assert.ok(
        (await service.sessions(host)).some(
          (session) => session.id === ownSession,
        ),
      );
      await service.callMethod(host, "session.destroy", {
        session_id: ownSession,
      });
      ownSession = undefined;
      const other = new RexService();
      await other.sessions(host);
      try {
        await assert.rejects(
          manager.perform(host, "stop"),
          /use|client|conflict/i,
        );
        assert.equal((await manager.status(host)).running, true);
      } finally {
        other.dispose();
      }
      const restarted = await manager.perform(
        { ...host, websocketOrigins: ["localhost:3210", "*.example.com"] },
        "restart",
      );
      assert.equal(restarted.running, true);
      assert.deepEqual(restarted.origins, ["localhost:3210", "*.example.com"]);
      const trusted = new RexControl(host.endpoint, {
        headers: { Origin: "https://client.example.com" },
      });
      try {
        await trusted.readyPublic();
      } finally {
        trusted.dispose();
      }
      const untrusted = new RexControl(host.endpoint, {
        headers: { Origin: "https://untrusted.invalid" },
      });
      try {
        await assert.rejects(untrusted.readyPublic(), /403|origin|forbidden/i);
      } finally {
        untrusted.dispose();
      }
      await manager.perform(host, "stop");
      running = false;
      assert.equal((await manager.status(host)).running, false);
      const restored = new LinuxServerManager({
        directory: join(directory, "manager"),
        call: (host, method, payload) =>
          service.callMethod(host, method, payload),
      });
      const after = await restored.perform(host, "start");
      running = true;
      assert.deepEqual(after.origins, ["localhost:3210", "*.example.com"]);
      const realStatus = (await originalService.callMethod(
        DEFAULT_SETTINGS.hosts[0],
        "server.status",
        {},
      )) as { instance_id: string };
      assert.equal(
        realStatus.instance_id,
        original.instance_id,
        "The user server must never be restarted by lifecycle verification",
      );
    } finally {
      if (ownSession)
        await service
          .callMethod(host, "session.destroy", { session_id: ownSession })
          .catch(() => {});
      if (running) await manager.perform(host, "stop");
      service.dispose();
      originalService.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
