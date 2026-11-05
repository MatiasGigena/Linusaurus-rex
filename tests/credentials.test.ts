import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsStoreCache } from "../electron/features/credentials.js";

const cipher = {
  available: async () => true,
  encrypt: async (value: string) => Buffer.from(value),
  decrypt: async (value: Buffer) => value.toString(),
};

test("credential initialization preserves corrupt storage and retries after repair", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rex-credential-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "credentials.json");
  const cache = new CredentialsStoreCache();
  for (const invalid of ["{broken json", "[]", '{"host":42}']) {
    await writeFile(path, invalid);
    const first = cache.get(path, cipher);
    assert.equal(cache.get(path, cipher), first);
    await assert.rejects(
      first,
      (error) =>
        error instanceof Error &&
        /could not be loaded/.test(error.message) &&
        error.cause instanceof Error,
    );
    assert.equal(await readFile(path, "utf8"), invalid);
  }
  await writeFile(path, "{}");
  const recovered = await cache.get(path, cipher);
  await recovered.set("host", { token: "new-token" });
  assert.deepEqual(await recovered.get("host"), { token: "new-token" });
  assert.equal(await cache.get(path, cipher), recovered);
});

test("only missing credential files initialize as empty stores", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rex-credential-read-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new CredentialsStoreCache();
  assert.equal(
    (
      await (
        await cache.get(join(directory, "missing.json"), cipher)
      ).status("host")
    ).stored,
    false,
  );
  await assert.rejects(cache.get(directory, cipher), /could not be loaded/);
});

test("credential unlock failures preserve their diagnostic cause behind the stable display message", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rex-credential-unlock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const failure = new Error("Keyring decrypt failed");
  let decoded: string | Error = failure;
  const store = await new CredentialsStoreCache().get(
    join(directory, "credentials.json"),
    {
      ...cipher,
      decrypt: async () => {
        if (decoded instanceof Error) throw decoded;
        return decoded;
      },
    },
  );
  await store.set("host", { token: "fixture-secret" });
  for (const value of [failure, "{broken json", '{"token":42}']) {
    decoded = value;
    await assert.rejects(store.get("host"), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Saved credentials could not be unlocked/);
      assert.ok(error.cause instanceof Error);
      if (value === failure) assert.equal(error.cause, failure);
      assert.ok(!error.message.includes("fixture-secret"));
      return true;
    });
  }
});
