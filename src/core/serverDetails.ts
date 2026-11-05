export interface TailscaleDetails extends Record<string, unknown> {
  state?: string;
  allow_tailnet_members?: boolean;
  dns_name?: string;
  auth_url?: string;
  control_url?: string;
  tags?: string[];
  error?: string;
  account?: { login_name?: string; [key: string]: unknown };
  https?: { state?: string; url?: string; [key: string]: unknown };
}
export interface ServerDetails extends Record<string, unknown> {
  started_at?: string;
  api_revision?: number;
  api_min_revision?: number;
  session_count?: number;
  tailscale?: TailscaleDetails;
}

function invalid(field: string): never {
  throw new Error(`Rex returned an invalid server status (${field}).`);
}
function record(value: unknown, field: string): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(field);
}
function text(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : invalid(field);
}
function count(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(field);
}
function boolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : invalid(field);
}
function tags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return invalid("tailscale.tags");
  return value.map((item) => item);
}
function account(value: unknown): TailscaleDetails["account"] {
  if (value === undefined) return undefined;
  const item = record(value, "tailscale.account");
  return {
    ...item,
    login_name: text(item.login_name, "tailscale.account.login_name"),
  };
}
function https(value: unknown): TailscaleDetails["https"] {
  if (value === undefined) return undefined;
  const item = record(value, "tailscale.https");
  return {
    ...item,
    state: text(item.state, "tailscale.https.state"),
    url: text(item.url, "tailscale.https.url"),
  };
}
function tailscale(value: unknown): TailscaleDetails | undefined {
  if (value === undefined) return undefined;
  const item = record(value, "tailscale");
  return {
    ...item,
    state: text(item.state, "tailscale.state"),
    allow_tailnet_members: boolean(
      item.allow_tailnet_members,
      "tailscale.allow_tailnet_members",
    ),
    dns_name: text(item.dns_name, "tailscale.dns_name"),
    auth_url: text(item.auth_url, "tailscale.auth_url"),
    control_url: text(item.control_url, "tailscale.control_url"),
    tags: tags(item.tags),
    error: text(item.error, "tailscale.error"),
    account: account(item.account),
    https: https(item.https),
  };
}

/** Check the fields used by diagnostics and pairing while retaining future report fields. */
export function decodeServerDetails(value: unknown): ServerDetails {
  const item = record(value, "status");
  return {
    ...item,
    started_at: text(item.started_at, "started_at"),
    api_revision: count(item.api_revision, "api_revision"),
    api_min_revision: count(item.api_min_revision, "api_min_revision"),
    session_count: count(item.session_count, "session_count"),
    tailscale: tailscale(item.tailscale),
  };
}
