import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  symlink,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SystemdUserServices,
  originsDropIn,
  quoteSystemdArgument,
} from "../electron/features/systemd.js";
import { LinuxServerManager } from "../electron/features/lifecycle.js";
import { attestLocalRex } from "../electron/features/local-attestation.js";
import { RexService } from "../electron/rex/service.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
const execute = promisify(execFile);

test("systemd inspection reads scalar busctl properties without truncating them", async () => {
  const unit = "owned-rex.service",
    path = "/org/freedesktop/systemd1/unit/owned";
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    run: async (_executable, args) => {
      const member = args.at(-1);
      if (member === unit) return JSON.stringify({ type: "o", data: [path] });
      if (member === "org.freedesktop.systemd1.Unit")
        return JSON.stringify({
          type: "a{sv}",
          data: [
            {
              Id: { data: unit },
              ActiveState: { data: "active" },
              SubState: { data: "running" },
              FragmentPath: { data: "/user/owned-rex.service" },
              DropInPaths: { data: [] },
              Job: { data: [0, "/"] },
            },
          ],
        });
      const data = {
        MainPID: 123,
        Restart: "always",
        RemainAfterExit: false,
        ExecStart: [["/usr/bin/rex", ["/usr/bin/rex", "server", "run"], false]],
      }[member as "MainPID"];
      return JSON.stringify({ data });
    },
  });
  const actual = await services.inspect(unit);
  assert.equal(actual.unit, unit);
  assert.equal(actual.restart, "always");
  assert.equal(actual.mainPID, 123);
  assert.equal(actual.canManage, true);
});

test("systemd command serialization preserves literal quotes, dollars and percent signs", () => {
  assert.equal(quoteSystemdArgument('a"b\\c$HOME%t'), '"a\\"b\\\\c$$HOME%%t"');
  const result = originsDropIn(
    "/usr/bin/rex",
    [
      "/usr/bin/rex",
      "server",
      "run",
      "--state-dir",
      "/a folder",
      "--websocket-origin-pattern",
      "old.example",
    ],
    ["https://new.example.com"],
  );
  assert.match(result, /ExecStart=\nExecStart=/);
  assert.match(result, /"--state-dir" "\/a folder"/);
  assert.match(result, /"--websocket-origin-pattern" "new.example.com"/);
  assert.equal(result.includes("old.example"), false);
  assert.throws(() => quoteSystemdArgument("bad\nargument"), /control/);
});

test("owning service discovery reads scalar unit IDs and fails closed on inspection errors", async () => {
  const unit = "owned-rex.service",
    path = "/org/freedesktop/systemd1/unit/owned";
  let failInspection = false;
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    run: async (_executable, args) => {
      if (args.includes("GetUnitByPID") || args.includes("LoadUnit"))
        return JSON.stringify({ type: "o", data: [path] });
      const member = args.at(-1)!;
      if (member === "Id") return JSON.stringify({ type: "s", data: unit });
      if (member === "org.freedesktop.systemd1.Unit") {
        if (failInspection) throw new Error("fixture permission denied");
        return JSON.stringify({
          data: [
            {
              Id: { data: unit },
              ActiveState: { data: "active" },
              SubState: { data: "running" },
            },
          ],
        });
      }
      const values: Record<string, unknown> = {
        MainPID: process.pid,
        Restart: "always",
        RemainAfterExit: false,
        ExecStart: [
          [process.execPath, [process.execPath, "server", "run"], false],
        ],
      };
      return JSON.stringify({ data: values[member] });
    },
  });
  assert.equal(
    (await services.discover("unix:///owned.sock", process.pid))?.unit,
    unit,
  );
  failInspection = true;
  await assert.rejects(
    services.discover("unix:///owned.sock", process.pid),
    /owning service cannot be inspected safely.*permission denied/,
  );
});

test("explicit lifecycle recovery restores only stale owned guards, preserving live owners and unrelated files", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "linusaurus-guard-recovery-")),
    unit = "owned-rex.service",
    directory = join(runtime, "systemd/user.control", `${unit}.d`),
    startText = await readFile("/proc/self/stat", "utf8"),
    start = startText.slice(startText.lastIndexOf(")") + 2).split(" ")[19];
  const guard = (pid: number, identity: string) =>
    `# Managed by Linusaurus Rex: idle shutdown guard\n# Owner: ${pid} ${identity}\n[Service]\nRestart=no\n`;
  const file = () => join(directory, `99-linusaurus-idle-${randomUUID()}.conf`);
  const stale = file(),
    abandoned = file(),
    reused = file(),
    live = file(),
    changed = file(),
    linked = file(),
    unrelated = join(directory, "other.conf");
  const calls: string[][] = [];
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    runtimeDirectory: runtime,
    run: async (_executable, args) => {
      calls.push(args);
      return "";
    },
  });
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(stale, guard(2147483647, "1"));
    await writeFile(
      abandoned,
      guard(process.pid, start).replace(
        "[Service]",
        "# State: abandoned\n[Service]",
      ),
    );
    await writeFile(reused, guard(process.pid, "0"));
    await writeFile(live, guard(process.pid, start));
    await writeFile(
      changed,
      "# User edited the generated filename\n[Service]\nRestart=no\n",
    );
    await writeFile(unrelated, guard(2147483647, "1"));
    await symlink(unrelated, linked);
    await services.recoverIdleGuards(unit);
    assert.equal(
      await lstat(stale)
        .then(() => true)
        .catch(() => false),
      false,
    );
    assert.equal(
      await lstat(reused)
        .then(() => true)
        .catch(() => false),
      false,
    );
    assert.equal(
      await lstat(abandoned)
        .then(() => true)
        .catch(() => false),
      false,
      "A released guard remains recoverable while its desktop process is still alive",
    );
    assert.equal(await readFile(live, "utf8"), guard(process.pid, start));
    assert.match(await readFile(changed, "utf8"), /User edited/);
    assert.equal((await lstat(linked)).isSymbolicLink(), true);
    assert.equal(await readFile(unrelated, "utf8"), guard(2147483647, "1"));
    assert.deepEqual(calls, [["--user", "daemon-reload"]]);
    await services.recoverIdleGuards(unit);
    assert.equal(
      calls.length,
      1,
      "A status with no stale owner must not repeatedly reload units",
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("failed stale-guard reload retains an owned marker for an explicit retry", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "linusaurus-guard-retry-")),
    unit = "owned-rex.service",
    directory = join(runtime, "systemd/user.control", `${unit}.d`),
    path = join(directory, `99-linusaurus-idle-${randomUUID()}.conf`),
    text =
      "# Managed by Linusaurus Rex: idle shutdown guard\n# Owner: 2147483647 1\n[Service]\nRestart=no\n";
  let attempts = 0;
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    runtimeDirectory: runtime,
    run: async () => {
      if (++attempts === 1) throw new Error("fixture reload failed");
      return "";
    },
  });
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path, text);
    await assert.rejects(
      services.recoverIdleGuards(unit),
      /fixture reload failed/,
    );
    assert.equal(await readFile(path, "utf8"), text);
    await services.recoverIdleGuards(unit);
    assert.equal(
      await lstat(path)
        .then(() => true)
        .catch(() => false),
      false,
    );
    assert.equal(attempts, 2);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("origin preview rejects an XDG directory outside the manager UnitPath before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-unitpath-"));
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    configDirectory: directory,
    run: async () =>
      JSON.stringify({ type: "as", data: ["/other/systemd/user"] }),
  });
  try {
    await assert.rejects(
      services.preview(
        { id: "owned", label: "Owned", endpoint: "unix:///owned.sock" },
        "unix:///owned.sock",
        {
          unit: "owned.service",
          scope: "user",
          activeState: "active",
          subState: "running",
          restart: "always",
          fragmentPath: "/owned",
          dropInPaths: [],
          configuredOrigins: [],
          canManage: true,
          objectPath: "/owned",
          mainPID: 123,
          execPath: "/usr/bin/rex",
          argv: ["/usr/bin/rex", "server", "run"],
          remainAfterExit: false,
          triggeredBy: [],
          job: 0,
        },
        ["client.example"],
      ),
      /outside the user service manager/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "owned Restart=always user service preserves sessions and unrelated configuration while reviewing persistent origins",
  { skip: process.env.REX_INTEGRATION !== "1" || !process.env.XDG_RUNTIME_DIR },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "linusaurus-systemd-"));
    const runtime = process.env.XDG_RUNTIME_DIR!;
    const unit = `linusaurus-test-${randomUUID()}.service`,
      unitRoot = join(runtime, "systemd/user"),
      unitPath = join(unitRoot, unit),
      extraDir = join(unitRoot, `${unit}.d`),
      extra = join(extraDir, "10-unrelated-owned.conf");
    const host = {
      id: "owned-systemd",
      label: "Owned systemd server",
      endpoint: `unix://${join(directory, "server.sock")}`,
    };
    const service = new RexService();
    const originalService = new RexService();
    const calls: { executable: string; args: string[] }[] = [];
    let failGuardRestoreReload = false;
    const run = async (executable: string, args: string[]) => {
      calls.push({ executable, args });
      if (
        failGuardRestoreReload &&
        executable === "systemctl" &&
        args.includes("daemon-reload")
      ) {
        const files = await readdir(
          join(runtime, "systemd/user.control", `${unit}.d`),
        ).catch(() => []);
        if (!files.some((name) => name.startsWith("99-linusaurus-idle-"))) {
          failGuardRestoreReload = false;
          throw new Error("fixture guard restoration reload failed");
        }
      }
      return (
        await execute(executable, args, {
          timeout: 8000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout;
    };
    const services = new SystemdUserServices({
      call: (h, m, p) => service.callMethod(h, m, p),
      attest: attestLocalRex,
      runtimeDirectory: runtime,
      configDirectory: runtime,
      run,
    });
    const lifecycle = new LinuxServerManager({
      directory: join(directory, "manager"),
      call: (h, m, p) => service.callMethod(h, m, p),
      systemd: services,
    });
    const ready = async () => {
      for (let index = 0; index < 100; index++) {
        try {
          const status = await lifecycle.status(host);
          if (status.running && status.service) return status;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Owned Rex service did not become ready");
    };
    let started = false,
      sessionId: string | undefined;
    const command = [
      "/usr/bin/rex",
      "server",
      "run",
      "--listen",
      host.endpoint,
      "--state-dir",
      join(directory, "state"),
      "--config",
      join(directory, "init.lua"),
    ];
    const unitText = `[Unit]\nDescription=Owned Linusaurus test only\n[Service]\nType=simple\nExecStart=${command.map(quoteSystemdArgument).join(" ")}\nRestart=always\nRestartSec=50ms\nUMask=0077\nEnvironment=LINUSAURUS_UNIT_SENTINEL=preserve\n`;
    const extraText =
      "[Service]\nNice=5\nEnvironment=LINUSAURUS_DROPIN_SENTINEL=keep\n";
    try {
      const original = await originalService.callMethod<{
        pid: number;
        instance_id: string;
      }>(DEFAULT_SETTINGS.hosts[0], "server.status", {});
      await mkdir(unitRoot, { recursive: true });
      await mkdir(extraDir, { recursive: true });
      await writeFile(
        join(directory, "init.lua"),
        "-- Owned systemd fixture\n",
      );
      await writeFile(unitPath, unitText, { flag: "wx", mode: 0o600 });
      await writeFile(extra, extraText, { flag: "wx", mode: 0o600 });
      await run("systemctl", ["--user", "daemon-reload"]);
      await run("systemctl", ["--user", "start", unit]);
      started = true;
      const initial = await ready();
      assert.equal(initial.running, true);
      assert.equal(initial.service?.unit, unit);
      assert.equal(initial.service?.scope, "user");
      assert.equal(initial.service?.restart, "always");
      assert.equal(initial.service?.canManage, true);
      sessionId = await service.createSession(host, "systemd-owned", directory);
      const abandonedDirectory = join(
          runtime,
          "systemd/user.control",
          `${unit}.d`,
        ),
        abandoned = join(
          abandonedDirectory,
          `99-linusaurus-idle-${randomUUID()}.conf`,
        );
      await mkdir(abandonedDirectory, { recursive: true });
      await writeFile(
        abandoned,
        "# Managed by Linusaurus Rex: idle shutdown guard\n# Owner: 2147483647 1\n[Service]\nRestart=no\n",
        { flag: "wx", mode: 0o600 },
      );
      await run("systemctl", ["--user", "daemon-reload"]);
      assert.equal(
        (await lifecycle.status(host)).service?.restart,
        "no",
        "Read-only status must not remove an abandoned guard",
      );
      assert.equal((await lstat(abandoned)).isFile(), true);
      await assert.rejects(
        lifecycle.perform(host, "restart"),
        /existing session/,
      );
      assert.equal((await lifecycle.status(host)).pid, initial.pid);
      assert.equal(
        (await lifecycle.status(host)).service?.restart,
        "always",
        "An explicit action recovers a crashed desktop guard even when an existing session prevents restart",
      );
      assert.equal(
        await lstat(abandoned)
          .then(() => true)
          .catch(() => false),
        false,
      );
      const preview = await lifecycle.previewOrigins(host, [
        "https://client.example.com",
        "*.trusted.example",
      ]);
      assert.equal(preview.before, null);
      assert.equal(
        await lstat(preview.path)
          .then(() => true)
          .catch(() => false),
        false,
        "Preview must not write files",
      );
      const applied = await lifecycle.applyOrigins(host, preview.previewId);
      assert.deepEqual(applied.service?.configuredOrigins, [
        "client.example.com",
        "*.trusted.example",
      ]);
      assert.deepEqual(applied.origins, []);
      assert.deepEqual(applied.pendingOrigins, [
        "client.example.com",
        "*.trusted.example",
      ]);
      assert.equal(applied.pid, initial.pid);
      await assert.rejects(
        lifecycle.applyOrigins(host, preview.previewId),
        /expired/,
      );
      assert.ok(
        (await service.sessions(host)).some(
          (session) => session.id === sessionId,
        ),
      );
      const stale = await lifecycle.previewOrigins(host, ["other.example"]);
      await writeFile(stale.path, stale.before + "# External edit\n");
      await assert.rejects(
        lifecycle.applyOrigins(host, stale.previewId),
        /changed after preview/,
      );
      await writeFile(stale.path, stale.before!);
      const competing = join(extraDir, "99-override-owned.conf"),
        competingText = `[Service]\nExecStart=\nExecStart=${command.map(quoteSystemdArgument).join(" ")}\n`;
      await writeFile(competing, competingText, { flag: "wx", mode: 0o600 });
      await run("systemctl", ["--user", "daemon-reload"]);
      const overridden = await lifecycle.previewOrigins(host, [
        "overridden.example",
      ]);
      await assert.rejects(
        lifecycle.applyOrigins(host, overridden.previewId),
        /overrides the requested origins/,
      );
      assert.equal(
        await readFile(overridden.path, "utf8"),
        overridden.before,
        "An overridden apply must roll back its dedicated file",
      );
      assert.equal(
        await readFile(competing, "utf8"),
        competingText,
        "A competing drop-in is never edited",
      );
      assert.equal((await lifecycle.status(host)).pid, initial.pid);
      await rm(competing);
      await run("systemctl", ["--user", "daemon-reload"]);
      await service.callMethod(host, "session.destroy", {
        session_id: sessionId,
      });
      sessionId = undefined;
      const other = new RexService();
      await other.sessions(host);
      try {
        await assert.rejects(
          lifecycle.perform(host, "restart"),
          /use|client|conflict/i,
        );
        const unchanged = await lifecycle.status(host);
        assert.equal(unchanged.pid, initial.pid);
        assert.equal(
          unchanged.service?.restart,
          "always",
          "A rejected atomic stop must restore Restart policy",
        );
      } finally {
        other.dispose();
      }
      const restarted = await lifecycle.perform(host, "restart");
      assert.notEqual(restarted.pid, initial.pid);
      assert.deepEqual(restarted.origins, [
        "client.example.com",
        "*.trusted.example",
      ]);
      assert.equal(restarted.pendingOrigins, undefined);
      assert.equal(restarted.service?.restart, "always");
      const second = await lifecycle.previewOrigins(host, []);
      assert.equal(second.backupPath, second.path + ".linusaurus-backup");
      await lifecycle.applyOrigins(host, second.previewId);
      assert.equal(await readFile(second.backupPath!, "utf8"), second.before);
      const afterClear = await lifecycle.perform(host, "restart");
      assert.deepEqual(afterClear.origins, []);
      assert.equal(afterClear.service?.restart, "always");
      assert.equal(await readFile(unitPath, "utf8"), unitText);
      assert.equal(await readFile(extra, "utf8"), extraText);
      const options = await run("systemctl", [
        "--user",
        "show",
        unit,
        "--property=UMask,Nice,Environment",
        "--no-pager",
      ]);
      assert.match(options, /UMask=0077/);
      assert.match(options, /Nice=5/);
      assert.match(options, /LINUSAURUS_UNIT_SENTINEL=preserve/);
      assert.match(options, /LINUSAURUS_DROPIN_SENTINEL=keep/);
      await lifecycle.perform(host, "stop");
      started = false;
      assert.equal((await lifecycle.status(host)).running, false);
      assert.equal(
        await lstat(unitPath).then(() => true),
        true,
        "A runtime file unit remains reloadable after idle exit",
      );
      const rebound = new LinuxServerManager({
        directory: join(directory, "manager"),
        call: (h, m, p) => service.callMethod(h, m, p),
        systemd: services,
      });
      const again = await rebound.perform(host, "start");
      started = true;
      assert.equal(again.running, true);
      assert.equal(again.service?.unit, unit);
      failGuardRestoreReload = true;
      await assert.rejects(
        rebound.perform(host, "stop"),
        /fixture guard restoration reload failed/,
      );
      started = false;
      const abandonedFiles = await readdir(
        join(runtime, "systemd/user.control", `${unit}.d`),
      );
      assert.equal(abandonedFiles.length, 1);
      assert.match(
        await readFile(
          join(runtime, "systemd/user.control", `${unit}.d`, abandonedFiles[0]),
          "utf8",
        ),
        /# State: abandoned/,
      );
      const recovered = await rebound.perform(host, "start");
      started = true;
      assert.equal(recovered.running, true);
      assert.equal(
        recovered.service?.restart,
        "always",
        "Retry after a failed guard restoration must restore the underlying Restart policy",
      );
      assert.deepEqual(
        await readdir(join(runtime, "systemd/user.control", `${unit}.d`)),
        [],
      );
      assert.equal(
        calls.some(
          (call) =>
            call.executable === "systemctl" &&
            call.args.some((arg) => ["stop", "restart", "kill"].includes(arg)),
        ),
        false,
        "No force-stop or service restart command may run",
      );
      const preserved = await originalService.callMethod<{
        pid: number;
        instance_id: string;
      }>(DEFAULT_SETTINGS.hosts[0], "server.status", {});
      assert.equal(
        preserved.pid,
        original.pid,
        "The installed user server must remain running unchanged",
      );
      assert.equal(preserved.instance_id, original.instance_id);
    } finally {
      try {
        if (sessionId)
          await service.callMethod(host, "session.destroy", {
            session_id: sessionId,
          });
        if (started) await lifecycle.perform(host, "stop");
      } catch {
        // Failed fixture setup can unlink its own socket before RPC cleanup.
        // This exact generated test unit is ours; production never calls StopUnit.
        await run("systemctl", ["--user", "stop", unit]);
      }
      service.dispose();
      originalService.dispose();
      await rm(unitPath, { force: true });
      await rm(extraDir, { recursive: true, force: true });
      await rm(join(runtime, "systemd/user.control", `${unit}.d`), {
        recursive: true,
        force: true,
      });
      await run("systemctl", ["--user", "daemon-reload"]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
