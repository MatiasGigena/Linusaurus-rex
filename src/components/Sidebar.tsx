import {
  Bot,
  ChevronDown,
  ChevronRight,
  Code2,
  Command,
  Eye,
  FolderPlus,
  GitBranch,
  Laptop,
  PanelLeftClose,
  Plus,
  Search,
  Server,
  Settings2,
  Terminal,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProgramActivity, Settings } from "../shared/types";
import { activityLabel } from "../core/workspace";
import { IconButton } from "./IconButton";
import { ProgramIcon } from "./ProgramIcon";

export interface NavigationWindow {
  id: string;
  label: string;
  activity?: ProgramActivity;
  program?: string;
  icons?: string[];
}
export interface NavigationSession {
  id: string;
  label: string;
  windows: NavigationWindow[];
}
export interface NavigationHost {
  id: string;
  label: string;
  endpoint?: string;
  connected: boolean;
  error?: string;
  sessions: NavigationSession[];
}
export interface SidebarProps {
  hosts: NavigationHost[];
  activeHostId?: string;
  activeSessionId?: string;
  activeWindowId?: string;
  collapsed: boolean;
  width?: number;
  onResize?: (width: number) => void;
  onResizeEnd?: (width: number) => void;
  onSelect: (hostId: string, sessionId: string, windowId?: string) => void;
  onNewSession: (hostId: string) => void;
  onNewWindow: (hostId: string, sessionId: string) => void;
  onRenameSession: (hostId: string, sessionId: string) => void;
  onSettings: () => void;
  onToggle: () => void;
  onPalette: () => void;
  onAddHost?: () => void;
  onDeleteHost?: (hostId: string) => void;
  settings?: Settings;
  collapsedSessions?: Set<string>;
  onToggleSession?: (sessionId: string) => void;
  onContextSession?: (
    event: React.MouseEvent,
    hostId: string,
    sessionId: string,
  ) => void;
  onContextWindow?: (
    event: React.MouseEvent,
    hostId: string,
    sessionId: string,
    windowId: string,
  ) => void;
  onCloseWindow?: (hostId: string, sessionId: string, windowId: string) => void;
  onReorderWindow?: (
    hostId: string,
    sessionId: string,
    windowId: string,
    beforeWindowId: string,
  ) => void;
  onActivity?: () => void;
  onSwitcher?: () => void;
  activityOnly?: boolean;
}

export function Sidebar(props: SidebarProps) {
  const [closedHosts, setClosedHosts] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const resizing = useRef<
    { x: number; width: number; next: number } | undefined
  >(undefined);
  useEffect(() => {
    const focus = () => filterInput.current?.focus();
    window.addEventListener("rex-sidebar-filter", focus);
    return () => window.removeEventListener("rex-sidebar-filter", focus);
  }, []);
  if (props.collapsed) return null;
  const toggleHost = (id: string) =>
    setClosedHosts((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const activeHost = props.hosts.find((host) => host.id === props.activeHostId);
  const sessionCount = props.hosts.reduce(
    (count, host) => count + host.sessions.length,
    0,
  );

  return (
    <aside
      className="sidebar"
      aria-label="Rex workspaces"
      style={{
        width: props.width,
        minWidth: props.width,
        position: "relative",
      }}
    >
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Sidebar width"
        aria-orientation="vertical"
        aria-valuenow={props.width}
        aria-valuemin={190}
        aria-valuemax={500}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizing.current = {
            x: event.clientX,
            width: props.width || 278,
            next: props.width || 278,
          };
        }}
        onPointerMove={(event) => {
          const start = resizing.current;
          if (!start) return;
          start.next = Math.round(
            Math.max(
              190,
              Math.min(
                500,
                start.width +
                  (event.clientX - start.x) *
                    (props.settings?.tabStyle === "right" ? -1 : 1),
              ),
            ),
          );
          props.onResize?.(start.next);
        }}
        onPointerUp={(event) => {
          const start = resizing.current;
          if (!start) return;
          resizing.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
          props.onResizeEnd?.(start.next);
        }}
        onPointerCancel={() => {
          resizing.current = undefined;
          props.onResize?.(props.settings?.sidebarWidth || 278);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          props.onResizeEnd?.(
            Math.max(
              190,
              Math.min(
                500,
                (props.width || 278) +
                  (event.key === "ArrowRight" ? 10 : -10) *
                    (props.settings?.tabStyle === "right" ? -1 : 1),
              ),
            ),
          );
        }}
      />
      <div className="sidebar-titlebar">
        <div className="brand-mark" aria-hidden="true">
          <Terminal size={17} strokeWidth={2.2} />
        </div>
        <div className="brand-name">
          Linusaurus<span>rex</span>
        </div>
        <span className="beta-label">BETA</span>
        <IconButton
          label="Hide sidebar"
          shortcut="Ctrl Shift B"
          onClick={props.onToggle}
          className="sidebar-toggle"
        >
          <PanelLeftClose size={17} />
        </IconButton>
      </div>

      <button
        type="button"
        className="quick-switcher"
        onClick={props.onSwitcher || props.onPalette}
      >
        <Search size={15} />
        <span>Jump to a session</span>
        <kbd>Ctrl K</kbd>
      </button>
      <label className="sidebar-filter">
        <Search size={12} />
        <input
          ref={filterInput}
          aria-label="Filter tabs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tabs…"
        />
        {filter && (
          <button onClick={() => setFilter("")} aria-label="Clear tab filter">
            ×
          </button>
        )}
      </label>

      <div className="sidebar-section-label">
        <span>WORKSPACES</span>
        <span className="session-count">{sessionCount}</span>
      </div>
      <nav className="workspace-navigation" aria-label="Hosts and sessions">
        {props.hosts.map((host, index) => {
          const closed = closedHosts.has(host.id);
          return (
            <section key={host.id} className="host-group">
              <div className="host-heading">
                <button
                  type="button"
                  className="host-toggle"
                  aria-expanded={!closed}
                  onClick={() => toggleHost(host.id)}
                  title={host.endpoint ?? host.label}
                >
                  <span className="host-icon">
                    {index === 0 ? <Laptop size={18} /> : <Server size={17} />}
                  </span>
                  <span className="host-name">{host.label}</span>
                  <span
                    className={`status-dot ${host.connected ? "online" : "offline"}`}
                    aria-label={host.connected ? "Connected" : "Disconnected"}
                  />
                  {closed ? (
                    <ChevronRight size={13} className="host-chevron" />
                  ) : (
                    <ChevronDown size={13} className="host-chevron" />
                  )}
                </button>
                <IconButton
                  label={`New session on ${host.label}`}
                  onClick={() => props.onNewSession(host.id)}
                  className="host-add"
                >
                  <Plus size={15} />
                </IconButton>
              </div>
              {!closed && (
                <div className="host-sessions">
                  {!host.connected && (
                    <div className="host-disconnected" title={host.error}>
                      <WifiOff size={13} />
                      <span>{host.error || "Waiting for connection"}</span>
                    </div>
                  )}
                  {host.sessions.length === 0 && host.connected && (
                    <button
                      type="button"
                      className="no-sessions"
                      onClick={() => props.onNewSession(host.id)}
                    >
                      <Plus size={13} /> Create a session
                    </button>
                  )}
                  {host.sessions.map((session) => {
                    const activeSession =
                      host.id === props.activeHostId &&
                      session.id === props.activeSessionId;
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
                              props.onContextSession(
                                event,
                                host.id,
                                session.id,
                              );
                            }
                          }}
                        >
                          {props.onToggleSession && (
                            <button
                              className="session-collapse"
                              aria-label={`${props.collapsedSessions?.has(session.id) ? "Expand" : "Collapse"} ${session.label}`}
                              onClick={() =>
                                props.onToggleSession?.(session.id)
                              }
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
                            onClick={() => props.onSelect(host.id, session.id)}
                            onDoubleClick={() =>
                              props.onRenameSession(host.id, session.id)
                            }
                            title={`${session.label} · Double-click to rename`}
                          >
                            <span className="session-label-text">
                              {session.label}
                            </span>
                            {activeSession && (
                              <span className="session-active-indicator" />
                            )}
                          </button>
                          <IconButton
                            label={`New terminal in ${session.label}`}
                            onClick={() =>
                              props.onNewWindow(host.id, session.id)
                            }
                            className="session-add"
                          >
                            <Plus size={13} />
                          </IconButton>
                        </div>
                        {!props.collapsedSessions?.has(session.id) &&
                          props.settings?.tabStyle !== "top" && (
                            <div className="session-windows">
                              {session.windows
                                .filter(
                                  (window) =>
                                    (!filter ||
                                      `${window.label} ${session.label} ${window.program || ""}`
                                        .toLowerCase()
                                        .includes(filter.toLowerCase())) &&
                                    (!props.activityOnly ||
                                      (!!window.activity &&
                                        (props.settings?.notifications
                                          .includeIdle ||
                                          window.activity.state !== "idle"))),
                                )
                                .map((window) => {
                                  const selected =
                                    activeSession &&
                                    window.id === props.activeWindowId;
                                  return (
                                    <button
                                      key={window.id}
                                      type="button"
                                      className={`window-item ${selected ? "is-selected" : ""} ${window.activity ? `has-activity activity-${window.activity.state}` : ""}`}
                                      onClick={() =>
                                        props.onSelect(
                                          host.id,
                                          session.id,
                                          window.id,
                                        )
                                      }
                                      aria-current={
                                        selected ? "page" : undefined
                                      }
                                      title={`${window.label}${window.activity ? ` · ${activityLabel(window.activity)}` : ""}`}
                                      onContextMenu={(event) => {
                                        if (props.onContextWindow) {
                                          event.preventDefault();
                                          props.onContextWindow(
                                            event,
                                            host.id,
                                            session.id,
                                            window.id,
                                          );
                                        }
                                      }}
                                      onAuxClick={(event) => {
                                        if (event.button === 1) {
                                          event.preventDefault();
                                          props.onCloseWindow?.(
                                            host.id,
                                            session.id,
                                            window.id,
                                          );
                                        }
                                      }}
                                      draggable
                                      onDragStart={(event) =>
                                        event.dataTransfer.setData(
                                          "application/x-rex-window",
                                          JSON.stringify({
                                            hostId: host.id,
                                            sessionId: session.id,
                                            windowId: window.id,
                                          }),
                                        )
                                      }
                                      onDragOver={(event) =>
                                        event.preventDefault()
                                      }
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        try {
                                          const source = JSON.parse(
                                            event.dataTransfer.getData(
                                              "application/x-rex-window",
                                            ),
                                          );
                                          if (
                                            source.hostId === host.id &&
                                            source.sessionId === session.id &&
                                            source.windowId !== window.id
                                          )
                                            props.onReorderWindow?.(
                                              host.id,
                                              session.id,
                                              source.windowId,
                                              window.id,
                                            );
                                        } catch {
                                          /* Ignore other application drag data. */
                                        }
                                      }}
                                    >
                                      {(props.settings?.tabIcons ?? 1) > 0 && (
                                        <span
                                          className={`terminal-glyph ${props.settings?.tabIconColors === "never" || (props.settings?.tabIconColors !== "always" && !selected) ? "monochrome" : ""}`}
                                        >
                                          <ProgramIcon
                                            program={window.program}
                                          />
                                        </span>
                                      )}
                                      <span className="window-label">
                                        {window.label || "Terminal"}
                                        {window.activity &&
                                          props.settings?.notifications
                                            .showInTabs && (
                                            <small
                                              className={`activity-caption ${window.activity.state}`}
                                            >
                                              {activityLabel(window.activity)}
                                              {window.activity.progress !==
                                              undefined
                                                ? ` ${Math.round(window.activity.progress)}%`
                                                : ""}
                                            </small>
                                          )}
                                      </span>
                                      {window.activity &&
                                      props.settings?.notifications
                                        .showInTabs ? (
                                        <span
                                          className={`activity-status ${window.activity.state}`}
                                          aria-label={activityLabel(
                                            window.activity,
                                          )}
                                        />
                                      ) : (
                                        selected && (
                                          <span
                                            className="window-live-dot"
                                            aria-hidden="true"
                                          />
                                        )
                                      )}
                                      {(props.settings?.tabIcons ?? 1) > 1 &&
                                        window.icons
                                          ?.slice(1, props.settings?.tabIcons)
                                          .map((program, index) => (
                                            <span
                                              className={`extra-program-icon ${props.settings?.tabIconColors === "always" || (props.settings?.tabIconColors === "active-tab" && selected) ? "" : "monochrome"}`}
                                              key={index}
                                            >
                                              <ProgramIcon
                                                program={program}
                                                shellTheme={
                                                  props.settings?.shellIconTheme
                                                }
                                              />
                                            </span>
                                          ))}
                                    </button>
                                  );
                                })}
                              {session.windows.length === 0 && (
                                <button
                                  type="button"
                                  className={`window-item ${activeSession ? "is-selected" : ""}`}
                                  onClick={() =>
                                    props.onSelect(host.id, session.id)
                                  }
                                >
                                  <span className="terminal-glyph">
                                    <Terminal size={17} />
                                  </span>
                                  <span className="window-label">
                                    Open session
                                  </span>
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <button
          type="button"
          className="new-workspace-button"
          onClick={() =>
            props.onNewSession(
              props.activeHostId ?? props.hosts[0]?.id ?? "local",
            )
          }
        >
          <FolderPlus size={16} />
          <span>New session</span>
          <kbd>Ctrl Shift N</kbd>
        </button>
        <div className="sidebar-footer">
          <span className="server-status">
            <span
              className={`status-dot ${activeHost?.connected ? "online" : "offline"}`}
            />
            {activeHost?.connected ? "Rex connected" : "Rex disconnected"}
          </span>
          <div className="footer-actions">
            {props.onActivity && (
              <IconButton
                label="Program activity"
                onClick={props.onActivity}
                active={props.activityOnly}
              >
                <Eye size={16} />
              </IconButton>
            )}
            {props.onAddHost && (
              <IconButton label="Add host" onClick={props.onAddHost}>
                <Server size={15} />
              </IconButton>
            )}
            <IconButton
              label="Command palette"
              shortcut="Ctrl Shift P"
              onClick={props.onPalette}
            >
              <Command size={16} />
            </IconButton>
            <IconButton label="Settings" onClick={props.onSettings}>
              <Settings2 size={16} />
            </IconButton>
          </div>
        </div>
        <div className="sidebar-build">
          <span>LINUSAURUS REX</span>
          <span>Independent Linux client</span>
        </div>
      </div>
    </aside>
  );
}
