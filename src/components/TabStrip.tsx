import { Plus, X } from 'lucide-react';
import type { RexWindow, Settings } from '../shared/types';
import { activityLabel, primaryActivity } from '../core/workspace';
import { ProgramIcon } from './ProgramIcon';
export function TabStrip({
  windows,
  activeId,
  settings,
  onSelect,
  onClose,
  onNew,
  onContext,
  onReorder,
}: {
  windows: RexWindow[];
  activeId?: string;
  settings: Settings;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onContext(event: React.MouseEvent, id: string): void;
  onReorder(id: string, before?: string): void;
}) {
  return (
    <nav className={`tab-strip ${settings.fillTabs ? 'fill-tabs' : ''}`} aria-label="Terminal tabs">
      {windows.map((window) => {
        const selected = activeId === window.id;
        const panes = [...window.panes].sort(
          (a, b) => Number(b.id === window.focusedBlockId) - Number(a.id === window.focusedBlockId),
        );
        const activity = primaryActivity(
          window.panes
            .flatMap((pane) => pane.activities || [])
            .filter(
              (activity) =>
                activity.state === 'idle' ||
                (settings.notifications[activity.state] &&
                  settings.notifications.channels[activity.state].tabs),
            ),
        );
        return (
          <div
            key={window.id}
            className={`horizontal-tab ${selected ? 'is-selected' : ''}`}
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData('application/x-rex-window', window.id)
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('application/x-rex-window');
              if (id && id !== window.id) onReorder(id, window.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onContext(event, window.id);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(window.id);
              }
            }}
          >
            <button
              onClick={() => onSelect(window.id)}
              aria-current={selected ? 'page' : undefined}
              title={`${window.label}${activity ? ` · ${activityLabel(activity)}` : ''}`}
            >
              {panes.slice(0, settings.tabIcons).map((pane, index) => (
                <span
                  key={pane.id}
                  className={`horizontal-program-icon ${settings.tabIconColors === 'always' || (selected && (settings.tabIconColors === 'active-tab' || (settings.tabIconColors === 'active-pane' && index === 0))) ? '' : 'monochrome'}`}
                >
                  <ProgramIcon program={pane.program} size={14} />
                </span>
              ))}
              <span className="horizontal-tab-label">
                {window.label}
                {settings.notifications.showInTabs && activity && (
                  <small className={`activity-caption ${activity.state}`}>
                    {activityLabel(activity)}
                  </small>
                )}
              </span>
              {settings.notifications.showInTabs && activity && (
                <i className={`activity-status ${activity.state}`} />
              )}
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${window.label}`}
              onClick={() => onClose(window.id)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        className="icon-button"
        title="New terminal tab"
        aria-label="New terminal tab"
        onClick={onNew}
      >
        <Plus size={16} />
      </button>
    </nav>
  );
}
