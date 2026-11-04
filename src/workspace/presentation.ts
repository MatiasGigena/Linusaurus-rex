import type { NavigationHost } from "../components/sidebar/Sidebar";
import type { HostState, SessionViews } from "../core/workspaceSnapshot";
import type { PaneMetadata } from "../core/workspaceSnapshot";
import type { RexWindow, Settings } from "../shared/types";
import {
  paneKey,
  viewKey,
  primaryActivity,
  windowTitle,
} from "../core/workspace";

type Metadata = Partial<Record<string, PaneMetadata>>;
export function enrichWindow(
  hostId: string,
  sessionId: string,
  window: RexWindow,
  metadata: Metadata,
): RexWindow {
  return {
    ...window,
    panes: window.panes.map((pane) => ({
      ...pane,
      ...metadata[paneKey(hostId, sessionId, pane.id)],
    })),
  };
}
export function buildNavigationHosts(
  hosts: HostState[],
  views: SessionViews,
  metadata: Metadata,
  settings: Settings | undefined,
): NavigationHost[] {
  return hosts.map((host) => ({
    ...host,
    sessions: host.sessions.map((session) => ({
      ...session,
      windows: (views[viewKey(host.id, session.id)]?.windows || []).map(
        (raw) => {
          const window = enrichWindow(host.id, session.id, raw, metadata);
          const focused =
            window.panes.find((pane) => pane.id === window.focusedBlockId) ||
            window.panes[0];
          return {
            id: window.id,
            label: windowTitle(
              window,
              settings?.preferGeneratedTitles || false,
            ),
            activity: primaryActivity(
              window.panes
                .flatMap((pane) => pane.activities || [])
                .filter(
                  (activity) =>
                    activity.state === "idle" ||
                    (settings?.notifications[activity.state] &&
                      settings.notifications.channels[activity.state].tabs),
                ),
            ),
            program:
              metadata[paneKey(host.id, session.id, focused?.id || "")]
                ?.program,
            icons: window.panes.map(
              (pane) =>
                metadata[paneKey(host.id, session.id, pane.id)]?.program ||
                "shell",
            ),
          };
        },
      ),
    })),
  }));
}

export function buildActivityFeed(
  hosts: HostState[],
  views: SessionViews,
  metadata: Metadata,
  settings: Settings | undefined,
  activityGroup: "session" | "priority",
) {
  const individualActivities = hosts.flatMap((host) =>
    host.sessions.flatMap((session) =>
      (views[viewKey(host.id, session.id)]?.windows || []).flatMap((window) =>
        window.panes.flatMap((pane) =>
          (metadata[paneKey(host.id, session.id, pane.id)]?.activities || [])
            .filter(
              (activity) =>
                settings?.notifications.includeIdle ||
                activity.state !== "idle",
            )
            .map((activity) => ({ host, session, window, pane, activity })),
        ),
      ),
    ),
  );
  const groupedActivities = new Map<
    string,
    (typeof individualActivities)[number]
  >();
  for (const item of individualActivities) {
    const key = `${item.host.id}/${item.window.id}`;
    const previous = groupedActivities.get(key);
    if (
      !previous ||
      primaryActivity([previous.activity, item.activity]) === item.activity
    )
      groupedActivities.set(key, item);
  }
  const allActivities = settings?.notifications.eachProcess
    ? individualActivities
    : [...groupedActivities.values()];
  if (activityGroup === "priority")
    allActivities.sort(
      (a, b) =>
        ({ blocked: 0, error: 1, done: 2, working: 3, idle: 4 })[
          a.activity.state
        ] -
        { blocked: 0, error: 1, done: 2, working: 3, idle: 4 }[
          b.activity.state
        ],
    );

  return allActivities;
}
