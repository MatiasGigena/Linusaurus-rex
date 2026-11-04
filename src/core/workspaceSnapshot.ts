import type { Host, RexBridge, Selection, SessionView } from "../shared/types";
import type { HostState } from "../hooks/useWorkspace";
import { errorMessage, viewKey } from "./workspace";

/** Missing sessions are expected when another client closes one during a refresh. */
function isMissingSession(failure: unknown): boolean {
  if (
    failure instanceof Error &&
    "code" in failure &&
    failure.code === "session_not_found"
  )
    return true;
  return /\b(?:unknown session|no such session|session(?:\s+["'\w:.-]+)?\s+(?:was\s+)?not found)\b/i.test(
    errorMessage(failure),
  );
}

export async function collectHostSnapshot(
  host: Host,
  request: RexBridge["request"],
): Promise<{ host: HostState; views: Record<string, SessionView> }> {
  try {
    const status = await request("status", { hostId: host.id });
    if (!status.connected)
      return {
        host: {
          ...host,
          connected: false,
          status,
          error: status.error,
          sessions: [],
        },
        views: {},
      };
    const sessions = await request("listSessions", { hostId: host.id });
    const inspected = await Promise.all(
      sessions.map(async (session) => {
        try {
          return await request("inspectSession", {
            hostId: host.id,
            sessionId: session.id,
          });
        } catch (failure) {
          if (isMissingSession(failure)) return undefined;
          throw failure;
        }
      }),
    );
    const views: Record<string, SessionView> = {};
    for (const view of inspected)
      if (view) views[viewKey(host.id, view.id)] = view;
    return {
      host: {
        ...host,
        connected: true,
        status,
        sessions: sessions.filter((session) =>
          Boolean(views[viewKey(host.id, session.id)]),
        ),
      },
      views,
    };
  } catch (failure) {
    // Keep this host's last successful views in the caller, and expose the failure.
    return {
      host: {
        ...host,
        connected: false,
        error: errorMessage(failure),
        sessions: [],
      },
      views: {},
    };
  }
}

export function reconcileSelection(
  current: Selection | undefined,
  hosts: HostState[],
  views: Record<string, SessionView>,
): {
  selection: Selection | undefined;
  updateFocus: boolean;
  focusedPane?: string;
} {
  const host = current && hosts.find((host) => host.id === current.hostId);
  const view = current && views[viewKey(current.hostId, current.sessionId)];
  if (current && view) {
    const selectedWindow =
      view.windows.find((window) => window.id === current.windowId) ||
      view.windows.find((window) => window.id === view.activeWindowId) ||
      view.windows[0];
    const requestedPane = selectedWindow?.panes.find(
      (pane) => pane.id === current.blockId,
    );
    return {
      selection: {
        hostId: current.hostId,
        sessionId: current.sessionId,
        windowId: selectedWindow?.id || "",
      },
      updateFocus: true,
      focusedPane: requestedPane?.id || selectedWindow?.focusedBlockId,
    };
  }
  // Retain explicit empty-host selections and disconnected hosts until they recover.
  if (current && host && (!current.sessionId || !host.connected))
    return { selection: current, updateFocus: false };
  const firstHost = hosts.find(
    (host) => host.connected && host.sessions.length,
  );
  const session = firstHost?.sessions[0];
  const first =
    firstHost && session && views[viewKey(firstHost.id, session.id)];
  if (!firstHost || !session || !first)
    return { selection: undefined, updateFocus: true };
  const activeWindow =
    first.windows.find((window) => window.id === first.activeWindowId) ||
    first.windows[0];
  return {
    selection: {
      hostId: firstHost.id,
      sessionId: session.id,
      windowId: activeWindow?.id || "",
    },
    updateFocus: true,
    focusedPane: activeWindow?.focusedBlockId,
  };
}
