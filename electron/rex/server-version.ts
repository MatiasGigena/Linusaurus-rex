export function parseServerVersion(value: unknown): string | undefined {
  const message = "Rex returned an invalid server version.";
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(message);
  const result = value as Record<string, unknown>;
  if (
    (result.version !== undefined && typeof result.version !== "string") ||
    (result.rex_version !== undefined && typeof result.rex_version !== "string")
  )
    throw new Error(message);
  return result.version || result.rex_version;
}
