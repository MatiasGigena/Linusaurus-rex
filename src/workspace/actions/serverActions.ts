import type { DialogActions, DialogOwner } from "../dialogs";
import type { ServerActionArgs, ServerActionCommand } from "../../shared/types";
import type { WorkspaceOperations } from "../../core/workspaceOperations";

export function createServerActions(
  hostId: string,
  dialogs: DialogActions,
  getSettings: WorkspaceOperations["getSettings"],
  origin?: DialogOwner,
) {
  const endpoint = getSettings()?.hosts.find(
    (host) => host.id === hostId,
  )?.endpoint;
  const assertCurrentHost = () => {
    const current = getSettings()?.hosts.find((host) => host.id === hostId);
    if (endpoint === undefined || !current || current.endpoint !== endpoint)
      throw new Error(
        "The host configuration changed before this server action could be submitted. Reopen diagnostics for the current server.",
      );
  };
  return (...[action, args]: ServerActionCommand) => {
    if (action === "tailscale.rename") {
      dialogs.open(
        {
          kind: "form",
          form: {
            title: "Change Tailscale hostname",
            description:
              "This changes the selected Rex server’s advertised hostname.",
            fields: [
              {
                name: "hostname",
                label: "Hostname",
                required: true,
                value: args?.hostname,
              },
            ],
            submit: async (values) => {
              assertCurrentHost();
              await window.rex.request("serverAction", {
                hostId,
                action: "tailscale.rename",
                args: { hostname: values.hostname },
              });
            },
          },
        },
        origin,
      );
      return;
    }
    let owner: DialogOwner | undefined;
    owner = dialogs.open(
      {
        kind: "confirmation",
        confirmation: {
          title: `Apply ${action.replace("tailscale.", "Tailscale ")}?`,
          description:
            "This changes remote access on the selected server. Existing terminal programs are retained.",
          label: "Apply change",
          submit: async () => {
            if (!dialogs.isOpen(owner)) return;
            assertCurrentHost();
            const primary = dialogs.snapshot.primary;
            const change: ServerActionArgs =
              action === "tailscale.enable"
                ? { action, args: { allow_tailnet_members: false, ...args } }
                : { action };
            const result = await window.rex.request("serverAction", {
              hostId,
              ...change,
            });
            if (dialogs.isOpen(owner) && dialogs.snapshot.primary === primary)
              dialogs.open(
                {
                  kind: "report",
                  title: "Server response",
                  body: JSON.stringify(result ?? null, null, 2),
                },
                owner,
              );
          },
        },
      },
      origin,
    );
  };
}
