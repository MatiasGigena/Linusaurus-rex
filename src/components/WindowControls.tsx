import { Minus, Square, X } from "lucide-react";
import { IconButton } from "./IconButton";

export type WindowControlAction = "minimize" | "maximize" | "close";

export interface WindowControlsProps {
  onWindowControl: (action: WindowControlAction) => void;
  /** `traffic` draws macOS-style close/minimize/zoom lights; `linux` keeps the icon buttons. */
  variant: "traffic" | "linux";
}

export function WindowControls({
  onWindowControl,
  variant,
}: WindowControlsProps) {
  if (variant === "traffic")
    return (
      <div
        className="traffic-lights"
        role="group"
        aria-label="Application window controls"
      >
        <button
          type="button"
          className="traffic-light traffic-close"
          aria-label="Close application"
          title="Close"
          onClick={() => onWindowControl("close")}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1.75 1.75l4.5 4.5M6.25 1.75l-4.5 4.5" />
          </svg>
        </button>
        <button
          type="button"
          className="traffic-light traffic-minimize"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => onWindowControl("minimize")}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1.25 4h5.5" />
          </svg>
        </button>
        <button
          type="button"
          className="traffic-light traffic-zoom"
          aria-label="Maximize or restore window"
          title="Zoom"
          onClick={() => onWindowControl("maximize")}
        >
          <svg viewBox="0 0 8 8" aria-hidden="true">
            <path d="M4 1.25v5.5M1.25 4h5.5" />
          </svg>
        </button>
      </div>
    );
  return (
    <div
      className="window-controls"
      role="group"
      aria-label="Application window controls"
    >
      <IconButton
        label="Minimize window"
        onClick={() => onWindowControl("minimize")}
      >
        <Minus size={14} />
      </IconButton>
      <IconButton
        label="Maximize or restore window"
        onClick={() => onWindowControl("maximize")}
      >
        <Square size={11} />
      </IconButton>
      <IconButton
        label="Close application"
        onClick={() => onWindowControl("close")}
        className="window-close"
      >
        <X size={16} />
      </IconButton>
    </div>
  );
}
