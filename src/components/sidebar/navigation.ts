import type { SidebarProps } from "../Sidebar";
export type NavigationContext = Pick<
  SidebarProps,
  | "activeHostId"
  | "activeSessionId"
  | "activeWindowId"
  | "settings"
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
