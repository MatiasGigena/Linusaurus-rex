import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SettingsTab } from "../../components/preferences/types";
import type { useWorkspace } from "../../hooks/useWorkspace";
import type {
  ClientEvent,
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
  ws: ReturnType<typeof useWorkspace>;
  settings: Settings | undefined;
  hosts: ReturnType<typeof useWorkspace>["hosts"];
  views: Record<string, SessionView>;
  selection: Selection | undefined;
  keymaps: ReturnType<typeof useWorkspace>["keymaps"];
  focusedPane: string | undefined;
  activeHost: Host | undefined;
  activePane: RexPane | undefined;
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
  requestClose(
    title: string,
    description: string,
    action: () => Promise<unknown>,
  ): void;
  inspectAfter(
    hostId: string,
    sessionId: string,
    selectActive?: boolean,
  ): Promise<SessionView>;
  focusPane(pane: RexPane, where?: Selection): Promise<void>;
}
export interface ActionContext extends WorkspaceActionOptions {
  settings: Settings;
  name: string;
  args: Record<string, unknown>;
  event?: ClientEvent;
  hostId: string;
  sessionId: string;
  currentView: SessionView | undefined;
  currentWindow: RexWindow | undefined;
  displayedContext: boolean;
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
