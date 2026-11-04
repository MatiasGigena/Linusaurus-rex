import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SettingsTab } from "../../components/preferences/types";
import type { HostState } from "../../core/workspaceSnapshot";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import type {
  ClientEvent,
  KeymapResult,
  Host,
  RexPane,
  RexWindow,
  Selection,
  SessionView,
  Settings,
  TerminalRef,
} from "../../shared/types";

export interface FormField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}
export interface Form {
  title: string;
  description: string;
  fields: FormField[];
  submit(values: Record<string, string>): Promise<void>;
}
export interface Confirmation {
  title: string;
  description: string;
  label?: string;
  submit(): Promise<void>;
}
type StateSetter<T> = Dispatch<SetStateAction<T>>;
export interface WorkspaceActionOptions {
  workspace: WorkspaceOperations;
  settings: Settings | undefined;
  hosts: HostState[];
  views: Record<string, SessionView>;
  selection: Selection | undefined;
  keymaps: Record<string, KeymapResult>;
  focusedPane: string | undefined;
  interfaceTheme: string | undefined;
  workspaceElement: RefObject<HTMLDivElement | null>;
  setPalette: StateSetter<"all" | "sessions" | undefined>;
  setSettingsTab: StateSetter<SettingsTab | undefined>;
  setDiagnostics: StateSetter<boolean>;
  setPairing: StateSetter<boolean>;
  setEditingHost: StateSetter<Host | null | undefined>;
  setConfirmation: StateSetter<Confirmation | undefined>;
  setForm: StateSetter<Form | undefined>;
  setCollapsedSessions: StateSetter<Set<string>>;
  setActivityOnly: StateSetter<boolean>;
  setActivityOpen: StateSetter<boolean>;
  setActivityGroup: StateSetter<"session" | "priority">;
  setDirectoryBrowser: StateSetter<
    { mode: "insert" | "directory"; ref: TerminalRef } | undefined
  >;
  setReport: StateSetter<{ title: string; body: string } | undefined>;
  onError(message: string): void;
}
export interface ResolvedCommand {
  name: string;
  args: Record<string, unknown>;
  event?: ClientEvent;
  hostId: string;
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
  "name" | "args" | "hostId" | "sessionId" | "currentView"
>;
export type SessionActionsDependencies = Pick<
  WorkspaceActionOptions,
  "hosts" | "setPalette" | "setForm" | "setCollapsedSessions"
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
export type TabActionsDependencies = Pick<WorkspaceActionOptions, "setForm"> & {
  workspace: Pick<WorkspaceOperations, "mutateSession" | "run" | "select">;
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
  "setConfirmation" | "setForm" | "setDirectoryBrowser" | "setReport"
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
  "workspaceElement" | "setForm"
> & {
  workspace: Pick<
    WorkspaceOperations,
    "mutateSession" | "focusPane" | "run" | "refresh"
  >;
  settings: Settings;
};

export type ClientActionsTarget = Pick<
  ResolvedCommand,
  "name" | "args" | "hostId"
>;
export type ClientActionsDependencies = Pick<
  WorkspaceActionOptions,
  | "hosts"
  | "interfaceTheme"
  | "setPalette"
  | "setSettingsTab"
  | "setDiagnostics"
  | "setPairing"
  | "setEditingHost"
  | "setConfirmation"
  | "setForm"
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
