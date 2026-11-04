import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SystemdUserServices,
  type ServiceSnapshot,
} from "../electron/server-management/systemd.js";

const unit = "owned-rex.service";
const host = { id: "owned", label: "Owned", endpoint: "unix:///owned.sock" };
const staleText =
  "# Managed by Linusaurus Rex: idle shutdown guard\n# Owner: 2147483647 1\n[Service]\nRestart=no\n";

async function runtimeFixture() {
  const runtime = await mkdtemp(join(tmpdir(), "linusaurus-guard-failure-"));
  const directory = join(runtime, "systemd/user.control", `${unit}.d`);
  await mkdir(directory, { recursive: true });
  return {
    runtime,
    directory,
    async stale() {
      const path = join(directory, `99-linusaurus-idle-${randomUUID()}.conf`);
      await writeFile(path, staleText, { flag: "wx", mode: 0o600 });
      return path;
    },
    close: () => rm(runtime, { recursive: true, force: true }),
  };
}

function compound(error: unknown, primary: Error) {
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, primary);
  assert.equal(error.errors[0], primary);
  assert.ok(error.message.includes(primary.message));
  return error;
}

for (const count of [1, 2]) {
  test(`stale recovery retains reload failure and attempts all ${count} removed marker writes`, async () => {
    const f = await runtimeFixture();
    const paths = await Promise.all(
      Array.from({ length: count }, () => f.stale()),
    );
    const primary = new Error("stale guard manager reload failed");
    const services = new SystemdUserServices({
      runtimeDirectory: f.runtime,
      attest: async () => {},
      call: async () => {},
      run: async (_executable, args) => {
        assert.deepEqual(args, ["--user", "daemon-reload"]);
        assert.deepEqual(await readdir(f.directory), []);
        await rm(f.directory, { recursive: true });
        throw primary;
      },
    });
    try {
      await assert.rejects(services.recoverIdleGuards(unit), (error) => {
        const aggregate = compound(error, primary);
        assert.equal(aggregate.errors.length, count + 1);
        const failures = aggregate.errors.slice(1) as NodeJS.ErrnoException[];
        assert.ok(failures.every((failure) => failure.code === "ENOENT"));
        assert.deepEqual(
          new Set(failures.map((failure) => failure.path)),
          new Set(paths),
        );
        assert.match(aggregate.message, /marker restoration failed/i);
        assert.match(aggregate.message, /Restart policy.*unconfirmed/i);
        return true;
      });
      await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    } finally {
      await f.close();
    }
  });
}

test("a conflicting marker is left untouched while other removed stale markers are restored and recoverable", async () => {
  const f = await runtimeFixture();
  const conflict = await f.stale();
  const restored = await f.stale();
  const primary = new Error("stale reload failed with a competing marker");
  let reloads = 0;
  const services = new SystemdUserServices({
    runtimeDirectory: f.runtime,
    attest: async () => {},
    call: async () => {},
    run: async () => {
      if (++reloads === 1) {
        await writeFile(conflict, "External replacement\n", { flag: "wx" });
        throw primary;
      }
      return "";
    },
  });
  try {
    await assert.rejects(services.recoverIdleGuards(unit), (error) => {
      const aggregate = compound(error, primary);
      assert.equal(
        (aggregate.errors[1] as NodeJS.ErrnoException).code,
        "EEXIST",
      );
      assert.match(aggregate.message, /conflicting file.*left untouched/i);
      assert.ok(aggregate.message.includes(restored));
      return true;
    });
    assert.equal(await readFile(conflict, "utf8"), "External replacement\n");
    assert.equal(await readFile(restored, "utf8"), staleText);
    await services.recoverIdleGuards(unit);
    await assert.rejects(lstat(restored), { code: "ENOENT" });
    assert.equal(await readFile(conflict, "utf8"), "External replacement\n");
    assert.equal(reloads, 2);
  } finally {
    await f.close();
  }
});

test(
  "a stale scan failure survives a second daemon-reload failure after an earlier removal",
  { skip: process.getuid?.() === 0 },
  async () => {
    const f = await runtimeFixture();
    await f.stale();
    await f.stale();
    const names = await readdir(f.directory);
    const removed = join(f.directory, names[0]);
    const unreadable = join(f.directory, names[1]);
    const reload = new Error("manager reload also failed after the scan error");
    let reloads = 0;
    const services = new SystemdUserServices({
      runtimeDirectory: f.runtime,
      attest: async () => {},
      call: async () => {},
      run: async () => {
        reloads++;
        throw reload;
      },
    });
    try {
      await chmod(unreadable, 0);
      await assert.rejects(services.recoverIdleGuards(unit), (error) => {
        assert.ok(error instanceof AggregateError);
        const primary = error.errors[0] as NodeJS.ErrnoException;
        assert.equal(primary.code, "EACCES");
        assert.equal(primary.path, unreadable);
        assert.equal(error.cause, primary);
        assert.equal(error.errors[1], reload);
        assert.match(error.message, /EACCES/);
        assert.ok(error.message.includes(reload.message));
        assert.match(error.message, /marker restored/i);
        return true;
      });
      assert.equal(reloads, 1);
      assert.equal(await readFile(removed, "utf8"), staleText);
    } finally {
      await chmod(unreadable, 0o600);
      await f.close();
    }
  },
);

type RuntimeFixture = Awaited<ReturnType<typeof runtimeFixture>>;
interface StopFixture extends RuntimeFixture {
  services: SystemdUserServices;
  snapshot: ServiceSnapshot;
  reloads: number;
  calls: number;
  paths(): Promise<string[]>;
  stop(): Promise<void>;
}
async function stopFixture(
  hooks: {
    reload?(attempt: number, f: StopFixture): Promise<void>;
    inspect?(
      attempt: number,
      snapshot: ServiceSnapshot,
      f: StopFixture,
    ): Promise<ServiceSnapshot>;
    call?(f: StopFixture): Promise<void>;
  } = {},
): Promise<StopFixture> {
  const runtime = await runtimeFixture();
  const snapshot: ServiceSnapshot = {
    unit,
    scope: "user",
    activeState: "active",
    subState: "running",
    restart: "always",
    fragmentPath: "/owned/rex.service",
    dropInPaths: [],
    configuredOrigins: [],
    canManage: true,
    objectPath: "/owned",
    mainPID: process.pid,
    execPath: "/usr/bin/rex",
    argv: ["/usr/bin/rex", "server", "run"],
    remainAfterExit: false,
    triggeredBy: [],
    job: 0,
  };
  let stopped = false;
  let inspections = 0;
  class InspectedServices extends SystemdUserServices {
    override async inspect(name: string, scope: "user" | "system" = "user") {
      assert.equal(name, unit);
      assert.equal(scope, "user");
      const paths = await f.paths();
      const current = {
        ...snapshot,
        mainPID: stopped ? 0 : process.pid,
        restart: paths.length ? "no" : "always",
        dropInPaths: paths,
      };
      inspections++;
      return hooks.inspect?.(inspections, current, f) ?? current;
    }
  }
  const services = new InspectedServices({
    runtimeDirectory: runtime.runtime,
    attest: async (endpoint, pid) => {
      assert.equal(endpoint, host.endpoint);
      assert.equal(pid, process.pid);
    },
    run: async (executable, args) => {
      assert.equal(executable, "systemctl");
      assert.deepEqual(args, ["--user", "daemon-reload"]);
      f.reloads++;
      await hooks.reload?.(f.reloads, f);
      return "";
    },
    call: async (target, method, payload) => {
      assert.equal(target, host);
      assert.equal(method, "server.stop");
      assert.deepEqual(payload, { if_idle: true });
      f.calls++;
      await hooks.call?.(f);
      stopped = true;
    },
  });
  const f: StopFixture = {
    ...runtime,
    services,
    snapshot,
    reloads: 0,
    calls: 0,
    paths: async () =>
      (await readdir(runtime.directory))
        .filter((name) => name.startsWith("99-linusaurus-idle-"))
        .map((name) => join(runtime.directory, name)),
    stop: () => services.stop(host, host.endpoint, process.pid, snapshot),
  };
  return f;
}

test("guard setup preserves its reload failure when restoration succeeds", async () => {
  const primary = new Error("guard setup reload failed");
  const f = await stopFixture({
    reload: async (attempt) => {
      if (attempt === 1) throw primary;
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => error === primary);
    assert.equal(f.reloads, 2);
    assert.equal(f.calls, 0);
    assert.deepEqual(await f.paths(), []);
  } finally {
    await f.close();
  }
});

test("guard setup preserves a real lstat failure instead of treating an inaccessible path as missing", async () => {
  const primary = new Error(
    "guard setup reload failed before path obstruction",
  );
  const f = await stopFixture({
    reload: async (attempt, f) => {
      assert.equal(attempt, 1);
      await rm(f.directory, { recursive: true });
      await writeFile(f.directory, "External path obstruction\n");
      throw primary;
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => {
      const aggregate = compound(error, primary);
      assert.equal(
        (aggregate.errors[1] as NodeJS.ErrnoException).code,
        "ENOTDIR",
      );
      assert.match(aggregate.message, /ENOTDIR/);
      return true;
    });
    assert.equal(
      await readFile(f.directory, "utf8"),
      "External path obstruction\n",
    );
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
});

test("guard verification failure and a changed owned guard both survive setup recovery", async () => {
  const primary = new Error("guard verification bus inspection failed");
  let path = "";
  const f = await stopFixture({
    inspect: async (attempt, snapshot, f) => {
      if (attempt === 2) {
        [path] = await f.paths();
        await writeFile(path, "External guard edit\n");
        throw primary;
      }
      return snapshot;
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => {
      const aggregate = compound(error, primary);
      assert.match((aggregate.errors[1] as Error).message, /guard changed/i);
      assert.match(aggregate.message, /conflicting file.*left untouched/i);
      return true;
    });
    assert.equal(await readFile(path, "utf8"), "External guard edit\n");
    assert.equal(f.reloads, 1);
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
});

test("failed setup plus failed restore reload retain both errors and an abandoned marker for explicit retry", async () => {
  const primary = new Error("guard setup daemon reload failed");
  const recovery = new Error("guard restore daemon reload failed");
  const f = await stopFixture({
    reload: async (attempt) => {
      if (attempt === 1) throw primary;
      if (attempt === 2) throw recovery;
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => {
      const aggregate = compound(error, primary);
      assert.equal(aggregate.errors[1], recovery);
      assert.ok(aggregate.message.includes(recovery.message));
      assert.match(aggregate.message, /abandoned marker was written/i);
      assert.match(aggregate.message, /Restart policy.*unconfirmed/i);
      return true;
    });
    const [path] = await f.paths();
    assert.match(await readFile(path, "utf8"), /# State: abandoned\n/);
    await f.services.recoverIdleGuards(unit);
    assert.deepEqual(await f.paths(), []);
    assert.equal(f.reloads, 3);
    assert.equal(f.calls, 0);
  } finally {
    await f.close();
  }
});

for (const failureAt of ["stop", "exit inspection"] as const) {
  test(`${failureAt} failure survives a changed guard during final restoration`, async () => {
    const primary = new Error(`${failureAt} original failure`);
    let path = "";
    const fail = async (f: StopFixture) => {
      [path] = await f.paths();
      await writeFile(path, "External edit during stop\n");
      throw primary;
    };
    const f = await stopFixture(
      failureAt === "stop"
        ? { call: fail }
        : {
            inspect: async (attempt, snapshot, f) =>
              attempt === 3 ? fail(f) : snapshot,
          },
    );
    try {
      await assert.rejects(f.stop(), (error) => {
        const aggregate = compound(error, primary);
        assert.match((aggregate.errors[1] as Error).message, /guard changed/i);
        assert.match(aggregate.message, /conflicting file.*left untouched/i);
        return true;
      });
      assert.equal(await readFile(path, "utf8"), "External edit during stop\n");
      assert.equal(f.calls, 1);
      assert.equal(f.reloads, 1);
    } finally {
      await f.close();
    }
  });
}

test("successful stop reports restore reload and abandoned-marker write failures together", async () => {
  const primary = new Error("post-stop guard removal reload failed");
  const f = await stopFixture({
    reload: async (attempt, f) => {
      if (attempt === 2) {
        await rm(f.directory, { recursive: true });
        throw primary;
      }
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => {
      const aggregate = compound(error, primary);
      assert.equal(
        (aggregate.errors[1] as NodeJS.ErrnoException).code,
        "ENOENT",
      );
      assert.match(aggregate.message, /guard was removed/i);
      assert.match(aggregate.message, /abandoned marker restoration failed/i);
      assert.match(aggregate.message, /Restart policy.*unconfirmed/i);
      return true;
    });
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    assert.equal(f.calls, 1);
    assert.equal(f.reloads, 2);
  } finally {
    await f.close();
  }
});

test("restore preserves a conflicting file instead of replacing it with an abandoned marker", async () => {
  const primary = new Error(
    "restore reload failed while another writer replaced the marker",
  );
  let path = "";
  const f = await stopFixture({
    reload: async (attempt, f) => {
      if (attempt === 1) [path] = await f.paths();
      if (attempt === 2) {
        await writeFile(path, "Competing runtime guard\n", { flag: "wx" });
        throw primary;
      }
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => {
      const aggregate = compound(error, primary);
      assert.equal(
        (aggregate.errors[1] as NodeJS.ErrnoException).code,
        "EEXIST",
      );
      assert.match(aggregate.message, /conflicting file.*left untouched/i);
      assert.match(aggregate.message, /Restart policy.*unconfirmed/i);
      return true;
    });
    assert.equal(await readFile(path, "utf8"), "Competing runtime guard\n");
    assert.equal(f.calls, 1);
    assert.equal(f.reloads, 2);
  } finally {
    await f.close();
  }
});

test("failed atomic stop is rethrown unchanged after successful guard restoration", async () => {
  const primary = new Error("server still has a connected client");
  const f = await stopFixture({
    call: async () => {
      throw primary;
    },
  });
  try {
    await assert.rejects(f.stop(), (error) => error === primary);
    assert.equal(f.calls, 1);
    assert.equal(f.reloads, 2);
    assert.deepEqual(await f.paths(), []);
  } finally {
    await f.close();
  }
});

test("successful atomic stop removes its owned guard and restores manager policy", async () => {
  const f = await stopFixture();
  try {
    await f.stop();
    assert.equal(f.calls, 1);
    assert.equal(f.reloads, 2);
    assert.deepEqual(await f.paths(), []);
  } finally {
    await f.close();
  }
});
