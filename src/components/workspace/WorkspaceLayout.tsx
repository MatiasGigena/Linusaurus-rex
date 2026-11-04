import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { AlertCircle } from "lucide-react";
import {
  usePaneGeometry,
  type PaneGeometryOperations,
} from "../../hooks/usePaneGeometry";
import { errorMessage, viewKey } from "../../core/workspace";
import type {
  HostState,
  PaneMetadata,
  SessionViews,
} from "../../core/workspaceSnapshot";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import type { Selection, Settings } from "../../shared/types";
import { enrichWindow } from "../../workspace/presentation";
import { WorkspaceWindow } from "./WorkspaceWindow";

interface WorkspaceLayoutProps {
  workspaceElement: RefObject<HTMLDivElement | null>;
  selection?: Selection;
  views: SessionViews;
  hosts: Pick<HostState, "id" | "connected" | "error">[];
  metadata: Partial<Record<string, PaneMetadata>>;
  settings: Settings;
  focusedPane?: string;
  modalOpen: boolean;
  connectionRevisions: Record<string, number>;
  operations: PaneGeometryOperations &
    Pick<WorkspaceOperations, "focusPane" | "refresh">;
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
  onError(message: string): void;
  children: ReactNode;
}
const sameWindow = (left: Selection, right: Selection) =>
  left.hostId === right.hostId &&
  left.sessionId === right.sessionId &&
  left.windowId === right.windowId;

/** Retain a bounded set of windows so switching tabs preserves their live runtimes. */
export function WorkspaceLayout({
  workspaceElement,
  selection,
  views,
  hosts,
  metadata,
  settings,
  focusedPane,
  modalOpen,
  connectionRevisions,
  operations,
  execute,
  onError,
  children,
}: WorkspaceLayoutProps) {
  const [visited, setVisited] = useState<Selection[]>([]);
  const activeWindow =
    selection &&
    views[viewKey(selection.hostId, selection.sessionId)]?.windows.find(
      (window) => window.id === selection.windowId,
    );
  useEffect(() => {
    if (selection && activeWindow)
      setVisited((previous) =>
        [
          ...previous.filter((item) => !sameWindow(item, selection)),
          selection,
        ].slice(-12),
      );
  }, [
    selection?.hostId,
    selection?.sessionId,
    selection?.windowId,
    !!activeWindow,
  ]);
  const safely = (action: () => Promise<unknown>) => {
    void action().catch((failure) => onError(errorMessage(failure)));
  };
  const interactions = usePaneGeometry(workspaceElement, operations, safely);
  const activeHost =
    hosts.find((host) => host.id === selection?.hostId) || hosts[0];
  return (
    <div className="workspace-body" ref={workspaceElement}>
      {selection && activeWindow ? (
        <>
          {[
            ...visited.filter((item) => !sameWindow(item, selection)),
            selection,
          ].map((where) => {
            const raw = views[
              viewKey(where.hostId, where.sessionId)
            ]?.windows.find((window) => window.id === where.windowId);
            if (!raw) return null;
            return (
              <WorkspaceWindow
                key={`${where.hostId}/${where.sessionId}/${where.windowId}`}
                window={enrichWindow(
                  where.hostId,
                  where.sessionId,
                  raw,
                  metadata,
                )}
                where={where}
                visible={sameWindow(where, selection)}
                connected={
                  !!hosts.find((host) => host.id === where.hostId)?.connected
                }
                settings={settings}
                focusedPane={focusedPane}
                modalOpen={modalOpen}
                connectionRevision={connectionRevisions[where.hostId] || 0}
                operations={{ focusPane: operations.focusPane }}
                interactions={interactions}
                execute={execute}
                onError={onError}
              />
            );
          })}
          {!activeHost?.connected && (
            <div className="disconnected-overlay">
              <AlertCircle size={20} />
              <span>
                {activeHost?.error || "Connection lost. Reconnecting…"}
              </span>
              <button
                className="button"
                onClick={() => safely(() => operations.refresh())}
              >
                Reconnect
              </button>
            </div>
          )}
        </>
      ) : (
        children
      )}
    </div>
  );
}
