import { Bot, X } from "lucide-react";
import { activityLabel } from "../core/workspace";
import type { WorkspaceOperations } from "../core/workspaceOperations";
import type { buildActivityFeed } from "../workspace/presentation";
interface ActivityPanelProps {
  items: ReturnType<typeof buildActivityFeed>;
  group: "session" | "priority";
  filterSidebar: boolean;
  onGroupChange(group: "session" | "priority"): void;
  onFilterChange(enabled: boolean): void;
  onSelect: WorkspaceOperations["select"];
  onClose(): void;
}
export function ActivityPanel({
  items,
  group,
  filterSidebar,
  onGroupChange,
  onFilterChange,
  onSelect,
  onClose,
}: ActivityPanelProps) {
  return (
    <aside className="activity-panel">
      <div className="activity-panel-heading">
        <h2>Program activity</h2>
        <button
          className="icon-button"
          aria-label="Close activity"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="activity-controls">
        <select
          aria-label="Group activity"
          className="form-select"
          value={group}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "session" || value === "priority")
              onGroupChange(value);
          }}
        >
          <option value="session">By session</option>
          <option value="priority">By priority</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={filterSidebar}
            onChange={(event) => onFilterChange(event.target.checked)}
          />
          Filter sidebar
        </label>
      </div>
      {items.length ? (
        items.map(({ host, session, window, pane, activity }) => (
          <button
            key={`${host.id}/${session.id}/${window.id}/${pane.id}/${activity.id}`}
            className={`activity-entry ${activity.state}`}
            onClick={() => {
              onSelect(host.id, session.id, window.id, pane.id);
              onClose();
            }}
          >
            <Bot size={17} />
            <span>
              <strong>{activity.app || pane.label}</strong>
              <small>{activityLabel(activity)}</small>
              <small>
                {session.label} · {host.label}
              </small>
            </span>
            <i className={`activity-status ${activity.state}`} />
          </button>
        ))
      ) : (
        <div className="activity-empty">
          Programs that report their status appear here while they work, finish
          or need your attention.
        </div>
      )}
    </aside>
  );
}
