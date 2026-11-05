import { useEffect, useRef, type RefObject } from "react";
import type { RexWindow, Settings } from "../shared/types";
export function useWorkspaceGestures(
  workspaceElement: RefObject<HTMLDivElement | null>,
  settings:
    | Pick<
        Settings,
        "trackpadGestures" | "sidebarGesture" | "tabStyle" | "sidebarCollapsed"
      >
    | undefined,
  activeWindow: Pick<RexWindow, "id" | "zoomedBlockId"> | undefined,
  dispatch: (name: string) => void,
) {
  const gesture = useRef({ at: 0, handled: false, x: 0, y: 0 });
  const callback = useRef(dispatch);
  callback.current = dispatch;
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
        if (wantsZoom !== !!activeWindow?.zoomedBlockId)
          callback.current("pane.zoom");
      } else if (swipe && Math.abs(state.x) > 90) {
        state.handled = true;
        const wantsCollapsed =
          settings.tabStyle === "right" ? state.x < 0 : state.x > 0;
        if (wantsCollapsed !== settings.sidebarCollapsed)
          callback.current("client.sidebar.toggle");
      }
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => element.removeEventListener("wheel", wheel, { capture: true });
  }, [settings, activeWindow?.id, activeWindow?.zoomedBlockId]);
}
