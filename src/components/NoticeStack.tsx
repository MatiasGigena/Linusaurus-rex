import { X } from "lucide-react";
import type { ClientEvent, Settings } from "../shared/types";
import type { WorkspaceOperations } from "../core/workspaceOperations";
type Notice = Extract<ClientEvent, { type: "notification" }>;
export function NoticeStack({
  notices,
  position,
  onSelect,
  onDismiss,
}: {
  notices: Notice[];
  position: Settings["notifications"]["position"];
  onSelect: WorkspaceOperations["select"];
  onDismiss(id: string): void;
}) {
  return (
    <div className={`notice-stack ${position}`}>
      {notices.map((notice) => (
        <div className={`program-notice ${notice.kind}`} key={notice.id}>
          <button
            className="notice-content"
            onClick={() => {
              if (notice.sessionId)
                onSelect(
                  notice.hostId,
                  notice.sessionId,
                  notice.windowId,
                  notice.blockId,
                );
              onDismiss(notice.id);
            }}
          >
            <strong>{notice.title}</strong>
            <span>{notice.body}</span>
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notice.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
