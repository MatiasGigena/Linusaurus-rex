export interface Host { id: string; label: string; endpoint: string }
export interface SessionSummary { id: string; label: string }
export type PaneRect = [number, number, number, number];
export interface RexPane { id: string; label: string; rect: PaneRect; creator?: string }
export interface RexWindow { id: string; label: string; focusedBlockId: string; panes: RexPane[] }
export interface SessionView extends SessionSummary { activeWindowId: string; windows: RexWindow[] }
export interface Selection { hostId: string; sessionId: string; windowId: string }
export interface Settings { hosts: Host[]; fontSize: number; fontFamily: string; sidebarCollapsed: boolean; lastSelection?: Selection }
export interface ServerStatus { connected: boolean; version?: string; endpoint?: string; error?: string }
export interface TerminalRef { hostId: string; sessionId: string; blockId: string }
export interface TerminalFrame { subscriptionId: string; data?: string; error?: string }
type SessionRef = { hostId: string; sessionId: string };
type WindowRef = SessionRef & { windowId: string };
export interface RexMethods {
  status: { args: { hostId: string }; result: ServerStatus };
  listSessions: { args: { hostId: string }; result: SessionSummary[] };
  inspectSession: { args: SessionRef; result: SessionView };
  createSession: { args: { hostId: string; label: string; cwd?: string }; result: { sessionId: string } };
  renameSession: { args: SessionRef & { label: string }; result: void };
  newWindow: { args: SessionRef & { label?: string }; result: void };
  renameWindow: { args: WindowRef & { label: string }; result: void };
  closeWindow: { args: WindowRef; result: void };
  split: { args: TerminalRef & { direction: 'right' | 'below' }; result: void };
  closePane: { args: TerminalRef; result: void };
  focus: { args: TerminalRef; result: void };
  zoom: { args: TerminalRef; result: void };
  subscribe: { args: TerminalRef & { subscriptionId: string }; result: void };
  unsubscribe: { args: { subscriptionId: string }; result: void };
  input: { args: TerminalRef & { data: string }; result: void };
  resize: { args: TerminalRef & { cols: number; rows: number }; result: void };
}
export interface RexBridge {
  request<K extends keyof RexMethods>(method: K, args: RexMethods[K]['args']): Promise<RexMethods[K]['result']>;
  onTerminal(callback: (frame: TerminalFrame) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<Settings>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
}
declare global { interface Window { rex: RexBridge } }
export const DEFAULT_SETTINGS: Settings = {
  hosts: [{ id: 'local', label: 'This computer', endpoint: '' }],
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
  sidebarCollapsed: false,
};
