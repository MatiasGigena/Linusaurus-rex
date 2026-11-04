import type { ClientEvent } from "../../shared/types";
import { viewKey } from "../../core/workspace";
import type { WorkspaceActionOptions } from "./context";
export function resolveCommandTarget(
  name: string,
  args: Record<string, unknown>,
  event: ClientEvent | undefined,
  state: Pick<
    WorkspaceActionOptions,
    "hosts" | "views" | "selection" | "focusedPane"
  >,
) {
  const { hosts, views, selection, focusedPane } = state;
  const activeHost =
    hosts.find((host) => host.id === selection?.hostId) || hosts[0];
  const sourceHostId = event?.type === "action" ? event.hostId : undefined;
  if (
    sourceHostId !== undefined &&
    args.host_id !== undefined &&
    args.host_id !== sourceHostId
  )
    throw new Error("A server-originated action cannot target another host.");
  const hostId =
    sourceHostId ??
    String(
      args.host_id ||
        (event && "hostId" in event ? event.hostId : undefined) ||
        selection?.hostId ||
        activeHost?.id ||
        "local",
    );
  const selectionMatchesHost = selection?.hostId === hostId;
  const sessionId = String(
    args.session_id ||
      (event && "sessionId" in event ? event.sessionId : undefined) ||
      (selectionMatchesHost ? selection?.sessionId : undefined) ||
      "",
  );
  const selectionMatchesSession =
    selectionMatchesHost && selection?.sessionId === sessionId;
  const currentView = views[viewKey(hostId, sessionId)];
  const requestedBlock =
    args.block_id || (event && "blockId" in event ? event.blockId : undefined);
  const currentWindow =
    (requestedBlock
      ? currentView?.windows.find((window) =>
          window.panes.some((pane) => pane.id === requestedBlock),
        )
      : undefined) ||
    currentView?.windows.find(
      (window) =>
        window.id ===
        String(
          args.window_id ||
            (selectionMatchesSession ? selection?.windowId : undefined),
        ),
    ) ||
    currentView?.windows.find(
      (window) => window.id === currentView.activeWindowId,
    ) ||
    currentView?.windows[0];
  const displayedContext =
    selectionMatchesSession && selection?.windowId === currentWindow?.id;
  const blockId = String(
    args.block_id ||
      (event && "blockId" in event ? event.blockId : undefined) ||
      (displayedContext &&
      currentWindow?.panes.some((pane) => pane.id === focusedPane)
        ? focusedPane
        : undefined) ||
      currentWindow?.focusedBlockId ||
      currentWindow?.panes[0]?.id ||
      "",
  );
  const terminalRef = { hostId, sessionId, blockId };
  const targetPane = currentWindow?.panes.find((pane) => pane.id === blockId);

  return {
    name,
    args,
    event,
    hostId,
    sourceHostId,
    sessionId,
    currentView,
    currentWindow,
    displayedContext,
    blockId,
    terminalRef,
    targetPane,
  };
}
