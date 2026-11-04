import type {
  Selection,
  SessionView,
  Settings,
  TerminalRef,
} from "../shared/types";

export interface SessionMutationPlan<T> {
  hostId: string;
  sessionId: string | ((result: T) => string);
  selectActive?: boolean;
}
export interface WorkspaceOperations {
  run<T>(action: () => Promise<T>): Promise<T>;
  mutateSession<T>(
    plan: SessionMutationPlan<T>,
    action: () => Promise<T>,
  ): Promise<{ result: T; view: SessionView }>;
  refresh(): Promise<void>;
  getSettings(): Settings | undefined;
  saveSettings(settings: Settings): Promise<Settings>;
  select(
    hostId: string,
    sessionId: string,
    windowId?: string,
    blockId?: string,
  ): void;
  focusPane(target: TerminalRef): Promise<void>;
  dismissNotices(): void;
}
export function activeSessionSelection(
  hostId: string,
  view: SessionView,
): Selection {
  return {
    hostId,
    sessionId: view.id,
    windowId: view.activeWindowId || view.windows[0]?.id || "",
  };
}
