import type { Form, Confirmation } from "./context";
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
  return (action: string, args: Record<string, unknown> = {}) => {
    if (action === "tailscale.rename") {
      setDiagnostics(false);
      setForm({
        title: "Change Tailscale hostname",
        description:
          "This changes the selected Rex server’s advertised hostname.",
        fields: [{ name: "hostname", label: "Hostname", required: true }],
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
        const result = await window.rex.request("serverAction", {
          hostId: hostId,
          action: action as "tailscale.enable",
          args:
            action === "tailscale.enable"
              ? { allow_tailnet_members: false, ...args }
              : args,
        });
        setReport({
          title: "Server response",
          body: JSON.stringify(result, null, 2),
        });
      },
    });
  };
}
