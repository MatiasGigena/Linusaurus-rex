import type { Form, Confirmation } from "./context";
import type { ServerActionArgs, ServerActionCommand } from "../../shared/types";
interface ServerActionUI {
  setDiagnostics(value: boolean): void;
  setForm(form: Form): void;
  setConfirmation(confirmation: Confirmation): void;
  setReport(report: { title: string; body: string }): void;
}
export function createServerActions(
  hostId: string,
  { setDiagnostics, setForm, setConfirmation, setReport }: ServerActionUI,
) {
  return (...[action, args]: ServerActionCommand) => {
    if (action === "tailscale.rename") {
      setDiagnostics(false);
      setForm({
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
            hostId: hostId,
            action: "tailscale.rename",
            args: { hostname: values.hostname },
          });
        },
      });
      return;
    }
    setDiagnostics(false);
    setConfirmation({
      title: `Apply ${action.replace("tailscale.", "Tailscale ")}?`,
      description:
        "This changes remote access on the selected server. Existing terminal programs are retained.",
      label: "Apply change",
      submit: async () => {
        const change: ServerActionArgs =
          action === "tailscale.enable"
            ? { action, args: { allow_tailnet_members: false, ...args } }
            : { action };
        const result = await window.rex.request("serverAction", {
          hostId,
          ...change,
        });
        setReport({
          title: "Server response",
          body: JSON.stringify(result, null, 2),
        });
      },
    });
  };
}
