import type { Settings, TerminalFrame, TerminalRef } from "../shared/types";
import type { TerminalRuntime } from "./runtime";

interface ViewportOptions {
  runtime: TerminalRuntime;
  hostElement: HTMLElement;
  ref: TerminalRef;
  settings(): Settings;
  visible(): boolean;
  onError(failure: unknown): void;
}

/** One mounted viewport owns fitting, resize publication and browser listeners. */
export function registerTerminalViewport(options: ViewportOptions) {
  const { runtime, hostElement, ref } = options;
  const term = runtime.terminal;
  let disposed = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeAnimation = 0;
  let lastSize = "";
  let resizeRevision = 0;
  const canMeasure = () =>
    !disposed &&
    options.visible() &&
    document.hasFocus() &&
    hostElement.isConnected &&
    hostElement.clientWidth > 0 &&
    hostElement.clientHeight > 0;
  const publishSize = () => {
    const size = `${term.cols}/${term.rows}`;
    if (size === lastSize) return;
    lastSize = size;
    const revision = ++resizeRevision;
    void window.rex
      .request("resize", { ...ref, cols: term.cols, rows: term.rows })
      .catch((failure: unknown) => {
        if (disposed || revision !== resizeRevision) return;
        lastSize = "";
        options.onError(failure);
      });
  };
  const schedule = () => {
    if (!canMeasure()) return;
    if (options.settings().smoothResize) runtime.fit.fit();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (!canMeasure()) return;
      if (!options.settings().smoothResize) runtime.fit.fit();
      publishSize();
    }, 100);
  };
  const refresh = () => {
    lastSize = "";
    schedule();
  };
  const visibility = () => {
    if (!document.hidden && options.visible()) refresh();
  };
  const focus = () => {
    if (options.visible()) refresh();
  };
  const cancelPending = () => {
    clearTimeout(resizeTimer);
    resizeTimer = undefined;
    cancelAnimationFrame(resizeAnimation);
    resizeAnimation = 0;
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(hostElement);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", focus);
  return {
    start: schedule,
    frameComplete(frame: TerminalFrame) {
      if (disposed) return;
      const snapshot = !frame.kind || frame.kind === "snapshot";
      if (!snapshot && frame.kind !== "resize") return;
      if (snapshot) lastSize = "";
      cancelAnimationFrame(resizeAnimation);
      resizeAnimation = requestAnimationFrame(() => {
        resizeAnimation = 0;
        schedule();
      });
    },
    visibilityChanged(show: boolean) {
      if (disposed) return;
      if (show) refresh();
      else {
        resizeRevision++;
        cancelPending();
        void window.rex.request("releaseViewport", ref).catch(() => {});
      }
    },
    settingsChanged() {
      if (!canMeasure()) return;
      // Font and padding changes must fit immediately, even in debounced mode.
      runtime.fit.fit();
      lastSize = "";
      publishSize();
    },
    dispose() {
      disposed = true;
      cancelPending();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
    },
  };
}
