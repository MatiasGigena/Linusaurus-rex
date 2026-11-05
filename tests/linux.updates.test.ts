import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LinuxUpdateManager,
  checksumFor,
  newerVersion,
  selectRelease,
} from "../electron/updates/updates.js";
const root =
  "https://github.com/MatiasGigena/Linusaurus-rex/releases/download/v0.3.0/";
const bytes = Buffer.from("new verified AppImage fixture");
const hash = createHash("sha256").update(bytes).digest("hex");
const release = {
  tag_name: "v0.3.0",
  html_url:
    "https://github.com/MatiasGigena/Linusaurus-rex/releases/tag/v0.3.0",
  assets: [
    {
      name: "Linusaurus-Rex-0.3.0-x86_64.AppImage",
      browser_download_url: `${root}Linusaurus-Rex-0.3.0-x86_64.AppImage`,
      size: bytes.length,
    },
    {
      name: "SHA256SUMS",
      browser_download_url: `${root}SHA256SUMS`,
      size: 100,
    },
  ],
};
const fixtureFetch =
  (
    manifest = `${hash}  ${release.assets[0].name}\n`,
    payload: Uint8Array = bytes,
  ) =>
  async (url: unknown) =>
    String(url).includes("api.github.com")
      ? new Response(JSON.stringify(release))
      : String(url).endsWith("SHA256SUMS")
        ? new Response(manifest)
        : new Response(Uint8Array.from(payload).buffer);

test("update selection pins project assets, requires compatible checksums and compares numeric versions", () => {
  assert.equal(newerVersion("v0.10.0", "0.9.9"), true);
  assert.equal(newerVersion("0.2.0", "0.2.0"), false);
  assert.equal(newerVersion("v0.3.0", "0.3.0-beta.1"), true);
  assert.equal(
    selectRelease(release, "0.2.0", "appimage")?.asset.name,
    release.assets[0].name,
  );
  assert.equal(
    selectRelease({ ...release, prerelease: true }, "0.2.0", "appimage"),
    undefined,
  );
  assert.throws(
    () =>
      selectRelease(
        { ...release, assets: [release.assets[0]] },
        "0.2.0",
        "appimage",
      ),
    /checksum/,
  );
  assert.throws(
    () =>
      selectRelease(
        {
          ...release,
          assets: [
            {
              ...release.assets[0],
              browser_download_url: "https://evil.example/payload.AppImage",
            },
            release.assets[1],
          ],
        },
        "0.2.0",
        "appimage",
      ),
    /project/,
  );
  assert.equal(
    checksumFor(`${hash} *${release.assets[0].name}`, release.assets[0].name),
    hash,
  );
  assert.throws(
    () => checksumFor(`${hash}  different.AppImage`, release.assets[0].name),
    /does not include/,
  );
});

test("verified AppImage installation preserves a backup and never touches Rex sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-update-"));
  const current = join(directory, "current.AppImage");
  await writeFile(current, "old appimage", { mode: 0o755 });
  const installations: string[] = [];
  const manager = new LinuxUpdateManager({
    directory: join(directory, "downloads"),
    version: "0.2.0",
    appImage: current,
    fetch: fixtureFetch() as typeof fetch,
    install: async (path) => {
      installations.push(path);
    },
  });
  try {
    assert.equal((await manager.check()).phase, "available");
    assert.equal((await manager.download()).phase, "ready");
    await manager.apply();
    assert.deepEqual(await readFile(current), bytes);
    assert.equal(await readFile(`${current}.previous`, "utf8"), "old appimage");
    assert.deepEqual(installations, [current]);
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt and modified updates are rejected before replacing the executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-update-corrupt-"));
  const current = join(directory, "current.AppImage");
  await writeFile(current, "original", { mode: 0o755 });
  const manager = new LinuxUpdateManager({
    directory,
    version: "0.2.0",
    appImage: current,
    fetch: fixtureFetch(
      "0".repeat(64) + "  " + release.assets[0].name,
    ) as typeof fetch,
  });
  try {
    await manager.check();
    assert.equal((await manager.download()).phase, "error");
    await assert.rejects(manager.apply(), /verify an update/);
    assert.equal(await readFile(current, "utf8"), "original");
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
  const another = await mkdtemp(join(tmpdir(), "linusaurus-update-tamper-"));
  const executable = join(another, "current.AppImage");
  await writeFile(executable, "original", { mode: 0o755 });
  const good = new LinuxUpdateManager({
    directory: join(another, "downloads"),
    version: "0.2.0",
    appImage: executable,
    fetch: fixtureFetch() as typeof fetch,
  });
  try {
    await good.check();
    await good.download();
    await writeFile(
      join(another, "downloads", release.assets[0].name),
      "changed",
    );
    await assert.rejects(good.apply(), /no longer verified/);
    assert.equal(await readFile(executable, "utf8"), "original");
  } finally {
    good.dispose();
    await rm(another, { recursive: true, force: true });
  }
});

test("idle installs remain scheduled while UI or programs are busy and cancel without replacing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-update-idle-"));
  const current = join(directory, "current.AppImage");
  await writeFile(current, "original", { mode: 0o755 });
  let idle = false,
    installed = 0;
  const manager = new LinuxUpdateManager({
    directory,
    version: "0.2.0",
    appImage: current,
    fetch: fixtureFetch() as typeof fetch,
    idle: () => idle,
    install: async () => {
      installed++;
    },
  });
  try {
    await manager.check();
    await manager.download();
    assert.equal((await manager.apply(true)).phase, "scheduled");
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(installed, 0);
    manager.cancel();
    idle = true;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(installed, 0);
    await manager.apply(true);
    for (let attempt = 0; attempt < 30 && !installed; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(installed, 1);
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("development builds cannot replace their checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-update-kind-"));
  const development = new LinuxUpdateManager({
    directory,
    version: "0.2.0",
    development: true,
    fetch: fixtureFetch() as typeof fetch,
  });
  try {
    await development.check();
    await development.download();
    await assert.rejects(development.apply(), /packaged Linux client/);
  } finally {
    development.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("download cleanup failure retains the primary error, publishes failure and permits retry", async (t) => {
  for (const failure of ["write", "verification"] as const) {
    await t.test(failure, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "linusaurus-update-cleanup-"),
      );
      const partial = join(directory, `${release.assets[0].name}.part`);
      const phases: string[] = [];
      let obstructed = false;
      let validManifest = failure === "write";
      const obstruct = () => {
        mkdirSync(partial);
        writeFileSync(join(partial, "preserve"), "unrelated file");
        obstructed = true;
      };
      if (failure === "write") obstruct();
      const manager = new LinuxUpdateManager({
        directory,
        version: "0.2.0",
        development: true,
        fetch: async (url) =>
          fixtureFetch(
            `${validManifest ? hash : "0".repeat(64)}  ${release.assets[0].name}\n`,
          )(url),
        changed(state) {
          phases.push(state.phase);
          if (
            !obstructed &&
            state.phase === "downloading" &&
            state.bytes === bytes.length
          ) {
            // The real writer has finished this chunk. Another actor replaces
            // its path before verification and cleanup; the open handle stays valid.
            renameSync(partial, `${partial}.held`);
            obstruct();
          }
        },
      });
      try {
        assert.equal((await manager.check()).phase, "available");
        let rejected: unknown;
        try {
          await manager.download();
        } catch (error) {
          rejected = error;
        }
        assert.deepEqual(
          {
            phase: manager.status().phase,
            canApply: manager.status().canApply,
            aggregate: rejected instanceof AggregateError,
          },
          { phase: "error", canApply: false, aggregate: true },
        );
        assert.ok(rejected instanceof AggregateError);
        assert.equal(rejected.errors.length, 2);
        const [primary, cleanup] = rejected.errors;
        assert.ok(primary instanceof Error);
        assert.ok(cleanup instanceof Error);
        assert.equal(rejected.cause, primary);
        assert.match(
          primary.message,
          failure === "write" ? /EISDIR.*open/ : /SHA-256\/size verification/,
        );
        assert.match(cleanup.message, /directory|EISDIR/i);
        assert.ok(manager.status().error?.includes(primary.message));
        assert.ok(manager.status().error?.includes(cleanup.message));
        assert.equal(phases.at(-1), "error");
        assert.equal(
          await readFile(join(partial, "preserve"), "utf8"),
          "unrelated file",
        );

        await rm(partial, { recursive: true });
        validManifest = true;
        assert.equal((await manager.download()).phase, "ready");
        assert.equal(phases.at(-1), "ready");
      } finally {
        manager.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

test(
  "download cancellation preserves canceled state unless partial cleanup itself fails",
  { timeout: 10_000 },
  async (t) => {
    for (const obstructed of [false, true]) {
      await t.test(
        obstructed ? "cleanup failure" : "clean cancellation",
        async () => {
          const directory = await mkdtemp(
            join(tmpdir(), "linusaurus-update-cancel-"),
          );
          const partial = join(directory, `${release.assets[0].name}.part`);
          let began: () => void = () => {};
          const written = new Promise<void>((resolve) => {
            began = resolve;
          });
          const manager = new LinuxUpdateManager({
            directory,
            version: "0.2.0",
            development: true,
            fetch: async (url, init) => {
              if (!String(url).endsWith(".AppImage"))
                return fixtureFetch()(url);
              return new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(bytes.subarray(0, 1));
                    init?.signal?.addEventListener(
                      "abort",
                      () => {
                        controller.error(
                          new DOMException("Transfer canceled", "AbortError"),
                        );
                      },
                      { once: true },
                    );
                  },
                }),
              );
            },
            changed(state) {
              if (state.phase === "downloading" && state.bytes === 1) began();
            },
          });
          try {
            await manager.check();
            const pending = manager.download();
            await written;
            if (obstructed) {
              renameSync(partial, `${partial}.held`);
              mkdirSync(partial);
            }
            const canceled = manager.cancel();
            assert.equal(canceled.phase, "idle");
            if (obstructed) {
              await assert.rejects(pending, (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.ok(error.cause instanceof Error);
                assert.equal(error.cause.name, "AbortError");
                assert.equal(error.errors[0], error.cause);
                return true;
              });
              assert.equal(manager.status().phase, "error");
              assert.match(manager.status().error ?? "", /cleanup also failed/);
            } else {
              assert.deepEqual(await pending, canceled);
              assert.deepEqual(manager.status(), canceled);
              await assert.rejects(readFile(partial), { code: "ENOENT" });
            }
          } finally {
            manager.dispose();
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
    }
  },
);

test("Debian updates open the verified package with the native installer hook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-update-deb-"));
  const deb = {
    ...release,
    assets: [
      {
        ...release.assets[0],
        name: "linusaurus-rex_0.3.0_amd64.deb",
        browser_download_url: root + "linusaurus-rex_0.3.0_amd64.deb",
      },
      release.assets[1],
    ],
  };
  let installed: string | undefined;
  const fetcher = async (url: unknown) =>
    String(url).includes("api.github.com")
      ? new Response(JSON.stringify(deb))
      : String(url).endsWith("SHA256SUMS")
        ? new Response(`${hash}  ${deb.assets[0].name}`)
        : new Response(bytes);
  const manager = new LinuxUpdateManager({
    directory,
    version: "0.2.0",
    fetch: fetcher as typeof fetch,
    install: async (path, kind) => {
      assert.equal(kind, "deb");
      installed = path;
    },
  });
  try {
    await manager.check();
    await manager.download();
    await manager.apply();
    assert.equal(installed, join(directory, deb.assets[0].name));
    assert.deepEqual(await readFile(installed!), bytes);
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancel aborts the in-flight release request without changing canceled state to an error", async () => {
  let began: () => void = () => {};
  const started = new Promise<void>((resolve) => (began = resolve));
  const manager = new LinuxUpdateManager({
    directory: "/unused",
    version: "0.2.0",
    development: true,
    fetch: async (_url, init) => {
      began();
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Canceled", "AbortError")),
        ),
      );
    },
  });
  try {
    const pending = manager.check();
    await started;
    assert.equal(manager.cancel().phase, "idle");
    assert.equal((await pending).phase, "idle");
  } finally {
    manager.dispose();
  }
});

test("automatic update idleness follows program status including seeded history and cleared hosts", async () => {
  const { ActivityRegistry } = await import("../electron/client/activity.js");
  const { DEFAULT_SETTINGS } = await import("../src/shared/types.js");
  const registry = new ActivityRegistry(
    () => {},
    () => {},
    () => DEFAULT_SETTINGS.notifications,
  );
  registry.seed(
    "host",
    "session",
    "block",
    { records: [{ id: "compile", state: "working" }] },
    undefined,
    undefined,
  );
  assert.equal(registry.isIdle(), false);
  registry.apply("host", "session", {
    creator_name: "com.superlogical.terminal",
    block_id: "block",
    name: "program_status_changed",
    payload: { id: "compile", record: { state: "blocked" } },
  });
  assert.equal(registry.isIdle(), false);
  registry.apply("host", "session", {
    creator_name: "com.superlogical.terminal",
    block_id: "block",
    name: "program_status_changed",
    payload: { id: "compile", record: { state: "done" } },
  });
  assert.equal(registry.isIdle(), true);
  registry.seed(
    "other",
    "session",
    "block",
    { records: [{ id: "other", state: "working" }] },
    undefined,
    undefined,
  );
  assert.equal(registry.isIdle(), false);
  registry.clearHost("other");
  assert.equal(registry.isIdle(), true);
});
