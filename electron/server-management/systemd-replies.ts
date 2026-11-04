import { isAbsolute } from "node:path";

export class InvalidSystemdReplyError extends Error {
  constructor(field: string) {
    super(`The service manager returned an invalid ${field}.`);
    this.name = "InvalidSystemdReplyError";
  }
}
const invalid = (field: string): never => {
  throw new InvalidSystemdReplyError(field);
};
function record(value: unknown, field: string): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(field);
}
function data(value: unknown, field: string): unknown {
  const reply = record(value, field);
  if (!Object.hasOwn(reply, "data")) return invalid(field);
  return reply.data;
}
function scalar(value: unknown, field: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.length === 1 ? value[0] : invalid(field);
}
function text(value: unknown, field: string): string {
  return typeof value === "string" ? value : invalid(field);
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return invalid(field);
  return value.map((item) => item);
}
function unsigned(value: unknown, field: string): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
    ? value
    : invalid(field);
}
function objectPath(value: unknown, field: string): string {
  return typeof value === "string" &&
    /^(?:\/|(?:\/[A-Za-z0-9_]+)+)$/.test(value)
    ? value
    : invalid(field);
}
function filePath(value: unknown, field: string): string {
  const result = text(value, field);
  return isAbsolute(result) && !/[\x00-\x1f\x7f]/.test(result)
    ? result
    : invalid(field);
}
function optionalProperty(
  properties: Record<string, unknown>,
  name: string,
): unknown {
  return Object.hasOwn(properties, name)
    ? data(properties[name], `${name} property`)
    : undefined;
}
function requiredProperty(
  properties: Record<string, unknown>,
  name: string,
): unknown {
  if (!Object.hasOwn(properties, name)) return invalid(`${name} property`);
  return data(properties[name], `${name} property`);
}
export function isServiceUnitName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_.:@\\-]+\.service$/.test(value) &&
    !value.includes("..")
  );
}
function unitName(value: unknown): string {
  return isServiceUnitName(value) ? value : invalid("service unit name");
}

/** Command execution errors stay distinct from malformed replies during discovery. */
export function decodeBusReply(output: string): unknown {
  try {
    const value: unknown = JSON.parse(output);
    return value;
  } catch {
    return invalid("busctl JSON response");
  }
}
export function decodeUnitObject(value: unknown): string {
  const result = data(value, "unit object path");
  if (!Array.isArray(result) || result.length !== 1)
    return invalid("unit object path");
  return objectPath(result[0], "unit object path");
}
export function decodeUnitName(value: unknown): string {
  const name = scalar(data(value, "Id property"), "Id property");
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_.:@\\-]+\.[a-zA-Z]+$/.test(name) ||
    name.includes("..")
  )
    return invalid("owner unit name");
  return name;
}
export function decodeUnitPaths(value: unknown): string[] {
  return strings(data(value, "UnitPath property"), "UnitPath property").map(
    (path) => filePath(path, "UnitPath entry"),
  );
}

interface ExecStartCommand {
  path: string;
  argv: string[];
  ignoreFailure: boolean;
}
function execStart(value: unknown): ExecStartCommand[] {
  const commands = data(value, "ExecStart property");
  if (!Array.isArray(commands)) return invalid("ExecStart property");
  return commands.map((value) => {
    if (
      !Array.isArray(value) ||
      value.length < 3 ||
      typeof value[2] !== "boolean"
    )
      return invalid("ExecStart command");
    return {
      path: filePath(value[0], "ExecStart executable"),
      argv: strings(value[1], "ExecStart arguments"),
      ignoreFailure: value[2],
    };
  });
}
export interface SystemdInspection {
  unit: string;
  activeState: string;
  subState: string;
  fragmentPath: string;
  dropInPaths: string[];
  triggeredBy: string[];
  job: number;
  mainPID: number;
  restart: string;
  remainAfterExit: boolean;
  commands: ExecStartCommand[];
}
export function decodeSystemdInspection(
  value: unknown,
  service: {
    pid: unknown;
    restart: unknown;
    remain: unknown;
    commands: unknown;
  },
): SystemdInspection {
  const rows = data(value, "Unit properties");
  if (!Array.isArray(rows) || rows.length !== 1)
    return invalid("Unit properties");
  const properties = record(rows[0], "Unit properties");
  const remain = scalar(
    data(service.remain, "RemainAfterExit property"),
    "RemainAfterExit property",
  );
  if (typeof remain !== "boolean") return invalid("RemainAfterExit property");
  const fragment = optionalProperty(properties, "FragmentPath");
  const dropIns = optionalProperty(properties, "DropInPaths");
  const triggered = optionalProperty(properties, "TriggeredBy");
  const job = optionalProperty(properties, "Job");
  if (job !== undefined && (!Array.isArray(job) || job.length !== 2))
    return invalid("Job property");
  if (Array.isArray(job)) objectPath(job[1], "Job object path");
  return {
    unit: unitName(requiredProperty(properties, "Id")),
    activeState: text(
      requiredProperty(properties, "ActiveState"),
      "ActiveState property",
    ),
    subState: text(
      requiredProperty(properties, "SubState"),
      "SubState property",
    ),
    fragmentPath:
      fragment === undefined || fragment === ""
        ? ""
        : filePath(fragment, "FragmentPath property"),
    dropInPaths:
      dropIns === undefined
        ? []
        : strings(dropIns, "DropInPaths property").map((path) =>
            filePath(path, "DropInPaths entry"),
          ),
    triggeredBy:
      triggered === undefined ? [] : strings(triggered, "TriggeredBy property"),
    job: Array.isArray(job) ? unsigned(job[0], "Job ID") : 0,
    mainPID: unsigned(
      scalar(data(service.pid, "MainPID property"), "MainPID property"),
      "MainPID property",
    ),
    restart: text(
      scalar(data(service.restart, "Restart property"), "Restart property"),
      "Restart property",
    ),
    remainAfterExit: remain,
    commands: execStart(service.commands),
  };
}
