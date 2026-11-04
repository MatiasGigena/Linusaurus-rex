import { useWorkspaceDialogs } from "./hooks/useWorkspaceDialogs";
import { WorkspaceDialogHost } from "./components/workspace/WorkspaceDialogHost";
import { reorderWorkspaceTab } from "./workspace/actions/tabActions";
import { persistSidebarWidth } from "./workspace/actions/clientActions";
import { ActivityPanel } from "./components/ActivityPanel";
import { NoticeStack } from "./components/NoticeStack";
import { buildPaletteCommands } from "./workspace/palette";
import { useWorkspaceMenus } from "./hooks/useWorkspaceMenus";
import { useNativeWindowFocus } from "./hooks/useNativeWindowFocus";
import { useClientUpdateBanner } from "./hooks/useClientUpdateBanner";
import { useWorkspaceGestures } from "./hooks/useWorkspaceGestures";
import { configuredShortcutEntries } from "./shared/actions";
import { createHostSaver } from "./workspace/actions/hostActions";
import {
  buildNavigationHosts,
  buildActivityFeed,
  enrichWindow,
} from "./workspace/presentation";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { WorkspaceEmptyState } from "./components/workspace/WorkspaceEmptyState";
import { useInterfaceAppearance } from "./hooks/useInterfaceAppearance";
import { createWorkspaceActions } from "./workspace/actions/createWorkspaceActions";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Eye, Loader2 } from "lucide-react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Toolbar } from "./components/workspace/Toolbar";
import { ContextMenu } from "./components/ContextMenu";
import { TabStrip } from "./components/workspace/TabStrip";
import "./linux.css";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  errorMessage,
  matchesShortcut,
  windowTitle,
  viewKey,
} from "./core/workspace";
import { type ClientEvent } from "./shared/types";

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
  const {
    controller: dialogs,
    state: dialogState,
    modalOpen,
  } = useWorkspaceDialogs();
  const palette =
    dialogState.primary?.dialog.kind === "palette"
      ? dialogState.primary.dialog.scope
      : undefined;
  const [connectionRevisions, setConnectionRevisions] = useState<
    Partial<Record<string, number>>
  >({});
  const [activityOpen, setActivityOpen] = useState(false);
  const interfaceTheme = useInterfaceAppearance(settings);
  const [activityOnly, setActivityOnly] = useState(false);
  const [activityGroup, setActivityGroup] = useState<"session" | "priority">(
    "session",
  );
  const [collapsedSessions, setCollapsedSessions] = useState(new Set<string>());
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number>();
  const workspaceElement = useRef<HTMLDivElement>(null);
  const executeRef = useRef<
    (
      name: string,
      args?: Record<string, unknown>,
      event?: ClientEvent,
    ) => Promise<unknown>
  >(async () => {});
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
  const { menu, closeMenu, openSessionMenu, openTabMenu } = useWorkspaceMenus({
    getHosts: () => ws.settingsRef.current?.hosts,
    collapsedSessions,
    toggleCollapse,
    dispatch,
  });
  const nativeFocused = useNativeWindowFocus({
    getSelection: ws.getSelection,
    getHosts: () => ws.settingsRef.current?.hosts,
    onError: ws.setError,
  });
  useWorkspaceGestures(workspaceElement, settings, activeWindow, dispatch);
  useEffect(() => {
    ws.publishUiBusy(modalOpen || !!menu);
  }, [modalOpen, menu, ws.publishUiBusy]);
  const updateBanner = useClientUpdateBanner(() =>
    dialogs.open({
      kind: "services",
      hostId: activeHost?.id || "local",
      tab: "updates",
    }),
  );
  const execute = createWorkspaceActions({
    executeCurrent: (name, args, event) =>
      executeRef.current(name, args, event),
    dialogs,
    workspace: ws.operations,
    settings,
    hosts,
    views,
    selection,
    focusedPane,
    keymaps,
    interfaceTheme,
    workspaceElement,
    setCollapsedSessions,
    setActivityOnly,
    setActivityOpen,
    setActivityGroup,
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
    dialogs,
    palette,
    settings,
    keymaps,
    activeHostId: activeHost?.id,
    navHosts,
    dispatch,
    execute,
    select: ws.operations.select,
  });
  const reorder = (
    hostId: string,
    sessionId: string,
    windowId: string,
    beforeWindowId?: string,
  ) =>
    safely(() =>
      reorderWorkspaceTab(ws.operations, {
        hostId,
        sessionId,
        windowId,
        beforeWindowId,
      }),
    );

  const saveHost = createHostSaver(ws.operations, (hostId) =>
    setConnectionRevisions((previous) => ({
      ...previous,
      [hostId]: (previous[hostId] || 0) + 1,
    })),
  );

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
              await persistSidebarWidth(ws.operations, settings, width);
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
        onSettings={() => dialogs.open({ kind: "settings", tab: "appearance" })}
        onToggle={() => dispatch("client.sidebar.toggle")}
        onPalette={() => dialogs.open({ kind: "palette", scope: "all" })}
        onSwitcher={() => dialogs.open({ kind: "palette", scope: "sessions" })}
        onAddHost={() => dialogs.open({ kind: "host", host: null })}
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
          onPalette={() => dialogs.open({ kind: "palette", scope: "all" })}
          onSettings={() =>
            dialogs.open({ kind: "settings", tab: "appearance" })
          }
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
        {updateBanner}
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
            mutateHostAndRefresh: ws.operations.mutateHostAndRefresh,
            refresh: ws.operations.refresh,
            reloadSession: ws.reloadSession,
          }}
          execute={(name, args) => executeRef.current(name, args)}
          onError={ws.setError}
        >
          <WorkspaceEmptyState
            connected={hosts.some((host) => host.connected)}
            error={activeHost?.error}
            onNewSession={() => dispatch("session.new")}
            onReconnect={() => safely(() => ws.refresh())}
            onPalette={() => dialogs.open({ kind: "palette", scope: "all" })}
          />
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
        <ActivityPanel
          items={allActivities}
          group={activityGroup}
          filterSidebar={activityOnly}
          onGroupChange={setActivityGroup}
          onFilterChange={setActivityOnly}
          onSelect={ws.select}
          onClose={() => setActivityOpen(false)}
        />
      )}
      <NoticeStack
        notices={ws.notices}
        position={settings.notifications.position}
        onSelect={ws.select}
        onDismiss={(id) =>
          ws.setNotices((previous) =>
            previous.filter((notice) => notice.id !== id),
          )
        }
      />
      <WorkspaceDialogHost
        state={dialogState}
        dialogs={dialogs}
        settings={settings}
        hosts={hosts}
        activeHostId={activeHost?.id || "local"}
        operations={ws.operations}
        busy={busy}
        commands={paletteCommands}
        saveHost={saveHost}
        onError={ws.setError}
      />
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
