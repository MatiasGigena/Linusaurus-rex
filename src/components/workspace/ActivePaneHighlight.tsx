import { useEffect, useRef, useState } from "react";
import type { PaneRect } from "../../shared/types";

export function ActivePaneHighlight({
  rect,
  animation,
  inset = 0,
}: {
  rect?: PaneRect;
  animation: "fade" | "move" | "instant";
  inset?: number;
}) {
  const [position, setPosition] = useState(rect);
  const [visible, setVisible] = useState(Boolean(rect));
  const positioned = useRef(Boolean(rect));
  useEffect(() => {
    if (!rect) {
      setVisible(false);
      return;
    }
    if (animation !== "fade" || !positioned.current) {
      setPosition(rect);
      setVisible(true);
      positioned.current = true;
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => {
      setPosition(rect);
      setVisible(true);
    }, 85);
    return () => window.clearTimeout(timer);
  }, [rect?.[0], rect?.[1], rect?.[2], rect?.[3], animation]);
  if (!position) return null;
  return (
    <div
      aria-hidden="true"
      className={`active-pane-highlight highlight-${animation}`}
      data-visible={visible}
      style={{
        left: `calc(${position[0] * 100}% + ${inset}px)`,
        top: `calc(${position[1] * 100}% + ${inset}px)`,
        width: `calc(${position[2] * 100}% - ${inset * 2}px)`,
        height: `calc(${position[3] * 100}% - ${inset * 2}px)`,
      }}
    />
  );
}
