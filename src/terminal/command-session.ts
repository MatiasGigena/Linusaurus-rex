import type { TerminalCommandCompletion } from "./commands";

const COMMAND_READY_TIMEOUT_MS = 10_000;
interface ReadinessWaiter {
  resolve(generation: number): void;
  reject(failure: Error): void;
}
interface TerminalSessionCallbacks {
  visible(): boolean;
  connected(value: boolean): void;
  error(message?: string): void;
}
export const terminalErrorMessage = (failure: unknown) =>
  failure instanceof Error
    ? failure.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : String(failure);

/** One mounted terminal connection owns readiness and its non-replaying input queue. */
export class TerminalCommandSession {
  private disposed = false;
  private online = false;
  private ready = false;
  private disconnected = false;
  private inputGeneration = 0;
  private connectionGeneration = 0;
  private inputQueue = Promise.resolve();
  private waiters = new Set<ReadinessWaiter>();

  constructor(private readonly callbacks: TerminalSessionCallbacks) {}

  get isDisposed() {
    return this.disposed;
  }
  get isOnline() {
    return this.online;
  }
  get frameGeneration() {
    return this.connectionGeneration;
  }

  receiveFrame(): boolean {
    if (this.disposed) return false;
    const recovered = !this.online;
    if (recovered) {
      this.inputGeneration++;
      this.connectionGeneration++;
      this.disconnected = false;
    }
    this.online = true;
    this.callbacks.connected(true);
    this.callbacks.error(undefined);
    return recovered;
  }

  beginSnapshot() {
    this.ready = false;
  }

  frameRendered(generation: number, pendingSnapshot: boolean) {
    if (
      this.disposed ||
      !this.online ||
      generation !== this.connectionGeneration ||
      this.ready ||
      pendingSnapshot
    )
      return;
    this.ready = true;
    for (const waiter of this.waiters) waiter.resolve(this.inputGeneration);
    this.waiters.clear();
  }

  waitUntilReady(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.disposed || !this.callbacks.visible())
      return Promise.reject(
        new Error("The terminal pane is no longer visible."),
      );
    if (this.online && this.ready) return Promise.resolve(this.inputGeneration);
    if (this.disconnected)
      return Promise.reject(
        new Error("The terminal is disconnected; wait for it to reconnect."),
      );
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        signal?.removeEventListener("abort", abort);
      };
      const waiter: ReadinessWaiter = {
        resolve: (generation) => {
          cleanup();
          resolve(generation);
        },
        reject: (failure) => {
          cleanup();
          reject(failure);
        },
      };
      const abort = () => waiter.reject(signal?.reason);
      const timer = setTimeout(
        () =>
          waiter.reject(
            new Error("The terminal did not become ready within 10 seconds."),
          ),
        COMMAND_READY_TIMEOUT_MS,
      );
      this.waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  isCommandReady(generation: number): boolean {
    return (
      !this.disposed &&
      this.online &&
      this.ready &&
      this.callbacks.visible() &&
      generation === this.inputGeneration
    );
  }

  assertCommandReady(generation: number) {
    if (!this.isCommandReady(generation))
      throw new Error(
        "The terminal connection changed before the command could be accepted.",
      );
  }

  async executeCommand(
    execute: (generation: number) => Promise<unknown> | void,
    signal?: AbortSignal,
  ): Promise<void> {
    let connectionGeneration = this.connectionGeneration;
    try {
      const generation = await this.waitUntilReady(signal);
      signal?.throwIfAborted();
      this.assertCommandReady(generation);
      // Readiness can resolve just before a replacement connection arrives.
      // Only accepted commands acquire that connection's error-reporting scope.
      connectionGeneration = this.connectionGeneration;
      await execute(generation);
    } catch (failure) {
      this.reportError(failure, connectionGeneration);
      throw failure;
    }
  }

  async sendCommand(
    send: () => Promise<unknown>,
    generation: number,
    completion: TerminalCommandCompletion = "settled",
  ) {
    this.assertCommandReady(generation);
    const sent = this.enqueueCompletion(send);
    if (!sent)
      throw new Error(
        "The terminal pane is no longer available for this command.",
      );
    if (completion === "settled") await sent;
  }

  enqueue(send: () => Promise<unknown>): boolean {
    return !!this.enqueueCompletion(send);
  }

  private enqueueCompletion(
    send: () => Promise<unknown>,
  ): Promise<void> | undefined {
    if (!this.online || !this.callbacks.visible() || this.disposed) return;
    const generation = this.inputGeneration;
    const connectionGeneration = this.connectionGeneration;
    const completion = this.inputQueue.then(async () => {
      if (
        this.disposed ||
        !this.online ||
        generation !== this.inputGeneration
      ) {
        throw new Error(
          "The terminal connection changed before queued input could be sent.",
        );
      }
      try {
        await send();
      } catch (failure) {
        if (
          !this.disposed &&
          connectionGeneration === this.connectionGeneration
        ) {
          const message = terminalErrorMessage(failure);
          if (
            /connection|socket|network|disconnected|closed|timed out|ECONN|EPIPE|transport|handshake|\bEOF\b/i.test(
              message,
            )
          )
            this.fail(failure);
          else {
            // A rejected action invalidates queued keys but leaves the transport up.
            this.inputGeneration++;
            this.reportError(failure);
          }
        }
        throw failure;
      }
    });
    // Browser input and acknowledged reverse-RPC paste report failures locally;
    // explicit callers retain the original rejection instead of this recovered tail.
    this.inputQueue = completion.catch(() => {});
    return completion;
  }

  readonly reportError = (
    failure: unknown,
    connectionGeneration = this.connectionGeneration,
  ) => {
    if (!this.disposed && connectionGeneration === this.connectionGeneration)
      this.callbacks.error(terminalErrorMessage(failure));
  };

  readonly fail = (failure: unknown) => {
    this.inputGeneration++;
    this.connectionGeneration++;
    this.online = false;
    this.ready = false;
    this.disconnected = true;
    this.rejectWaiters(terminalErrorMessage(failure));
    if (!this.disposed) {
      this.callbacks.connected(false);
      this.reportError(failure);
    }
  };

  hide() {
    // Hiding invalidates input admission, not an in-progress snapshot from the
    // same connection. Its completion may establish readiness for the next show.
    this.inputGeneration++;
    this.rejectWaiters(
      "The terminal pane was hidden before the command became ready.",
    );
  }

  dispose() {
    this.disposed = true;
    this.online = false;
    this.inputGeneration++;
    this.connectionGeneration++;
    this.rejectWaiters(
      "The terminal pane was hidden or closed before the command became ready.",
    );
  }

  private rejectWaiters(message: string) {
    for (const waiter of this.waiters) waiter.reject(new Error(message));
    this.waiters.clear();
  }
}
