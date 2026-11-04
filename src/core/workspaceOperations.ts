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
/** A newer workspace publication owns the state that this read would replace. */
export class SupersededSessionInspectionError extends Error {
  constructor(cause?: unknown) {
    super(
      "The session inspection was superseded by a newer workspace change.",
      { cause },
    );
    this.name = "SupersededSessionInspectionError";
  }
}
/** The write completed; this failure must be recovered by reading, not replaying it. */
export class WorkspaceReconciliationError extends Error {
  readonly code?: string;
  readonly method?: string;
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `The change completed, but refreshing the workspace failed: ${detail} Refresh to check the result before repeating the change.`,
      { cause },
    );
    this.name = "WorkspaceReconciliationError";
    if (cause && typeof cause === "object") {
      if ("code" in cause && typeof cause.code === "string")
        this.code = cause.code;
      if ("method" in cause && typeof cause.method === "string")
        this.method = cause.method;
    }
  }
}
export interface WorkspaceOperations {
  /**
   * Resolve the action result after queued workspace refreshes converge and the
   * named host has a successful snapshot. React state updates are queued before
   * resolution; rendering may finish afterward. Reject unavailable targets before
   * invoking the action. Once the action succeeds, target failure, configuration
   * changes, or closure reject as WorkspaceReconciliationError with the original
   * cause and code/method. Unrelated offline hosts stay visible and do not reject.
   * An action rejection is preserved even if later background recovery fails.
   */
  run<T>(hostId: string, action: () => Promise<T>): Promise<T>;
  /**
   * Resolve once the action and one target-session inspection succeed and any
   * active selection/focus state updates are queued. Preserve action rejection
   * identity. Inspection failure rejects as WorkspaceReconciliationError with
   * cause/code/method, keeps the last good view, and publishes the host error.
   * Recovery retries reads only, never the mutation.
   * Target replacement/removal or workspace closure prevents stale selection.
   */
  mutateSession<T>(
    plan: SessionMutationPlan<T>,
    action: () => Promise<T>,
  ): Promise<{ result: T; view: SessionView }>;
  /**
   * Drain queued snapshot invalidations, retaining per-host failures and last
   * good views for UI recovery. Offline hosts are reported in state; unexpected
   * collection failures reject. Calling after disposal starts no bridge work.
   */
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
