export interface Host {
  id: string;
  label: string;
  endpoint: string;
  startupCommand?: string;
  websocketOrigins?: string[];
}
export interface SessionSummary {
  id: string;
  label: string;
}
export type PaneRect = [number, number, number, number];
export interface RexPane {
  id: string;
  label: string;
  rect: PaneRect;
  creator?: string;
  layerId?: string;
  layerKind?: string;
  activities?: ProgramActivity[];
  title?: string;
  cwd?: string;
  program?: string;
}
export interface RexWindow {
  id: string;
  label: string;
  focusedBlockId: string;
  panes: RexPane[];
  zoomedBlockId?: string;
  dividers?: PaneDivider[];
  minimizedLayers?: { id: string; label: string; blockId: string }[];
}
export interface PaneDivider {
  direction: "horizontal" | "vertical";
  beforeBlockId: string;
  afterBlockId: string;
  ratio: number;
  rect: PaneRect;
}
export interface SessionView extends SessionSummary {
  activeWindowId: string;
  windows: RexWindow[];
}
export interface Selection {
  hostId: string;
  sessionId: string;
  windowId: string;
  blockId?: string;
}
export interface NotificationChannel {
  tabs: boolean;
  desktop: boolean;
  badge: boolean;
  sound: boolean;
}
export interface NotificationSettings {
  enabled: boolean;
  desktopEnabled: boolean;
  showInTabs: boolean;
  working: boolean;
  blocked: boolean;
  error: boolean;
  done: boolean;
  programMessages: boolean;
  sound: boolean;
  badge: boolean;
  position:
    | "top-right"
    | "top-left"
    | "bottom-right"
    | "bottom-left"
    | "top-center"
    | "bottom-center";
  includeIdle: boolean;
  eachProcess: boolean;
  channels: Record<
    "working" | "blocked" | "error" | "done",
    NotificationChannel
  >;
  tailscaleLogin: boolean;
  tailscaleApproval: boolean;
  tailscaleError: boolean;
}
export interface Settings {
  hosts: Host[];
  fontSize: number;
  fontFamily: string;
  sidebarCollapsed: boolean;
  lastSelection?: Selection;
  interfaceZoom: number;
  theme: "macos" | "macos-light" | "graphite" | "midnight" | "light" | "system";
  customTheme?: Record<string, string>;
  customLightTheme?: Record<string, string>;
  customDarkTheme?: Record<string, string>;
  appearance: "system" | "dark" | "light";
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  scrollback: number;
  lineHeight: number;
  copyOnSelect: boolean;
  scrollOnOutput: boolean;
  terminalBell: boolean;
  notifications: NotificationSettings;
  letAgentsNameSessions: boolean;
  openLinks: boolean;
  mouseReporting: boolean;
  confirmClose: boolean;
  shortcuts: Record<string, string>;
  globalShortcut: string;
  closeToTray: boolean;
  clientLabel: string;
  remoteControl: boolean;
  tabStyle: "left" | "right" | "top";
  fillTabs: boolean;
  tabIcons: number;
  tabIconColors: "always" | "active-pane" | "active-tab" | "never";
  paneStyle: "comfortable" | "compact";
  showPaneHeaders: boolean;
  paddingX: number;
  paddingY: number;
  highlightActivePane: boolean;
  highlightColor: string;
  highlightOpacity: number;
  inactivePaneFade: number;
  focusFollowsMouse: boolean;
  autobalanceSplits: boolean;
  trackpadGestures: boolean;
  sidebarGesture: "swipe" | "alt-swipe" | "off";
  animation: "snappy" | "natural" | "off";
  fontWeight: number;
  fontWeightBold: number;
  letterSpacing: number;
  minimumContrastRatio: number;
  smoothScrollDuration: number;
  preferGeneratedTitles: boolean;
  startupCommand: string;
  lightTheme: "macos-light" | "macos" | "light" | "graphite" | "midnight";
  darkTheme: "macos" | "macos-light" | "light" | "graphite" | "midnight";
  useExtendedPalette: boolean;
  forceCursorStyle: boolean;
  cursorBlinkInterval: number;
  ligatures: boolean;
  fontStyle: "normal" | "italic" | "oblique";
  fontSmoothing: boolean;
  showKeyHints: boolean;
  showRecentPaths: boolean;
  recentPaths: Record<string, string[]>;
  appLinks: "ask" | "always" | "never";
  trustedLinks: string[];
  sidebarWidth: number;
  preserveWindowWidth: boolean;
  inactiveWindowFade: number;
  useExtendedLightPalette: boolean;
  useExtendedDarkPalette: boolean;
  selectionForeground: string;
  selectionBackground: string;
  showWindowOnLaunch: boolean;
  developerMode: boolean;
  themeLibrary: { id: string; name: string; colors: Record<string, string> }[];
  lightThemeId: string;
  darkThemeId: string;
  shellIconTheme: "default" | "theme" | "accent";
  tintInterface: boolean;
  highlightAnimation: "fade" | "move" | "instant";
  inactivePaneFadeTarget: "content" | "surfaces" | "both";
  graphicsEnabled: boolean;
  forceThemePalette: boolean;
  displayP3: boolean;
  cursorEffect: "off" | "warp" | "comet" | "blaze";
  matchProgramBackground: boolean;
  paddingColor: "pane" | "extend";
  selectionCopyAnimation: boolean;
  selectionRounded: boolean;
  smoothResize: boolean;
  boldPolicy: "always" | "font" | "never";
  italicPolicy: "always" | "font" | "never";
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
  installUpdatesWhenIdle: boolean;
}
export interface ProgramActivity {
  id: string;
  state: "idle" | "working" | "blocked" | "error" | "done";
  kind?: string;
  app?: string;
  message?: string;
  progress?: number;
  updatedAt?: string;
}
export interface RexKeyEvent {
  key: string;
  mods: string;
  consumed_mods: string;
  text: string;
  unshifted_codepoint: number;
  composing: boolean;
  action: "press" | "release" | "repeat";
}
export interface ActionDefinition {
  name: string;
  title?: string;
  description?: string;
  kind?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface KeyBinding {
  keys: string[];
  action?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface KeymapResult {
  actions: ActionDefinition[];
  bindings: KeyBinding[];
  modes: unknown[];
  warnings: unknown[];
}
export interface IntegrationPreview {
  previewId: string;
  output: string;
  steps?: unknown[];
}
export type ClientEvent =
  | {
      type: "action";
      requestId: string;
      name: string;
      args: Record<string, unknown>;
      hostId: string;
      sessionId?: string;
      blockId?: string;
    }
  | {
      type: "activity";
      hostId: string;
      sessionId: string;
      blockId: string;
      activities: ProgramActivity[];
      title?: string;
      program?: string;
      cwd?: string;
    }
  | { type: "layout"; hostId: string; sessionId?: string }
  | {
      type: "select";
      hostId: string;
      sessionId: string;
      windowId?: string;
      blockId?: string;
    }
  | {
      type: "notification";
      hostId: string;
      sessionId?: string;
      windowId?: string;
      blockId?: string;
      id: string;
      title: string;
      body: string;
      kind: "working" | "blocked" | "error" | "done" | "program";
    }
  | { type: "status"; hostId: string; connected: boolean; message?: string }
  | {
      type: "keys";
      hostId: string;
      prefix: string[];
      mode?: string;
      hints: string[];
    }
  | { type: "keymap"; hostId: string; keymap: KeymapResult }
  | { type: "settings"; settings: Settings }
  | { type: "update"; state: UpdateState };
export interface UpdateState {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "scheduled"
    | "current"
    | "error";
  currentVersion: string;
  version?: string;
  bytes?: number;
  total?: number;
  releaseUrl?: string;
  error?: string;
  installKind: "appimage" | "deb" | "development";
  canApply: boolean;
}
export interface ServerServiceInfo {
  unit: string;
  scope: "user" | "system";
  activeState: string;
  subState?: string;
  restart: string;
  fragmentPath?: string;
  dropInPaths: string[];
  configuredOrigins: string[];
  canManage: boolean;
  reason?: string;
}
export interface ServerOriginPreview {
  previewId: string;
  unit: string;
  path: string;
  before: string | null;
  after: string;
  backupPath?: string;
  restartRequired: true;
}
export interface ServerManagementInfo {
  service?: ServerServiceInfo;
  local: boolean;
  running: boolean;
  canManage: boolean;
  reason?: string;
  pid?: number;
  sessionCount: number;
  endpoint: string;
  executable?: string;
  arguments: string[];
  origins: string[];
  pendingOrigins?: string[];
  version?: string;
  binarySha256?: string;
  configPath?: string;
  stateDirectory?: string;
}
export interface ServerStatus {
  connected: boolean;
  version?: string;
  endpoint?: string;
  error?: string;
}
export interface TerminalRef {
  hostId: string;
  sessionId: string;
  blockId: string;
}
export interface TerminalFrame {
  subscriptionId: string;
  data?: string;
  error?: string;
  kind?: "snapshot" | "output" | "resize";
  cols?: number;
  rows?: number;
}
type SessionRef = { hostId: string; sessionId: string };
type WindowRef = SessionRef & { windowId: string };
export interface RexMethods {
  previewServerOrigins: {
    args: { hostId: string; origins: string[] };
    result: ServerOriginPreview;
  };
  applyServerOrigins: {
    args: { hostId: string; previewId: string };
    result: ServerManagementInfo;
  };

  createTutorial: {
    args: { hostId: string };
    result: { sessionId: string; windowId: string; blockId: string };
  };
  updateStatus: { args: Record<string, never>; result: UpdateState };
  checkUpdates: { args: Record<string, never>; result: UpdateState };
  downloadUpdate: { args: Record<string, never>; result: UpdateState };
  applyUpdate: { args: { whenIdle?: boolean }; result: UpdateState };
  cancelUpdate: { args: Record<string, never>; result: UpdateState };
  serverManagement: { args: { hostId: string }; result: ServerManagementInfo };
  serverLifecycle: {
    args: { hostId: string; operation: "start" | "stop" | "restart" };
    result: ServerManagementInfo;
  };
  status: { args: { hostId: string }; result: ServerStatus };
  listSessions: { args: { hostId: string }; result: SessionSummary[] };
  inspectSession: { args: SessionRef; result: SessionView };
  createSession: {
    args: { hostId: string; label: string; cwd?: string };
    result: { sessionId: string };
  };
  renameSession: { args: SessionRef & { label: string }; result: void };
  newWindow: {
    args: SessionRef & { label?: string; cwd?: string };
    result: void;
  };
  renameWindow: { args: WindowRef & { label: string }; result: void };
  closeWindow: { args: WindowRef; result: void };
  split: {
    args: TerminalRef & {
      direction: "right" | "below" | "left" | "above";
      ratio?: number;
    };
    result: void;
  };
  closePane: { args: TerminalRef; result: void };
  focus: { args: TerminalRef; result: void };
  focusWindow: { args: WindowRef; result: void };
  zoom: { args: TerminalRef; result: void };
  subscribe: { args: TerminalRef & { subscriptionId: string }; result: void };
  unsubscribe: { args: { subscriptionId: string }; result: void };
  input: { args: TerminalRef & { data: string }; result: void };
  resize: { args: TerminalRef & { cols: number; rows: number }; result: void };
  releaseViewport: { args: TerminalRef; result: void };
  key: {
    args: TerminalRef & { event: RexKeyEvent; prefix?: string[] };
    result: { handled: boolean };
  };
  paste: { args: TerminalRef & { text: string }; result: void };
  focusEvent: { args: TerminalRef & { focused: boolean }; result: void };
  mouse: {
    args: TerminalRef & {
      event: {
        action: "press" | "motion" | "release";
        button?: "left" | "middle" | "right";
        x: number;
        y: number;
        mods: string;
      };
    };
    result: void;
  };
  wheel: {
    args: TerminalRef & {
      event: { x: number; y: number; delta_x: number; delta_y: number };
    };
    result: void;
  };
  keymap: { args: { hostId: string }; result: KeymapResult };
  keyMode: {
    args: {
      hostId: string;
      operation: "enter" | "exit" | "exitAll";
      name?: string;
    };
    result: void;
  };
  invokeAction: {
    args: {
      hostId: string;
      sessionId?: string;
      blockId?: string;
      action: string;
      args?: Record<string, unknown>;
    };
    result: unknown;
  };
  configureClient: {
    args: {
      hostId: string;
      actions?: ActionDefinition[];
      defaults?: unknown[];
    };
    result: KeymapResult;
  };
  resizeDivider: {
    args: SessionRef & {
      beforeBlockId: string;
      afterBlockId: string;
      direction: "horizontal" | "vertical";
      ratio: number;
    };
    result: void;
  };
  movePane: {
    args: TerminalRef & {
      anchorBlockId: string;
      direction: "right" | "left" | "above" | "below";
    };
    result: void;
  };
  swapPanes: { args: TerminalRef & { otherBlockId: string }; result: void };
  layoutAction: {
    args: TerminalRef & {
      operation:
        | "balance"
        | "float"
        | "minimize"
        | "restore"
        | "moveToNewTab"
        | "moveToTab";
      targetWindowId?: string;
      layerId?: string;
    };
    result: unknown;
  };
  resizeLayer: {
    args: SessionRef & { layerId: string; bounds: PaneRect };
    result: void;
  };
  reorderWindow: {
    args: WindowRef & { beforeWindowId?: string };
    result: void;
  };
  destroySession: { args: SessionRef; result: void };
  creators: { args: { hostId: string }; result: unknown };
  renamePane: { args: TerminalRef & { label: string }; result: void };
  createBlock: {
    args: SessionRef & {
      windowId?: string;
      flavor: string;
      options?: Record<string, unknown>;
    };
    result: unknown;
  };
  blockInfo: { args: TerminalRef; result: unknown };
  callBlock: {
    args: TerminalRef & { method: string; args?: Record<string, unknown> };
    result: unknown;
  };
  listDirectory: {
    args: TerminalRef & {
      path: string;
      files?: boolean;
      prefix?: string;
      limit?: number;
    };
    result: {
      path: string;
      home: string;
      status: "ok" | "missing" | "not_dir" | "denied";
      entries: { name: string; file?: boolean; symlink?: boolean }[];
      truncated: boolean;
    };
  };
  integrationsStatus: {
    args: Record<string, never>;
    result: { output: string; agents?: unknown[] };
  };
  integrationsPreview: {
    args: {
      operation: "setup" | "remove";
      agents: string[];
      letAgentsNameSessions: boolean;
      force?: boolean;
    };
    result: IntegrationPreview;
  };
  integrationsApply: {
    args: { previewId: string };
    result: { output: string; steps?: unknown[] };
  };
  setCredentials: {
    args: {
      hostId: string;
      username?: string;
      password?: string;
      token?: string;
    };
    result: void;
  };
  credentialStatus: {
    args: { hostId: string };
    result: { stored: boolean; secureStorageAvailable: boolean };
  };
  removeCredentials: { args: { hostId: string }; result: void };
  setContext: {
    args: Partial<Selection> & {
      blockId?: string;
      visible?: boolean;
      uiBusy?: boolean;
    };
    result: void;
  };
  openExternal: { args: { url: string }; result: void };
  configInfo: {
    args: { hostId: string };
    result: { path: string; content?: string; [key: string]: unknown };
  };
  reloadConfig: { args: { hostId: string }; result: unknown };
  writeConfig: { args: { hostId: string; content: string }; result: void };
  serverAction: {
    args: {
      hostId: string;
      action:
        | "status"
        | "tailscale.enable"
        | "tailscale.disable"
        | "tailscale.login"
        | "tailscale.logout"
        | "tailscale.rename";
      args?: Record<string, unknown>;
    };
    result: unknown;
  };
  diagnostics: { args: { hostId?: string }; result: Record<string, unknown> };
  importTheme: {
    args: Record<string, never>;
    result: Record<string, string> | null;
  };
  pickPath: {
    args: {
      directory?: boolean;
      save?: boolean;
      content?: string;
      defaultPath?: string;
    };
    result: string | null;
  };
  resizeWindow: { args: { deltaWidth: number }; result: void };
}
export interface RexBridge {
  request<K extends keyof RexMethods>(
    method: K,
    args: RexMethods[K]["args"],
  ): Promise<RexMethods[K]["result"]>;
  onTerminal(callback: (frame: TerminalFrame) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
  onClientEvent(callback: (event: ClientEvent) => void): () => void;
  replyAction(requestId: string, result?: unknown, error?: string): void;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<Settings>;
  windowControl(
    action:
      | "minimize"
      | "maximize"
      | "close"
      | "fullscreen"
      | "new"
      | "hide"
      | "show",
  ): void;
}
declare global {
  interface Window {
    rex: RexBridge;
  }
}
export const DEFAULT_SETTINGS: Settings = {
  hosts: [{ id: "local", label: "This computer", endpoint: "" }],
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
  sidebarCollapsed: false,
  interfaceZoom: 1,
  theme: "system",
  appearance: "system",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 20000,
  lineHeight: 1.2,
  copyOnSelect: false,
  scrollOnOutput: true,
  terminalBell: false,
  notifications: {
    enabled: true,
    desktopEnabled: true,
    showInTabs: true,
    working: true,
    blocked: true,
    error: true,
    done: true,
    programMessages: true,
    sound: false,
    badge: true,
    position: "top-right",
    includeIdle: false,
    eachProcess: false,
    channels: {
      working: { tabs: true, desktop: false, badge: false, sound: false },
      blocked: { tabs: true, desktop: true, badge: true, sound: true },
      error: { tabs: true, desktop: true, badge: true, sound: true },
      done: { tabs: true, desktop: true, badge: true, sound: true },
    },
    tailscaleLogin: true,
    tailscaleApproval: true,
    tailscaleError: true,
  },
  letAgentsNameSessions: false,
  openLinks: true,
  mouseReporting: true,
  confirmClose: true,
  shortcuts: {
    "command-palette": "Ctrl+Shift+P",
    "session-switcher": "Ctrl+K",
    "new-session": "Ctrl+Shift+N",
    "new-window": "Ctrl+Shift+T",
    "close-window": "Ctrl+Shift+W",
    "toggle-sidebar": "Ctrl+Shift+B",
    "split-right": "Ctrl+Shift+D",
    "split-below": "Ctrl+Shift+Alt+D",
    zoom: "Ctrl+Shift+Enter",
    settings: "Ctrl+Shift+Comma",
    find: "Ctrl+Shift+F",
    copy: "Ctrl+Shift+C",
    paste: "Ctrl+Shift+V",
    "font-increase": "Ctrl+Equal",
    "font-decrease": "Ctrl+Minus",
    "font-reset": "Ctrl+0",
    "next-tab": "Ctrl+Tab",
    "previous-tab": "Ctrl+Shift+Tab",
    "focus-left": "Ctrl+Alt+ArrowLeft",
    "focus-right": "Ctrl+Alt+ArrowRight",
    "focus-up": "Ctrl+Alt+ArrowUp",
    "focus-down": "Ctrl+Alt+ArrowDown",
  },
  globalShortcut: "",
  closeToTray: false,
  clientLabel: "Linusaurus Rex",
  remoteControl: true,
  tabStyle: "left",
  fillTabs: false,
  tabIcons: 1,
  tabIconColors: "always",
  paneStyle: "comfortable",
  showPaneHeaders: true,
  paddingX: 18,
  paddingY: 12,
  highlightActivePane: true,
  highlightColor: "#a1c291",
  highlightOpacity: 0.15,
  inactivePaneFade: 0,
  focusFollowsMouse: false,
  autobalanceSplits: false,
  trackpadGestures: true,
  sidebarGesture: "off",
  animation: "snappy",
  fontWeight: 400,
  fontWeightBold: 700,
  letterSpacing: 0,
  minimumContrastRatio: 1,
  smoothScrollDuration: 0,
  preferGeneratedTitles: true,
  startupCommand: "",
  selectionForeground: "#edf2f5",
  selectionBackground: "#61757480",
  showWindowOnLaunch: true,
  developerMode: false,
  lightTheme: "macos-light",
  darkTheme: "macos",
  useExtendedPalette: true,
  forceCursorStyle: false,
  cursorBlinkInterval: 500,
  ligatures: true,
  fontStyle: "normal",
  fontSmoothing: true,
  showKeyHints: true,
  showRecentPaths: true,
  recentPaths: {},
  appLinks: "ask",
  trustedLinks: [],
  sidebarWidth: 278,
  preserveWindowWidth: true,
  inactiveWindowFade: 0,
  useExtendedLightPalette: true,
  useExtendedDarkPalette: true,
  themeLibrary: [],
  lightThemeId: "",
  darkThemeId: "",
  shellIconTheme: "default",
  tintInterface: false,
  highlightAnimation: "fade",
  inactivePaneFadeTarget: "both",
  graphicsEnabled: true,
  forceThemePalette: false,
  displayP3: false,
  cursorEffect: "off",
  matchProgramBackground: true,
  paddingColor: "pane",
  selectionCopyAnimation: true,
  selectionRounded: true,
  smoothResize: true,
  boldPolicy: "always",
  italicPolicy: "always",
  autoCheckUpdates: false,
  autoDownloadUpdates: false,
  installUpdatesWhenIdle: false,
};
