import { readFile, readlink, stat } from "node:fs/promises";
import { basename } from "node:path";
import { attestLocalRex } from "./local-attestation.js";
import { isServiceUnitName } from "./systemd-replies.js";

export type LaunchProfile = {
  endpoint: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
  serviceUnit?: string;
  serviceScope?: "user" | "system";
};
export const environmentKey = (key: string) =>
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
export const commandLineOptionValue = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index >= 0
    ? args[index + 1]
    : args
        .find((argument) => argument.startsWith(`${name}=`))
        ?.slice(name.length + 1);
};
export async function readProcessProfile(
  pid: number,
  endpoint: string,
): Promise<LaunchProfile> {
  await attestLocalRex(endpoint, pid);
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
  const listened = commandLineOptionValue(args, "--listen");
  if (listened && listened !== endpoint)
    throw new Error(
      "This is an additional listener; manage the server through its primary Unix socket.",
    );
  if (
    args
      .slice(0, -1)
      .some(
        (flag) =>
          /auth.*key(?!.*file)|password|secret|token/i.test(flag) &&
          !flag.includes("file"),
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only checked launch metadata may be reused after the original process has exited. */
export function parseSavedProfile(
  value: unknown,
  endpoint: string,
): LaunchProfile | undefined {
  const input = object(value);
  if (
    !input ||
    input.endpoint !== endpoint ||
    typeof input.executable !== "string" ||
    !/^rex(?:[-.].*)?$/.test(basename(input.executable))
  )
    return undefined;
  const args = input.args;
  if (
    !Array.isArray(args) ||
    !args.every((argument) => typeof argument === "string") ||
    args[0] !== "server" ||
    args[1] !== "run"
  )
    return undefined;
  const environment = object(input.env);
  if (!environment) return undefined;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string") return undefined;
    env[key] = value;
  }
  if (input.serviceUnit !== undefined && !isServiceUnitName(input.serviceUnit))
    return undefined;
  if (
    input.serviceScope !== undefined &&
    input.serviceScope !== "user" &&
    input.serviceScope !== "system"
  )
    return undefined;
  return {
    endpoint,
    executable: input.executable,
    args: args.map((argument) => argument),
    env,
    ...(typeof input.serviceUnit === "string"
      ? { serviceUnit: input.serviceUnit }
      : {}),
    ...(input.serviceScope === "user" || input.serviceScope === "system"
      ? { serviceScope: input.serviceScope }
      : {}),
  };
}
