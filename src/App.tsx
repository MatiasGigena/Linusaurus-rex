import { buildPaletteCommands } from "./workspace/palette";
import { sessionMenuItems, tabMenuItems } from "./workspace/contextMenus";
import { useWorkspaceGestures } from "./hooks/useWorkspaceGestures";
import { configuredShortcutEntries } from "./shared/actions";
import { createHostSaver } from "./workspace/actions/hostActions";
import { createServerActions } from "./workspace/actions/serverActions";
import { pickDirectoryPath } from "./workspace/actions/directoryActions";
import {
  buildNavigationHosts,
  buildActivityFeed,
  enrichWindow,
} from "./workspace/presentation";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { FormDialog, ConfirmDialog } from "./components/WorkspaceDialogs";
import { useInterfaceAppearance } from "./hooks/useInterfaceAppearance";
import { createWorkspaceActions } from "./workspace/actions/createWorkspaceActions";
import type { Form, Confirmation } from "./workspace/actions/context";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  ChevronRight,
  Command,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { Dialog } from "./components/Dialog";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu, type ContextItem } from "./components/ContextMenu";
import { SettingsDialog } from "./components/preferences/SettingsDialog";
import type { SettingsTab } from "./components/preferences/types";
import { HostDialog } from "./components/HostDialog";
import { ConfigurationDialog } from "./components/ConfigurationDialog";
import { DiagnosticsDialog } from "./components/DiagnosticsDialog";
import { PairDeviceDialog } from "./components/PairDeviceDialog";
import { DirectoryDialog } from "./components/DirectoryDialog";
import { TabStrip } from "./components/TabStrip";
import { NativeServicesDialog } from "./components/services/NativeServicesDialog";
import type { UpdateState } from "./shared/types";
import "./linux.css";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  activityLabel,
  errorMessage,
  matchesShortcut,
  windowTitle,
  viewKey,
} from "./core/workspace";
import { type ClientEvent, type Host } from "./shared/types";

type Menu = { x: number; y: number; items: (ContextItem | null)[] };
export default function App() {
  const ws = useWorkspace();
  const {
    settings,
    hosts,
    views,
    selection,
    focusedPane,
    metadata,
    keymaps,
    error,
    busy,
    loading,
  } = ws;
  const [palette, setPalette] = useState<"all" | "sessions">();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [form, setForm] = useState<Form>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [editingHost, setEditingHost] = useState<Host | null>();
  const [configuration, setConfiguration] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [nativeServices, setNativeServices] = useState<"server" | "updates">();
  const [updateState, setUpdateState] = useState<UpdateState>();
  const [directoryBrowser, setDirectoryBrowser] = useState<{
    mode: "insert" | "directory";
    ref: { hostId: string; sessionId: string; blockId: string };
  }>();
  const [connectionRevisions, setConnectionRevisions] = useState<
    Record<string, number>
  >({});
  const [report, setReport] = useState<{ title: string; body: string }>();
  const [menu, setMenu] = useState<Menu>();
  const [activityOpen, setActivityOpen] = useState(false);
  const interfaceTheme = useInterfaceAppearance(settings);
  const [activityOnly, setActivityOnly] = useState(false);
  const [activityGroup, setActivityGroup] = useState<"session" | "priority">(
    "session",
  );
  const [collapsedSessions, setCollapsedSessions] = useState(new Set<string>());
  const [nativeFocused, setNativeFocused] = useState(document.hasFocus());
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number>();
  const workspaceElement = useRef<HTMLDivElement>(null);
  const executeRef = useRef<
    (
      name: string,
      args?: Record<string, unknown>,
      event?: ClientEvent,
    ) => Promise<unknown>
  >(async () => {});
  const modalOpen =
    !!palette ||
    !!settingsTab ||
    !!form ||
    !!confirmation ||
    editingHost !== undefined ||
    configuration ||
    diagnostics ||
    pairing ||
    !!nativeServices ||
    !!directoryBrowser ||
    !!report;
  const activeHost =
    hosts.find((host) => host.id === selection?.hostId) || hosts[0];
  const view =
    selection && views[viewKey(selection.hostId, selection.sessionId)];
  const rawWindow = view?.windows.find(
    (window) => window.id === selection?.windowId,
  );
  const activeWindow =
    rawWindow && selection
      ? enrichWindow(selection.hostId, selection.sessionId, rawWindow, metadata)
      : undefined;
  const toggleCollapse = (sessionId: string) =>
    setCollapsedSessions((previous) => {
      const next = new Set(previous);
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId);
      return next;
    });
  const safely = (action: () => Promise<unknown>) =>
    void action().catch((failure) => ws.setError(errorMessage(failure)));
  const dispatch = (name: string, args: Record<string, unknown> = {}) =>
    safely(() => executeRef.current(name, args));

  useEffect(() => {
    if (selection?.windowId)
      void window.rex
        .request("focusWindow", selection)
        .catch((failure) => ws.setError(errorMessage(failure)));
  }, [selection?.hostId, selection?.sessionId, selection?.windowId]);
  useWorkspaceGestures(workspaceElement, settings, activeWindow, dispatch);
  useEffect(() => {
    const focus = () => setNativeFocused(true);
    const blur = () => setNativeFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    if (window.rex)
      void window.rex
        .request("setContext", { uiBusy: modalOpen || !!menu })
        .catch(() => {});
  }, [modalOpen, menu]);
  useEffect(() => {
    if (!window.rex) return;
    void window.rex
      .request("updateStatus", {})
      .then(setUpdateState)
      .catch(() => {});
    return window.rex.onClientEvent((event) => {
      if (event.type === "update") setUpdateState(event.state);
    });
  }, []);
  const execute = createWorkspaceActions({
    workspace: ws.operations,
    settings,
    hosts,
    views,
    selection,
    focusedPane,
    keymaps,
    interfaceTheme,
    workspaceElement,
    setPalette,
    setSettingsTab,
    setDiagnostics,
    setPairing,
    setEditingHost,
    setConfirmation,
    setForm,
    setCollapsedSessions,
    setActivityOnly,
    setActivityOpen,
    setActivityGroup,
    setDirectoryBrowser,
    onError: ws.setError,
  });

  executeRef.current = execute;
  ws.actionHandler.current = (name, args, event) =>
    executeRef.current(name, args, event);

  useEffect(() => {
    if (!window.rex) return;
    const unsubscribe = window.rex.onCommand((command) => {
      if (!modalOpen) safely(() => executeRef.current(command));
    });
    const keydown = (event: KeyboardEvent) => {
      if (modalOpen) return;
      const config = ws.settingsRef.current;
      if (!config) return;
      if ((event.target as Element)?.closest?.(".terminal-container")) return;
      const shortcut = configuredShortcutEntries(config.shortcuts).find(
        ([, shortcut]) => matchesShortcut(event, shortcut),
      );
      if (shortcut) {
        event.preventDefault();
        event.stopPropagation();
        safely(() => executeRef.current(shortcut[0]));
        return;
      }
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        /^Digit[1-9]$/.test(event.code)
      ) {
        event.preventDefault();
        dispatch("client.tab.goto", { index: Number(event.code.slice(-1)) });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", keydown, true);
    };
  }, [modalOpen, menu]);

  const navHosts = buildNavigationHosts(hosts, views, metadata, settings);
  const allActivities = buildActivityFeed(
    hosts,
    views,
    metadata,
    settings,
    activityGroup,
  );
  const paletteCommands = buildPaletteCommands({
    palette,
    settings,
    keymaps,
    activeHostId: activeHost?.id,
    navHosts,
    dispatch,
    execute,
    select: ws.operations.select,
    setForm,
  });
  const openSessionMenu = (
    event: React.MouseEvent,
    hostId: string,
    sessionId: string,
  ) =>
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: sessionMenuItems({
        hostId,
        sessionId,
        collapsedSessions,
        toggleCollapse,
        dispatch,
      }),
    });
  const openTabMenu = (
    event: React.MouseEvent,
    hostId: string,
    sessionId: string,
    windowId: string,
  ) =>
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: tabMenuItems({ hostId, sessionId, windowId, dispatch }),
    });
  const reorder = (
    hostId: string,
    sessionId: string,
    windowId: string,
    beforeWindowId?: string,
  ) =>
    safely(() =>
      ws.run(hostId, () =>
        window.rex.request("reorderWindow", {
          hostId,
          sessionId,
          windowId,
          beforeWindowId,
        }),
      ),
    );

  const saveHost = createHostSaver(ws.operations, (hostId) =>
    setConnectionRevisions((previous) => ({
      ...previous,
      [hostId]: (previous[hostId] || 0) + 1,
    })),
  );
  const serverAction = createServerActions(activeHost?.id || "local", {
    setDiagnostics,
    setForm,
    setConfirmation,
    setReport,
  });

  if (!settings && loading)
    return (
      <div className="startup-state">
        <Loader2 className="spinning" size={24} />
        <span>Connecting to Rex…</span>
      </div>
    );
  if (!settings)
    return (
      <div className="startup-state">
        <AlertCircle size={25} />
        <h2>Could not open Linusaurus Rex</h2>
        <p>{error}</p>
      </div>
    );
  // macOS chrome puts traffic lights at the window's top-left: in the sidebar
  // when it is shown on the left, otherwise at the start of the toolbar.
  const macChrome = interfaceTheme?.startsWith("macos") ?? false;
  const trafficLightsInSidebar =
    macChrome && !settings.sidebarCollapsed && settings.tabStyle !== "right";
  return (
    <div
      className={`app-shell tabs-${settings.tabStyle} pane-${settings.paneStyle}`}
      data-native-focused={nativeFocused}
      data-fade-target={settings.inactivePaneFadeTarget}
      style={
        {
          "--inactive-window-opacity": String(1 - settings.inactiveWindowFade),
          "--inactive-pane-opacity": String(1 - settings.inactivePaneFade),
        } as React.CSSProperties
      }
    >
      <Sidebar
        hosts={navHosts}
        preferences={{
          sidebarWidth: settings.sidebarWidth,
          tabStyle: settings.tabStyle,
          tabIcons: settings.tabIcons,
          tabIconColors: settings.tabIconColors,
          shellIconTheme: settings.shellIconTheme,
          notifications: {
            includeIdle: settings.notifications.includeIdle,
            showInTabs: settings.notifications.showInTabs,
          },
        }}
        width={sidebarPreviewWidth ?? settings.sidebarWidth}
        onResize={setSidebarPreviewWidth}
        onResizeEnd={(width) =>
          safely(async () => {
            try {
              if (!settings.preserveWindowWidth)
                await window.rex.request("resizeWindow", {
                  deltaWidth: width - settings.sidebarWidth,
                });
              await ws.saveSettings({ ...settings, sidebarWidth: width });
            } finally {
              setSidebarPreviewWidth(undefined);
            }
          })
        }
        activeHostId={selection?.hostId}
        activeSessionId={selection?.sessionId}
        activeWindowId={selection?.windowId}
        collapsed={settings.sidebarCollapsed}
        collapsedSessions={collapsedSessions}
        activityOnly={activityOnly}
        onSelect={ws.select}
        onNewSession={(hostId) => dispatch("session.new", { host_id: hostId })}
        onNewWindow={(hostId, sessionId) =>
          dispatch("client.tab.new", { host_id: hostId, session_id: sessionId })
        }
        onRenameSession={(hostId, sessionId) =>
          dispatch("session.rename", { host_id: hostId, session_id: sessionId })
        }
        onSettings={() => setSettingsTab("appearance")}
        onToggle={() => dispatch("client.sidebar.toggle")}
        onPalette={() => setPalette("all")}
        onSwitcher={() => setPalette("sessions")}
        onAddHost={() => setEditingHost(null)}
        onActivity={() => setActivityOpen((previous) => !previous)}
        onToggleSession={toggleCollapse}
        onContextSession={openSessionMenu}
        onContextWindow={openTabMenu}
        onCloseWindow={(hostId, sessionId, windowId) =>
          dispatch("client.tab.close", {
            host_id: hostId,
            session_id: sessionId,
            window_id: windowId,
          })
        }
        onReorderWindow={reorder}
        onWindowControl={
          trafficLightsInSidebar ? window.rex.windowControl : undefined
        }
        compactFooter={macChrome}
        activityCount={allActivities.length}
      />
      <main className="workspace">
        <h1 className="sr-only">Linusaurus Rex workspace</h1>
        <Toolbar
          title={
            activeWindow
              ? windowTitle(activeWindow, settings.preferGeneratedTitles)
              : "Linusaurus Rex"
          }
          subtitle={
            view
              ? `${activeHost?.label} / ${view.label}`
              : "Your terminals, together"
          }
          connected={activeHost?.connected || false}
          sidebarCollapsed={settings.sidebarCollapsed}
          onToggleSidebar={() => dispatch("client.sidebar.toggle")}
          onSplit={(direction) =>
            dispatch(
              direction === "right" ? "pane.split.right" : "pane.split.down",
            )
          }
          onNewWindow={() => dispatch("client.tab.new")}
          onZoom={() => dispatch("pane.zoom")}
          zoomed={!!activeWindow?.zoomedBlockId}
          canZoom={!macChrome || (activeWindow?.panes.length ?? 0) > 1}
          onCloseWindow={() => dispatch("client.tab.close")}
          onPalette={() => setPalette("all")}
          onSettings={() => setSettingsTab("appearance")}
          onRenameWindow={() => dispatch("client.tab.rename")}
          onWindowControl={window.rex.windowControl}
          windowControlsPlacement={
            !macChrome
              ? "trailing"
              : trafficLightsInSidebar
                ? "none"
                : "leading"
          }
        />
        {settings.tabStyle === "top" && activeWindow && selection && view && (
          <TabStrip
            windows={view.windows.map((window) => ({
              ...enrichWindow(
                selection.hostId,
                selection.sessionId,
                window,
                metadata,
              ),
              label: windowTitle(
                enrichWindow(
                  selection.hostId,
                  selection.sessionId,
                  window,
                  metadata,
                ),
                settings.preferGeneratedTitles,
              ),
            }))}
            activeId={selection.windowId}
            settings={settings}
            onSelect={(id) =>
              ws.select(selection.hostId, selection.sessionId, id)
            }
            onClose={(id) => dispatch("client.tab.close", { window_id: id })}
            onNew={() => dispatch("client.tab.new")}
            onContext={(event, id) =>
              openTabMenu(event, selection.hostId, selection.sessionId, id)
            }
            onReorder={(id, before) =>
              reorder(selection.hostId, selection.sessionId, id, before)
            }
          />
        )}
        {error && (
          <div className="connection-banner" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
            <button
              onClick={() => ws.setError(undefined)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        {updateState &&
          ["available", "ready", "scheduled"].includes(updateState.phase) && (
            <div className="client-update-banner">
              <span>
                Linusaurus Rex {updateState.version}{" "}
                {updateState.phase === "scheduled"
                  ? "will install when idle"
                  : updateState.phase === "ready"
                    ? "is ready to install"
                    : "is available"}
                .
              </span>
              <button onClick={() => setNativeServices("updates")}>
                Review update
              </button>
            </div>
          )}
        <WorkspaceLayout
          workspaceElement={workspaceElement}
          selection={selection}
          views={views}
          hosts={hosts}
          metadata={metadata}
          settings={settings}
          focusedPane={focusedPane}
          modalOpen={modalOpen}
          connectionRevisions={connectionRevisions}
          operations={{
            focusPane: ws.operations.focusPane,
            run: ws.operations.run,
            refresh: ws.operations.refresh,
            reloadSession: ws.reloadSession,
          }}
          execute={(name, args) => executeRef.current(name, args)}
          onError={ws.setError}
        >
          <div className="empty-state">
            <div className="empty-terminal-icon">
              <TerminalSquare size={30} />
            </div>
            <span className="eyebrow">LINUSAURUS REX</span>
            <h1>
              {hosts.some((host) => host.connected)
                ? "Make room for your next idea."
                : "Your workspace is waiting."}
            </h1>
            <p>
              {hosts.some((host) => host.connected)
                ? "Choose a session, or start a fresh workspace. Your programs stay on Rex when this app closes."
                : activeHost?.error ||
                  "Connect to your existing Rex server to bring your terminals together."}
            </p>
            <div className="empty-actions">
              <button
                className="button button-primary"
                onClick={() => dispatch("session.new")}
              >
                <Plus size={15} />
                New session
              </button>
              <button
                className="button"
                onClick={() => safely(() => ws.refresh())}
              >
                <RefreshCw size={14} />
                Reconnect
              </button>
            </div>
            <button className="empty-palette" onClick={() => setPalette("all")}>
              <Command size={13} />
              Find a session or command<kbd>Ctrl Shift P</kbd>
            </button>
          </div>
        </WorkspaceLayout>
        {settings.showKeyHints &&
          ws.keyHints &&
          (ws.keyHints.prefix.length > 0 || ws.keyHints.mode) && (
            <div className="key-sequence-hints">
              <strong>{ws.keyHints.mode || "Key sequence"}</strong>
              <kbd>{ws.keyHints.prefix.join(" → ")}</kbd>
              <span>{ws.keyHints.hints.join(" · ")}</span>
            </div>
          )}
        <footer className="workspace-status">
          <span>
            <i
              className={
                activeHost?.connected ? "status-dot online" : "status-dot"
              }
            />
            {busy
              ? "Updating workspace…"
              : activeHost?.connected
                ? "Connected · streaming"
                : "Disconnected"}
          </span>
          <span className="status-breadcrumb">
            {view?.label || "No session"}
            <ChevronRight size={11} />
            {activeWindow
              ? `${activeWindow.panes.length} ${activeWindow.panes.length === 1 ? "pane" : "panes"}`
              : "Ready when you are"}
          </span>
          <button
            className="status-activity"
            onClick={() => setActivityOpen((previous) => !previous)}
          >
            <Eye size={12} />
            {allActivities.length
              ? `${allActivities.length} active`
              : "Activity"}
          </button>
          <span className="status-version">
            {Math.round(settings.interfaceZoom * 100)}%<kbd>Ctrl Shift P</kbd>
          </span>
        </footer>
      </main>
      {activityOpen && (
        <aside className="activity-panel">
          <div className="activity-panel-heading">
            <h2>Program activity</h2>
            <button
              className="icon-button"
              aria-label="Close activity"
              onClick={() => setActivityOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="activity-controls">
            <select
              aria-label="Group activity"
              className="form-select"
              value={activityGroup}
              onChange={(event) =>
                setActivityGroup(event.target.value as "session")
              }
            >
              <option value="session">By session</option>
              <option value="priority">By priority</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={activityOnly}
                onChange={(event) => setActivityOnly(event.target.checked)}
              />
              Filter sidebar
            </label>
          </div>
          {allActivities.length ? (
            allActivities.map(({ host, session, window, pane, activity }) => (
              <button
                key={`${pane.id}/${activity.id}`}
                className={`activity-entry ${activity.state}`}
                onClick={() => {
                  ws.select(host.id, session.id, window.id, pane.id);
                  setActivityOpen(false);
                }}
              >
                <Bot size={17} />
                <span>
                  <strong>{activity.app || pane.label}</strong>
                  <small>{activityLabel(activity)}</small>
                  <small>
                    {session.label} · {host.label}
                  </small>
                </span>
                <i className={`activity-status ${activity.state}`} />
              </button>
            ))
          ) : (
            <div className="activity-empty">
              Programs that report their status appear here while they work,
              finish or need your attention.
            </div>
          )}
        </aside>
      )}
      <div className={`notice-stack ${settings.notifications.position}`}>
        {ws.notices.map((notice) => (
          <div className={`program-notice ${notice.kind}`} key={notice.id}>
            <button
              className="notice-content"
              onClick={() => {
                if (notice.sessionId)
                  ws.select(
                    notice.hostId,
                    notice.sessionId,
                    notice.windowId,
                    notice.blockId,
                  );
                ws.setNotices((previous) =>
                  previous.filter((item) => item.id !== notice.id),
                );
              }}
            >
              <strong>{notice.title}</strong>
              <span>{notice.body}</span>
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() =>
                ws.setNotices((previous) =>
                  previous.filter((item) => item.id !== notice.id),
                )
              }
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {palette && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPalette(undefined)}
        />
      )}
      {settingsTab && (
        <SettingsDialog
          settings={settings}
          initialTab={settingsTab}
          onSave={async (next) => {
            const saved = await ws.saveSettings(next);
            await ws.refresh();
            return saved;
          }}
          onClose={() => setSettingsTab(undefined)}
          onAddHost={() => {
            setSettingsTab(undefined);
            setEditingHost(null);
          }}
          onEditHost={(host) => {
            setSettingsTab(undefined);
            setEditingHost(host);
          }}
          onNativeServices={() => {
            setSettingsTab(undefined);
            setNativeServices("server");
          }}
          onConfig={() => {
            setSettingsTab(undefined);
            setConfiguration(true);
          }}
          onDiagnostics={() => {
            setSettingsTab(undefined);
            setDiagnostics(true);
          }}
        />
      )}
      {editingHost !== undefined && (
        <HostDialog
          host={editingHost || undefined}
          onClose={() => setEditingHost(undefined)}
          onSave={saveHost}
        />
      )}
      {configuration && (
        <ConfigurationDialog
          hostId={activeHost?.id || "local"}
          onClose={() => setConfiguration(false)}
          onReload={() => safely(() => ws.refresh())}
        />
      )}
      {diagnostics && (
        <DiagnosticsDialog
          hostId={activeHost?.id}
          endpoint={activeHost?.endpoint}
          onClose={() => setDiagnostics(false)}
          onServerAction={serverAction}
        />
      )}
      {pairing && (
        <PairDeviceDialog
          hostId={activeHost?.id || "local"}
          endpoint={activeHost?.status?.endpoint || activeHost?.endpoint}
          onClose={() => setPairing(false)}
          onManage={() => {
            setPairing(false);
            setDiagnostics(true);
          }}
        />
      )}
      {directoryBrowser && (
        <DirectoryDialog
          terminalRef={directoryBrowser.ref}
          endpoint={
            settings.hosts.find(
              (host) => host.id === directoryBrowser.ref.hostId,
            )?.endpoint
          }
          mode={directoryBrowser.mode}
          recent={
            settings.showRecentPaths
              ? settings.recentPaths[directoryBrowser.ref.hostId] || []
              : []
          }
          onClose={() => setDirectoryBrowser(undefined)}
          onPick={(path) =>
            pickDirectoryPath(ws.operations, directoryBrowser, path)
          }
        />
      )}
      {form && (
        <FormDialog
          form={form}
          busy={busy}
          onRefresh={ws.refresh}
          onClose={() => setForm((current) => current === form ? undefined : current)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          confirmation={confirmation}
          onRefresh={ws.refresh}
          onClose={() => setConfirmation((current) => current === confirmation ? undefined : current)}
        />
      )}
      {report && (
        <Dialog title={report.title} onClose={() => setReport(undefined)} wide>
          <pre className="diagnostic-output">{report.body}</pre>
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() =>
                safely(() => window.rex.writeClipboard(report.body))
              }
            >
              Copy
            </button>
            <button
              className="button button-primary"
              onClick={() => setReport(undefined)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
      {nativeServices && (
        <NativeServicesDialog
          settings={settings}
          hostId={activeHost?.id || "local"}
          initialTab={nativeServices}
          onSave={ws.saveSettings}
          onClose={() => setNativeServices(undefined)}
        />
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
