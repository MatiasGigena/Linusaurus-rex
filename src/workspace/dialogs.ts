import type { SettingsTab } from "../components/preferences/types";
import type { Host, TerminalRef } from "../shared/types";

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
export interface DirectoryChoice {
  mode: "insert" | "directory";
  ref: TerminalRef;
}
export type PrimaryDialog =
  | { kind: "palette"; scope: "all" | "sessions" }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "host"; host: Host | null }
  | { kind: "configuration"; hostId: string }
  | { kind: "diagnostics"; hostId: string }
  | { kind: "pairing"; hostId: string }
  | { kind: "services"; hostId: string; tab: "server" | "updates" }
  | { kind: "directory"; choice: DirectoryChoice }
  | { kind: "report"; title: string; body: string };
export type WorkspaceDialog =
  | PrimaryDialog
  | { kind: "form"; form: Form }
  | { kind: "confirmation"; confirmation: Confirmation };
export interface DialogOwner<D extends WorkspaceDialog = WorkspaceDialog> {
  readonly id: number;
  readonly dialog: D;
}
export interface WorkspaceDialogState {
  readonly primary?: DialogOwner<PrimaryDialog>;
  readonly form?: DialogOwner<Extract<WorkspaceDialog, { kind: "form" }>>;
  readonly confirmation?: DialogOwner<
    Extract<WorkspaceDialog, { kind: "confirmation" }>
  >;
}
export type DialogActions = Pick<
  WorkspaceDialogController,
  "open" | "close" | "isOpen" | "snapshot"
>;

/** Primary dialogs replace each other; explicit forms/confirmations may stack. */
export class WorkspaceDialogController {
  private state: WorkspaceDialogState = {};
  private sequence = 0;
  private active = true;
  constructor(
    private readonly publish?: (state: WorkspaceDialogState) => void,
  ) {}
  get snapshot(): WorkspaceDialogState {
    return this.state;
  }
  activate() {
    this.active = true;
  }
  deactivate() {
    this.active = false;
  }
  readonly isOpen = (owner: DialogOwner | undefined): boolean =>
    this.active &&
    owner !== undefined &&
    (this.state.primary === owner ||
      this.state.form === owner ||
      this.state.confirmation === owner);
  readonly open = (
    dialog: WorkspaceDialog,
    replaces?: DialogOwner,
  ): DialogOwner | undefined => {
    if (!this.active || (replaces && !this.isOpen(replaces))) return;
    const previous = replaces ? this.without(replaces) : this.state;
    const id = ++this.sequence;
    if (dialog.kind === "form") {
      const owner = { id, dialog };
      this.commit({ ...previous, form: owner });
      return owner;
    }
    if (dialog.kind === "confirmation") {
      const owner = { id, dialog };
      this.commit({ ...previous, confirmation: owner });
      return owner;
    }
    const owner = { id, dialog };
    this.commit({ ...previous, primary: owner });
    return owner;
  };
  readonly close = (owner: DialogOwner | undefined) => {
    if (this.isOpen(owner)) this.commit(this.without(owner));
  };
  private without(owner: DialogOwner | undefined): WorkspaceDialogState {
    if (this.state.primary === owner)
      return { ...this.state, primary: undefined };
    if (this.state.form === owner) return { ...this.state, form: undefined };
    if (this.state.confirmation === owner)
      return { ...this.state, confirmation: undefined };
    return this.state;
  }
  private commit(next: WorkspaceDialogState) {
    this.state = next;
    this.publish?.(next);
  }
}
