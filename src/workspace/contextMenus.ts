import type { ContextItem } from "../components/ContextMenu";
type Dispatch = (name: string, args?: Record<string, unknown>) => void;
export function sessionMenuItems({
  hostId,
  sessionId,
  collapsedSessions,
  toggleCollapse,
  dispatch,
}: {
  hostId: string;
  sessionId: string;
  collapsedSessions: Set<string>;
  toggleCollapse(sessionId: string): void;
  dispatch: Dispatch;
}): (ContextItem | null)[] {
  return [
    {
      label: "New terminal tab",
      run: () =>
        dispatch("client.tab.new", {
          host_id: hostId,
          session_id: sessionId,
        }),
    },
    {
      label: "Rename session…",
      run: () =>
        dispatch("session.rename", {
          host_id: hostId,
          session_id: sessionId,
        }),
    },
    {
      label: collapsedSessions.has(sessionId)
        ? "Expand session"
        : "Collapse session",
      run: () => toggleCollapse(sessionId),
    },
    null,
    {
      label: "Close session…",
      danger: true,
      run: () =>
        dispatch("session.close", {
          host_id: hostId,
          session_id: sessionId,
        }),
    },
  ];
}
export function tabMenuItems({
  hostId,
  sessionId,
  windowId,
  dispatch,
}: {
  hostId: string;
  sessionId: string;
  windowId: string;
  dispatch: Dispatch;
}): (ContextItem | null)[] {
  return [
    {
      label: "Rename tab…",
      run: () =>
        dispatch("client.tab.rename", {
          host_id: hostId,
          session_id: sessionId,
          window_id: windowId,
        }),
    },
    {
      label: "Move tab backward",
      run: () =>
        dispatch("client.tab.move.backward", {
          host_id: hostId,
          session_id: sessionId,
          window_id: windowId,
        }),
    },
    {
      label: "Move tab forward",
      run: () =>
        dispatch("client.tab.move.forward", {
          host_id: hostId,
          session_id: sessionId,
          window_id: windowId,
        }),
    },
    {
      label: "Show in a new window",
      run: () =>
        dispatch("client.tab.move_to_new_window", {
          host_id: hostId,
          session_id: sessionId,
          window_id: windowId,
        }),
    },
    null,
    {
      label: "Close tab…",
      danger: true,
      shortcut: "Ctrl Shift W",
      run: () =>
        dispatch("client.tab.close", {
          host_id: hostId,
          session_id: sessionId,
          window_id: windowId,
        }),
    },
  ];
}
