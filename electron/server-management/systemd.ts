import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  lstat,
  realpath,
  unlink,
  readdir,
} from "node:fs/promises";
import { dirname, join, relative, isAbsolute, basename } from "node:path";
import { homedir } from "node:os";
import type { Host } from "../../src/shared/types.js";
import {
  validateOrigins,
  withOrigins,
  originPatterns,
} from "./server-origins.js";

import {
  decodeBusReply,
  decodeUnitName,
  decodeUnitObject,
  decodeUnitPaths,
  decodeSystemdInspection,
  InvalidSystemdReplyError,
  isServiceUnitName,
} from "./systemd-replies.js";

const execute = promisify(execFile),
  MARKER = "# Managed by Linusaurus Rex: web origins",
  IDLE_MARKER = "# Managed by Linusaurus Rex: idle shutdown guard";
export interface ServiceInfo {
  unit: string;
  scope: "user" | "system";
  activeState: string;
  subState: string;
  restart: string;
  fragmentPath: string;
  dropInPaths: string[];
  configuredOrigins: string[];
  canManage: boolean;
  reason?: string;
}
export interface ServiceSnapshot extends ServiceInfo {
  objectPath: string;
  mainPID: number;
  execPath: string;
  argv: string[];
  remainAfterExit: boolean;
  triggeredBy: string[];
  job: number;
}
export interface OriginsPreview {
  previewId: string;
  unit: string;
  path: string;
  before: string | null;
  after: string;
  backupPath?: string;
  restartRequired: true;
  expiresAt: number;
}
type Runner = (executable: string, args: string[]) => Promise<string>;
type Call = (host: Host, method: string, payload: object) => Promise<unknown>;
export interface SystemdOptions {
  call: Call;
  attest: (endpoint: string, pid: number) => Promise<unknown>;
  run?: Runner;
  runtimeDirectory?: string;
  configDirectory?: string;
  now?: () => number;
}
type Pending = {
  preview: OriginsPreview;
  hostId: string;
  endpoint: string;
  unit: string;
  beforeHash: string;
  snapshot: string;
  argv: string[];
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function processStart(pid: number): Promise<string | undefined> {
  try {
    const text = await readFile(`/proc/${pid}/stat`, "utf8"),
      start = text.slice(text.lastIndexOf(")") + 2).split(" ")[19];
    if (!/^\d+$/.test(start))
      throw new Error("Invalid desktop process identity.");
    return start;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
const signature = (unit: ServiceSnapshot) =>
  JSON.stringify([
    unit.unit,
    unit.execPath,
    unit.argv,
    unit.fragmentPath,
    unit.dropInPaths.filter((path) => !path.includes("linusaurus-idle-")),
  ]);
const beneath = (root: string, path: string) => {
  const child = relative(root, path);
  return (
    child !== "" &&
    !isAbsolute(child) &&
    child !== ".." &&
    !child.startsWith("../")
  );
};
export function quoteSystemdArgument(value: string) {
  if (/[\x00-\x1f\x7f]/.test(value))
    throw new Error("A service command contains control characters.");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}
export function originsDropIn(
  executable: string,
  argv: string[],
  origins: string[],
) {
  return `${MARKER}\n[Service]\nExecStart=\nExecStart=${[executable, ...withOrigins(argv.slice(1), validateOrigins(origins))].map(quoteSystemdArgument).join(" ")}\n`;
}
export class SystemdUserServices {
  private pending = new Map<string, Pending>();
  private run: Runner;
  private runtime: string;
  private config: string;
  constructor(private options: SystemdOptions) {
    this.run =
      options.run ||
      (async (executable, args) =>
        (
          await execute(executable, args, {
            timeout: 8000,
            maxBuffer: 2 * 1024 * 1024,
          })
        ).stdout);
    this.runtime =
      options.runtimeDirectory ||
      process.env.XDG_RUNTIME_DIR ||
      `/run/user/${process.getuid?.()}`;
    this.config =
      options.configDirectory ||
      process.env.XDG_CONFIG_HOME ||
      join(homedir(), ".config");
  }
  private async bus(
    scope: "user" | "system",
    args: string[],
  ): Promise<unknown> {
    return decodeBusReply(
      await this.run("busctl", [`--${scope}`, "--json=short", ...args]),
    );
  }
  private async object(unit: string, scope: "user" | "system") {
    if (!isServiceUnitName(unit))
      throw new Error("Invalid Rex service unit name.");
    return decodeUnitObject(
      await this.bus(scope, [
        "call",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
        "LoadUnit",
        "s",
        unit,
      ]),
    );
  }
  private async property(path: string, scope: "user" | "system", name: string) {
    return this.bus(scope, [
      "get-property",
      "org.freedesktop.systemd1",
      path,
      "org.freedesktop.systemd1.Service",
      name,
    ]);
  }
  async inspect(
    unit: string,
    scope: "user" | "system" = "user",
  ): Promise<ServiceSnapshot> {
    const path = await this.object(unit, scope);
    const properties = await this.bus(scope, [
      "call",
      "org.freedesktop.systemd1",
      path,
      "org.freedesktop.DBus.Properties",
      "GetAll",
      "s",
      "org.freedesktop.systemd1.Unit",
    ]);
    const [pid, restart, remain, commands] = await Promise.all([
      this.property(path, scope, "MainPID"),
      this.property(path, scope, "Restart"),
      this.property(path, scope, "RemainAfterExit"),
      this.property(path, scope, "ExecStart"),
    ]);
    const inspection = decodeSystemdInspection(properties, {
      pid,
      restart,
      remain,
      commands,
    });
    const command = inspection.commands[0];
    const result: ServiceSnapshot = {
      unit: inspection.unit,
      scope,
      objectPath: path,
      mainPID: inspection.mainPID,
      activeState: inspection.activeState,
      subState: inspection.subState,
      restart: inspection.restart,
      fragmentPath: inspection.fragmentPath,
      dropInPaths: inspection.dropInPaths,
      configuredOrigins: originPatterns(command?.argv ?? []),
      triggeredBy: inspection.triggeredBy,
      remainAfterExit: inspection.remainAfterExit,
      execPath: command?.path ?? "",
      argv: command?.argv ?? [],
      job: inspection.job,
      canManage: true,
    };
    if (scope === "system") {
      result.canManage = false;
      result.reason =
        "This is a system service. Manage it with your system administrator.";
    } else if (result.remainAfterExit) {
      result.canManage = false;
      result.reason =
        "RemainAfterExit services require their existing service manager.";
    } else if (result.triggeredBy.length) {
      result.canManage = false;
      result.reason =
        "Socket, timer or path activated services require their existing activation controls.";
    } else if (
      inspection.commands.length !== 1 ||
      !result.execPath ||
      !/^rex(?:[-.].*)?$/.test(basename(result.execPath)) ||
      result.argv[0] !== result.execPath ||
      result.argv[1] !== "server" ||
      result.argv[2] !== "run" ||
      command?.ignoreFailure
    ) {
      result.canManage = false;
      result.reason =
        "Only a direct, single rex server run ExecStart is supported.";
    } else if (result.job) {
      result.canManage = false;
      result.reason = "A service manager job is already in progress.";
    }
    return result;
  }
  async discover(
    endpoint: string,
    pid: number,
  ): Promise<ServiceSnapshot | undefined> {
    await this.options.attest(endpoint, pid);
    for (const scope of ["user", "system"] as const) {
      let lookup: unknown;
      try {
        lookup = await this.bus(scope, [
          "call",
          "org.freedesktop.systemd1",
          "/org/freedesktop/systemd1",
          "org.freedesktop.systemd1.Manager",
          "GetUnitByPID",
          "u",
          String(pid),
        ]);
      } catch (error) {
        if (error instanceof InvalidSystemdReplyError)
          throw new Error(
            `The owning service cannot be inspected safely: ${error.message}`,
          );
        continue;
      }
      try {
        const object = decodeUnitObject(lookup);
        const id = decodeUnitName(
          await this.bus(scope, [
            "get-property",
            "org.freedesktop.systemd1",
            object,
            "org.freedesktop.systemd1.Unit",
            "Id",
          ]),
        );
        // A desktop/login scope is not a dedicated Rex service. Its process
        // remains subject to the separate local socket and executable attestation.
        if (!isServiceUnitName(id)) continue;
        const unit = await this.inspect(id, scope);
        if (unit.mainPID !== pid) continue;
        if (
          (await realpath(unit.execPath)) !==
          (await realpath(`/proc/${pid}/exe`))
        ) {
          unit.canManage = false;
          unit.reason =
            "The service ExecStart does not identify the connected Rex executable.";
        }
        return unit;
      } catch (error) {
        throw new Error(
          `The owning service cannot be inspected safely: ${(error as Error).message}`,
        );
      }
    }
    return;
  }
  info(unit: ServiceSnapshot): ServiceInfo {
    const {
      unit: name,
      scope,
      activeState,
      subState,
      restart,
      fragmentPath,
      dropInPaths,
      configuredOrigins,
      canManage,
      reason,
    } = unit;
    return {
      unit: name,
      scope,
      activeState,
      subState,
      restart,
      fragmentPath,
      dropInPaths,
      configuredOrigins,
      canManage,
      reason,
    };
  }
  async start(unit: string) {
    await this.recoverIdleGuards(unit);
    const before = await this.inspect(unit);
    if (!before.canManage) throw new Error(before.reason);
    if (before.mainPID) return;
    await this.run("systemctl", ["--user", "start", unit]);
  }
  /** Explicit lifecycle actions recover a previous desktop crash; status is read-only. */
  async recoverIdleGuards(unit: string) {
    if (!isServiceUnitName(unit))
      throw new Error("Invalid Rex service unit name.");
    const directory = join(this.runtime, "systemd/user.control", `${unit}.d`);
    const names = await readdir(directory).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    const removed = new Map<string, string>();
    try {
      for (const name of names) {
        if (
          !/^99-linusaurus-idle-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.conf$/.test(
            name,
          )
        )
          continue;
        const path = join(directory, name),
          identity = await lstat(path).catch(() => undefined);
        if (
          !identity?.isFile() ||
          identity.uid !== process.getuid?.() ||
          identity.size > 512
        )
          continue;
        const text = await readFile(path, "utf8"),
          match =
            /^# Managed by Linusaurus Rex: idle shutdown guard\n# Owner: (\d+) (\d+)\n(# State: abandoned\n)?\[Service\]\nRestart=no\n$/.exec(
              text,
            );
        if (!match || Number(match[1]) <= 1) continue;
        if (!match[3] && (await processStart(Number(match[1]))) === match[2])
          continue;
        const current = await lstat(path).catch(() => undefined);
        if (
          current?.ino !== identity.ino ||
          current.dev !== identity.dev ||
          (await readFile(path, "utf8")) !== text
        )
          throw new Error(
            "A stale idle guard changed during recovery; it was left untouched.",
          );
        await unlink(path);
        removed.set(path, text);
      }
    } finally {
      if (removed.size) {
        try {
          await this.run("systemctl", ["--user", "daemon-reload"]);
        } catch (error) {
          // Retain a recognizable stale marker for the next explicit retry.
          for (const [path, text] of removed)
            await writeFile(path, text, { flag: "wx", mode: 0o600 }).catch(
              (failure) => {
                if ((failure as NodeJS.ErrnoException).code !== "EEXIST")
                  throw failure;
              },
            );
          throw error;
        }
      }
    }
  }
  private async guard(unit: ServiceSnapshot) {
    const owner = await processStart(process.pid);
    if (!owner)
      throw new Error("The desktop process identity could not be read.");
    const directory = join(
        this.runtime,
        "systemd/user.control",
        `${unit.unit}.d`,
      ),
      path = join(directory, `99-linusaurus-idle-${randomUUID()}.conf`);
    const text = `${IDLE_MARKER}\n# Owner: ${process.pid} ${owner}\n[Service]\nRestart=no\n`;
    await mkdir(directory, { recursive: true });
    const handle = await import("node:fs/promises").then((fs) =>
      fs.open(path, "wx", 0o600),
    );
    try {
      await handle.writeFile(text);
    } finally {
      await handle.close();
    }
    const identity = await lstat(path);
    let removed = false;
    const restore = async () => {
      if (removed) return;
      const current = await lstat(path).catch(() => undefined);
      if (
        current?.ino !== identity.ino ||
        current.dev !== identity.dev ||
        (await readFile(path, "utf8")) !== text
      )
        throw new Error(
          "The owned runtime Restart guard changed; it was left untouched.",
        );
      await unlink(path);
      removed = true;
      try {
        await this.run("systemctl", ["--user", "daemon-reload"]);
      } catch (error) {
        // A failed reload can leave the manager caching Restart=no. An explicitly
        // abandoned marker allows the next action to retry while this app lives.
        await writeFile(
          path,
          text.replace("[Service]", "# State: abandoned\n[Service]"),
          { flag: "wx", mode: 0o600 },
        ).catch((failure) => {
          if ((failure as NodeJS.ErrnoException).code !== "EEXIST")
            throw failure;
        });
        throw error;
      }
    };
    try {
      await this.run("systemctl", ["--user", "daemon-reload"]);
      const effective = await this.inspect(unit.unit);
      if (
        effective.restart !== "no" ||
        effective.mainPID !== unit.mainPID ||
        !effective.dropInPaths.includes(path) ||
        !effective.canManage
      )
        throw new Error(
          "The service Restart guard could not be verified without changing its process.",
        );
      return restore;
    } catch (error) {
      await restore();
      throw error;
    }
  }
  async stop(host: Host, endpoint: string, pid: number, unit: ServiceSnapshot) {
    if (!unit.canManage || unit.scope !== "user")
      throw new Error(unit.reason || "This service is read-only.");
    await this.options.attest(endpoint, pid);
    await this.recoverIdleGuards(unit.unit);
    const before = await this.inspect(unit.unit);
    if (before.mainPID !== pid)
      throw new Error("The service process changed. Refresh before retrying.");
    const restore = await this.guard(before);
    try {
      // The caller checks advertised if_idle support; the server atomically refuses
      // all existing sessions and other connected clients. No StopUnit is issued.
      await this.options.call(host, "server.stop", { if_idle: true });
      for (let attempt = 0; attempt < 100; attempt++) {
        const after = await this.inspect(unit.unit);
        if (after.mainPID !== pid) {
          if (after.mainPID)
            throw new Error(
              "Another actor started a new Rex process. It has been preserved.",
            );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        "The Rex service has not exited yet. No process was killed.",
      );
    } finally {
      await restore();
    }
  }
  private path(unit: string) {
    if (!isServiceUnitName(unit)) throw new Error("Invalid Rex service name.");
    return join(
      this.config,
      "systemd/user",
      `${unit}.d`,
      "90-linusaurus-origins.conf",
    );
  }
  private async read(path: string) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error("The origins drop-in must be a regular file.");
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text) > 1024 * 1024)
        throw new Error("The origins drop-in exceeds the text limit.");
      return text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }
  async preview(
    host: Host,
    endpoint: string,
    unit: ServiceSnapshot,
    origins: string[],
  ): Promise<OriginsPreview> {
    if (!unit.canManage || unit.scope !== "user")
      throw new Error(unit.reason || "This service cannot be edited.");
    if (unit.argv.some((argument) => /[$%]|[\x00-\x1f]/.test(argument)))
      throw new Error(
        "This service uses command expansion. Edit its origins with the existing service configuration.",
      );
    const paths = decodeUnitPaths(
      await this.bus("user", [
        "get-property",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
        "UnitPath",
      ]),
    );
    if (
      !Array.isArray(paths) ||
      !paths.includes(join(this.config, "systemd/user"))
    )
      throw new Error(
        "The desktop configuration directory is outside the user service manager’s unit search path. Launch the client with the same XDG_CONFIG_HOME as your user service manager.",
      );
    const path = this.path(unit.unit),
      before = await this.read(path);
    if (before && !before.startsWith(MARKER + "\n"))
      throw new Error(
        "An unrelated file occupies the dedicated origins drop-in. It was not changed.",
      );
    const now = this.options.now?.() || Date.now();
    for (const [id, pending] of this.pending)
      if (pending.preview.expiresAt < now) this.pending.delete(id);
    if (this.pending.size >= 32)
      throw new Error(
        "Too many unconsumed origins previews. Close older previews and retry later.",
      );
    const after = originsDropIn(unit.execPath, unit.argv, origins),
      preview: OriginsPreview = {
        previewId: randomUUID(),
        unit: unit.unit,
        path,
        before: before || null,
        after,
        ...(before ? { backupPath: `${path}.linusaurus-backup` } : {}),
        restartRequired: true,
        expiresAt: (this.options.now?.() || Date.now()) + 5 * 60_000,
      };
    this.pending.set(preview.previewId, {
      preview,
      hostId: host.id,
      endpoint,
      unit: unit.unit,
      beforeHash: hash(before),
      snapshot: signature(unit),
      argv: withOrigins(unit.argv.slice(1), validateOrigins(origins)),
    });
    return preview;
  }
  async apply(host: Host, endpoint: string, id: string) {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (
      !pending ||
      pending.hostId !== host.id ||
      pending.endpoint !== endpoint ||
      pending.preview.expiresAt < (this.options.now?.() || Date.now())
    )
      throw new Error(
        "The origins preview expired. Review a new preview before applying.",
      );
    const before = await this.read(pending.preview.path),
      unit = await this.inspect(pending.unit);
    if (
      !unit.canManage ||
      hash(before) !== pending.beforeHash ||
      signature(unit) !== pending.snapshot
    )
      throw new Error(
        "The service or drop-in changed after preview. Nothing was written.",
      );
    const directory = dirname(pending.preview.path);
    await mkdir(directory, { recursive: true });
    const base = await realpath(join(this.config, "systemd/user")),
      actual = await realpath(directory);
    if (!beneath(base, actual))
      throw new Error(
        "The service drop-in directory resolves outside the user unit directory.",
      );
    const write = async (path: string, text: string) => {
      const temporary = `${path}.linusaurus-${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    };
    if (before)
      await write(`${pending.preview.path}.linusaurus-backup`, before);
    await write(pending.preview.path, pending.preview.after);
    try {
      await this.run("systemctl", ["--user", "daemon-reload"]);
      const effective = await this.inspect(unit.unit);
      if (
        effective.execPath !== unit.execPath ||
        JSON.stringify(effective.argv.slice(1)) !==
          JSON.stringify(pending.argv) ||
        !effective.dropInPaths.includes(pending.preview.path)
      )
        throw new Error(
          "Another service setting overrides the requested origins.",
        );
      return effective;
    } catch (error) {
      if (before) await write(pending.preview.path, before);
      else await unlink(pending.preview.path);
      await this.run("systemctl", ["--user", "daemon-reload"]);
      throw error;
    }
  }
}
