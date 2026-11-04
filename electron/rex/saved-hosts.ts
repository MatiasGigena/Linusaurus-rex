export interface SavedHost {
  label: string;
  endpoints?: string[];
  endpoint?: string;
  address?: string;
  url?: string;
}

/** Optional discovery must either publish a complete checked list or fall back. */
export function parseSavedHosts(value: unknown): SavedHost[] {
  const invalid = () => new Error("Rex returned an invalid saved-host list.");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const hosts = (value as Record<string, unknown>).hosts;
  if (hosts === undefined) return [];
  if (!Array.isArray(hosts)) throw invalid();
  return hosts.map((value): SavedHost => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid();
    const host = value as Record<string, unknown>;
    if (typeof host.label !== "string") throw invalid();
    const parsed: SavedHost = { label: host.label };
    if (host.endpoints !== undefined) {
      if (
        !Array.isArray(host.endpoints) ||
        !host.endpoints.every((endpoint) => typeof endpoint === "string")
      )
        throw invalid();
      parsed.endpoints = host.endpoints.slice();
    }
    for (const field of ["endpoint", "address", "url"] as const) {
      const endpoint = host[field];
      if (endpoint !== undefined) {
        if (typeof endpoint !== "string") throw invalid();
        parsed[field] = endpoint;
      }
    }
    return parsed;
  });
}
