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
  keymaps: Record<string, KeymapResult>;
  focusedPane: string | undefined;
  interfaceTheme: string | undefined;
  workspaceElement: RefObject<HTMLDivElement | null>;
  dialogs: DialogActions;
  setCollapsedSessions: StateSetter<Set<string>>;
  setActivityOnly: StateSetter<boolean>;
  setActivityOpen: StateSetter<boolean>;
  setActivityGroup: StateSetter<"session" | "priority">;
  onError(message: string): void;
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
    "mutateSession" | "select" | "run" | "refresh"
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
    "mutateSession" | "run" | "select"
  >;
  requestClose: RequestClose;
};

export type PaneActionsTarget = Pick<
  ResolvedCommand,
  | "name"
  | "args"
  | "hostId"
  | "sessionId"
  | "currentWindow"
  | "blockId"
  | "terminalRef"
  | "targetPane"
  | "localCommand"
  | "requirePane"
>;
export type PaneActionsDependencies = Pick<
  WorkspaceActionOptions,
  "dialogs"
> & {
  workspace: Pick<WorkspaceOperations, "run">;
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
    "mutateSession" | "focusPane" | "run" | "refresh"
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
    | "run"
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
) => void;
