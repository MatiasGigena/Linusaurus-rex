import type { Settings } from "../../shared/types";

export type NavigationPreferences = Pick<
  Settings,
  "sidebarWidth" | "tabStyle" | "tabIcons" | "tabIconColors" | "shellIconTheme"
> & {
  notifications: Pick<Settings["notifications"], "includeIdle" | "showInTabs">;
};

import type { SidebarProps } from "./Sidebar";
export type NavigationContext = Pick<
  SidebarProps,
  | "activeHostId"
  | "activeSessionId"
  | "activeWindowId"
  | "preferences"
  | "collapsedSessions"
  | "onToggleSession"
  | "onSelect"
  | "onNewSession"
  | "onNewWindow"
  | "onRenameSession"
  | "onContextSession"
  | "onContextWindow"
  | "onCloseWindow"
  | "onReorderWindow"
  | "activityOnly"
> & { filter: string };
