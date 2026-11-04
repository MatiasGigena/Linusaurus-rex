import type { Host, Selection } from "../../src/shared/types.js";
import { validateOrigins } from "../server-management/server-origins.js";
import { identifier, record, string } from "../validation.js";

export function validateHosts(value: unknown): Host[] {
  if (!Array.isArray(value) || !value.length || value.length > 32)
    throw new Error("Add between 1 and 32 hosts");
  const hosts = value.map((value): Host => {
    const host = record(value);
    const endpoint = string(host.endpoint, "host endpoint");
    if (/^(?:https?|wss?):\/\//i.test(endpoint) && new URL(endpoint).password) {
      throw new Error(
        "Save HTTP gateway credentials separately from its endpoint.",
      );
    }
    const origins =
      host.websocketOrigins === undefined
        ? undefined
        : validateOrigins(host.websocketOrigins);
    return {
      id: identifier(host.id, "host ID"),
      label: identifier(host.label, "host label"),
      endpoint,
      ...(origins === undefined ? {} : { websocketOrigins: origins }),
      ...(host.startupCommand === undefined
        ? {}
        : {
            startupCommand: string(
              host.startupCommand,
              "host startup command",
              4096,
            ),
          }),
    };
  });
  if (new Set(hosts.map((host) => host.id)).size !== hosts.length)
    throw new Error("Host IDs must be unique");
  return hosts;
}

export function validateLastSelection(
  value: unknown,
  hosts: Host[],
): Selection | undefined {
  if (value === undefined) return undefined;
  const selection = record(value);
  const hostId = identifier(selection.hostId, "selected host");
  if (!hosts.some((host) => host.id === hostId)) return undefined;
  const result: Selection = {
    hostId,
    sessionId: string(selection.sessionId, "selected session", 256),
    windowId: string(selection.windowId, "selected tab", 256),
    ...(selection.blockId === undefined
      ? {}
      : { blockId: identifier(selection.blockId, "selected pane") }),
  };
  if (!result.sessionId && (result.windowId || result.blockId))
    throw new Error("An empty host selection cannot contain a tab or pane.");
  return result;
}
