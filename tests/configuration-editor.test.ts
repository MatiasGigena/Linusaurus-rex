import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationEditor } from "../electron/features/configuration-editor.js";

test("a Unix proxy cannot authorize reading or writing its reported local configuration path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rex-config-attestation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "private.lua");
  await writeFile(path, "-- private contents");
  const host = {
    id: "proxy",
    label: "Proxy",
    endpoint: `unix://${directory}/proxy.sock`,
  };
  const backend = {
    control: async () => ({ endpoint: host.endpoint }),
    callMethod: async (_host: typeof host, method: string) =>
      method === "client.keymap" ? { config: { path } } : { pid: 4321 },
  };
  let attested = false;
  const editor = new ConfigurationEditor(backend, async (endpoint, pid) => {
    assert.equal(endpoint, host.endpoint);
    assert.equal(pid, 4321);
    if (!attested) throw new Error("The endpoint is a proxy.");
    return {
      pid,
      uid: 1000,
      executable: "/usr/bin/rex",
      socketPath: endpoint.slice(7),
      socketInode: "123",
    };
  });
  const info = await editor.info(host);
  assert.equal(info.editable, false);
  assert.equal(info.content, undefined);
  await assert.rejects(
    editor.write(host, "-- attacker content"),
    /remote Rex configuration/,
  );
  assert.equal(await readFile(path, "utf8"), "-- private contents");
  attested = true;
  assert.equal((await editor.info(host)).content, "-- private contents");
  await editor.write(host, "-- authorized");
  assert.equal(await readFile(path, "utf8"), "-- authorized");
  attested = false;
  await assert.rejects(
    editor.write(host, "-- stale authorization"),
    /remote Rex configuration/,
  );
  assert.equal(await readFile(path, "utf8"), "-- authorized");
});
