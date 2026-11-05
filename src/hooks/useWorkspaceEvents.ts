import { useCallback, useEffect, useState } from "react";
import { paneKey } from "../core/workspace";
import type { PaneMetadata } from "../core/workspaceSnapshot";
import type { ClientEvent } from "../shared/types";

type WorkspaceEvent = Extract<
  ClientEvent,
  { type: "activity" | "keys" | "notification" }
>;

/** Transient presentation state; the workspace owns the event subscription. */
export function useWorkspaceEvents() {
  const [metadata, setMetadata] = useState<
    Partial<Record<string, PaneMetadata>>
  >({});
  const [keyHints, setKeyHints] =
    useState<Extract<ClientEvent, { type: "keys" }>>();
  const [notices, setNotices] = useState<
    Extract<ClientEvent, { type: "notification" }>[]
  >([]);

  const handleWorkspaceEvent = useCallback((event: WorkspaceEvent) => {
    if (event.type === "activity") {
      const key = paneKey(event.hostId, event.sessionId, event.blockId);
      setMetadata((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          activities: event.activities,
          ...(event.title !== undefined ? { title: event.title } : {}),
          ...(event.program !== undefined ? { program: event.program } : {}),
          ...(event.cwd !== undefined ? { cwd: event.cwd } : {}),
        },
      }));
    } else if (event.type === "keys") setKeyHints(event);
    else setNotices((previous) => [...previous.slice(-4), event]);
  }, []);

  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(
      () => setNotices((previous) => previous.slice(1)),
      8000,
    );
    return () => clearTimeout(timer);
  }, [notices]);

  return { metadata, keyHints, notices, setNotices, handleWorkspaceEvent };
}
