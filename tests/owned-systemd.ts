import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { RexService } from "../electron/rex/service.js";
import { quoteSystemdArgument } from "../electron/features/systemd.js";
const execute = promisify(execFile);
/** Test-owned runtime service only. No installed unit or existing Rex session is used. */
export async function createOwnedSystemdFixture() {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!runtime)
    throw Error(
      "A running user systemd manager and XDG_RUNTIME_DIR are required.",
    );
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-native-service-")),
    unit = `linusaurus-native-test-${randomUUID()}.service`,
    unitPath = join(runtime, "systemd/user", unit),
    configDropIn = join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "systemd/user",
      `${unit}.d`,
      "90-linusaurus-origins.conf",
    );
  const rex = new RexService(),
    host = {
      id: "native-service-owned",
      label: "Native systemd test",
      endpoint: `unix://${join(directory, "server.sock")}`,
    };
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    rex.dispose();
    // This exact generated fixture owns all processes/programs in the unit.
    await execute("systemctl", ["--user", "stop", unit]).catch(() => {});
    await rm(unitPath, { force: true });
    await rm(join(runtime, "systemd/user.control", `${unit}.d`), {
      recursive: true,
      force: true,
    });
    await rm(
      join(
        process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
        "systemd/user",
        `${unit}.d`,
      ),
      { recursive: true, force: true },
    );
    await execute("systemctl", ["--user", "daemon-reload"]);
    await execute("systemctl", ["--user", "reset-failed", unit]).catch(
      () => {},
    );
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const executable = (await execute("which", ["rex"])).stdout.trim();
    const args = [
      executable,
      "server",
      "run",
      "--listen",
      host.endpoint,
      "--state-dir",
      join(directory, "state"),
      "--config",
      join(directory, "init.lua"),
    ];
    await writeFile(
      join(directory, "init.lua"),
      "-- Owned native UI fixture\n",
    );
    await mkdir(join(runtime, "systemd/user"), { recursive: true });
    await writeFile(
      unitPath,
      `[Unit]\nDescription=Owned Linusaurus native fixture\n[Service]\nExecStart=${args.map(quoteSystemdArgument).join(" ")}\nRestart=always\nRestartSec=50ms\nUMask=0077\n`,
      { flag: "wx", mode: 0o600 },
    );
    await execute("systemctl", ["--user", "daemon-reload"]);
    await execute("systemctl", ["--user", "start", unit]);
    let pid: number | undefined;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        pid = (await rex.callMethod<{ pid: number }>(host, "server.status", {}))
          .pid;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!pid) throw Error("The owned fixture server did not become ready");
    const sessionId = await rex.createSession(
      host,
      `native-services-${Date.now()}`,
      directory,
    );
    return { fixture: { unit, host, sessionId, pid, configDropIn }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
