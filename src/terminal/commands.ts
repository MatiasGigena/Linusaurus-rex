import type { TerminalRef } from "../shared/types";

const HANDOFF_TIMEOUT_MS = 10_000;
interface PaneCommands {
  available(): boolean;
  focused(): boolean;
  execute(command: string, signal: AbortSignal): Promise<void>;
  onError(failure: unknown): void;
}
interface PendingCommand {
  key: string;
  command: string;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  owner?: RegisteredPane;
  settled: boolean;
  resolve(): void;
  reject(failure: Error): void;
}
interface RegisteredPane {
  key: string;
  commands: PaneCommands;
  active: Set<PendingCommand>;
}
const targetKey = (target: TerminalRef) =>
  JSON.stringify([target.hostId, target.sessionId, target.blockId]);
const commandError = (failure: unknown) =>
  failure instanceof Error ? failure : new Error(String(failure));

/** Holds targeted commands until their pane registers or becomes visible. */
export class TerminalCommandBroker {
  private panes = new Map<string, RegisteredPane>();
  private queued = new Map<string, Set<PendingCommand>>();

  register(target: TerminalRef, commands: PaneCommands) {
    const key = targetKey(target);
    const previous = this.panes.get(key);
    if (previous) this.unregister(previous);
    const pane: RegisteredPane = { key, commands, active: new Set() };
    this.panes.set(key, pane);
    this.activate(pane);
    return {
      activate: () => this.activate(pane),
      dispose: () => this.unregister(pane),
    };
  }

  dispatch(command: string, target?: TerminalRef): Promise<void> {
    const key = target
      ? targetKey(target)
      : [...this.panes.values()].find(
          (pane) => pane.commands.available() && pane.commands.focused(),
        )?.key;
    if (!key)
      return Promise.reject(new Error("No visible terminal pane is focused."));
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        key,
        command,
        resolve,
        reject,
        controller: new AbortController(),
        settled: false,
      };
      const queue = this.queued.get(key) || new Set<PendingCommand>();
      queue.add(pending);
      this.queued.set(key, queue);
      pending.timer = setTimeout(
        () =>
          this.finish(
            pending,
            new Error(
              "The target terminal pane did not become visible within 10 seconds.",
            ),
          ),
        HANDOFF_TIMEOUT_MS,
      );
      const pane = this.panes.get(key);
      if (pane) this.activate(pane);
    });
  }

  private activate(pane: RegisteredPane) {
    if (this.panes.get(pane.key) !== pane || !pane.commands.available()) return;
    for (const pending of [...(this.queued.get(pane.key) || [])]) {
      if (pending.settled || pending.owner) continue;
      // Acceptance is single-shot. Never hand an accepted command to a remount,
      // even when its execution fails or its connection generation changes.
      this.removeQueued(pending);
      clearTimeout(pending.timer);
      pending.timer = undefined;
      pending.owner = pane;
      pane.active.add(pending);
      const failed = (failure: unknown) => {
        this.finish(pending, commandError(failure));
        try {
          pane.commands.onError(failure);
        } catch {
          /* An error observer cannot strand command completion. */
        }
      };
      try {
        pending.controller.signal.throwIfAborted();
        void pane.commands
          .execute(pending.command, pending.controller.signal)
          .then(() => this.finish(pending), failed);
      } catch (failure) {
        failed(failure);
      }
    }
  }

  private unregister(pane: RegisteredPane) {
    if (this.panes.get(pane.key) === pane) {
      this.panes.delete(pane.key);
      for (const pending of [...(this.queued.get(pane.key) || [])]) {
        this.finish(
          pending,
          new Error(
            "The target terminal pane was closed before accepting the command.",
          ),
        );
      }
    }
    for (const pending of [...pane.active]) {
      this.finish(
        pending,
        new Error(
          "The target terminal pane was closed before completing the command.",
        ),
      );
    }
  }

  private removeQueued(pending: PendingCommand) {
    const queue = this.queued.get(pending.key);
    queue?.delete(pending);
    if (!queue?.size) this.queued.delete(pending.key);
  }

  private finish(pending: PendingCommand, failure?: Error) {
    if (pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timer);
    this.removeQueued(pending);
    pending.owner?.active.delete(pending);
    if (failure) {
      pending.controller.abort(failure);
      pending.reject(failure);
    } else pending.resolve();
  }
}

export const terminalCommands = new TerminalCommandBroker();

/** Resolves when the target accepts the command after its transport is ready. */
export function dispatchTerminalCommandAsync(
  command: string,
  target?: TerminalRef,
): Promise<void> {
  return terminalCommands.dispatch(command, target);
}

export function dispatchTerminalCommand(
  command: string,
  target?: TerminalRef,
): void {
  void dispatchTerminalCommandAsync(command, target).catch(() => {});
}
