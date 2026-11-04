import type { DialogActions, DialogOwner } from "../dialogs";
import type { ServerActionArgs, ServerActionCommand } from "../../shared/types";

export function createServerActions(
  hostId: string,
  dialogs: DialogActions,
  origin?: DialogOwner,
) {
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
