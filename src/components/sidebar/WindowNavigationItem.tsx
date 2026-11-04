import type { NavigationWindow, SidebarProps } from "../Sidebar";
import { ProgramIcon } from "../ProgramIcon";
import { activityLabel } from "../../core/workspace";
type Props = Pick<
  SidebarProps,
  | "settings"
  | "onSelect"
  | "onContextWindow"
  | "onCloseWindow"
  | "onReorderWindow"
> & {
  hostId: string;
  sessionId: string;
  window: NavigationWindow;
  selected: boolean;
};
export function WindowNavigationItem({
  hostId,
  sessionId,
  window,
  selected,
  ...props
}: Props) {
  return (
    <button
      key={window.id}
      type="button"
      className={`window-item ${selected ? "is-selected" : ""} ${window.activity ? `has-activity activity-${window.activity.state}` : ""}`}
      onClick={() => props.onSelect(hostId, sessionId, window.id)}
      aria-current={selected ? "page" : undefined}
      title={`${window.label}${window.activity ? ` · ${activityLabel(window.activity)}` : ""}`}
      onContextMenu={(event) => {
        if (props.onContextWindow) {
          event.preventDefault();
          props.onContextWindow(event, hostId, sessionId, window.id);
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          props.onCloseWindow?.(hostId, sessionId, window.id);
        }
      }}
      draggable
      onDragStart={(event) =>
        event.dataTransfer.setData(
          "application/x-rex-window",
          JSON.stringify({
            hostId: hostId,
            sessionId: sessionId,
            windowId: window.id,
          }),
        )
      }
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        try {
          const value: unknown = JSON.parse(
            event.dataTransfer.getData("application/x-rex-window"),
          );
          if (!value || typeof value !== "object" || Array.isArray(value))
            return;
          const source = value as Record<string, unknown>;
          if (
            typeof source.windowId === "string" &&
            source.hostId === hostId &&
            source.sessionId === sessionId &&
            source.windowId !== window.id
          )
            props.onReorderWindow?.(
              hostId,
              sessionId,
              source.windowId,
              window.id,
            );
        } catch {
          /* Ignore other application drag data. */
        }
      }}
    >
      {(props.settings?.tabIcons ?? 1) > 0 && (
        <span
          className={`terminal-glyph ${props.settings?.tabIconColors === "never" || (props.settings?.tabIconColors !== "always" && !selected) ? "monochrome" : ""}`}
        >
          <ProgramIcon program={window.program} />
        </span>
      )}
      <span className="window-label">
        {window.label || "Terminal"}
        {window.activity && props.settings?.notifications.showInTabs && (
          <small className={`activity-caption ${window.activity.state}`}>
            {activityLabel(window.activity)}
            {window.activity.progress !== undefined
              ? ` ${Math.round(window.activity.progress)}%`
              : ""}
          </small>
        )}
      </span>
      {window.activity && props.settings?.notifications.showInTabs ? (
        <span
          className={`activity-status ${window.activity.state}`}
          aria-label={activityLabel(window.activity)}
        />
      ) : (
        selected && <span className="window-live-dot" aria-hidden="true" />
      )}
      {(props.settings?.tabIcons ?? 1) > 1 &&
        window.icons
          ?.slice(1, props.settings?.tabIcons)
          .map((program, index) => (
            <span
              className={`extra-program-icon ${props.settings?.tabIconColors === "always" || (props.settings?.tabIconColors === "active-tab" && selected) ? "" : "monochrome"}`}
              key={index}
            >
              <ProgramIcon
                program={program}
                shellTheme={props.settings?.shellIconTheme}
              />
            </span>
          ))}
    </button>
  );
}
