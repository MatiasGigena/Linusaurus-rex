import { ChevronDown, ChevronRight, Plus, Terminal } from "lucide-react";
import { IconButton } from "../IconButton";
import type { NavigationSession } from "../Sidebar";
import type { NavigationContext } from "./navigation";
import { WindowNavigationItem } from "./WindowNavigationItem";
export function SessionNavigation({
  hostId,
  session,
  ...props
}: NavigationContext & { hostId: string; session: NavigationSession }) {
  const activeSession =
    hostId === props.activeHostId && session.id === props.activeSessionId;
  return (
    <div
      className={`session-group ${activeSession ? "is-current" : ""}`}
      key={session.id}
    >
      <div
        className="session-heading"
        onContextMenu={(event) => {
          if (props.onContextSession) {
            event.preventDefault();
            props.onContextSession(event, hostId, session.id);
          }
        }}
      >
        {props.onToggleSession && (
          <button
            className="session-collapse"
            aria-label={`${props.collapsedSessions?.has(session.id) ? "Expand" : "Collapse"} ${session.label}`}
            onClick={() => props.onToggleSession?.(session.id)}
          >
            {props.collapsedSessions?.has(session.id) ? (
              <ChevronRight size={11} />
            ) : (
              <ChevronDown size={11} />
            )}
          </button>
        )}
        <button
          type="button"
          className="session-label"
          onClick={() => props.onSelect(hostId, session.id)}
          onDoubleClick={() => props.onRenameSession(hostId, session.id)}
          title={`${session.label} · Double-click to rename`}
        >
          <span className="session-label-text">{session.label}</span>
          {activeSession && <span className="session-active-indicator" />}
        </button>
        <IconButton
          label={`New terminal in ${session.label}`}
          onClick={() => props.onNewWindow(hostId, session.id)}
          className="session-add"
        >
          <Plus size={13} />
        </IconButton>
      </div>
      {!props.collapsedSessions?.has(session.id) &&
        props.preferences?.tabStyle !== "top" && (
          <div className="session-windows">
            {session.windows
              .filter(
                (window) =>
                  (!props.filter ||
                    `${window.label} ${session.label} ${window.program || ""}`
                      .toLowerCase()
                      .includes(props.filter.toLowerCase())) &&
                  (!props.activityOnly ||
                    (!!window.activity &&
                      (props.preferences?.notifications.includeIdle ||
                        window.activity.state !== "idle"))),
              )
              .map((window) => (
                <WindowNavigationItem
                  key={window.id}
                  hostId={hostId}
                  sessionId={session.id}
                  window={window}
                  selected={activeSession && window.id === props.activeWindowId}
                  preferences={props.preferences}
                  onSelect={props.onSelect}
                  onContextWindow={props.onContextWindow}
                  onCloseWindow={props.onCloseWindow}
                  onReorderWindow={props.onReorderWindow}
                />
              ))}
            {session.windows.length === 0 && (
              <button
                type="button"
                className={`window-item ${activeSession ? "is-selected" : ""}`}
                onClick={() => props.onSelect(hostId, session.id)}
              >
                <span className="terminal-glyph">
                  <Terminal size={17} />
                </span>
                <span className="window-label">Open session</span>
              </button>
            )}
          </div>
        )}
    </div>
  );
}
