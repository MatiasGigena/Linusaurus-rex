import { createHash } from "node:crypto";
import {
  open,
  readFile,
  readlink,
  realpath,
  stat,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { Host, ServerManagementInfo } from "../../src/shared/types.js";
import { effectiveEndpoint } from "../rex/service.js";
import { localEndpoint } from "../rex/control.js";

type Profile = {
  endpoint: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
};
type ServerCall = (
  host: Host,
  method: string,
  payload: object,
) => Promise<unknown>;
export interface LifecycleOptions {
  directory: string;
  call: ServerCall;
  launch?: (profile: Profile) => Promise<void>;
  process?: (pid: number, endpoint: string) => Promise<Profile>;
  now?: () => number;
}
const managementBusy = new Set<string>();
const local = (endpoint: string) =>
  endpoint.startsWith("unix://") || endpoint.startsWith("/");
const environmentKey = (key: string) =>
  [
    "PATH",
    "HOME",
    "SHELL",
    "USER",
    "LOGNAME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "REX_CONFIG",
    "TMPDIR",
    "LANG",
    "TZ",
  ].includes(key) || key.startsWith("LC_");
const value = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index >= 0
    ? args[index + 1]
    : args
        .find((argument) => argument.startsWith(`${name}=`))
        ?.slice(name.length + 1);
};
export function originPatterns(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--websocket-origin-pattern" && args[index + 1])
      values.push(args[++index]);
    else if (args[index].startsWith("--websocket-origin-pattern="))
      values.push(args[index].slice(27));
  }
  return values;
}
export function validateOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins) || origins.length > 64)
    throw new Error("Allow at most 64 web origin patterns.");
  return [
    ...new Set(
      origins.map((input) => {
        if (
          typeof input !== "string" ||
          input.length > 512 ||
          /[\s\x00-\x1f]/.test(input)
        )
          throw new Error(
            "Use a browser origin or specific host[:port] pattern.",
          );
        let origin = input;
        if (/^https?:\/\//i.test(origin)) {
          const parsed = new URL(origin);
          if (
            parsed.username ||
            parsed.password ||
            !["", "/"].includes(parsed.pathname) ||
            parsed.search ||
            parsed.hash
          )
            throw new Error(
              "A browser origin contains only scheme, hostname and optional port.",
            );
          origin = parsed.host;
        }
        if (
          !/^[a-zA-Z0-9.*:\[\]_-]+$/.test(origin) ||
          !origin ||
          origin === "*"
        )
          throw new Error(
            "Use a specific host[:port] or wildcard subdomain, such as localhost:3000 or *.example.com.",
          );
        return origin.toLowerCase();
      }),
    ),
  ];
}
export function withOrigins(
  args: readonly string[],
  origins: readonly string[],
): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--websocket-origin-pattern") {
      index++;
      continue;
    }
    if (!args[index].startsWith("--websocket-origin-pattern="))
      result.push(args[index]);
  }
  for (const origin of origins)
    result.push("--websocket-origin-pattern", origin);
  return result;
}
async function processProfile(pid: number, endpoint: string): Promise<Profile> {
  const metadata = await stat(`/proc/${pid}`);
  if (metadata.uid !== process.getuid?.())
    throw new Error("The Rex process belongs to another user.");
  const executable = await readlink(`/proc/${pid}/exe`);
  if (!/^rex(?:[-.].*)?$/.test(basename(executable)))
    throw new Error(
      "The connected process is not an identifiable Rex executable.",
    );
  const command = (await readFile(`/proc/${pid}/cmdline`))
    .toString()
    .split("\0")
    .filter(Boolean);
  const args = command.slice(1);
  if (args[0] !== "server" || args[1] !== "run")
    throw new Error(
      "The server was not launched as rex server run. Manage this service with its existing service manager.",
    );
  const listened = value(args, "--listen");
  if (listened && listened !== endpoint)
    throw new Error(
      "This is an additional listener; manage the server through its primary Unix socket.",
    );
  if (
    args.some(
      (argument, index) =>
        index > 0 &&
        /auth.*key(?!.*file)|password|secret|token/i.test(args[index - 1]) &&
        !args[index - 1].includes("file"),
    )
  )
    throw new Error(
      "A secret appears in the server command line. Manage this service with its existing service manager.",
    );
  const env: Record<string, string> = {};
  for (const pair of (await readFile(`/proc/${pid}/environ`))
    .toString()
    .split("\0")) {
    const equal = pair.indexOf("=");
    if (equal > 0) env[pair.slice(0, equal)] = pair.slice(equal + 1);
  }
  for (const key of ["REX_SESSION", "REX_BLOCK", "REX_CLIENT", "REX_SERVER"])
    delete env[key];
  return { endpoint, executable, args, env };
}
export class LinuxServerManager {
  private profiles = new Map<string, Profile>();
  private busy = managementBusy;
  constructor(private options: LifecycleOptions) {}
  private endpoint(host: Host) {
    return effectiveEndpoint(host.endpoint) || localEndpoint();
  }
  private path(endpoint: string) {
    return join(
      this.options.directory,
      `server-${createHash("sha256").update(endpoint).digest("hex")}.json`,
    );
  }
  private async save(profile: Profile) {
    const path = this.path(profile.endpoint);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify(
        {
          ...profile,
          env: Object.fromEntries(
            Object.entries(profile.env).filter(([key]) => environmentKey(key)),
          ),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(temporary, path);
    this.profiles.set(profile.endpoint, profile);
  }
  private async profile(endpoint: string) {
    let profile = this.profiles.get(endpoint);
    if (profile) return profile;
    try {
      const parsed = JSON.parse(
        await readFile(this.path(endpoint), "utf8"),
      ) as Profile;
      if (
        parsed.endpoint !== endpoint ||
        !Array.isArray(parsed.args) ||
        parsed.args[0] !== "server" ||
        parsed.args[1] !== "run" ||
        typeof parsed.executable !== "string" ||
        !/^rex(?:[-.].*)?$/.test(basename(parsed.executable))
      )
        return;
      profile = parsed;
      this.profiles.set(endpoint, profile);
      return profile;
    } catch {
      return;
    }
  }
  async status(host: Host): Promise<ServerManagementInfo> {
    const endpoint = this.endpoint(host);
    const info: ServerManagementInfo = {
      local: local(endpoint),
      running: false,
      canManage: false,
      sessionCount: 0,
      endpoint,
      arguments: [],
      origins: [],
      ...(host.websocketOrigins !== undefined
        ? { pendingOrigins: validateOrigins(host.websocketOrigins) }
        : {}),
    };
    if (!info.local) {
      info.reason =
        "Lifecycle and web-origin launch options are managed on the remote Rex host.";
      return info;
    }
    let result: Record<string, any> | undefined;
    try {
      result = (await this.options.call(host, "server.status", {})) as Record<
        string,
        any
      >;
    } catch (error) {
      const message = (error as Error).message;
      if (
        !/ENOENT|ECONNREFUSED|closed|not connected|connection.*refused|socket.*not.*found/i.test(
          message,
        )
      ) {
        info.reason = `The local server cannot be inspected safely: ${message}`;
        return info;
      }
      /* A stopped local server is valid and can use its saved launch profile. */
    }
    let profile = await this.profile(endpoint);
    if (result) {
      info.running = true;
      info.pid = result.pid;
      info.sessionCount = result.session_count || 0;
      try {
        const version = (await this.options.call(
          host,
          "server.version",
          {},
        )) as { version?: string; rex_version?: string };
        info.version = version.version || version.rex_version;
      } catch {
        /* Older servers may expose version in the connection welcome only. */
      }
      try {
        profile = await (this.options.process || processProfile)(
          result.pid,
          endpoint,
        );
        await this.save(profile);
      } catch (error) {
        info.reason = (error as Error).message;
        profile = undefined;
      }
    }
    if (profile) {
      info.canManage = true;
      info.executable = profile.executable;
      info.arguments = profile.args.map((argument, index) =>
        /auth.*key(?!.*file)|password|secret|token/i.test(
          profile!.args[index - 1] || "",
        )
          ? "[redacted]"
          : argument,
      );
      info.origins = originPatterns(profile.args);
      info.configPath =
        value(profile.args, "--config") || profile.env.REX_CONFIG;
      info.stateDirectory = value(profile.args, "--state-dir");
      try {
        info.binarySha256 = createHash("sha256")
          .update(await readFile(profile.executable))
          .digest("hex");
      } catch {
        /* Hash is diagnostic only. */
      }
    } else if (!info.reason) {
      info.canManage = true;
      info.reason =
        "Start creates an isolated local server with its own state/configuration directory. Existing installed server state is not overwritten.";
    }
    return info;
  }
  async perform(
    host: Host,
    operation: "start" | "stop" | "restart",
  ): Promise<ServerManagementInfo> {
    const endpoint = this.endpoint(host);
    if (this.busy.has(endpoint))
      throw new Error("A server operation is already in progress.");
    this.busy.add(endpoint);
    try {
      const before = await this.status(host);
      if (!before.canManage)
        throw new Error(
          before.reason || "This server cannot be managed safely.",
        );
      if (!before.local)
        throw new Error(
          before.reason || "This remote server cannot be managed.",
        );
      if (
        !(await this.profile(endpoint)) &&
        !before.running &&
        operation === "start"
      ) {
        let executable: string | undefined;
        for (const part of (process.env.PATH || "").split(":")) {
          try {
            const path = join(part, "rex");
            const item = await stat(path);
            if (item.isFile() && item.mode & 0o111) {
              executable = await realpath(path);
              break;
            }
          } catch {
            /* Try the next installed executable path. */
          }
        }
        if (!executable)
          throw new Error(
            "Install Rex or add its executable to PATH before starting a server.",
          );
        const stateDirectory = join(
          this.options.directory,
          `state-${createHash("sha256").update(endpoint).digest("hex").slice(0, 16)}`,
        );
        await mkdir(stateDirectory, { recursive: true });
        const config = join(stateDirectory, "init.lua");
        try {
          await writeFile(
            config,
            "-- Managed local Rex server configuration.\n",
            { flag: "wx", mode: 0o600 },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        );
        for (const key of [
          "REX_SESSION",
          "REX_BLOCK",
          "REX_CLIENT",
          "REX_SERVER",
        ])
          delete env[key];
        await this.save({
          endpoint,
          executable,
          args: [
            "server",
            "run",
            "--listen",
            endpoint,
            "--state-dir",
            stateDirectory,
            "--config",
            config,
          ],
          env,
        });
      } else if (!before.canManage)
        throw new Error(
          before.reason || "This local server cannot be managed.",
        );
      if (operation === "start" && before.running) return before;
      if (before.running) {
        if (before.sessionCount > 0)
          throw new Error(
            `Rex has ${before.sessionCount} existing session${before.sessionCount === 1 ? "" : "s"}. Close them yourself before stopping or restarting; their programs will never be ended by this client.`,
          );
        // The server performs this test atomically, refusing races and other clients.
        await this.options.call(host, "server.stop", { if_idle: true });
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            await this.options.call(host, "server.status", {});
          } catch {
            break;
          }
          if (attempt === 49)
            throw new Error("The server has not stopped yet.");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (operation === "stop") return this.status(host);
      const profile = await this.profile(endpoint);
      if (!profile) throw new Error("The saved launch profile is missing.");
      const launch = {
        ...profile,
        args:
          host.websocketOrigins === undefined
            ? [...profile.args]
            : withOrigins(profile.args, validateOrigins(host.websocketOrigins)),
      };
      if (this.options.launch) await this.options.launch(launch);
      else {
        await mkdir(this.options.directory, { recursive: true });
        const log = await open(
          join(this.options.directory, "managed-server.log"),
          "a",
          0o600,
        );
        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(launch.executable, launch.args, {
              env: launch.env,
              detached: true,
              stdio: ["ignore", log.fd, log.fd],
              shell: false,
            });
            child.once("error", reject);
            child.once("spawn", () => {
              child.unref();
              resolve();
            });
          });
        } finally {
          await log.close();
        }
      }
      await this.save(launch);
      for (let attempt = 0; attempt < 100; attempt++) {
        const after = await this.status(host);
        if (after.running) return after;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        "Rex did not become ready. Inspect the managed-server log in client configuration.",
      );
    } finally {
      this.busy.delete(endpoint);
    }
  }
}
