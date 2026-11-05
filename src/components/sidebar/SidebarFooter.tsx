import { useState } from "react";
import {
  Plus,
  ChevronDown,
  Server,
  Eye,
  FolderPlus,
  Command,
  Settings2,
} from "lucide-react";
import type { SidebarProps } from "./Sidebar";
import { IconButton } from "../IconButton";
import { ContextMenu, type ContextItem } from "../ContextMenu";
export function SidebarFooter(
  props: Pick<
    SidebarProps,
    | "hosts"
    | "activeHostId"
    | "compactFooter"
    | "onNewSession"
    | "onActivity"
    | "activityOnly"
    | "activityCount"
    | "onAddHost"
    | "onPalette"
    | "onSettings"
  >,
) {
  const [newMenu, setNewMenu] = useState<{ x: number; y: number }>();
  const activeHost = props.hosts.find((host) => host.id === props.activeHostId);
  return props.compactFooter ? (
    <div className="sidebar-bottom sidebar-bottom-compact">
      <div className="new-session-split" role="group" aria-label="New">
        <button
          type="button"
          className="new-workspace-button"
          title="New session (Ctrl Shift N)"
          onClick={() =>
            props.onNewSession(
              props.activeHostId ?? props.hosts[0]?.id ?? "local",
            )
          }
        >
          <Plus size={16} />
          <span>New session</span>
        </button>
        <IconButton
          label="More options"
          className="new-session-more"
          aria-haspopup="menu"
          aria-expanded={!!newMenu}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setNewMenu({ x: rect.left, y: rect.top });
          }}
        >
          <ChevronDown size={14} />
        </IconButton>
      </div>
      {!!props.activityCount && props.onActivity && (
        <button
          type="button"
          className={`sidebar-activity ${props.activityOnly ? "is-active" : ""}`}
          onClick={props.onActivity}
          aria-pressed={!!props.activityOnly}
          title="Program activity"
        >
          <span className="activity-status working" aria-hidden="true" />
          {props.activityCount} active
        </button>
      )}
      {activeHost && !activeHost.connected && (
        <span className="server-status">
          <span className="status-dot offline" />
          Rex disconnected
        </span>
      )}
      {newMenu && (
        <ContextMenu
          x={newMenu.x}
          y={newMenu.y}
          onClose={() => setNewMenu(undefined)}
          items={[
            ...(props.hosts.length > 1
              ? props.hosts.map((host): ContextItem => ({
                  label: `New session on ${host.label}`,
                  icon: <Plus size={14} />,
                  run: () => props.onNewSession(host.id),
                }))
              : []),
            props.hosts.length > 1 ? null : undefined,
            props.onAddHost
              ? {
                  label: "Add host…",
                  icon: <Server size={14} />,
                  run: props.onAddHost,
                }
              : undefined,
            props.onActivity
              ? {
                  label: "Program activity",
                  icon: <Eye size={14} />,
                  run: props.onActivity,
                }
              : undefined,
          ].filter((item): item is ContextItem | null => item !== undefined)}
        />
      )}
    </div>
  ) : (
    <div className="sidebar-bottom">
      <button
        type="button"
        className="new-workspace-button"
        onClick={() =>
          props.onNewSession(
            props.activeHostId ?? props.hosts[0]?.id ?? "local",
          )
        }
      >
        <FolderPlus size={16} />
        <span>New session</span>
        <kbd>Ctrl Shift N</kbd>
      </button>
      <div className="sidebar-footer">
        <span className="server-status">
          <span
            className={`status-dot ${activeHost?.connected ? "online" : "offline"}`}
          />
          {activeHost?.connected ? "Rex connected" : "Rex disconnected"}
        </span>
        <div className="footer-actions">
          {props.onActivity && (
            <IconButton
              label="Program activity"
              onClick={props.onActivity}
              active={props.activityOnly}
            >
              <Eye size={16} />
            </IconButton>
          )}
          {props.onAddHost && (
            <IconButton label="Add host" onClick={props.onAddHost}>
              <Server size={15} />
            </IconButton>
          )}
          <IconButton
            label="Command palette"
            shortcut="Ctrl Shift P"
            onClick={props.onPalette}
          >
            <Command size={16} />
          </IconButton>
          <IconButton label="Settings" onClick={props.onSettings}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </div>
      <div className="sidebar-build">
        <span>LINUSAURUS REX</span>
        <span>Independent Linux client</span>
      </div>
    </div>
  );
}
