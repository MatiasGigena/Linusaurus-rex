import { useEffect, useRef, type RefObject } from "react";
import type {
  PaneDivider,
  RexPane,
  Selection,
  SessionView,
} from "../shared/types";
import {
  SupersededSessionInspectionError,
  type WorkspaceOperations,
} from "../core/workspaceOperations";

export type PaneGeometryOperations = Pick<
  WorkspaceOperations,
  "run"
> & {
  reloadSession(hostId: string, sessionId: string): Promise<SessionView>;
};

/** Pointer interactions for tiled split borders and floating layers. */
export function usePaneGeometry(
  workspaceElement: RefObject<HTMLDivElement | null>,
  ws: PaneGeometryOperations,
  safely: (action: () => Promise<unknown>) => void,
) {
  const stopInteraction = useRef<() => void>(() => {});
  useEffect(() => () => stopInteraction.current(), []);
  const resizeDivider = (
    event: React.PointerEvent,
    divider: PaneDivider,
    where: Selection,
  ) => {
    stopInteraction.current();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = workspaceElement.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    let latest = divider.ratio;
    let inFlight = false;
    let cancelled = false;
    const flush = () => {
      if (inFlight || cancelled) return;
      const sentRatio = latest;
      inFlight = true;
      safely(async () => {
        try {
          await window.rex.request("resizeDivider", {
            hostId: where.hostId,
            sessionId: where.sessionId,
            beforeBlockId: divider.beforeBlockId,
            afterBlockId: divider.afterBlockId,
            direction: divider.direction,
            ratio: sentRatio,
          });
          await ws
            .reloadSession(where.hostId, where.sessionId)
            .catch((failure) => {
              if (!(failure instanceof SupersededSessionInspectionError))
                throw failure;
            });
        } finally {
          inFlight = false;
          if (latest !== sentRatio) flush();
        }
      });
    };
    const move = (next: PointerEvent) => {
      const position =
        divider.direction === "horizontal"
          ? (next.clientX - bounds.left) / bounds.width
          : (next.clientY - bounds.top) / bounds.height;
      latest = Math.max(
        0.05,
        Math.min(
          0.95,
          (position -
            divider.rect[divider.direction === "horizontal" ? 0 : 1]) /
            divider.rect[divider.direction === "horizontal" ? 2 : 3],
        ),
      );
      flush();
    };
    const up = (next: PointerEvent) => {
      move(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    stopInteraction.current = () => {
      cancelled = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const resizeDividerByKey = (
    event: React.KeyboardEvent,
    divider: PaneDivider,
    where: Selection,
  ) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const ratio = Math.max(
      0.05,
      Math.min(
        0.95,
        divider.ratio +
          (["ArrowRight", "ArrowDown"].includes(event.key) ? 0.05 : -0.05),
      ),
    );
    safely(() =>
      ws.run(where.hostId, () =>
        window.rex.request("resizeDivider", {
          hostId: where.hostId,
          sessionId: where.sessionId,
          ...divider,
          ratio,
        }),
      ),
    );
  };
  const startFloatingPaneInteraction = (
    event: React.PointerEvent,
    pane: RexPane,
    where: Selection,
    mode: "move" | "resize",
  ) => {
    if (!pane.layerId || !workspaceElement.current) return;
    stopInteraction.current();
    const layerId = pane.layerId;
    const wrapper = event.currentTarget.closest<HTMLElement>(
      "[data-floating-block]",
    );
    event.preventDefault();
    const bounds = workspaceElement.current.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      rect: [...pane.rect] as typeof pane.rect,
    };
    let latest = [...pane.rect] as typeof pane.rect;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) / bounds.width;
      const dy = (next.clientY - start.y) / bounds.height;
      latest =
        mode === "resize"
          ? [
              start.rect[0],
              start.rect[1],
              Math.min(1 - start.rect[0], Math.max(0.15, start.rect[2] + dx)),
              Math.min(1 - start.rect[1], Math.max(0.15, start.rect[3] + dy)),
            ]
          : [
              Math.max(0, Math.min(1 - start.rect[2], start.rect[0] + dx)),
              Math.max(0, Math.min(1 - start.rect[3], start.rect[1] + dy)),
              start.rect[2],
              start.rect[3],
            ];
      if (wrapper)
        Object.assign(wrapper.style, {
          left: `${latest[0] * 100}%`,
          top: `${latest[1] * 100}%`,
          width: `${latest[2] * 100}%`,
          height: `${latest[3] * 100}%`,
        });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      safely(() =>
        ws.run(where.hostId, () =>
          window.rex.request("resizeLayer", {
            hostId: where.hostId,
            sessionId: where.sessionId,
            layerId,
            bounds: latest,
          }),
        ),
      );
    };
    stopInteraction.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  return { resizeDivider, resizeDividerByKey, startFloatingPaneInteraction };
}
