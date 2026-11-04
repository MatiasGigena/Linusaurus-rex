import type { HostState } from "../../core/workspaceSnapshot";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import { errorMessage } from "../../core/workspace";
import type { Settings } from "../../shared/types";
import type {
  DialogActions,
  DialogOwner,
  PrimaryDialog,
  WorkspaceDialogState,
} from "../../workspace/dialogs";
import type { createHostSaver } from "../../workspace/actions/hostActions";
import { createServerActions } from "../../workspace/actions/serverActions";
import { pickDirectoryPath } from "../../workspace/actions/directoryActions";
import { Dialog } from "../Dialog";
import { CommandPalette, type PaletteCommand } from "../CommandPalette";
import { HostDialog } from "../HostDialog";
import { DirectoryDialog } from "../DirectoryDialog";
import { SettingsDialog } from "../preferences/SettingsDialog";
import { ConfigurationDialog } from "../services/ConfigurationDialog";
import { DiagnosticsDialog } from "../services/DiagnosticsDialog";
import { PairDeviceDialog } from "../services/PairDeviceDialog";
import { NativeServicesDialog } from "../services/NativeServicesDialog";
import { ConfirmDialog, FormDialog } from "./WorkspaceDialogs";

interface WorkspaceDialogHostProps {
  state: WorkspaceDialogState;
  dialogs: DialogActions;
  settings: Settings;
  hosts: HostState[];
  activeHostId: string;
  operations: WorkspaceOperations;
  busy: boolean;
  commands: PaletteCommand[];
  saveHost: ReturnType<typeof createHostSaver>;
  onError(message: string): void;
}

export function WorkspaceDialogHost(props: WorkspaceDialogHostProps) {
  const { state, dialogs, operations, busy } = props;
  return (
    <>
      {state.primary && (
        <PrimaryDialogView
          key={state.primary.id}
          {...props}
          owner={state.primary}
        />
      )}
      {state.form && (
        <FormDialog
          key={state.form.id}
          form={state.form.dialog.form}
          busy={busy}
          onRefresh={operations.refresh}
          onClose={() => dialogs.close(state.form)}
        />
      )}
      {state.confirmation && (
        <ConfirmDialog
          key={state.confirmation.id}
          confirmation={state.confirmation.dialog.confirmation}
          onRefresh={operations.refresh}
          onClose={() => dialogs.close(state.confirmation)}
        />
      )}
    </>
  );
}

function PrimaryDialogView({
  owner,
  dialogs,
  settings,
  hosts,
  activeHostId,
  operations,
  commands,
  saveHost,
  onError,
}: WorkspaceDialogHostProps & { owner: DialogOwner<PrimaryDialog> }) {
  const dialog = owner.dialog;
  const close = () => dialogs.close(owner);
  const openHostDialog = (kind: "configuration" | "diagnostics") =>
    dialogs.open({ kind, hostId: activeHostId }, owner);
  switch (dialog.kind) {
    case "palette":
      return <CommandPalette commands={commands} onClose={close} />;
    case "settings":
      return (
        <SettingsDialog
          settings={settings}
          initialTab={dialog.tab}
          onClose={close}
          onSave={async (next) => {
            const saved = await operations.saveSettings(next);
            await operations.refresh();
            return saved;
          }}
          onAddHost={() => dialogs.open({ kind: "host", host: null }, owner)}
          onEditHost={(host) => dialogs.open({ kind: "host", host }, owner)}
          onNativeServices={() =>
            dialogs.open(
              { kind: "services", hostId: activeHostId, tab: "server" },
              owner,
            )
          }
          onConfig={() => openHostDialog("configuration")}
          onDiagnostics={() => openHostDialog("diagnostics")}
        />
      );
    case "host":
      return (
        <HostDialog
          host={dialog.host ?? undefined}
          onClose={close}
          onSave={saveHost}
        />
      );
    case "configuration":
      return (
        <ConfigurationDialog
          key={
            settings.hosts.find((host) => host.id === dialog.hostId)?.endpoint
          }
          hostId={dialog.hostId}
          onClose={close}
          onReload={() =>
            void operations
              .refresh()
              .catch((failure) => onError(errorMessage(failure)))
          }
        />
      );
    case "diagnostics":
      return (
        <DiagnosticsDialog
          hostId={dialog.hostId}
          endpoint={
            settings.hosts.find((host) => host.id === dialog.hostId)?.endpoint
          }
          onClose={close}
          onServerAction={createServerActions(dialog.hostId, dialogs, owner)}
        />
      );
    case "pairing": {
      const host = hosts.find((host) => host.id === dialog.hostId);
      return (
        <PairDeviceDialog
          hostId={dialog.hostId}
          endpoint={
            host?.status?.endpoint ??
            settings.hosts.find((host) => host.id === dialog.hostId)?.endpoint
          }
          onClose={close}
          onManage={() =>
            dialogs.open({ kind: "diagnostics", hostId: dialog.hostId }, owner)
          }
        />
      );
    }
    case "services":
      return (
        <NativeServicesDialog
          settings={settings}
          hostId={dialog.hostId}
          initialTab={dialog.tab}
          onSave={operations.saveSettings}
          onClose={close}
        />
      );
    case "directory": {
      const { choice } = dialog;
      const recent = Object.hasOwn(settings.recentPaths, choice.ref.hostId)
        ? settings.recentPaths[choice.ref.hostId]
        : [];
      return (
        <DirectoryDialog
          terminalRef={choice.ref}
          mode={choice.mode}
          endpoint={
            settings.hosts.find((host) => host.id === choice.ref.hostId)
              ?.endpoint
          }
          recent={settings.showRecentPaths ? recent : []}
          onClose={close}
          onRefresh={operations.refresh}
          onPick={(path) => pickDirectoryPath(operations, choice, path)}
        />
      );
    }
    case "report":
      return (
        <Dialog title={dialog.title} onClose={close} wide>
          <pre className="diagnostic-output">{dialog.body}</pre>
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() =>
                void window.rex
                  .writeClipboard(dialog.body)
                  .catch((failure) => onError(errorMessage(failure)))
              }
            >
              Copy
            </button>
            <button className="button button-primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog>
      );
  }
}
