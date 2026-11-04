import type { Settings, TerminalRef } from "../shared/types";
import type { TerminalRuntime } from "./runtime";
import {
  isCompositionKey,
  isNativeText,
  keyboardPayload,
  keyModifiers,
  pointerCell,
} from "./keys";

export interface TerminalMenu {
  x: number;
  y: number;
  selection: boolean;
}
interface TerminalInputOptions {
  runtime: TerminalRuntime;
  hostElement: HTMLElement;
  ref: TerminalRef;
  settings(): Settings;
  isVisible(): boolean;
  isOnline(): boolean;
  isFocused(): boolean;
  isReplayingSnapshot(): boolean;
  enqueue(send: () => Promise<unknown>): boolean;
  paste(text?: string): Promise<void>;
  onFocus(): void;
  onCopied(): void;
  onError(failure: unknown): void;
  onMenu(menu: TerminalMenu): void;
}

/** Browser input owns its listeners and transient state; transport owns send readiness. */
export function registerTerminalInput(options: TerminalInputOptions) {
  const keyboard = registerKeyboard(options);
  const pointer = registerPointer(options);
  const clipboard = registerClipboard(options);
  return {
    copy: clipboard.copy,
    reset() {
      keyboard.reset();
      pointer.reset();
    },
    dispose() {
      keyboard.dispose();
      pointer.dispose();
      clipboard.dispose();
    },
  };
}

function registerKeyboard(options: TerminalInputOptions) {
  const { runtime, hostElement, ref, settings, isVisible, isOnline, enqueue } =
    options;
  const term = runtime.terminal;
  let composing = false,
    deadKey = false,
    nativeTextUntil = 0;
  let layout: ReadonlyMap<string, string> | undefined;
  const pressedKeys = new Set<string>();
  const dataListener = term.onData((data) => {
    // Rex's Ghostty already answered terminal queries. Only native IME/dead-key
    // text enters this path; keys, paste, mouse and focus use typed events.
    if (
      isNativeText(data) &&
      (composing || performance.now() < nativeTextUntil)
    )
      enqueue(() => window.rex.request("input", { ...ref, data }));
  });
  term.attachCustomKeyEventHandler((event) => {
    if (event.defaultPrevented || !isVisible() || !isOnline()) return false;
    if (isCompositionKey(event) || composing || deadKey) {
      nativeTextUntil = performance.now() + 1500;
      if (event.key === "Dead") deadKey = true;
      else if (event.type === "keyup") deadKey = false;
      return true;
    }
    if (event.type === "keypress") return false;
    const payload = keyboardPayload(event, layout);
    if (!payload) return true;
    if (event.type === "keyup") {
      if (!pressedKeys.delete(event.code)) return false;
    } else pressedKeys.add(event.code);
    event.preventDefault();
    enqueue(() => window.rex.request("key", { ...ref, event: payload }));
    if (settings().scrollOnOutput && event.type === "keydown")
      term.scrollToBottom();
    return false;
  });
  const compositionStart = () => {
    composing = true;
    nativeTextUntil = performance.now() + 1500;
  };
  const compositionEnd = () => {
    composing = false;
    nativeTextUntil = performance.now() + 250;
  };
  const beforeInput = (event: InputEvent) => {
    if (event.isComposing || event.inputType.startsWith("insertComposition"))
      nativeTextUntil = performance.now() + 1500;
  };
  const focusIn = () =>
    enqueue(() => window.rex.request("focusEvent", { ...ref, focused: true }));
  const focusOut = () => {
    pressedKeys.clear();
    enqueue(() => window.rex.request("focusEvent", { ...ref, focused: false }));
  };
  hostElement.addEventListener("compositionstart", compositionStart, true);
  hostElement.addEventListener("compositionend", compositionEnd, true);
  hostElement.addEventListener(
    "beforeinput",
    beforeInput as EventListener,
    true,
  );
  hostElement.addEventListener("focusin", focusIn);
  hostElement.addEventListener("focusout", focusOut);

  const navigatorWithKeyboard = navigator as Navigator & {
    keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> };
  };
  let disposed = false;
  void navigatorWithKeyboard.keyboard
    ?.getLayoutMap()
    .then((value) => {
      if (!disposed) layout = value;
    })
    .catch(() => {});
  const reset = () => {
    pressedKeys.clear();
    composing = false;
    deadKey = false;
    nativeTextUntil = 0;
  };
  return {
    reset,
    dispose() {
      disposed = true;
      reset();
      dataListener.dispose();
      term.attachCustomKeyEventHandler(() => false);
      hostElement.removeEventListener(
        "compositionstart",
        compositionStart,
        true,
      );
      hostElement.removeEventListener("compositionend", compositionEnd, true);
      hostElement.removeEventListener(
        "beforeinput",
        beforeInput as EventListener,
        true,
      );
      hostElement.removeEventListener("focusin", focusIn);
      hostElement.removeEventListener("focusout", focusOut);
    },
  };
}

function registerPointer(options: TerminalInputOptions) {
  const {
    runtime,
    hostElement,
    ref,
    settings,
    isVisible,
    isOnline,
    isFocused,
    enqueue,
    onFocus,
    onMenu,
  } = options;
  const term = runtime.terminal;
  let motionAnimation = 0,
    wheelRemainder = 0;
  let pendingMotion: (() => void) | undefined;
  let pointerButton: "left" | "middle" | "right" | undefined;
  let selectionAnchor: number | undefined;
  let lastMouseCell = "";
  const screen = runtime.element.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) throw new Error("The terminal screen is not mounted.");
  const cellAt = (event: MouseEvent) =>
    pointerCell(
      event.clientX,
      event.clientY,
      screen.getBoundingClientRect(),
      term.cols,
      term.rows,
    );
  const tracking = () => term.modes.mouseTrackingMode !== "none";
  const sendMouse = (
    event: MouseEvent,
    action: "press" | "motion" | "release",
    button?: "left" | "middle" | "right",
  ) => {
    const cell = cellAt(event),
      signature = `${cell.x}/${cell.y}/${button || ""}`;
    if (action === "motion" && lastMouseCell === signature) return;
    lastMouseCell = signature;
    enqueue(() =>
      window.rex.request("mouse", {
        ...ref,
        event: {
          action,
          ...(button ? { button } : {}),
          ...cell,
          mods: keyModifiers(event, false),
        },
      }),
    );
  };
  const stopMouse = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const mouseDown = (event: MouseEvent) => {
    if (!isVisible()) return;
    if (
      event.button === 2 &&
      !(event.shiftKey && tracking() && settings().mouseReporting)
    ) {
      stopMouse(event);
      return;
    }
    if (!tracking() || (event.button === 0 && event.shiftKey)) return;
    if (!settings().mouseReporting && event.button === 0) {
      const at = cellAt(event);
      selectionAnchor =
        (term.buffer.active.viewportY + at.y) * term.cols + at.x;
      term.clearSelection();
      stopMouse(event);
      return;
    }
    if (!settings().mouseReporting || !isOnline()) return;
    pointerButton =
      event.button === 0 ? "left" : event.button === 1 ? "middle" : "right";
    term.clearSelection();
    sendMouse(event, "press", pointerButton);
    stopMouse(event);
  };
  const mouseMove = (event: MouseEvent) => {
    if (!isVisible()) return;
    if (selectionAnchor !== undefined) {
      const at = cellAt(event),
        end = (term.buffer.active.viewportY + at.y) * term.cols + at.x,
        start = Math.min(selectionAnchor, end);
      term.select(
        start % term.cols,
        Math.floor(start / term.cols),
        Math.abs(selectionAnchor - end) + 1,
      );
      stopMouse(event);
      return;
    }
    const inside = screen.contains(event.target as Node);
    if (
      !pointerButton &&
      (!inside ||
        !isFocused() ||
        term.modes.mouseTrackingMode !== "any" ||
        event.shiftKey)
    )
      return;
    if (!settings().mouseReporting || !isOnline() || !tracking()) return;
    pendingMotion = () => sendMouse(event, "motion", pointerButton);
    if (!motionAnimation)
      motionAnimation = requestAnimationFrame(() => {
        motionAnimation = 0;
        pendingMotion?.();
        pendingMotion = undefined;
      });
    if (pointerButton) stopMouse(event);
  };
  const mouseUp = (event: MouseEvent) => {
    if (selectionAnchor !== undefined) {
      selectionAnchor = undefined;
      stopMouse(event);
      return;
    }
    if (!pointerButton) return;
    cancelAnimationFrame(motionAnimation);
    motionAnimation = 0;
    pendingMotion?.();
    pendingMotion = undefined;
    sendMouse(event, "release", pointerButton);
    pointerButton = undefined;
    stopMouse(event);
  };
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && tracking() && settings().mouseReporting && isOnline())
      return;
    onFocus();
    onMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 410)),
      selection: term.hasSelection(),
    });
  };
  const wheel = (event: WheelEvent) => {
    if (!isVisible()) return;
    if (
      settings().mouseReporting &&
      tracking() &&
      !event.shiftKey &&
      isOnline()
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const lineHeight = screen.clientHeight / Math.max(1, term.rows);
      wheelRemainder +=
        (event.deltaY *
          (event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? lineHeight
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? screen.clientHeight
              : 1)) /
        lineHeight;
      const lines = Math.trunc(wheelRemainder);
      wheelRemainder -= lines;
      const cell = cellAt(event);
      for (let i = 0; i < Math.min(Math.abs(lines), 8); i++)
        enqueue(() =>
          window.rex.request("wheel", {
            ...ref,
            event: { ...cell, delta_x: 0, delta_y: Math.sign(lines) },
          }),
        );
    } else if (tracking()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const lines =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY
          : event.deltaY / (screen.clientHeight / Math.max(1, term.rows));
      term.scrollLines(
        Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines))),
      );
    }
  };
  hostElement.addEventListener("mousedown", mouseDown, true);
  window.addEventListener("mousemove", mouseMove, true);
  window.addEventListener("mouseup", mouseUp, true);
  hostElement.addEventListener("contextmenu", contextMenu);
  hostElement.addEventListener("wheel", wheel, {
    capture: true,
    passive: false,
  });

  const reset = () => {
    cancelAnimationFrame(motionAnimation);
    motionAnimation = 0;
    pendingMotion = undefined;
    pointerButton = undefined;
    selectionAnchor = undefined;
    lastMouseCell = "";
    wheelRemainder = 0;
  };
  return {
    reset,
    dispose() {
      reset();
      hostElement.removeEventListener("mousedown", mouseDown, true);
      window.removeEventListener("mousemove", mouseMove, true);
      window.removeEventListener("mouseup", mouseUp, true);
      hostElement.removeEventListener("contextmenu", contextMenu);
      hostElement.removeEventListener("wheel", wheel, true);
    },
  };
}

function registerClipboard(options: TerminalInputOptions) {
  const {
    runtime,
    hostElement,
    settings,
    isVisible,
    isReplayingSnapshot,
    paste,
    onCopied,
    onError,
  } = options;
  const term = runtime.terminal;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const copy = () => {
    if (term.hasSelection())
      void window.rex
        .writeClipboard(term.getSelection())
        .then(() => {
          if (!disposed) onCopied();
        })
        .catch(onError);
  };
  const clipboardPaste = (event: ClipboardEvent) => {
    if (!isVisible()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void paste(
      event.clipboardData?.types.includes("text/plain")
        ? event.clipboardData.getData("text/plain")
        : undefined,
    ).catch(onError);
  };
  const selectionListener = term.onSelectionChange(() => {
    clearTimeout(copyTimer);
    if (
      !isReplayingSnapshot() &&
      settings().copyOnSelect &&
      term.hasSelection()
    )
      copyTimer = setTimeout(copy, 150);
  });

  hostElement.addEventListener("paste", clipboardPaste, true);
  return {
    copy,
    dispose() {
      disposed = true;
      clearTimeout(copyTimer);
      selectionListener.dispose();
      hostElement.removeEventListener("paste", clipboardPaste, true);
    },
  };
}
