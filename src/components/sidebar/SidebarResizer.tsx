import { useRef } from "react";
export function SidebarResizer({
  width,
  committedWidth,
  right,
  onResize,
  onResizeEnd,
}: {
  width?: number;
  committedWidth?: number;
  right: boolean;
  onResize?(width: number): void;
  onResizeEnd?(width: number): void;
}) {
  const resizing = useRef<
    { x: number; width: number; next: number } | undefined
  >(undefined);
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={190}
      aria-valuemax={500}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizing.current = {
          x: event.clientX,
          width: width || 278,
          next: width || 278,
        };
      }}
      onPointerMove={(event) => {
        const start = resizing.current;
        if (!start) return;
        start.next = Math.round(
          Math.max(
            190,
            Math.min(
              500,
              start.width + (event.clientX - start.x) * (right ? -1 : 1),
            ),
          ),
        );
        onResize?.(start.next);
      }}
      onPointerUp={(event) => {
        const start = resizing.current;
        if (!start) return;
        resizing.current = undefined;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onResizeEnd?.(start.next);
      }}
      onPointerCancel={() => {
        resizing.current = undefined;
        onResize?.(committedWidth || 278);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        onResizeEnd?.(
          Math.max(
            190,
            Math.min(
              500,
              (width || 278) +
                (event.key === "ArrowRight" ? 10 : -10) * (right ? -1 : 1),
            ),
          ),
        );
      }}
    />
  );
}
