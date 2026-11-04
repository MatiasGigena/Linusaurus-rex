import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SystemdUserServices,
  originsDropIn,
} from "../electron/server-management/systemd.js";

const host = { id: "owned", label: "Owned", endpoint: "unix:///owned.sock" };
const unit = "owned-rex.service";
const objectPath = "/org/freedesktop/systemd1/unit/owned";

async function fixture(
  existing: boolean,
  reload: (attempt: number, path: string) => Promise<void>,
) {
  const directory = await mkdtemp(
    join(tmpdir(), "linusaurus-origins-rollback-"),
  );
  const unitRoot = join(directory, "systemd/user");
  const dropInDirectory = join(unitRoot, `${unit}.d`);
  const path = join(dropInDirectory, "90-linusaurus-origins.conf");
  const argv = ["/usr/bin/rex", "server", "run"];
  const before = existing
    ? originsDropIn(argv[0], argv, ["old.example"])
    : null;
  await mkdir(dropInDirectory, { recursive: true });
  if (before) await writeFile(path, before);
  const reloadContents: (string | null)[] = [];
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {},
    configDirectory: directory,
    run: async (executable, args) => {
      if (executable === "systemctl") {
        assert.deepEqual(args, ["--user", "daemon-reload"]);
        reloadContents.push(
          await readFile(path, "utf8").catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }),
        );
        await reload(reloadContents.length, path);
        return "";
      }
      assert.equal(executable, "busctl");
      if (args.includes("LoadUnit"))
        return JSON.stringify({ data: [objectPath] });
      if (args.includes("GetAll"))
        return JSON.stringify({
          data: [
            {
              Id: { data: unit },
              ActiveState: { data: "active" },
              SubState: { data: "running" },
              FragmentPath: { data: join(unitRoot, unit) },
              DropInPaths: { data: existing ? [path] : [] },
              TriggeredBy: { data: [] },
              Job: { data: [0, "/"] },
            },
          ],
        });
      const member = args.at(-1)!;
      const data: Record<string, unknown> = {
        UnitPath: [unitRoot],
        MainPID: 123,
        Restart: "always",
        RemainAfterExit: false,
        ExecStart: [[argv[0], argv, false]],
      };
      assert.ok(
        Object.hasOwn(data, member),
        `Unexpected busctl property ${member}`,
      );
      return JSON.stringify({ data: data[member] });
    },
  });
  const inspected = await services.inspect(unit);
  const preview = await services.preview(host, host.endpoint, inspected, [
    "new.example",
  ]);
  assert.equal(preview.before, before);
  assert.deepEqual(
    await readdir(dropInDirectory),
    existing ? ["90-linusaurus-origins.conf"] : [],
    "preview must not write a drop-in or backup",
  );
  return {
    services,
    preview,
    before,
    path,
    reloadContents,
    dropInDirectory,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

for (const existing of [false, true]) {
  const action = existing
    ? "restores the previous drop-in"
    : "removes the new drop-in";
  test(`origins apply ${action} and preserves the original error after successful rollback`, async () => {
    const primary = new Error("apply daemon reload failed");
    const f = await fixture(existing, async (attempt) => {
      if (attempt === 1) throw primary;
    });
    try {
      await assert.rejects(
        f.services.apply(host, host.endpoint, f.preview.previewId),
        (error) => error === primary,
      );
      assert.deepEqual(f.reloadContents, [f.preview.after, f.before]);
      if (existing) {
        assert.equal(await readFile(f.path, "utf8"), f.before);
        assert.equal(await readFile(f.preview.backupPath!, "utf8"), f.before);
      } else await assert.rejects(lstat(f.path), { code: "ENOENT" });
    } finally {
      await f.close();
    }
  });

  test(`origins apply reports both errors when it ${action} but rollback reload fails`, async () => {
    const primary = new Error("apply daemon reload failed");
    const rollback = new Error("rollback daemon reload failed");
    const f = await fixture(existing, async (attempt) => {
      throw attempt === 1 ? primary : rollback;
    });
    try {
      await assert.rejects(
        f.services.apply(host, host.endpoint, f.preview.previewId),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.deepEqual(error.errors, [primary, rollback]);
          assert.equal(error.cause, primary);
          assert.match(error.message, /apply daemon reload failed/);
          assert.match(error.message, /rollback daemon reload failed/);
          assert.match(
            error.message,
            existing
              ? /previous drop-in was restored/
              : /new drop-in was removed/,
          );
          assert.match(error.message, /service manager reload failed/);
          return true;
        },
      );
      assert.deepEqual(f.reloadContents, [f.preview.after, f.before]);
      if (existing) assert.equal(await readFile(f.path, "utf8"), f.before);
      else await assert.rejects(lstat(f.path), { code: "ENOENT" });
    } finally {
      await f.close();
    }
  });

  test(`origins apply distinguishes a failed file rollback from a failed manager reload (${existing ? "existing" : "new"} drop-in)`, async () => {
    const primary = new Error("apply daemon reload failed");
    const f = await fixture(existing, async (attempt, path) => {
      assert.equal(attempt, 1);
      await unlink(path);
      await mkdir(path);
      throw primary;
    });
    try {
      await assert.rejects(
        f.services.apply(host, host.endpoint, f.preview.previewId),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.errors[0], primary);
          assert.equal(
            (error.errors[1] as NodeJS.ErrnoException).code,
            "EISDIR",
          );
          assert.equal(error.cause, primary);
          assert.match(error.message, /apply daemon reload failed/);
          assert.match(error.message, /file rollback failed.*EISDIR/);
          assert.match(
            error.message,
            /service manager reload was not attempted/,
          );
          return true;
        },
      );
      assert.equal(f.reloadContents.length, 1);
      assert.equal((await lstat(f.path)).isDirectory(), true);
      assert.equal(
        (await readdir(f.dropInDirectory)).some((name) =>
          name.endsWith(".tmp"),
        ),
        false,
      );
      if (existing)
        assert.equal(await readFile(f.preview.backupPath!, "utf8"), f.before);
    } finally {
      await f.close();
    }
  });
}
