import type { Terminal } from "@xterm/xterm";
import type { TerminalFrame } from "../shared/types";
import type { GraphicsPart } from "./kitty";
import type { TerminalRuntime } from "./runtime";

// Frames contain decoded strings, so this bound counts UTF-16 code units.
const MAX_PENDING_OUTPUT_LENGTH = 16 * 1024 * 1024;
const isSnapshot = (frame: TerminalFrame) =>
  !frame.kind || frame.kind === "snapshot";

interface QueuedFrame {
  frame: TerminalFrame;
  generation: number;
}
interface FrameWriterCallbacks {
  scrollOnOutput(): boolean;
  complete(frame: TerminalFrame, generation: number): void;
  error(failure: unknown, source: "frame" | "image"): void;
}

function currentSelection(term: Terminal) {
  const position = term.getSelectionPosition();
  return position && { position, text: term.getSelection() };
}
function restoreSelection(
  term: Terminal,
  previous: ReturnType<typeof currentSelection>,
) {
  if (!previous) return;
  const { start, end } = previous.position;
  const length = (end.y - start.y) * term.cols + end.x - start.x;
  if (start.y < 0 || end.y >= term.buffer.active.length || length < 0) return;
  term.select(start.x, start.y, length);
  if (term.getSelection() !== previous.text) term.clearSelection();
}

/** Owns the frame backlog and ordered xterm/Kitty writes for one mounted pane. */
export class TerminalFrameWriter {
  private disposed = false;
  private writing = false;
  private replaying = false;
  private pending: QueuedFrame[] = [];
  private pendingLength = 0;

  constructor(
    private runtime: TerminalRuntime,
    private callbacks: FrameWriterCallbacks,
  ) {
    runtime.requestCursorReset = this.flush;
  }

  get replayingSnapshot() {
    return this.replaying;
  }
  get hasPendingSnapshot() {
    return this.pending.some(({ frame }) => isSnapshot(frame));
  }

  /** A snapshot replaces queued output; an in-progress write always finishes first. */
  enqueue(frame: TerminalFrame, generation: number): boolean {
    if (this.disposed) return false;
    if (isSnapshot(frame)) this.clearPending();
    this.pending.push({ frame, generation });
    this.pendingLength += frame.data?.length ?? 0;
    // Initial snapshots may exceed the live-output bound: rejecting one would
    // reconnect forever to the same validated scrollback snapshot.
    if (
      frame.kind === "output" &&
      this.pendingLength > MAX_PENDING_OUTPUT_LENGTH
    ) {
      this.clearPending();
      return false;
    }
    this.flush();
    return true;
  }

  readonly flush = () => {
    if (this.disposed || this.writing) return;
    const { terminal: term, boundary } = this.runtime;
    if (this.runtime.cursorResetPending && boundary.ground) {
      this.runtime.cursorResetPending = false;
      this.writing = true;
      term.write("\x1b[0 q", () => {
        this.writing = false;
        this.flush();
      });
      return;
    }
    const next = this.pending.shift();
    if (!next) return;
    const { frame, generation } = next;
    this.pendingLength -= frame.data?.length ?? 0;
    const before = term.buffer.active;
    const atBottom = before.viewportY >= before.baseY;
    const previousScroll = before.viewportY;
    const snapshot = isSnapshot(frame);
    const selection = snapshot ? currentSelection(term) : undefined;
    if (
      frame.cols &&
      frame.rows &&
      (term.cols !== frame.cols || term.rows !== frame.rows)
    ) {
      term.resize(frame.cols, frame.rows);
    }
    this.replaying = snapshot;
    if (snapshot) {
      term.reset();
      boundary.reset();
      this.runtime.kitty.reset();
    }
    if (frame.data) boundary.push(frame.data);
    const complete = () => {
      this.writing = false;
      if (this.disposed) return;
      if (snapshot) restoreSelection(term, selection);
      this.replaying = false;
      if (!atBottom || !this.callbacks.scrollOnOutput())
        term.scrollToLine(previousScroll);
      this.callbacks.complete(frame, generation);
      this.flush();
    };
    this.writing = true;
    let parts: GraphicsPart[];
    try {
      parts = frame.data ? this.runtime.kitty.framer.push(frame.data) : [];
    } catch (failure) {
      this.callbacks.error(failure, "frame");
      complete();
      return;
    }
    this.writeParts(parts, 0, complete);
  };

  private writeParts(
    parts: GraphicsPart[],
    index: number,
    complete: () => void,
  ): void {
    if (this.disposed) return;
    const part = parts[index];
    if (!part) {
      complete();
      return;
    }
    const next = () => this.writeParts(parts, index + 1, complete);
    if (part.kind === "text") {
      this.runtime.terminal.write(part.data, next);
      return;
    }
    void this.runtime.kitty
      .command(part.data)
      .then((move) => {
        if (this.disposed) return;
        if (move) this.runtime.terminal.write(move, next);
        else next();
      })
      .catch((failure) => {
        if (this.disposed) return;
        this.callbacks.error(failure, "image");
        next();
      });
  }

  private clearPending() {
    this.pending = [];
    this.pendingLength = 0;
  }

  dispose() {
    this.disposed = true;
    this.replaying = false;
    this.clearPending();
    if (this.runtime.requestCursorReset === this.flush)
      this.runtime.requestCursorReset = undefined;
  }
}
