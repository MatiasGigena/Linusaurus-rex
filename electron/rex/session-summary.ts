import type { SessionSummary } from "../../src/shared/types.js";

function response(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(message);
  return value as Record<string, unknown>;
}
function summary(value: unknown, message: string): SessionSummary {
  const item = response(value, message);
  if (
    typeof item.session_id !== "string" ||
    !item.session_id ||
    (item.label !== undefined && typeof item.label !== "string")
  )
    throw new Error(message);
  return { id: item.session_id, label: item.label || "Untitled session" };
}

export function parseSessionList(value: unknown): SessionSummary[] {
  const message = "Rex returned an invalid session list.";
  const result = response(value, message);
  if (!Array.isArray(result.sessions)) throw new Error(message);
  return result.sessions.map((item) => summary(item, message));
}

export function parseCreatedSession(value: unknown): string {
  return summary(value, "Rex returned an invalid session creation response.")
    .id;
}
