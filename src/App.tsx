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
import { Sidebar, type NavigationHost } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { Dialog } from "./components/Dialog";
import {
  CommandPalette,
  type PaletteCommand,
} from "./components/CommandPalette";
import { ContextMenu, type ContextItem } from "./components/ContextMenu";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { HostDialog, type Credentials } from "./components/HostDialog";
import { ConfigurationDialog } from "./components/ConfigurationDialog";
import { DiagnosticsDialog } from "./components/DiagnosticsDialog";
import { PairDeviceDialog } from "./components/PairDeviceDialog";
import { DirectoryDialog } from "./components/DirectoryDialog";
import { TabStrip } from "./components/TabStrip";
import {
  TerminalPane,
  dispatchTerminalCommandAsync,
  type TerminalPaneProps,
} from "./terminal/TerminalPane";
import { BlockInspector } from "./terminal/BlockInspector";
import { NativeServicesDialog } from "./components/NativeServicesDialog";
import { OnboardingPane } from "./components/OnboardingPane";
import { ActivePaneHighlight } from "./components/ActivePaneHighlight";
import { terminalTheme } from "./terminal/themes";
import {
  migrateThemeLibrary,
  saveLibraryTheme,
  uniqueThemeName,
} from "./core/themeLibrary";
import type { UpdateState } from "./shared/types";
import "./linux.css";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  activityLabel,
  adjacentPane,
  errorMessage,
  matchesShortcut,
  paneKey,
  primaryActivity,
  viewKey,
  windowTitle,
} from "./core/workspace";
import { CLIENT_ACTIONS } from "./shared/actions";
import {
  DEFAULT_SETTINGS,
  type ClientEvent,
  type Host,
  type PaneDivider,
  type RexPane,
  type RexWindow,
  type Selection,
  type Settings,
} from "./shared/types";

type Field = {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
};
type Form = {
  title: string;
  description: string;
  fields: Field[];
  submit(values: Record<string, string>): Promise<void>;
};
type Confirmation = {
  title: string;
  description: string;
  label?: string;
  submit(): Promise<void>;
};
type Menu = { x: number; y: number; items: (ContextItem | null)[] };
const aliases: Record<string, string> = {
  "new-session": "session.new",
  "session-switcher": "session.switch",
  "new-window": "client.tab.new",
  "close-window": "client.tab.close",
  "close-pane": "pane.close",
  "toggle-sidebar": "client.sidebar.toggle",
  "command-palette": "client.palette.toggle",
  settings: "client.settings",
  "split-right": "pane.split.right",
  "split-below": "pane.split.down",
  zoom: "pane.zoom",
  find: "client.find.open",
  "font-increase": "client.font.increase",
  "font-decrease": "client.font.decrease",
  "font-reset": "client.font.reset",
  "next-tab": "client.tab.next",
  "previous-tab": "client.tab.previous",
  "focus-left": "pane.focus.left",
  "focus-right": "pane.focus.right",
  "focus-up": "pane.focus.up",
  "focus-down": "pane.focus.down",
};
const nativeActions = new Set([
  "client.window.new",
  "client.window.close",
  "client.window.fullscreen.toggle",
  "client.visibility.toggle",
  "client.version.copy",
  "client.debug.copy",
]);

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
  const [activityOnly, setActivityOnly] = useState(false);
  const [activityGroup, setActivityGroup] = useState<"session" | "priority">(
    "session",
  );
  const [collapsedSessions, setCollapsedSessions] = useState(new Set<string>());
  const [nativeFocused, setNativeFocused] = useState(document.hasFocus());
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number>();
  const gesture = useRef({ at: 0, handled: false, x: 0, y: 0 });
  const [visited, setVisited] = useState<Selection[]>([]);
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
  const enrich = (
    hostId: string,
    sessionId: string,
    window: RexWindow,
  ): RexWindow => ({
    ...window,
    panes: window.panes.map((pane) => ({
      ...pane,
      ...metadata[paneKey(hostId, sessionId, pane.id)],
    })),
  });
  const view =
    selection && views[viewKey(selection.hostId, selection.sessionId)];
  const rawWindow = view?.windows.find(
    (window) => window.id === selection?.windowId,
  );
  const activeWindow =
    rawWindow && selection
      ? enrich(selection.hostId, selection.sessionId, rawWindow)
      : undefined;
  const activePane =
    activeWindow?.panes.find((pane) => pane.id === focusedPane) ||
    activeWindow?.panes.find(
      (pane) => pane.id === activeWindow.focusedBlockId,
    ) ||
    activeWindow?.panes[0];
  const ref =
    selection && activePane
      ? {
          hostId: selection.hostId,
          sessionId: selection.sessionId,
          blockId: activePane.id,
        }
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
  const requestClose = (
    title: string,
    description: string,
    action: () => Promise<unknown>,
  ) => {
    if (settings?.confirmClose)
      setConfirmation({
        title,
        description,
        submit: async () => {
          await ws.run(action);
        },
      });
    else safely(() => ws.run(action));
  };

  useEffect(() => {
    if (selection && activeWindow)
      setVisited((previous) =>
        [
          ...previous.filter(
            (item) =>
              !(
                item.hostId === selection.hostId &&
                item.sessionId === selection.sessionId &&
                item.windowId === selection.windowId
              ),
          ),
          selection,
        ].slice(-12),
      );
  }, [
    selection?.hostId,
    selection?.sessionId,
    selection?.windowId,
    !!activeWindow,
  ]);
  useEffect(() => {
    if (!settings) return;
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const theme =
        settings.theme === "system"
          ? settings.appearance === "light" ||
            (settings.appearance === "system" && media.matches)
            ? settings.lightTheme
            : settings.darkTheme
          : settings.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.animation = settings.animation;
      document.documentElement.style.setProperty(
        "--active-pane-color",
        settings.highlightColor,
      );
      document.documentElement.style.setProperty(
        "--active-pane-opacity",
        String(settings.highlightActivePane ? settings.highlightOpacity : 0),
      );
      const light =
        settings.appearance === "light" ||
        (settings.appearance === "system" && media.matches);
      const resolved = terminalTheme(settings);
      const root = document.documentElement;
      root.dataset.tintInterface = String(settings.tintInterface);
      for (const [key, value] of Object.entries({
        "--terminal-background": resolved.background,
        "--shell-background": resolved.background,
        "--shell-foreground": resolved.foreground,
        "--resolved-background": resolved.background,
        "--resolved-foreground": resolved.foreground,
        "--theme-accent": resolved.green,
      }))
        if (value) root.style.setProperty(key, value);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [
    settings?.theme,
    settings?.appearance,
    settings?.lightTheme,
    settings?.darkTheme,
    settings?.animation,
    settings?.highlightColor,
    settings?.highlightOpacity,
    settings?.highlightActivePane,
    settings?.customTheme,
    settings?.customLightTheme,
    settings?.customDarkTheme,
    settings?.themeLibrary,
    settings?.lightThemeId,
    settings?.darkThemeId,
    settings?.tintInterface,
  ]);

  useEffect(() => {
    if (selection?.windowId)
      void window.rex
        .request("focusWindow", selection)
        .catch((failure) => ws.setError(errorMessage(failure)));
  }, [selection?.hostId, selection?.sessionId, selection?.windowId]);
  useEffect(() => {
    const element = workspaceElement.current;
    if (!element || !settings) return;
    const wheel = (event: WheelEvent) => {
      const pinch =
        settings.trackpadGestures && event.ctrlKey && !!activeWindow;
      const swipe =
        settings.sidebarGesture !== "off" &&
        Math.abs(event.deltaX) > Math.abs(event.deltaY) &&
        (settings.sidebarGesture === "swipe" || event.altKey);
      if (!pinch && !swipe) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const now = performance.now();
      if (now - gesture.current.at > 300)
        gesture.current = { at: now, handled: false, x: 0, y: 0 };
      const state = gesture.current;
      state.at = now;
      state.x += event.deltaX;
      state.y += event.deltaY;
      if (state.handled) return;
      if (pinch && Math.abs(state.y) > 15) {
        state.handled = true;
        const wantsZoom = state.y < 0;
        if (wantsZoom !== !!activeWindow?.zoomedBlockId) dispatch("pane.zoom");
      } else if (swipe && Math.abs(state.x) > 90) {
        state.handled = true;
        const wantsCollapsed =
          settings.tabStyle === "right" ? state.x < 0 : state.x > 0;
        if (wantsCollapsed !== settings.sidebarCollapsed)
          dispatch("client.sidebar.toggle");
      }
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => element.removeEventListener("wheel", wheel, { capture: true });
  }, [settings, activeWindow?.id, activeWindow?.zoomedBlockId]);
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
  const focusPane = async (pane: RexPane, where = selection) => {
    if (!where) return;
    ws.setFocusedPane(pane.id);
    await ws.run(() =>
      window.rex.request("focus", {
        hostId: where.hostId,
        sessionId: where.sessionId,
        blockId: pane.id,
      }),
    );
  };
  const inspectAfter = async (
    hostId: string,
    sessionId: string,
    selectActive = false,
  ) => {
    const next = await ws.reloadSession(hostId, sessionId);
    if (selectActive) ws.select(hostId, sessionId, next.activeWindowId);
    return next;
  };

  const execute = async (
    inputName: string,
    args: Record<string, unknown> = {},
    event?: ClientEvent,
  ): Promise<unknown> => {
    if (!settings) return;
    const name = aliases[inputName] || inputName;
    const hostId = String(
      args.host_id ||
        (event && "hostId" in event ? event.hostId : undefined) ||
        selection?.hostId ||
        activeHost?.id ||
        "local",
    );
    const sessionId = String(
      args.session_id ||
        (event && "sessionId" in event ? event.sessionId : undefined) ||
        selection?.sessionId ||
        "",
    );
    const currentView = views[viewKey(hostId, sessionId)];
    const requestedBlock =
      args.block_id ||
      (event && "blockId" in event ? event.blockId : undefined);
    const currentWindow =
      (requestedBlock
        ? currentView?.windows.find((window) =>
            window.panes.some((pane) => pane.id === requestedBlock),
          )
        : undefined) ||
      currentView?.windows.find(
        (window) => window.id === String(args.window_id || selection?.windowId),
      ) ||
      currentView?.windows.find(
        (window) => window.id === currentView.activeWindowId,
      ) ||
      currentView?.windows[0];
    const displayedContext =
      selection?.hostId === hostId &&
      selection.sessionId === sessionId &&
      selection.windowId === currentWindow?.id;
    const blockId = String(
      args.block_id ||
        (event && "blockId" in event ? event.blockId : undefined) ||
        (displayedContext ? activePane?.id : undefined) ||
        currentWindow?.focusedBlockId ||
        currentWindow?.panes[0]?.id ||
        "",
    );
    const terminalRef = { hostId, sessionId, blockId };
    const targetPane = currentWindow?.panes.find((pane) => pane.id === blockId);
    const localCommand = async (command: string) => {
      requirePane();
      if (!currentWindow)
        throw new Error("The target pane is no longer available.");
      if (!displayedContext || focusedPane !== blockId) {
        ws.select(hostId, sessionId, currentWindow.id, blockId);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      await dispatchTerminalCommandAsync(command, terminalRef);
    };
    const requirePane = () => {
      if (!sessionId || !blockId)
        throw new Error("Select a terminal pane first.");
    };
    if (nativeActions.has(name))
      return window.rex.request("invokeAction", {
        ...terminalRef,
        action: name,
        args,
      });
    if (
      [
        "copy",
        "paste",
        "select-all",
        "scroll-top",
        "scroll-bottom",
        "clear-content",
        "clear-scrollback",
        "find-next",
        "find-previous",
        "prompt-previous",
        "prompt-next",
      ].includes(name)
    ) {
      return localCommand(name);
    }
    switch (name) {
      case "client.palette.toggle":
        setPalette((previous) => (previous ? undefined : "all"));
        return;
      case "session.switch":
        setPalette("sessions");
        return;
      case "client.settings":
        setSettingsTab(
          [
            "appearance",
            "terminal",
            "notifications",
            "hosts",
            "integrations",
            "shortcuts",
            "server",
          ].includes(String(args.tab))
            ? (args.tab as SettingsTab)
            : "appearance",
        );
        return;
      case "client.shortcuts.edit":
        setSettingsTab("shortcuts");
        return;
      case "client.agents.setup":
        setSettingsTab("integrations");
        return;
      case "client.diagnostics":
        setDiagnostics(true);
        return;
      case "client.pair_device":
        setPairing(true);
        return;
      case "client.onboarding": {
        const tutorial = await ws.run(() =>
          window.rex.request("createTutorial", { hostId }),
        );
        await inspectAfter(hostId, tutorial.sessionId);
        ws.select(
          hostId,
          tutorial.sessionId,
          tutorial.windowId,
          tutorial.blockId,
        );
        return tutorial;
      }
      case "client.update.accept":
        return window.rex.request("applyUpdate", {});
      case "client.update.accept_when_idle":
        return window.rex.request("applyUpdate", { whenIdle: true });
      case "client.server.restart":
        return ws.run(() =>
          window.rex.request("serverLifecycle", {
            hostId,
            operation: "restart",
          }),
        );
      case "client.notice.dismiss":
        ws.setNotices([]);
        return;
      case "client.host.add":
        setEditingHost(null);
        return;
      case "client.host.remove": {
        const host = settings.hosts.find((host) => host.id === hostId);
        if (!host || host.id === "local")
          throw new Error(
            "The local host is retained. Edit its endpoint in Settings.",
          );
        setConfirmation({
          title: `Forget ${host.label}?`,
          description:
            "The saved connection and its stored credentials will be removed. Server sessions keep running.",
          label: "Forget host",
          submit: async () => {
            await window.rex.request("removeCredentials", { hostId });
            await ws.saveSettings({
              ...settings,
              hosts: settings.hosts.filter((item) => item.id !== hostId),
            });
            await ws.refresh();
          },
        });
        return;
      }
      case "client.host.switch": {
        const next = settings.hosts.find(
          (host) =>
            host.id === String(args.host_id || args.host || "") ||
            host.label === String(args.host || ""),
        );
        if (next) {
          const first = hosts.find((host) => host.id === next.id)?.sessions[0];
          if (first) ws.select(next.id, first.id);
          else setEditingHost(next);
        } else setPalette("sessions");
        return;
      }
      case "session.new": {
        const create = async (label: string, cwd?: string) => {
          await ws.run(async () => {
            const created = await window.rex.request("createSession", {
              hostId,
              label,
              cwd: cwd || undefined,
            });
            await inspectAfter(hostId, created.sessionId, true);
          });
        };
        if (args.label || args.name)
          return create(
            String(args.label || args.name),
            args.cwd ? String(args.cwd) : undefined,
          );
        setForm({
          title: "New session",
          description: "Create a persistent workspace on this Rex server.",
          fields: [
            { name: "label", label: "Session name", required: true },
            {
              name: "cwd",
              label: "Working directory",
              placeholder: "Default home directory",
            },
          ],
          submit: (values) => create(values.label, values.cwd),
        });
        return;
      }
      case "session.select": {
        const target = String(
          args.session_id || args.session || args.label || "",
        );
        const matches = hosts.flatMap((host) =>
          host.sessions
            .filter(
              (session) => session.id === target || session.label === target,
            )
            .map((session) => ({ host, session })),
        );
        if (matches.length === 1) {
          ws.select(
            matches[0].host.id,
            matches[0].session.id,
            args.window_id ? String(args.window_id) : undefined,
            args.block_id ? String(args.block_id) : undefined,
          );
          return;
        }
        if (!target) {
          setPalette("sessions");
          return;
        }
        throw new Error(
          matches.length
            ? "Session name is ambiguous. Use its full ID."
            : "Session was not found.",
        );
      }
      case "session.next":
      case "session.previous": {
        const all = hosts.flatMap((host) =>
          host.sessions.map((session) => ({
            hostId: host.id,
            sessionId: session.id,
          })),
        );
        const index = all.findIndex(
          (item) => item.hostId === hostId && item.sessionId === sessionId,
        );
        const next =
          all[
            (index + (name === "session.next" ? 1 : -1) + all.length) %
              all.length
          ];
        if (next) ws.select(next.hostId, next.sessionId);
        return;
      }
      case "session.rename": {
        if (!sessionId) throw new Error("Choose a session first.");
        const rename = async (label: string) => {
          await ws.run(() =>
            window.rex.request("renameSession", { hostId, sessionId, label }),
          );
        };
        if (args.label) return rename(String(args.label));
        setForm({
          title: "Rename session",
          description: "This name is shared with your other Rex clients.",
          fields: [
            {
              name: "label",
              label: "Session name",
              value: currentView?.label,
              required: true,
            },
          ],
          submit: (values) => rename(values.label),
        });
        return;
      }
      case "session.close":
        if (!sessionId) return;
        requestClose(
          "Close this session?",
          "All tabs, panes and running programs in this session will close on the server.",
          () => window.rex.request("destroySession", { hostId, sessionId }),
        );
        return;
      case "session.refresh":
        return ws.refresh();
      case "session.collapse":
        setCollapsedSessions((previous) => new Set(previous).add(sessionId));
        return;
      case "session.expand":
        setCollapsedSessions((previous) => {
          const next = new Set(previous);
          next.delete(sessionId);
          return next;
        });
        return;
      case "session.collapse_others":
        setCollapsedSessions(
          new Set(
            hosts.flatMap((host) =>
              host.sessions
                .filter((session) => session.id !== sessionId)
                .map((session) => session.id),
            ),
          ),
        );
        return;
      case "session.open_on_web": {
        const endpoint = (
          hosts.find((host) => host.id === hostId)?.status?.endpoint || ""
        )
          .replace(/^wss:/, "https:")
          .replace(/^ws:/, "http:");
        if (!/^https?:\/\//.test(endpoint))
          throw new Error(
            "This host has no web address. Configure remote serving first.",
          );
        return window.rex.request("openExternal", {
          url: new URL(`/?session=${encodeURIComponent(sessionId)}`, endpoint)
            .href,
        });
      }
      case "client.tab.new": {
        if (!sessionId) return execute("session.new", { host_id: hostId });
        await ws.run(() =>
          window.rex.request("newWindow", {
            hostId,
            sessionId,
            label: args.label ? String(args.label) : undefined,
          }),
        );
        return inspectAfter(hostId, sessionId, true);
      }
      case "client.tab.close":
        if (!currentWindow) return;
        requestClose(
          "Close this tab?",
          `“${currentWindow.label}” and all of its running programs will close on the server.`,
          () =>
            window.rex.request("closeWindow", {
              hostId,
              sessionId,
              windowId: currentWindow.id,
            }),
        );
        return;
      case "client.tab.rename": {
        if (!currentWindow) return;
        const rename = async (label: string) => {
          await ws.run(() =>
            window.rex.request("renameWindow", {
              hostId,
              sessionId,
              windowId: currentWindow.id,
              label,
            }),
          );
        };
        if (args.label) return rename(String(args.label));
        setForm({
          title: "Rename tab",
          description: "Give this terminal tab a recognizable name.",
          fields: [
            {
              name: "label",
              label: "Tab name",
              value: currentWindow.label,
              required: true,
            },
          ],
          submit: (values) => rename(values.label),
        });
        return;
      }
      case "client.tab.next":
      case "client.tab.previous": {
        const windows = currentView?.windows || [];
        const index = windows.findIndex(
          (window) => window.id === currentWindow?.id,
        );
        const next =
          windows[
            (index + (name.endsWith("next") ? 1 : -1) + windows.length) %
              windows.length
          ];
        if (next) ws.select(hostId, sessionId, next.id);
        return;
      }
      case "client.tab.goto": {
        if (args.index === undefined) {
          setForm({
            title: "Go to tab",
            description: "Tabs are numbered from 1. Use -1 for the last tab.",
            fields: [{ name: "index", label: "Tab number", required: true }],
            submit: async (values) => {
              await execute(
                "client.tab.goto",
                { ...args, index: Number(values.index) },
                event,
              );
            },
          });
          return;
        }
        const index = Number(args.index);
        if (!Number.isInteger(index) || index === 0)
          throw new Error("Tab index must be a nonzero integer.");
        const windows = currentView?.windows || [];
        const target = windows[index > 0 ? index - 1 : windows.length + index];
        if (!target) throw new Error("There is no tab at that index.");
        ws.select(hostId, sessionId, target.id);
        return;
      }
      case "client.tab.move":
      case "client.tab.move.backward":
      case "client.tab.move.forward": {
        if (!currentView || !currentWindow) return;
        if (name === "client.tab.move" && args.index === undefined) {
          setForm({
            title: "Move tab",
            description: "Choose the tab’s new position in this session.",
            fields: [{ name: "index", label: "Tab position", required: true }],
            submit: async (values) => {
              await execute(
                name,
                { ...args, index: Number(values.index) },
                event,
              );
            },
          });
          return;
        }
        const windows = currentView.windows;
        const index = windows.findIndex(
          (window) => window.id === currentWindow.id,
        );
        const target = name.endsWith("backward")
          ? index - 1
          : name.endsWith("forward")
            ? index + 1
            : Number(args.index) - 1;
        if (!Number.isInteger(target) || target < 0 || target >= windows.length)
          return;
        const beforeWindowId =
          target < index ? windows[target].id : windows[target + 1]?.id;
        return ws.run(() =>
          window.rex.request("reorderWindow", {
            hostId,
            sessionId,
            windowId: currentWindow.id,
            beforeWindowId,
          }),
        );
      }
      case "client.tab.move_to_new_window": {
        if (!currentWindow) return;
        await window.rex.request("invokeAction", {
          ...terminalRef,
          action: "client.window.new",
          args: { session_id: sessionId, window_id: currentWindow.id },
        });
        const next = currentView?.windows.find(
          (window) => window.id !== currentWindow.id,
        );
        ws.select(hostId, next ? sessionId : "", next?.id || "");
        return;
      }
      case "client.close":
        if (!currentWindow) {
          window.rex.windowControl("close");
          return;
        }
        if ((currentWindow.panes.length || 0) > 1)
          return execute("pane.close", args, event);
        return execute("client.tab.close", args, event);
      case "pane.close":
        requirePane();
        requestClose(
          "Close this pane?",
          "This terminal and its running program will close on the Rex server.",
          async () => {
            await window.rex.request("closePane", terminalRef);
            if (settings.autobalanceSplits && currentWindow?.panes[0])
              await window.rex
                .request("layoutAction", {
                  ...terminalRef,
                  blockId:
                    currentWindow.panes.find((pane) => pane.id !== blockId)
                      ?.id || blockId,
                  operation: "balance",
                })
                .catch(() => {});
          },
        );
        return;
      case "pane.zoom":
        requirePane();
        return ws.run(() => window.rex.request("zoom", terminalRef));
      case "pane.copy_id":
        requirePane();
        return window.rex.writeClipboard(blockId);
      case "pane.split":
      case "pane.split.left":
      case "pane.split.right":
      case "pane.split.up":
      case "pane.split.down":
      case "pane.split.auto": {
        requirePane();
        const auto =
          targetPane &&
          targetPane.rect[2] * (workspaceElement.current?.clientWidth || 1) >
            targetPane.rect[3] *
              (workspaceElement.current?.clientHeight || 1) *
              1.4
            ? "right"
            : "below";
        const directions: Record<string, "left" | "right" | "above" | "below"> =
          {
            left: "left",
            right: "right",
            up: "above",
            down: "below",
            above: "above",
            below: "below",
            auto,
          };
        const direction =
          directions[String(args.direction || name.split(".").at(-1))] ||
          "right";
        await ws.run(async () => {
          await window.rex.request("split", {
            ...terminalRef,
            direction,
            ratio: typeof args.ratio === "number" ? args.ratio : undefined,
          });
          if (settings.autobalanceSplits)
            await window.rex.request("layoutAction", {
              ...terminalRef,
              operation: "balance",
            });
        });
        return inspectAfter(hostId, sessionId);
      }
      case "pane.focus":
      case "pane.focus.left":
      case "pane.focus.right":
      case "pane.focus.up":
      case "pane.focus.down":
      case "pane.focus_next":
      case "pane.focus_previous": {
        if (!currentWindow) return;
        if (name === "pane.focus" && !args.block_id && !args.direction) {
          setForm({
            title: "Focus pane",
            description: "Choose the pane by its block ID.",
            fields: [{ name: "block", label: "Pane ID", required: true }],
            submit: async (values) => {
              await execute(
                "pane.focus",
                { ...args, block_id: values.block },
                event,
              );
            },
          });
          return;
        }
        let target: RexPane | undefined;
        if (name === "pane.focus" && args.block_id)
          target = currentWindow.panes.find(
            (pane) => pane.id === String(args.block_id),
          );
        else if (name === "pane.focus_next" || name === "pane.focus_previous") {
          const index = currentWindow.panes.findIndex(
            (pane) => pane.id === blockId,
          );
          target =
            currentWindow.panes[
              (index +
                (name.endsWith("next") ? 1 : -1) +
                currentWindow.panes.length) %
                currentWindow.panes.length
            ];
        } else
          target = adjacentPane(
            currentWindow.panes,
            blockId,
            String(args.direction || name.split(".").at(-1)) as "left",
          );
        if (target)
          return focusPane(target, {
            hostId,
            sessionId,
            windowId: currentWindow.id,
          });
        return;
      }
      case "pane.move":
      case "pane.move.left":
      case "pane.move.right":
      case "pane.move.up":
      case "pane.move.down": {
        requirePane();
        if (!currentWindow) return;
        const direction = String(args.direction || name.split(".").at(-1));
        const target = args.anchor_id
          ? currentWindow.panes.find(
              (pane) => pane.id === String(args.anchor_id),
            )
          : ["left", "right", "up", "down"].includes(direction)
            ? adjacentPane(currentWindow.panes, blockId, direction as "left")
            : undefined;
        if (!target) {
          setForm({
            title: "Move pane",
            description: "Choose the destination pane and a direction.",
            fields: [
              { name: "anchor", label: "Destination pane ID", required: true },
              {
                name: "direction",
                label: "Direction",
                value: "right",
                required: true,
              },
            ],
            submit: async (values) => {
              if (
                !["left", "right", "above", "below"].includes(values.direction)
              )
                throw new Error("Use left, right, above or below.");
              await ws.run(() =>
                window.rex.request("movePane", {
                  ...terminalRef,
                  anchorBlockId: values.anchor,
                  direction: values.direction as "right",
                }),
              );
            },
          });
          return;
        }
        return ws.run(() =>
          window.rex.request("movePane", {
            ...terminalRef,
            anchorBlockId: target.id,
            direction:
              (({ up: "above", down: "below" } as Record<string, string>)[
                direction
              ] as "above") || (direction as "right"),
          }),
        );
      }
      case "pane.swap":
        requirePane();
        return ws.run(() =>
          window.rex.request("swapPanes", {
            ...terminalRef,
            otherBlockId: String(args.other_block_id),
          }),
        );
      case "pane.balance":
        requirePane();
        return ws.run(() =>
          window.rex.request("layoutAction", {
            ...terminalRef,
            operation: "balance",
          }),
        );
      case "pane.float":
      case "pane.minimize_floating":
      case "pane.restore_floating":
      case "pane.move_to_new_tab":
      case "pane.move_to_tab": {
        requirePane();
        const operations: Record<
          string,
          "float" | "minimize" | "restore" | "moveToNewTab" | "moveToTab"
        > = {
          "pane.float": "float",
          "pane.minimize_floating": "minimize",
          "pane.restore_floating": "restore",
          "pane.move_to_new_tab": "moveToNewTab",
          "pane.move_to_tab": "moveToTab",
        };
        const operation = operations[name];
        if (operation === "moveToTab" && !args.window_id) {
          setForm({
            title: "Move pane to tab",
            description: "Enter the destination tab ID from this session.",
            fields: [
              { name: "windowId", label: "Destination tab ID", required: true },
            ],
            submit: async (values) => {
              await ws.run(() =>
                window.rex.request("layoutAction", {
                  ...terminalRef,
                  operation,
                  targetWindowId: values.windowId,
                }),
              );
            },
          });
          return;
        }
        const result = await ws.run(() =>
          window.rex.request("layoutAction", {
            ...terminalRef,
            operation,
            targetWindowId: args.window_id ? String(args.window_id) : undefined,
            layerId: args.layer_id ? String(args.layer_id) : undefined,
          }),
        );
        await inspectAfter(hostId, sessionId, operation === "moveToNewTab");
        return result;
      }
      case "pane.minimize_all_floating": {
        if (!currentWindow) return;
        for (const pane of currentWindow.panes.filter(
          (pane) => pane.layerKind === "floating",
        ))
          await window.rex.request("layoutAction", {
            hostId,
            sessionId,
            blockId: pane.id,
            operation: "minimize",
            layerId: pane.layerId,
          });
        return ws.refresh();
      }
      case "pane.resize": {
        requirePane();
        const dividers = [...(currentWindow?.dividers || [])].sort((a, b) => {
          const score = (divider: PaneDivider) => {
            const [x, y, w, h] = targetPane?.rect || [0, 0, 1, 1];
            const [dx, dy, dw, dh] = divider.rect;
            const line =
              divider.direction === "horizontal"
                ? dx + dw * divider.ratio
                : dy + dh * divider.ratio;
            const distance =
              divider.direction === "horizontal"
                ? Math.min(Math.abs(x - line), Math.abs(x + w - line))
                : Math.min(Math.abs(y - line), Math.abs(y + h - line));
            return distance * 100 + dw * dh;
          };
          return score(a) - score(b);
        });
        if (!dividers.length)
          throw new Error("This tab has no split border to resize.");
        const resize = async (border: number, ratio: number) => {
          const divider = dividers[border - 1];
          if (!divider)
            throw new Error(`Choose a border from 1 to ${dividers.length}.`);
          if (!(ratio > 0 && ratio < 1))
            throw new Error("Enter a percentage between 1 and 99.");
          await ws.run(() =>
            window.rex.request("resizeDivider", {
              hostId,
              sessionId,
              ...divider,
              ratio,
            }),
          );
        };
        if (typeof args.ratio === "number")
          return resize(Number(args.border || 1), args.ratio);
        setForm({
          title: "Resize split",
          description:
            "The nearest border to the target pane comes first. " +
            dividers
              .map(
                (divider, index) =>
                  `${index + 1}: ${divider.direction === "horizontal" ? "left/right" : "upper/lower"}`,
              )
              .join("; "),
          fields: [
            ...(dividers.length > 1
              ? [
                  {
                    name: "border",
                    label: "Border number",
                    value: "1",
                    required: true,
                  },
                ]
              : []),
            {
              name: "ratio",
              label: "Before-side percentage",
              value: String(Math.round(dividers[0].ratio * 100)),
              required: true,
            },
          ],
          submit: (values) =>
            resize(Number(values.border || 1), Number(values.ratio) / 100),
        });
        return;
      }
      case "pane.rename":
        requirePane();
        setForm({
          title: "Rename pane",
          description: "A label shared with other Rex clients.",
          fields: [
            {
              name: "label",
              label: "Pane name",
              value: targetPane?.label,
              required: true,
            },
          ],
          submit: async (values) => {
            await ws.run(() =>
              window.rex.request("renamePane", {
                ...terminalRef,
                label: values.label,
              }),
            );
          },
        });
        return;
      case "pane.go_to_directory":
        requirePane();
        setDirectoryBrowser({ mode: "directory", ref: terminalRef });
        return;
      case "pane.insert_path":
        requirePane();
        setDirectoryBrowser({ mode: "insert", ref: terminalRef });
        return;
      case "pane.send_key":
      case "client.key.forward": {
        requirePane();
        const send = (key: string, mods: string, text = "") =>
          window.rex.request("invokeAction", {
            ...terminalRef,
            action: "pane.send_key",
            args: { key, mods, text },
          });
        if (!args.key) {
          setForm({
            title: "Send key",
            description: "Send one Ghostty key name to the target program.",
            fields: [
              { name: "key", label: "Key", value: "enter", required: true },
              { name: "mods", label: "Modifiers", placeholder: "ctrl+shift" },
            ],
            submit: async (values) => {
              await send(values.key, values.mods || "");
            },
          });
          return;
        }
        return send(
          String(args.key),
          String(args.mods || ""),
          String(args.text || ""),
        );
      }
      case "client.find.open":
        return localCommand("find");
      case "client.find.next":
        return localCommand("find-next");
      case "client.find.previous":
        return localCommand("find-previous");
      case "client.prompt.previous":
        return localCommand("prompt-previous");
      case "client.prompt.next":
        return localCommand("prompt-next");
      case "client.font.increase":
        return ws.saveSettings({
          ...settings,
          fontSize: Math.min(48, settings.fontSize + 1),
        });
      case "client.font.decrease":
        return ws.saveSettings({
          ...settings,
          fontSize: Math.max(8, settings.fontSize - 1),
        });
      case "client.font.reset":
        return ws.saveSettings({
          ...settings,
          fontSize: DEFAULT_SETTINGS.fontSize,
        });
      case "client.sidebar.toggle":
        if (!settings.preserveWindowWidth)
          await window.rex.request("resizeWindow", {
            deltaWidth: settings.sidebarCollapsed
              ? settings.sidebarWidth
              : -settings.sidebarWidth,
          });
        return ws.saveSettings({
          ...settings,
          sidebarCollapsed: !settings.sidebarCollapsed,
        });
      case "client.sidebar.activity.toggle":
        setActivityOnly((previous) => !previous);
        setActivityOpen(true);
        return;
      case "client.sidebar.activity.by_session":
        setActivityGroup("session");
        setActivityOpen(true);
        return;
      case "client.sidebar.activity.by_priority":
        setActivityGroup("priority");
        setActivityOpen(true);
        return;
      case "client.sidebar.filter.focus":
        if (settings.sidebarCollapsed)
          await ws.saveSettings({ ...settings, sidebarCollapsed: false });
        setTimeout(
          () => window.dispatchEvent(new Event("rex-sidebar-filter")),
          0,
        );
        return;
      case "client.tab_style.toggle":
        return ws.saveSettings({
          ...settings,
          tabStyle:
            settings.tabStyle === "left"
              ? "top"
              : settings.tabStyle === "top"
                ? "right"
                : "left",
        });
      case "client.theme.change":
        setSettingsTab("appearance");
        return;
      case "client.theme.import": {
        const imported = await window.rex.request("importTheme", {});
        if (imported) {
          const light =
            settings.appearance === "light" ||
            (settings.appearance === "system" &&
              matchMedia("(prefers-color-scheme: light)").matches);
          const next = migrateThemeLibrary(settings);
          return ws.saveSettings(
            saveLibraryTheme(
              next,
              uniqueThemeName(
                next.themeLibrary,
                `Imported ${light ? "light" : "dark"}`,
              ),
              imported,
              light ? "light" : "dark",
            ),
          );
        }
        return;
      }
      case "client.appearance.switch_mode":
        return ws.saveSettings({
          ...settings,
          theme: settings.theme === "light" ? "graphite" : "light",
        });
      case "client.config.copy_path": {
        const info = await window.rex.request("configInfo", { hostId });
        return window.rex.writeClipboard(info.path);
      }
      case "client.config.reload":
        await window.rex.request("reloadConfig", { hostId });
        await ws.refresh();
        return;
      case "client.mode.enter":
        if (!args.name) {
          setForm({
            title: "Enter key mode",
            description: "Choose a mode declared in the resolved Rex keymap.",
            fields: [{ name: "name", label: "Mode name", required: true }],
            submit: async (values) => {
              await window.rex.request("keyMode", {
                hostId,
                operation: "enter",
                name: values.name,
              });
            },
          });
          return;
        }
        return window.rex.request("keyMode", {
          hostId,
          operation: "enter",
          name: String(args.name),
        });
      case "client.mode.exit":
      case "client.mode.exit_all":
        return window.rex.request("keyMode", {
          hostId,
          operation: name.endsWith("exit_all") ? "exitAll" : "exit",
        });
      case "clear-content-server":
      case "clear-scrollback-server":
        requirePane();
        return window.rex.request("invokeAction", {
          ...terminalRef,
          action: "com.superlogical.terminal.clear",
        });
      case "reset-terminal":
        requirePane();
        setConfirmation({
          title: "Reset terminal?",
          description:
            "Reset the terminal emulator and clear its screen and scrollback. The program keeps running.",
          label: "Reset terminal",
          submit: async () => {
            await window.rex.request("invokeAction", {
              ...terminalRef,
              action: "com.superlogical.terminal.reset",
            });
          },
        });
        return;
      case "client.copy":
        return localCommand("copy");
      case "client.paste":
        return localCommand("paste");
      case "pane.new_block": {
        const creators = await window.rex.request("creators", { hostId });
        setReport({
          title: "Available block types",
          body: JSON.stringify(creators, null, 2),
        });
        setForm({
          title: "Create block",
          description:
            "Choose a flavor advertised by this Rex server. Non-terminal blocks expose their available methods in the inspector.",
          fields: [
            { name: "flavor", label: "Block flavor", required: true },
            {
              name: "options",
              label: "Options (JSON)",
              value: "{}",
              multiline: true,
            },
          ],
          submit: async (values) => {
            await ws.run(() =>
              window.rex.request("createBlock", {
                hostId,
                sessionId,
                windowId: currentWindow?.id,
                flavor: values.flavor,
                options: JSON.parse(values.options || "{}"),
              }),
            );
          },
        });
        setReport(undefined);
        return;
      }
      default: {
        const action = keymaps[hostId]?.actions.find(
          (action) => action.name === name,
        );
        if (action && action.kind !== "client")
          return window.rex.request("invokeAction", {
            ...terminalRef,
            action: name,
            args,
          });
        throw new Error(`This action is not available on this client: ${name}`);
      }
    }
  };
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
      const shortcut = Object.entries(config.shortcuts).find(([, shortcut]) =>
        matchesShortcut(event, shortcut),
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

  const navHosts: NavigationHost[] = hosts.map((host) => ({
    ...host,
    sessions: host.sessions.map((session) => ({
      ...session,
      windows: (views[viewKey(host.id, session.id)]?.windows || []).map(
        (raw) => {
          const window = enrich(host.id, session.id, raw);
          const focused =
            window.panes.find((pane) => pane.id === window.focusedBlockId) ||
            window.panes[0];
          return {
            id: window.id,
            label: windowTitle(
              window,
              settings?.preferGeneratedTitles || false,
            ),
            activity: primaryActivity(
              window.panes
                .flatMap((pane) => pane.activities || [])
                .filter(
                  (activity) =>
                    activity.state === "idle" ||
                    (settings?.notifications[activity.state] &&
                      settings.notifications.channels[activity.state].tabs),
                ),
            ),
            program:
              metadata[paneKey(host.id, session.id, focused?.id || "")]
                ?.program,
            icons: window.panes.map(
              (pane) =>
                metadata[paneKey(host.id, session.id, pane.id)]?.program ||
                "shell",
            ),
          };
        },
      ),
    })),
  }));
  const individualActivities = hosts.flatMap((host) =>
    host.sessions.flatMap((session) =>
      (views[viewKey(host.id, session.id)]?.windows || []).flatMap((window) =>
        window.panes.flatMap((pane) =>
          (metadata[paneKey(host.id, session.id, pane.id)]?.activities || [])
            .filter(
              (activity) =>
                settings?.notifications.includeIdle ||
                activity.state !== "idle",
            )
            .map((activity) => ({ host, session, window, pane, activity })),
        ),
      ),
    ),
  );
  const groupedActivities = new Map<
    string,
    (typeof individualActivities)[number]
  >();
  for (const item of individualActivities) {
    const key = `${item.host.id}/${item.window.id}`;
    const previous = groupedActivities.get(key);
    if (
      !previous ||
      primaryActivity([previous.activity, item.activity]) === item.activity
    )
      groupedActivities.set(key, item);
  }
  const allActivities = settings?.notifications.eachProcess
    ? individualActivities
    : [...groupedActivities.values()];
  if (activityGroup === "priority")
    allActivities.sort(
      (a, b) =>
        ({ blocked: 0, error: 1, done: 2, working: 3, idle: 4 })[
          a.activity.state
        ] -
        { blocked: 0, error: 1, done: 2, working: 3, idle: 4 }[
          b.activity.state
        ],
    );
  const paletteCommands: PaletteCommand[] = [
    ...(palette === "sessions"
      ? []
      : CLIENT_ACTIONS.filter(
          (action) => !["client.window.close"].includes(action.name),
        ).map((action) => ({
          id: action.name,
          label: action.title || action.name,
          description: action.name,
          shortcut: Object.entries(aliases).find(
            ([, name]) => name === action.name,
          )?.[0]
            ? settings?.shortcuts[
                Object.entries(aliases).find(
                  ([, name]) => name === action.name,
                )![0]
              ]
            : undefined,
          run: () => dispatch(action.name),
        }))),
    ...(palette === "sessions"
      ? []
      : [
          {
            id: "pane.new_block",
            label: "Create block from server plugin…",
            description: "Discover available block types",
            run: () => dispatch("pane.new_block"),
          },
        ]),
    ...(palette === "sessions"
      ? []
      : (keymaps[activeHost?.id || ""]?.actions || [])
          .filter(
            (action) =>
              action.kind !== "client" &&
              !CLIENT_ACTIONS.some((client) => client.name === action.name),
          )
          .map((action) => ({
            id: `server:${action.name}`,
            label: action.title || action.name,
            description: "Server action · " + action.name,
            run: () => {
              const required = action.args?.required as string[] | undefined;
              if (required?.length)
                setForm({
                  title: action.title || action.name,
                  description: "Arguments for this server-defined action.",
                  fields: [
                    {
                      name: "args",
                      label: "Arguments (JSON)",
                      value: JSON.stringify(
                        Object.fromEntries(required.map((key) => [key, ""])),
                        null,
                        2,
                      ),
                      multiline: true,
                    },
                  ],
                  submit: async (values) => {
                    await execute(action.name, JSON.parse(values.args));
                  },
                });
              else dispatch(action.name);
            },
          }))),
    ...(palette === "sessions"
      ? []
      : navHosts.flatMap((host) =>
          host.sessions.flatMap((session) =>
            session.windows.map((window) => ({
              id: `tab:${host.id}/${session.id}/${window.id}`,
              label: window.label,
              description: `${host.label} · ${session.label} · Tab`,
              icon: <TerminalSquare size={17} />,
              run: () => ws.select(host.id, session.id, window.id),
            })),
          ),
        )),
    ...navHosts.flatMap((host) =>
      host.sessions.map((session) => ({
        id: `session:${host.id}/${session.id}`,
        label: session.label,
        description: host.label,
        icon: <TerminalSquare size={17} />,
        run: () => ws.select(host.id, session.id),
      })),
    ),
  ];
  const openSessionMenu = (
    event: React.MouseEvent,
    hostId: string,
    sessionId: string,
  ) =>
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: "New terminal tab",
          run: () =>
            dispatch("client.tab.new", {
              host_id: hostId,
              session_id: sessionId,
            }),
        },
        {
          label: "Rename session…",
          run: () =>
            dispatch("session.rename", {
              host_id: hostId,
              session_id: sessionId,
            }),
        },
        {
          label: collapsedSessions.has(sessionId)
            ? "Expand session"
            : "Collapse session",
          run: () => toggleCollapse(sessionId),
        },
        null,
        {
          label: "Close session…",
          danger: true,
          run: () =>
            dispatch("session.close", {
              host_id: hostId,
              session_id: sessionId,
            }),
        },
      ],
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
      items: [
        {
          label: "Rename tab…",
          run: () =>
            dispatch("client.tab.rename", {
              host_id: hostId,
              session_id: sessionId,
              window_id: windowId,
            }),
        },
        {
          label: "Move tab backward",
          run: () =>
            dispatch("client.tab.move.backward", {
              host_id: hostId,
              session_id: sessionId,
              window_id: windowId,
            }),
        },
        {
          label: "Move tab forward",
          run: () =>
            dispatch("client.tab.move.forward", {
              host_id: hostId,
              session_id: sessionId,
              window_id: windowId,
            }),
        },
        {
          label: "Show in a new window",
          run: () =>
            dispatch("client.tab.move_to_new_window", {
              host_id: hostId,
              session_id: sessionId,
              window_id: windowId,
            }),
        },
        null,
        {
          label: "Close tab…",
          danger: true,
          shortcut: "Ctrl Shift W",
          run: () =>
            dispatch("client.tab.close", {
              host_id: hostId,
              session_id: sessionId,
              window_id: windowId,
            }),
        },
      ],
    });
  const reorder = (
    hostId: string,
    sessionId: string,
    windowId: string,
    beforeWindowId?: string,
  ) =>
    safely(() =>
      ws.run(() =>
        window.rex.request("reorderWindow", {
          hostId,
          sessionId,
          windowId,
          beforeWindowId,
        }),
      ),
    );

  const resizeDivider = (
    event: React.PointerEvent,
    divider: PaneDivider,
    where: Selection,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = workspaceElement.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    let latest = divider.ratio;
    let inFlight = false;
    const flush = () => {
      if (inFlight) return;
      inFlight = true;
      safely(async () => {
        try {
          await window.rex.request("resizeDivider", {
            hostId: where.hostId,
            sessionId: where.sessionId,
            beforeBlockId: divider.beforeBlockId,
            afterBlockId: divider.afterBlockId,
            direction: divider.direction,
            ratio: latest,
          });
          await ws.reloadSession(where.hostId, where.sessionId);
        } finally {
          inFlight = false;
        }
      });
    };
    const move = (next: PointerEvent) => {
      const position =
        divider.direction === "horizontal"
          ? (next.clientX - bounds.left) / bounds.width
          : (next.clientY - bounds.top) / bounds.height;
      latest = Math.max(
        0.05,
        Math.min(
          0.95,
          (position -
            divider.rect[divider.direction === "horizontal" ? 0 : 1]) /
            divider.rect[divider.direction === "horizontal" ? 2 : 3],
        ),
      );
      flush();
    };
    const up = (next: PointerEvent) => {
      move(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(flush, 50);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const moveFloating = (
    event: React.PointerEvent,
    pane: RexPane,
    where: Selection,
    resize = false,
  ) => {
    if (!pane.layerId || !workspaceElement.current) return;
    event.preventDefault();
    const bounds = workspaceElement.current.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      rect: [...pane.rect] as typeof pane.rect,
    };
    let latest = [...pane.rect] as typeof pane.rect;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) / bounds.width;
      const dy = (next.clientY - start.y) / bounds.height;
      latest = resize
        ? [
            start.rect[0],
            start.rect[1],
            Math.max(0.15, Math.min(1 - start.rect[0], start.rect[2] + dx)),
            Math.max(0.15, Math.min(1 - start.rect[1], start.rect[3] + dy)),
          ]
        : [
            Math.max(0, Math.min(1 - start.rect[2], start.rect[0] + dx)),
            Math.max(0, Math.min(1 - start.rect[3], start.rect[1] + dy)),
            start.rect[2],
            start.rect[3],
          ];
      const wrapper = document.querySelector<HTMLElement>(
        `[data-floating-block="${CSS.escape(pane.id)}"]`,
      );
      if (wrapper)
        Object.assign(wrapper.style, {
          left: `${latest[0] * 100}%`,
          top: `${latest[1] * 100}%`,
          width: `${latest[2] * 100}%`,
          height: `${latest[3] * 100}%`,
        });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      safely(() =>
        ws.run(() =>
          window.rex.request("resizeLayer", {
            hostId: where.hostId,
            sessionId: where.sessionId,
            layerId: pane.layerId!,
            bounds: latest,
          }),
        ),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const saveHost = async (host: Host, credentials?: Credentials) => {
    const current = ws.settingsRef.current!;
    await ws.saveSettings({
      ...current,
      hosts: current.hosts.some((item) => item.id === host.id)
        ? current.hosts.map((item) => (item.id === host.id ? host : item))
        : [...current.hosts, host],
    });
    if (credentials)
      await window.rex.request("setCredentials", {
        hostId: host.id,
        ...credentials,
      });
    setConnectionRevisions((previous) => ({
      ...previous,
      [host.id]: (previous[host.id] || 0) + 1,
    }));
    await ws.refresh();
  };
  const serverAction = (action: string, args: Record<string, unknown> = {}) => {
    if (action === "tailscale.rename") {
      setDiagnostics(false);
      setForm({
        title: "Change Tailscale hostname",
        description:
          "This changes the selected Rex server’s advertised hostname.",
        fields: [{ name: "hostname", label: "Hostname", required: true }],
        submit: async (values) => {
          await window.rex.request("serverAction", {
            hostId: activeHost?.id || "local",
            action: "tailscale.rename",
            args: { hostname: values.hostname },
          });
        },
      });
      return;
    }
    setDiagnostics(false);
    setConfirmation({
      title: `Apply ${action.replace("tailscale.", "Tailscale ")}?`,
      description:
        "This changes remote access on the selected server. Existing terminal programs are retained.",
      label: "Apply change",
      submit: async () => {
        const result = await window.rex.request("serverAction", {
          hostId: activeHost?.id || "local",
          action: action as "tailscale.enable",
          args:
            action === "tailscale.enable"
              ? { allow_tailnet_members: false, ...args }
              : args,
        });
        setReport({
          title: "Server response",
          body: JSON.stringify(result, null, 2),
        });
      },
    });
  };

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
        settings={settings}
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
          onCloseWindow={() => dispatch("client.tab.close")}
          onPalette={() => setPalette("all")}
          onSettings={() => setSettingsTab("appearance")}
          onRenameWindow={() => dispatch("client.tab.rename")}
          onWindowControl={window.rex.windowControl}
        />
        {settings.tabStyle === "top" && activeWindow && selection && view && (
          <TabStrip
            windows={view.windows.map((window) => ({
              ...enrich(selection.hostId, selection.sessionId, window),
              label: windowTitle(
                enrich(selection.hostId, selection.sessionId, window),
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
        <div className="workspace-body" ref={workspaceElement}>
          {activeWindow && selection ? (
            <>
              {[
                ...visited.filter(
                  (item) =>
                    !(
                      item.hostId === selection.hostId &&
                      item.sessionId === selection.sessionId &&
                      item.windowId === selection.windowId
                    ),
                ),
                selection,
              ].map((where) => {
                const raw = views[
                  viewKey(where.hostId, where.sessionId)
                ]?.windows.find((window) => window.id === where.windowId);
                if (!raw) return null;
                const window = enrich(where.hostId, where.sessionId, raw);
                const visible =
                  where.hostId === selection.hostId &&
                  where.sessionId === selection.sessionId &&
                  where.windowId === selection.windowId;
                const connected = hosts.find(
                  (host) => host.id === where.hostId,
                )?.connected;
                return (
                  <div
                    key={`${where.hostId}/${where.sessionId}/${where.windowId}`}
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
                          pane.layerKind === "floating"
                            ? "floating-pane-wrapper"
                            : ""
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
                            safely(() => focusPane(pane, where));
                        }}
                      >
                        {pane.layerKind === "floating" && (
                          <div
                            className="floating-drag-handle"
                            title="Drag floating pane"
                            onPointerDown={(event) =>
                              moveFloating(event, pane, where)
                            }
                          />
                        )}
                        <WorkspacePane
                          key={`${pane.id}/${settings.hosts.find((host) => host.id === where.hostId)?.endpoint || ""}/${connectionRevisions[where.hostId] || 0}`}
                          pane={pane}
                          terminalRef={{
                            hostId: where.hostId,
                            sessionId: where.sessionId,
                            blockId: pane.id,
                          }}
                          settings={settings}
                          focused={
                            visible && !modalOpen && pane.id === activePane?.id
                          }
                          visible={visible && !!connected}
                          showHeader={
                            settings.showPaneHeaders &&
                            (window.panes.length > 1 ||
                              pane.layerKind === "floating")
                          }
                          onFocus={() => {
                            if (visible && pane.id !== activePane?.id)
                              safely(() => focusPane(pane, where));
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
                            dispatch(command, {
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
                              moveFloating(event, pane, where, true)
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
                            aria-label={
                              horizontal ? "Resize columns" : "Resize rows"
                            }
                            aria-orientation={
                              horizontal ? "vertical" : "horizontal"
                            }
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
                              resizeDivider(event, divider, where)
                            }
                            onKeyDown={(event) => {
                              if (
                                [
                                  "ArrowLeft",
                                  "ArrowRight",
                                  "ArrowUp",
                                  "ArrowDown",
                                ].includes(event.key)
                              ) {
                                event.preventDefault();
                                const ratio = Math.max(
                                  0.05,
                                  Math.min(
                                    0.95,
                                    divider.ratio +
                                      (["ArrowRight", "ArrowDown"].includes(
                                        event.key,
                                      )
                                        ? 0.05
                                        : -0.05),
                                  ),
                                );
                                safely(() =>
                                  ws.run(() =>
                                    globalThis.window.rex.request(
                                      "resizeDivider",
                                      {
                                        hostId: where.hostId,
                                        sessionId: where.sessionId,
                                        ...divider,
                                        ratio,
                                      },
                                    ),
                                  ),
                                );
                              }
                            }}
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
              })}
              {!activeHost?.connected && (
                <div className="disconnected-overlay">
                  <AlertCircle size={20} />
                  <span>
                    {activeHost?.error || "Connection lost. Reconnecting…"}
                  </span>
                  <button className="button" onClick={() => void ws.refresh()}>
                    Reconnect
                  </button>
                </div>
              )}
            </>
          ) : (
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
                <button className="button" onClick={() => void ws.refresh()}>
                  <RefreshCw size={14} />
                  Reconnect
                </button>
              </div>
              <button
                className="empty-palette"
                onClick={() => setPalette("all")}
              >
                <Command size={13} />
                Find a session or command<kbd>Ctrl Shift P</kbd>
              </button>
            </div>
          )}
        </div>
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
              ? `${activeWindow.panes.length} panes`
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
          onReload={() => void ws.refresh()}
        />
      )}
      {diagnostics && (
        <DiagnosticsDialog
          hostId={activeHost?.id}
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
          mode={directoryBrowser.mode}
          recent={
            settings.showRecentPaths
              ? settings.recentPaths[directoryBrowser.ref.hostId] || []
              : []
          }
          onClose={() => setDirectoryBrowser(undefined)}
          onPick={async (path) => {
            const target = directoryBrowser.ref;
            if (directoryBrowser.mode === "insert")
              await window.rex.request("paste", {
                ...target,
                text: `'${path.replaceAll("'", "'\\''")}'`,
              });
            else {
              await ws.run(() =>
                window.rex.request("newWindow", {
                  hostId: target.hostId,
                  sessionId: target.sessionId,
                  label: path.split("/").filter(Boolean).at(-1) || "Shell",
                  cwd: path,
                }),
              );
              await inspectAfter(target.hostId, target.sessionId, true);
            }
            const current = ws.settingsRef.current!;
            await ws.saveSettings({
              ...current,
              recentPaths: {
                ...current.recentPaths,
                [target.hostId]: [
                  path,
                  ...(current.recentPaths[target.hostId] || []).filter(
                    (value) => value !== path,
                  ),
                ].slice(0, 20),
              },
            });
          }}
        />
      )}
      {form && (
        <FormDialog
          form={form}
          busy={busy}
          onClose={() => setForm(undefined)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          confirmation={confirmation}
          onClose={() => setConfirmation(undefined)}
        />
      )}
      {report && (
        <Dialog title={report.title} onClose={() => setReport(undefined)} wide>
          <pre className="diagnostic-output">{report.body}</pre>
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() => void window.rex.writeClipboard(report.body)}
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

function WorkspacePane(props: TerminalPaneProps) {
  if (props.pane.creator === "com.superlogical.onboarding")
    return <OnboardingPane {...props} />;
  return props.pane.creator &&
    props.pane.creator !== "com.superlogical.terminal" ? (
    <BlockInspector {...props} />
  ) : (
    <TerminalPane {...props} />
  );
}
function FormDialog({
  form,
  busy,
  onClose,
}: {
  form: Form;
  busy: boolean;
  onClose(): void;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.value || ""]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog title={form.title} subtitle={form.description} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || saving) return;
          setSaving(true);
          void form
            .submit(values)
            .then(onClose)
            .catch((failure) => {
              setError(errorMessage(failure));
              setSaving(false);
            });
        }}
      >
        {form.fields.map((field, index) => (
          <label className="form-field" key={field.name}>
            {field.label}
            {field.multiline ? (
              <textarea
                className="form-input"
                aria-label={field.label}
                value={values[field.name]}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            ) : (
              <input
                className="form-input"
                data-autofocus={index === 0 ? true : undefined}
                required={field.required}
                value={values[field.name]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={saving || busy}>
            {saving || busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation;
  onClose(): void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog
      title={confirmation.title}
      subtitle={confirmation.description}
      onClose={onClose}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-danger"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void confirmation
              .submit()
              .then(onClose)
              .catch((failure) => {
                setError(errorMessage(failure));
                setSaving(false);
              });
          }}
        >
          {saving ? "Applying…" : confirmation.label || "Close terminal"}
        </button>
      </div>
    </Dialog>
  );
}
