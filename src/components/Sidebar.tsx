import type { NavigationPreferences } from "./sidebar/navigation";
import { HostNavigation } from "./sidebar/HostNavigation";
import { SidebarResizer } from "./sidebar/SidebarResizer";
import { SidebarFooter } from "./sidebar/SidebarFooter";
import { PanelLeftClose, Search, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProgramActivity } from "../shared/types";
import { IconButton } from "./IconButton";
import { WindowControls, type WindowControlAction } from "./WindowControls";

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
  preferences?: NavigationPreferences;
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
  /** When set, the sidebar titlebar leads with macOS-style traffic lights. */
  onWindowControl?: (action: WindowControlAction) => void;
  /**
   * macOS footer: one "New session" button with a menu for the less common
   * actions, and activity shown only while programs report it.
   */
  compactFooter?: boolean;
  /** Number of programs currently reporting activity. */
  activityCount?: number;
}

export function Sidebar(props: SidebarProps) {
  const [closedHosts, setClosedHosts] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
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
      <SidebarResizer
        width={props.width}
        committedWidth={props.preferences?.sidebarWidth}
        right={props.preferences?.tabStyle === "right"}
        onResize={props.onResize}
        onResizeEnd={props.onResizeEnd}
      />
      <div className="sidebar-titlebar">
        {props.onWindowControl && (
          <WindowControls
            variant="traffic"
            onWindowControl={props.onWindowControl}
          />
        )}
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
        {props.hosts.map((host, index) => (
          <HostNavigation
            key={host.id}
            host={host}
            index={index}
            closed={closedHosts.has(host.id)}
            onToggleHost={toggleHost}
            filter={filter}
            activeHostId={props.activeHostId}
            activeSessionId={props.activeSessionId}
            activeWindowId={props.activeWindowId}
            preferences={props.preferences}
            collapsedSessions={props.collapsedSessions}
            onToggleSession={props.onToggleSession}
            onSelect={props.onSelect}
            onNewSession={props.onNewSession}
            onNewWindow={props.onNewWindow}
            onRenameSession={props.onRenameSession}
            onContextSession={props.onContextSession}
            onContextWindow={props.onContextWindow}
            onCloseWindow={props.onCloseWindow}
            onReorderWindow={props.onReorderWindow}
            activityOnly={props.activityOnly}
          />
        ))}
      </nav>

      <SidebarFooter
        hosts={props.hosts}
        activeHostId={props.activeHostId}
        compactFooter={props.compactFooter}
        onNewSession={props.onNewSession}
        onActivity={props.onActivity}
        activityOnly={props.activityOnly}
        activityCount={props.activityCount}
        onAddHost={props.onAddHost}
        onPalette={props.onPalette}
        onSettings={props.onSettings}
      />
    </aside>
  );
}
