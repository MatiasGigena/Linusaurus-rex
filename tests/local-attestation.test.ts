import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  unlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { attestLocalRex } from "../electron/server-management/local-attestation.js";

test("local attestation binds a same-user Rex listener to its actual socket inode and filesystem namespace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rex-attestation-")),
    socketPath = join(directory, "Rex socket.sock"),
    proc = join(directory, "proc"),
    pid = 4321;
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(socketPath, resolve);
  });
  const processPath = join(proc, String(pid));
  try {
    await Promise.all([
      mkdir(join(processPath, "fd"), { recursive: true }),
      mkdir(join(processPath, "ns"), { recursive: true }),
      mkdir(join(proc, "self/ns"), { recursive: true }),
      mkdir(join(proc, "net"), { recursive: true }),
    ]);
    await symlink("/usr/bin/rex", join(processPath, "exe"));
    await symlink("mnt:[100]", join(processPath, "ns/mnt"));
    await symlink("mnt:[100]", join(proc, "self/ns/mnt"));
    await writeFile(join(processPath, "cmdline"), "rex\0server\0run\0");
    await symlink("socket:[123456]", join(processPath, "fd/7"));
    await writeFile(
      join(proc, "net/unix"),
      `Num RefCount Protocol Flags Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 123456 ${socketPath}\n`,
    );
    const endpoint = `unix://${encodeURI(socketPath)}`;
    const identity = await attestLocalRex(endpoint, pid, proc);
    assert.equal(identity.socketPath, socketPath);
    assert.equal(identity.socketInode, "123456");
    assert.equal(identity.uid, process.getuid!());
    // A proxy can forward a valid Rex PID but cannot give that process its own listening FD.
    await unlink(join(processPath, "fd/7"));
    await symlink("socket:[999999]", join(processPath, "fd/7"));
    await assert.rejects(
      attestLocalRex(endpoint, pid, proc),
      /proxy|reported Rex process/,
    );
    await unlink(join(processPath, "fd/7"));
    await symlink("socket:[123456]", join(processPath, "fd/7"));
    await unlink(join(processPath, "ns/mnt"));
    await symlink("mnt:[200]", join(processPath, "ns/mnt"));
    await assert.rejects(
      attestLocalRex(endpoint, pid, proc),
      /filesystem namespace/,
    );
    await unlink(join(processPath, "ns/mnt"));
    await symlink("mnt:[100]", join(processPath, "ns/mnt"));
    await unlink(join(processPath, "exe"));
    await symlink("/usr/bin/ssh", join(processPath, "exe"));
    await assert.rejects(attestLocalRex(endpoint, pid, proc), /not Rex/);
    await assert.rejects(
      attestLocalRex("https://remote.example", pid, proc),
      /local.*Unix socket/,
    );
    await assert.rejects(
      attestLocalRex(endpoint, NaN, proc),
      /valid local process/,
    );
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "the installed Rex process can be attested without changing any existing session",
  { skip: process.env.REX_INTEGRATION !== "1" },
  async () => {
    const { RexService } = await import("../electron/rex/service.js");
    const { DEFAULT_SETTINGS } = await import("../src/shared/types.js");
    const service = new RexService(),
      host = DEFAULT_SETTINGS.hosts[0];
    try {
      const status = await service.status(host);
      const details = await service.callMethod<{ pid: number }>(
        host,
        "server.status",
        {},
      );
      const identity = await attestLocalRex(status.endpoint!, details.pid);
      assert.equal(identity.pid, details.pid);
      assert.equal(identity.uid, process.getuid!());
      const after = await service.callMethod<{ pid: number }>(
        host,
        "server.status",
        {},
      );
      assert.equal(
        after.pid,
        details.pid,
        "Read-only attestation must leave the serving process running",
      );
    } finally {
      service.dispose();
    }
  },
);
