import type { WorkspaceOperations } from "../../core/workspaceOperations";
import type { Host } from "../../shared/types";
import type { Credentials } from "../../components/HostDialog";

export function createHostSaver(
  workspace: Pick<
    WorkspaceOperations,
    "getSettings" | "saveSettings" | "refresh"
  >,
  reconnected: (hostId: string) => void,
) {
  return async (host: Host, credentials?: Credentials): Promise<void> => {
    const settings = workspace.getSettings();
    if (!settings) throw new Error("Workspace settings are not available.");
    await workspace.saveSettings({
      ...settings,
      hosts: settings.hosts.some((item) => item.id === host.id)
        ? settings.hosts.map((item) => (item.id === host.id ? host : item))
        : [...settings.hosts, host],
    });
    if (credentials)
      await window.rex.request("setCredentials", {
        hostId: host.id,
        ...credentials,
      });
    reconnected(host.id);
    await workspace.refresh();
  };
}
