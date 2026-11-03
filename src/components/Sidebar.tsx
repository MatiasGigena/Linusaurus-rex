import { ChevronDown, ChevronRight, Command, FolderPlus, Laptop, PanelLeftClose, Plus, Search, Server, Settings2, Terminal, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from './IconButton';

export interface NavigationWindow { id: string; label: string }
export interface NavigationSession { id: string; label: string; windows: NavigationWindow[] }
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
  onSelect: (hostId: string, sessionId: string, windowId?: string) => void;
  onNewSession: (hostId: string) => void;
  onNewWindow: (hostId: string, sessionId: string) => void;
  onRenameSession: (hostId: string, sessionId: string) => void;
  onSettings: () => void;
  onToggle: () => void;
  onPalette: () => void;
  onAddHost?: () => void;
  onDeleteHost?: (hostId: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const [closedHosts, setClosedHosts] = useState<Set<string>>(new Set());
  if (props.collapsed) return null;
  const toggleHost = (id: string) => setClosedHosts(previous => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const activeHost = props.hosts.find(host => host.id === props.activeHostId);
  const sessionCount = props.hosts.reduce((count, host) => count + host.sessions.length, 0);

  return (
    <aside className="sidebar" aria-label="Rex workspaces">
      <div className="sidebar-titlebar">
        <div className="brand-mark" aria-hidden="true"><Terminal size={17} strokeWidth={2.2} /></div>
        <div className="brand-name">Linusaurus<span>rex</span></div>
        <span className="beta-label">BETA</span>
        <IconButton label="Hide sidebar" shortcut="Ctrl Shift B" onClick={props.onToggle} className="sidebar-toggle"><PanelLeftClose size={17} /></IconButton>
      </div>

      <button type="button" className="quick-switcher" onClick={props.onPalette}>
        <Search size={15} /><span>Jump to a session</span><kbd>Ctrl Shift P</kbd>
      </button>

      <div className="sidebar-section-label"><span>WORKSPACES</span><span className="session-count">{sessionCount}</span></div>
      <nav className="workspace-navigation" aria-label="Hosts and sessions">
        {props.hosts.map((host, index) => {
          const closed = closedHosts.has(host.id);
          return <section key={host.id} className="host-group">
            <div className="host-heading">
              <button type="button" className="host-toggle" aria-expanded={!closed} onClick={() => toggleHost(host.id)} title={host.endpoint ?? host.label}>
                <span className="host-icon">{index === 0 ? <Laptop size={18} /> : <Server size={17} />}</span>
                <span className="host-name">{host.label}</span>
                <span className={`status-dot ${host.connected ? 'online' : 'offline'}`} aria-label={host.connected ? 'Connected' : 'Disconnected'} />
                {closed ? <ChevronRight size={13} className="host-chevron" /> : <ChevronDown size={13} className="host-chevron" />}
              </button>
              <IconButton label={`New session on ${host.label}`} onClick={() => props.onNewSession(host.id)} className="host-add"><Plus size={15} /></IconButton>
            </div>
            {!closed && <div className="host-sessions">
              {!host.connected && <div className="host-disconnected" title={host.error}><WifiOff size={13} /><span>{host.error || 'Waiting for connection'}</span></div>}
              {host.sessions.length === 0 && host.connected && <button type="button" className="no-sessions" onClick={() => props.onNewSession(host.id)}><Plus size={13} /> Create a session</button>}
              {host.sessions.map(session => {
                const activeSession = host.id === props.activeHostId && session.id === props.activeSessionId;
                return <div className={`session-group ${activeSession ? 'is-current' : ''}`} key={session.id}>
                  <div className="session-heading">
                    <button type="button" className="session-label" onClick={() => props.onSelect(host.id, session.id)} onDoubleClick={() => props.onRenameSession(host.id, session.id)} title={`${session.label} · Double-click to rename`}>
                      <span className="session-label-text">{session.label}</span>
                      {activeSession && <span className="session-active-indicator" />}
                    </button>
                    <IconButton label={`New terminal in ${session.label}`} onClick={() => props.onNewWindow(host.id, session.id)} className="session-add"><Plus size={13} /></IconButton>
                  </div>
                  <div className="session-windows">
                    {session.windows.map(window => {
                      const selected = activeSession && window.id === props.activeWindowId;
                      return <button key={window.id} type="button" className={`window-item ${selected ? 'is-selected' : ''}`} onClick={() => props.onSelect(host.id, session.id, window.id)} aria-current={selected ? 'page' : undefined} title={window.label}>
                        <span className="terminal-glyph"><Terminal size={17} strokeWidth={1.7} /></span>
                        <span className="window-label">{window.label || 'Terminal'}</span>
                        {selected && <span className="window-live-dot" aria-hidden="true" />}
                      </button>;
                    })}
                    {session.windows.length === 0 && <button type="button" className={`window-item ${activeSession ? 'is-selected' : ''}`} onClick={() => props.onSelect(host.id, session.id)}><span className="terminal-glyph"><Terminal size={17} /></span><span className="window-label">Open session</span></button>}
                  </div>
                </div>;
              })}
            </div>}
          </section>;
        })}
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="new-workspace-button" onClick={() => props.onNewSession(props.activeHostId ?? props.hosts[0]?.id ?? 'local')}><FolderPlus size={16} /><span>New session</span><kbd>Ctrl Shift N</kbd></button>
        <div className="sidebar-footer">
          <span className="server-status"><span className={`status-dot ${activeHost?.connected ? 'online' : 'offline'}`} />{activeHost?.connected ? 'Rex connected' : 'Rex disconnected'}</span>
          <div className="footer-actions">
            {props.onAddHost && <IconButton label="Add host" onClick={props.onAddHost}><Server size={15} /></IconButton>}
            <IconButton label="Command palette" shortcut="Ctrl Shift P" onClick={props.onPalette}><Command size={16} /></IconButton>
            <IconButton label="Settings" onClick={props.onSettings}><Settings2 size={16} /></IconButton>
          </div>
        </div>
        <div className="sidebar-build"><span>LINUSAURUS REX</span><span>Independent Linux client</span></div>
      </div>
    </aside>
  );
}
