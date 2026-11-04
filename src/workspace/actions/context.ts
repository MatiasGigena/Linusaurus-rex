import type { Dispatch, RefObject, SetStateAction } from "react";
import type { HostState, SessionViews } from "../../core/workspaceSnapshot";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import type { DialogActions } from "../dialogs";
import type {
  ClientEvent,
  KeymapResult,
  RexPane,
  RexWindow,
  Selection,
  SessionView,
  Settings,
  TerminalRef,
} from "../../shared/types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
export interface WorkspaceActionOptions {
  workspace: WorkspaceOperations;
  settings: Settings | undefined;
  hosts: HostState[];
  views: SessionViews;
  selection: Selection | undefined;
  keymaps: Partial<Record<string, KeymapResult>>;
  focusedPane: string | undefined;
  interfaceTheme: string | undefined;
  workspaceElement: RefObject<HTMLDivElement | null>;
  dialogs: DialogActions;
  /** Redispatch deferred actions through the current rendered executor. */
  executeCurrent: ResolvedCommand["execute"];
  setCollapsedSessions: StateSetter<Set<string>>;
  setActivityOnly: StateSetter<boolean>;
  setActivityOpen: StateSetter<boolean>;
  setActivityGroup: StateSetter<"session" | "priority">;
}
export interface ResolvedCommand {
  name: string;
  args: Record<string, unknown>;
  event?: ClientEvent;
  hostId: string;
  sourceHostId: string | undefined;
  sessionId: string;
  currentView: SessionView | undefined;
  currentWindow: RexWindow | undefined;
  blockId: string;
  terminalRef: TerminalRef;
  targetPane: RexPane | undefined;
  localCommand(command: string): Promise<void>;
  requirePane(): void;
  execute(
    name: string,
    args?: Record<string, unknown>,
    event?: ClientEvent,
  ): Promise<unknown>;
}
export const UNHANDLED = Symbol("unhandled workspace action");

export type SessionActionsTarget = Pick<
  ResolvedCommand,
  "name" | "args" | "hostId" | "sourceHostId" | "sessionId" | "currentView"
>;
export type SessionActionsDependencies = Pick<
  WorkspaceActionOptions,
  "hosts" | "dialogs" | "setCollapsedSessions"
> & {
  workspace: Pick<
    WorkspaceOperations,
    "mutateSession" | "select" | "mutateHostAndRefresh" | "refresh"
  >;
  requestClose: RequestClose;
};

export type TabActionsTarget = Pick<
  ResolvedCommand,
  | "name"
  | "args"
  | "event"
  | "hostId"
  | "sessionId"
  | "currentView"
  | "currentWindow"
  | "terminalRef"
  | "execute"
>;
export type TabActionsDependencies = Pick<WorkspaceActionOptions, "dialogs"> & {
  workspace: Pick<
    WorkspaceOperations,
    "mutateSession" | "mutateHostAndRefresh" | "select"
  >;
  requestClose: RequestClose;
};

export type PaneActionsTarget = Pick<
  ResolvedCommand,
  | "name"
  | "args"
  | "event"
  | "hostId"
  | "sessionId"
  | "currentWindow"
  | "blockId"
  | "terminalRef"
  | "targetPane"
  | "localCommand"
  | "requirePane"
  | "execute"
>;
export type PaneActionsDependencies = Pick<
  WorkspaceActionOptions,
  "dialogs"
> & {
  workspace: Pick<WorkspaceOperations, "mutateHostAndRefresh">;
  settings: Settings;
  requestClose: RequestClose;
};

export type PaneLayoutActionsTarget = Pick<
  ResolvedCommand,
  | "name"
  | "args"
  | "event"
  | "hostId"
  | "sessionId"
  | "currentWindow"
  | "blockId"
  | "terminalRef"
  | "targetPane"
  | "requirePane"
  | "execute"
>;
export type PaneLayoutActionsDependencies = Pick<
  WorkspaceActionOptions,
  "workspaceElement" | "dialogs"
> & {
  workspace: Pick<
    WorkspaceOperations,
    "mutateSession" | "focusPane" | "mutateHostAndRefresh" | "refresh"
  >;
  settings: Settings;
};

export type ClientActionsTarget = Pick<
  ResolvedCommand,
  "name" | "args" | "hostId" | "sourceHostId"
>;
export type ClientActionsDependencies = Pick<
  WorkspaceActionOptions,
  | "hosts"
  | "interfaceTheme"
  | "dialogs"
  | "setActivityOnly"
  | "setActivityOpen"
  | "setActivityGroup"
> & {
  workspace: Pick<
    WorkspaceOperations,
    | "mutateSession"
    | "select"
    | "mutateHostAndRefresh"
    | "dismissNotices"
    | "saveSettings"
    | "refresh"
  >;
  settings: Settings;
};

export type RequestClose = (
  hostId: string,
  title: string,
  description: string,
  action: () => Promise<unknown>,
) => Promise<void | { status: "confirmation_required" }>;
