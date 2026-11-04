interface RunningServer {
  pid: number;
  sessionCount: number;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function decodeRunningServer(value: unknown): RunningServer {
  const result = object(value);
  if (
    !result ||
    typeof result.pid !== "number" ||
    !Number.isSafeInteger(result.pid) ||
    result.pid <= 1 ||
    result.pid > 0xffffffff
  )
    throw new Error("Rex returned an invalid local server process ID.");
  const count = result.session_count === undefined ? 0 : result.session_count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    throw new Error("Rex returned an invalid local server session count.");
  return { pid: result.pid, sessionCount: count };
}

/** An unrecognized or malformed help response never authorizes a stop. */
export function advertisesIdleShutdown(value: unknown): boolean {
  const methods = object(value)?.methods;
  if (!Array.isArray(methods)) return false;
  const stop = methods
    .map(object)
    .find((method) => method?.name === "server.stop");
  const schema = object(
    object(object(stop?.input_schema)?.properties)?.if_idle,
  );
  return (
    schema !== undefined &&
    (schema.type === undefined || schema.type === "boolean")
  );
}
