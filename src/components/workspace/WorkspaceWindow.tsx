import { TerminalSquare } from "lucide-react";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import { errorMessage } from "../../core/workspace";
import type { RexWindow, Selection, Settings } from "../../shared/types";
import type { usePaneGeometry } from "../../hooks/usePaneGeometry";
import { ActivePaneHighlight } from "./ActivePaneHighlight";
import { WorkspacePane } from "./WorkspacePane";

interface WorkspaceWindowProps {
  window: RexWindow;
  where: Selection;
  visible: boolean;
  connected: boolean;
  settings: Settings;
  focusedPane?: string;
  modalOpen: boolean;
  connectionRevision: number;
  operations: Pick<WorkspaceOperations, "focusPane">;
  interactions: ReturnType<typeof usePaneGeometry>;
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
  onError(message: string): void;
}

/** Pane placement and controls for one retained terminal window. */
export function WorkspaceWindow({
  window,
  where,
  visible,
  connected,
  settings,
  focusedPane,
  modalOpen,
  connectionRevision,
  operations,
  interactions,
  execute,
  onError,
}: WorkspaceWindowProps) {
  const activePane =
    window.panes.find((pane) => pane.id === focusedPane) ||
    window.panes.find((pane) => pane.id === window.focusedBlockId) ||
    window.panes[0];
  const safely = (action: () => Promise<unknown>) => {
    void action().catch((failure) => onError(errorMessage(failure)));
  };
  const dispatch = (name: string, args: Record<string, unknown>) =>
    safely(() => execute(name, args));
  return (
    <div
      data-window-id={where.windowId}
      className={`terminal-layout ${window.panes.length > 1 ? "has-splits" : ""}`}
      style={{
        position: "absolute",
        inset: 0,
        display: visible ? "block" : "none",
      }}
      aria-hidden={!visible}
    >
      {visible && settings.highlightActivePane && (
        <ActivePaneHighlight
          rect={activePane?.rect}
          animation={settings.highlightAnimation}
          inset={
            window.panes.length > 1
              ? settings.paneStyle === "compact"
                ? 1
                : 4
              : 0
          }
        />
      )}
      {window.panes.map((pane) => (
        <div
          key={pane.id}
          data-block-id={pane.id}
          data-floating-block={
            pane.layerKind === "floating" ? pane.id : undefined
          }
          data-inactive={visible && pane.id !== activePane?.id}
          className={
            pane.layerKind === "floating" ? "floating-pane-wrapper" : ""
          }
          style={{
            position: "absolute",
            left: `${pane.rect[0] * 100}%`,
            top: `${pane.rect[1] * 100}%`,
            width: `${pane.rect[2] * 100}%`,
            height: `${pane.rect[3] * 100}%`,
            padding:
              window.panes.length > 1
                ? settings.paneStyle === "compact"
                  ? 1
                  : 4
                : 0,
            zIndex: pane.layerKind === "floating" ? 20 : 1,
          }}
          onPointerEnter={() => {
            if (
              visible &&
              settings.focusFollowsMouse &&
              pane.id !== activePane?.id
            )
              safely(() =>
                operations.focusPane({
                  hostId: where.hostId,
                  sessionId: where.sessionId,
                  blockId: pane.id,
                }),
              );
          }}
        >
          {pane.layerKind === "floating" && (
            <div
              className="floating-drag-handle"
              title="Drag floating pane"
              onPointerDown={(event) =>
                interactions.startFloatingPaneInteraction(
                  event,
                  pane,
                  where,
                  "move",
                )
              }
            />
          )}
          <WorkspacePane
            key={`${pane.id}/${settings.hosts.find((host) => host.id === where.hostId)?.endpoint || ""}/${connectionRevision}`}
            pane={pane}
            terminalRef={{
              hostId: where.hostId,
              sessionId: where.sessionId,
              blockId: pane.id,
            }}
            settings={settings}
            focused={visible && !modalOpen && pane.id === activePane?.id}
            visible={visible && !!connected}
            showHeader={
              settings.showPaneHeaders &&
              (window.panes.length > 1 || pane.layerKind === "floating")
            }
            onFocus={() => {
              if (visible && pane.id !== activePane?.id)
                safely(() =>
                  operations.focusPane({
                    hostId: where.hostId,
                    sessionId: where.sessionId,
                    blockId: pane.id,
                  }),
                );
            }}
            onZoom={() =>
              dispatch("pane.zoom", {
                host_id: where.hostId,
                session_id: where.sessionId,
                block_id: pane.id,
              })
            }
            onClose={() =>
              dispatch("pane.close", {
                host_id: where.hostId,
                session_id: where.sessionId,
                block_id: pane.id,
              })
            }
            onAction={(command) =>
              execute(command, {
                host_id: where.hostId,
                session_id: where.sessionId,
                block_id: pane.id,
              })
            }
          />
          {pane.layerKind === "floating" && (
            <div
              className="floating-resize-handle"
              onPointerDown={(event) =>
                interactions.startFloatingPaneInteraction(
                  event,
                  pane,
                  where,
                  "resize",
                )
              }
            />
          )}
        </div>
      ))}
      {visible &&
        window.dividers?.map((divider, index) => {
          const [x, y, w, h] = divider.rect;
          const horizontal = divider.direction === "horizontal";
          return (
            <div
              key={index}
              role="separator"
              aria-label={horizontal ? "Resize columns" : "Resize rows"}
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              aria-valuenow={Math.round(divider.ratio * 100)}
              tabIndex={0}
              className={`split-divider ${horizontal ? "vertical" : "horizontal"}`}
              style={
                horizontal
                  ? {
                      left: `${(x + w * divider.ratio) * 100}%`,
                      top: `${y * 100}%`,
                      height: `${h * 100}%`,
                    }
                  : {
                      top: `${(y + h * divider.ratio) * 100}%`,
                      left: `${x * 100}%`,
                      width: `${w * 100}%`,
                    }
              }
              onPointerDown={(event) =>
                interactions.resizeDivider(event, divider, where)
              }
              onKeyDown={(event) =>
                interactions.resizeDividerByKey(event, divider, where)
              }
            />
          );
        })}
      {visible && window.minimizedLayers?.length ? (
        <div className="minimized-panes">
          {window.minimizedLayers.map((layer) => (
            <button
              key={layer.id}
              onClick={() =>
                dispatch("pane.restore_floating", {
                  host_id: where.hostId,
                  session_id: where.sessionId,
                  block_id: layer.blockId,
                  layer_id: layer.id,
                })
              }
            >
              <TerminalSquare size={12} />
              {layer.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
