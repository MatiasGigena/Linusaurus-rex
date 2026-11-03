import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronRight, Command, FolderPlus, Loader2, Plus, RefreshCw, Server, Settings2, TerminalSquare } from 'lucide-react';
import { Sidebar, type NavigationHost } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Dialog } from './components/Dialog';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { TerminalPane } from './terminal/TerminalPane';
import { type RexMethods, type Selection, type ServerStatus, type SessionView, type Settings } from './shared/types';

type HostState = NavigationHost & { status?: ServerStatus };
type Prompt = { title: string; description: string; label: string; value: string; cwd?: string; submit(value: string, cwd?: string): Promise<void> };
type Confirmation = { title: string; description: string; submit(): Promise<void> };
const viewKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;
const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);

export default function App() {
  const [settings, setSettings] = useState<Settings>();
  const [hosts, setHosts] = useState<HostState[]>([]);
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const [selection, setSelection] = useState<Selection>();
  const [focusedPane, setFocusedPane] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const refreshing = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const currentSettings = settingsRef.current;
    if (!currentSettings || refreshing.current) return;
    refreshing.current = true;
    try {
      const nextViews: Record<string, SessionView> = {};
      const nextHosts = await Promise.all(currentSettings.hosts.map(async (host): Promise<HostState> => {
        const status = await window.rex.request('status', { hostId: host.id });
        if (!status.connected) return { ...host, connected: false, error: status.error, sessions: [], status };
        try {
          const sessions = await window.rex.request('listSessions', { hostId: host.id });
          const navigationSessions = await Promise.all(sessions.map(async (session) => {
            try {
              const view = await window.rex.request('inspectSession', { hostId: host.id, sessionId: session.id });
              nextViews[viewKey(host.id, session.id)] = view;
              return { ...session, windows: view.windows.map(({ id, label }) => ({ id, label })) };
            } catch { return { ...session, windows: [] }; }
          }));
          return { ...host, connected: true, sessions: navigationSessions, status };
        } catch (failure) { return { ...host, connected: false, error: message(failure), sessions: [], status }; }
      }));
      if (!mounted.current) return;
      setHosts(nextHosts);
      setViews(nextViews);
      const current = selectionRef.current;
      const currentView = current && nextViews[viewKey(current.hostId, current.sessionId)];
      if (currentView) {
        if (!currentView.windows.some((window) => window.id === current.windowId)) {
          const id = currentView.activeWindowId || currentView.windows[0]?.id;
          if (id) setSelection({ ...current, windowId: id });
        }
      } else if (!current || !nextHosts.some((host) => host.id === current.hostId) || nextHosts.find((host) => host.id === current.hostId)?.connected) {
        const firstHost = nextHosts.find((host) => host.connected && host.sessions.length);
        const firstSession = firstHost?.sessions[0];
        const firstView = firstHost && firstSession && nextViews[viewKey(firstHost.id, firstSession.id)];
        setSelection(firstHost && firstSession && firstView ? {
          hostId: firstHost.id, sessionId: firstSession.id,
          windowId: firstView.activeWindowId || firstView.windows[0]?.id || '',
        } : undefined);
      }
    } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { refreshing.current = false; if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!window.rex) { setError('Open Linusaurus Rex as a desktop app with npm run dev or npm start.'); setLoading(false); return; }
    void window.rex.getSettings().then((saved) => {
      if (!mounted.current) return;
      settingsRef.current = saved;
      setSettings(saved);
      setSelection(saved.lastSelection);
      selectionRef.current = saved.lastSelection;
      void refresh();
    }).catch((failure) => { setError(message(failure)); setLoading(false); });
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  const saveSettings = async (next: Settings) => {
    const saved = await window.rex.setSettings(next);
    settingsRef.current = saved;
    setSettings(saved);
    return saved;
  };
  useEffect(() => {
    if (!selection || !settingsRef.current) return;
    const timer = setTimeout(() => {
      if (settingsRef.current) void saveSettings({ ...settingsRef.current, lastSelection: selection }).catch((failure) => setError(message(failure)));
    }, 350);
    return () => clearTimeout(timer);
  }, [selection]);

  const activeHost = hosts.find((host) => host.id === selection?.hostId) || hosts[0];
  const view = selection && views[viewKey(selection.hostId, selection.sessionId)];
  const activeWindow = view && view.windows.find((window) => window.id === selection?.windowId);
  const activePane = activeWindow?.panes.find((pane) => pane.id === focusedPane) || activeWindow?.panes.find((pane) => pane.id === activeWindow.focusedBlockId) || activeWindow?.panes[0];
  const terminalRef = selection && activePane && { hostId: selection.hostId, sessionId: selection.sessionId, blockId: activePane.id };
  const modalOpen = paletteOpen || settingsOpen || !!prompt || !!confirmation || addHostOpen;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await action(); await refresh(); }
    catch (failure) { setError(message(failure)); throw failure; }
    finally { setBusy(false); }
  };
  const mutate = <K extends keyof RexMethods>(method: K, args: RexMethods[K]['args']) =>
    run(async () => { await window.rex.request(method, args); }).catch(() => {});
  const select = (hostId: string, sessionId: string, windowId?: string) => {
    const nextView = views[viewKey(hostId, sessionId)];
    setFocusedPane(undefined);
    setSelection({ hostId, sessionId, windowId: windowId || nextView?.activeWindowId || nextView?.windows[0]?.id || '' });
  };
  const newSession = (hostId = activeHost?.id || 'local') => setPrompt({
    title: 'New session', description: 'A persistent workspace on your Rex server.', label: 'Session name', value: '', cwd: '',
    submit: async (label, cwd) => {
      await run(async () => {
        const created = await window.rex.request('createSession', { hostId, label, cwd: cwd || undefined });
        const nextView = await window.rex.request('inspectSession', { hostId, sessionId: created.sessionId });
        setSelection({ hostId, sessionId: created.sessionId, windowId: nextView.activeWindowId || nextView.windows[0]?.id || '' });
      });
    },
  });
  const newWindow = async (hostId = selection?.hostId, sessionId = selection?.sessionId) => {
    if (!hostId || !sessionId) { newSession(hostId); return; }
    await run(async () => {
      await window.rex.request('newWindow', { hostId, sessionId });
      const nextView = await window.rex.request('inspectSession', { hostId, sessionId });
      setFocusedPane(undefined);
      setSelection({ hostId, sessionId, windowId: nextView.activeWindowId });
    }).catch(() => {});
  };
  const renameSession = (hostId: string, sessionId: string) => {
    const session = views[viewKey(hostId, sessionId)];
    setPrompt({ title: 'Rename session', description: 'This name is shared with your other Rex clients.', label: 'Session name', value: session?.label || '',
      submit: async (label) => { await run(() => window.rex.request('renameSession', { hostId, sessionId, label })); } });
  };
  const renameWindow = () => {
    if (!selection || !activeWindow) return;
    setPrompt({ title: 'Rename tab', description: 'Give this terminal tab a recognizable name.', label: 'Tab name', value: activeWindow.label,
      submit: async (label) => { await run(() => window.rex.request('renameWindow', { ...selection, label })); } });
  };
  const split = (direction: 'right' | 'below') => { if (terminalRef) void mutate('split', { ...terminalRef, direction }); };
  const closeWindow = () => {
    if (!selection || !activeWindow) return;
    setConfirmation({ title: 'Close this tab?', description: `“${activeWindow.label}” and its ${activeWindow.panes.length === 1 ? 'terminal' : `${activeWindow.panes.length} terminals`} will close on the server. Running programs may be terminated.`,
      submit: async () => { await run(() => window.rex.request('closeWindow', selection)); } });
  };
  const closePane = (blockId = activePane?.id) => {
    if (!selection || !blockId) return;
    setConfirmation({ title: 'Close this pane?', description: 'This terminal will close on the Rex server. Its running program may be terminated.',
      submit: async () => { await run(() => window.rex.request('closePane', { ...selection, blockId })); } });
  };
  const toggleSidebar = () => {
    if (settingsRef.current) void saveSettings({ ...settingsRef.current, sidebarCollapsed: !settingsRef.current.sidebarCollapsed }).catch((failure) => setError(message(failure)));
  };
  const commandsRef = useRef<(command: string) => void>(() => {});
  commandsRef.current = (command) => {
    if (modalOpen) return;
    switch (command) {
      case 'new-session': newSession(); break;
      case 'new-window': void newWindow(); break;
      case 'toggle-sidebar': toggleSidebar(); break;
      case 'command-palette': setPaletteOpen(true); break;
      case 'settings': setSettingsOpen(true); break;
      case 'split-right': split('right'); break;
      case 'split-below': split('below'); break;
      case 'zoom': if (terminalRef) void mutate('zoom', terminalRef); break;
      case 'close-pane': closePane(); break;
      case 'close-window': closeWindow(); break;
    }
  };
  useEffect(() => {
    if (!window.rex) return;
    const unsubscribe = window.rex.onCommand((command) => commandsRef.current(command));
    const keydown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      const command = ({ KeyP: 'command-palette', KeyN: 'new-session', KeyT: 'new-window', KeyB: 'toggle-sidebar', KeyW: 'close-window', KeyD: event.altKey ? 'split-below' : 'split-right', Comma: 'settings', Enter: 'zoom' } as Record<string, string>)[event.code];
      if (command) { event.preventDefault(); commandsRef.current(command); }
    };
    window.addEventListener('keydown', keydown);
    return () => { unsubscribe(); window.removeEventListener('keydown', keydown); };
  }, []);

  const paletteCommands: PaletteCommand[] = [
    { id: 'new-session', label: 'New session', description: 'Create a persistent workspace', shortcut: 'Ctrl Shift N', icon: <FolderPlus size={17} />, run: () => newSession() },
    { id: 'new-window', label: 'New terminal tab', shortcut: 'Ctrl Shift T', icon: <Plus size={17} />, run: () => void newWindow() },
    ...(terminalRef ? [
      { id: 'split-right', label: 'Split right', shortcut: 'Ctrl Shift D', run: () => split('right') },
      { id: 'split-below', label: 'Split below', shortcut: 'Ctrl Shift Alt D', run: () => split('below') },
      { id: 'zoom', label: 'Toggle pane zoom', run: () => void mutate('zoom', terminalRef) },
      { id: 'rename-tab', label: 'Rename current tab', run: renameWindow },
    ] : []),
    { id: 'sidebar', label: 'Toggle sidebar', shortcut: 'Ctrl Shift B', run: toggleSidebar },
    { id: 'settings', label: 'Settings', icon: <Settings2 size={17} />, run: () => setSettingsOpen(true) },
    { id: 'add-host', label: 'Connect another host', icon: <Server size={17} />, run: () => setAddHostOpen(true) },
    ...hosts.flatMap((host) => host.sessions.map((session) => ({ id: `${host.id}/${session.id}`, label: session.label, description: host.label, icon: <TerminalSquare size={17} />, run: () => select(host.id, session.id) }))),
  ];

  if (!settings && loading) return <div className="startup-state"><Loader2 className="spinning" size={24} /><span>Connecting to Rex…</span></div>;
  if (!settings) return <div className="startup-state"><AlertCircle size={25} /><h2>Could not open Linusaurus Rex</h2><p>{error}</p></div>;

  return <div className="app-shell">
    <Sidebar hosts={hosts} activeHostId={selection?.hostId} activeSessionId={selection?.sessionId} activeWindowId={selection?.windowId}
      collapsed={settings.sidebarCollapsed} onSelect={select} onNewSession={newSession} onNewWindow={(hostId, sessionId) => void newWindow(hostId, sessionId)}
      onRenameSession={renameSession} onSettings={() => setSettingsOpen(true)} onToggle={toggleSidebar} onPalette={() => setPaletteOpen(true)}
      onAddHost={() => setAddHostOpen(true)} />
    <main className="workspace">
      <Toolbar title={activeWindow?.label || 'Linusaurus Rex'} subtitle={view ? `${activeHost?.label}  /  ${view.label}` : 'Your terminals, together'}
        connected={activeHost?.connected || false} sidebarCollapsed={settings.sidebarCollapsed} onToggleSidebar={toggleSidebar}
        onSplit={split} onNewWindow={() => void newWindow()} onZoom={() => { if (terminalRef) void mutate('zoom', terminalRef); }}
        onCloseWindow={closeWindow} onPalette={() => setPaletteOpen(true)} onSettings={() => setSettingsOpen(true)} onRenameWindow={renameWindow}
        onClosePane={activeWindow && activeWindow.panes.length > 1 ? () => closePane() : undefined} onWindowControl={window.rex.windowControl} />
      {error && <div className="connection-banner" role="alert"><AlertCircle size={15} /><span>{error}</span><button onClick={() => setError(undefined)} aria-label="Dismiss error">×</button></div>}
      <div className="workspace-body">
        {activeWindow && selection && activeHost?.connected ? <div className={`terminal-layout ${activeWindow.panes.length > 1 ? 'has-splits' : ''}`} style={{ position: 'relative', width: '100%', height: '100%' }}>
          {activeWindow.panes.map((pane) => <div key={pane.id} style={{ position: 'absolute', left: `${pane.rect[0] * 100}%`, top: `${pane.rect[1] * 100}%`, width: `${pane.rect[2] * 100}%`, height: `${pane.rect[3] * 100}%`, padding: activeWindow.panes.length > 1 ? 4 : 0 }}>
            <TerminalPane pane={pane} terminalRef={{ hostId: selection.hostId, sessionId: selection.sessionId, blockId: pane.id }} settings={settings}
              focused={!modalOpen && pane.id === activePane?.id} showHeader={activeWindow.panes.length > 1}
              onFocus={() => { if (pane.id !== activePane?.id) { setFocusedPane(pane.id); void window.rex.request('focus', { hostId: selection.hostId, sessionId: selection.sessionId, blockId: pane.id }).catch((failure) => setError(message(failure))); } }}
              onZoom={() => void mutate('zoom', { hostId: selection.hostId, sessionId: selection.sessionId, blockId: pane.id })} onClose={() => closePane(pane.id)} />
          </div>)}
        </div> : <div className="empty-state">
          <div className="empty-terminal-icon"><TerminalSquare size={30} strokeWidth={1.3} /></div>
          <span className="eyebrow">LINUSAURUS REX</span>
          <h1>{loading ? 'Finding your workspace…' : hosts.some((host) => host.connected) ? 'Make room for your next idea.' : 'Your workspace is waiting.'}</h1>
          <p>{hosts.some((host) => host.connected) ? 'Open a session from the sidebar, or start a fresh terminal. Rex keeps your work right where you leave it.' : activeHost?.error || 'Start your installed Rex server, then reconnect to bring your terminals together.'}</p>
          <div className="empty-actions"><button className="button button-primary" onClick={() => newSession()}><Plus size={15} /> New session</button><button className="button" onClick={() => void refresh()}><RefreshCw size={14} /> Reconnect</button></div>
          <button className="empty-palette" onClick={() => setPaletteOpen(true)}><Command size={13} /> Find a session or command <kbd>Ctrl Shift P</kbd></button>
        </div>}
      </div>
      <footer className="workspace-status"><span><i className={activeHost?.connected ? 'status-dot online' : 'status-dot'} />{busy ? 'Updating workspace…' : activeHost?.connected ? 'Connected to Rex' : 'Disconnected'}</span>
        <span className="status-breadcrumb">{view?.label || 'No session'}<ChevronRight size={11} />{activeWindow ? `${activeWindow.panes.length} ${activeWindow.panes.length === 1 ? 'pane' : 'panes'}` : 'Ready when you are'}</span>
        <span className="status-version">{activeHost?.status?.version ? `Rex ${activeHost.status.version.split('-')[0]}` : 'Linux client'}<kbd>Ctrl Shift P</kbd></span></footer>
    </main>
    {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
    {prompt && <PromptDialog prompt={prompt} busy={busy} onClose={() => setPrompt(undefined)} />}
    {confirmation && <ConfirmationDialog confirmation={confirmation} busy={busy} onClose={() => setConfirmation(undefined)} />}
    {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onAddHost={() => { setSettingsOpen(false); setAddHostOpen(true); }} />}
    {addHostOpen && <AddHostDialog onClose={() => setAddHostOpen(false)} onSave={async (label, endpoint) => { await saveSettings({ ...settingsRef.current!, hosts: [...settingsRef.current!.hosts, { id: crypto.randomUUID(), label, endpoint }] }); void refresh(); }} />}
  </div>;
}

function PromptDialog({ prompt, busy, onClose }: { prompt: Prompt; busy: boolean; onClose(): void }) {
  const [value, setValue] = useState(prompt.value);
  const [cwd, setCwd] = useState(prompt.cwd || '');
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    try { await prompt.submit(value.trim(), cwd.trim()); onClose(); } catch (failure) { setError(message(failure)); }
  };
  return <Dialog title={prompt.title} subtitle={prompt.description} onClose={onClose}>
    <form onSubmit={(event) => void submit(event)}><label className="form-field">{prompt.label}<input className="form-input" data-autofocus autoFocus maxLength={120} value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. side-project" required /></label>
      {prompt.cwd !== undefined && <label className="form-field">Working directory <span className="form-hint">Optional · path on the server</span><input className="form-input" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Default home directory" /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  </Dialog>;
}

function ConfirmationDialog({ confirmation, busy, onClose }: { confirmation: Confirmation; busy: boolean; onClose(): void }) {
  const [error, setError] = useState<string>();
  return <Dialog title={confirmation.title} subtitle={confirmation.description} onClose={onClose}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button" onClick={onClose}>Keep open</button><button className="button button-danger" disabled={busy} onClick={() => { void confirmation.submit().then(onClose).catch((failure) => setError(message(failure))); }}>{busy ? 'Closing…' : 'Close terminal'}</button></div>
  </Dialog>;
}

function SettingsDialog({ settings, onSave, onClose, onAddHost }: { settings: Settings; onSave(settings: Settings): Promise<Settings>; onClose(): void; onAddHost(): void }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return <Dialog title="Make yourself at home" subtitle="A few small things that make your terminal yours." onClose={onClose} wide>
    <form onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSave(draft).then(onClose).catch((failure) => { setError(message(failure)); setSaving(false); }); }}>
      <div className="settings-section-label">TERMINAL</div>
      <div className="settings-row"><label htmlFor="font-family">Font family<span className="form-hint">Use a monospace font installed on this computer.</span></label><input id="font-family" className="form-input" value={draft.fontFamily} onChange={(event) => setDraft({ ...draft, fontFamily: event.target.value })} required /></div>
      <div className="settings-row"><label htmlFor="font-size">Font size<span className="form-hint">Comfortable at every screen size.</span></label><select id="font-size" className="form-select" value={draft.fontSize} onChange={(event) => setDraft({ ...draft, fontSize: Number(event.target.value) })}>{[10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32].map((size) => <option key={size} value={size}>{size} px</option>)}</select></div>
      <div className="settings-section-label">CONNECTED HOSTS</div>
      {draft.hosts.map((host) => <div className="settings-host" key={host.id}><Server size={16} /><div><strong>{host.label}</strong><span>{host.endpoint || 'Local Rex server · automatic discovery'}</span></div>{host.id !== 'local' && <button className="button" type="button" onClick={() => setDraft({ ...draft, hosts: draft.hosts.filter((item) => item.id !== host.id) })}>Remove</button>}</div>)}
      <button type="button" className="text-button" onClick={onAddHost}><Plus size={14} /> Connect another host</button>
      <div className="settings-section-label">KEYBOARD</div><div className="shortcut-grid"><span>New session</span><kbd>Ctrl Shift N</kbd><span>New tab</span><kbd>Ctrl Shift T</kbd><span>Split right / below</span><kbd>Ctrl Shift [Alt] D</kbd><span>Commands & sessions</span><kbd>Ctrl Shift P</kbd><span>Toggle sidebar</span><kbd>Ctrl Shift B</kbd><span>Copy / paste</span><kbd>Ctrl Shift C / V</kbd></div>
      <p className="form-hint settings-note">Linusaurus Rex is an independent Linux client. Your sessions live on Rex and keep running when this app closes.</p>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Check size={14} />{saving ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </Dialog>;
}

function AddHostDialog({ onSave, onClose }: { onSave(label: string, endpoint: string): Promise<void>; onClose(): void }) {
  const [label, setLabel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return <Dialog title="Connect another host" subtitle="Attach to a Rex server you already have access to." onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (saving) return; setSaving(true); void onSave(label.trim(), endpoint.trim()).then(onClose).catch((failure) => { setError(message(failure)); setSaving(false); }); }}>
      <label className="form-field">Display name<input className="form-input" data-autofocus autoFocus required maxLength={80} placeholder="e.g. studio-linux" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="form-field">Rex endpoint or saved host label<input className="form-input" required placeholder="unix:///path/to/server.sock or my-host" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
      <p className="form-hint">Uses the installed Rex CLI’s connection and authentication settings. Configure remote access in Rex first.</p>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving || !label.trim() || !endpoint.trim()}>{saving ? 'Saving…' : 'Add host'}</button></div>
    </form>
  </Dialog>;
}
