import {
  UNHANDLED,
  type TabActionsDependencies,
  type TabActionsTarget,
} from "./context";

export function createTabActions(dependencies: TabActionsDependencies) {
  return async function tabActions(
    context: TabActionsTarget,
  ): Promise<unknown> {
    const { workspace, setForm, requestClose } = dependencies;
    const {
      name,
      args,
      event,
      hostId,
      sessionId,
      currentView,
      currentWindow,
      terminalRef,
      execute,
    } = context;
    switch (name) {
      case "client.tab.new": {
        if (!sessionId) return execute("session.new", { host_id: hostId });
        const completed = await workspace.mutateSession(
          { hostId, sessionId, selectActive: true },
          () =>
            window.rex.request("newWindow", {
              hostId,
              sessionId,
              label: args.label ? String(args.label) : undefined,
            }),
        );
        return completed.view;
      }
      case "client.tab.close":
        if (!currentWindow) return;
        requestClose(
          hostId,
          "Close this tab?",
          `“${currentWindow.label}” and all of its running programs will close on the server.`,
          () =>
            window.rex.request("closeWindow", {
              hostId,
              sessionId,
              windowId: currentWindow.id,
            }),
        );
        return;
      case "client.tab.rename": {
        if (!currentWindow) return;
        const rename = async (label: string) => {
          await workspace.run(hostId, () =>
            window.rex.request("renameWindow", {
              hostId,
              sessionId,
              windowId: currentWindow.id,
              label,
            }),
          );
        };
        if (args.label) return rename(String(args.label));
        setForm({
          title: "Rename tab",
          description: "Give this terminal tab a recognizable name.",
          fields: [
            {
              name: "label",
              label: "Tab name",
              value: currentWindow.label,
              required: true,
            },
          ],
          submit: (values) => rename(values.label),
        });
        return;
      }
      case "client.tab.next":
      case "client.tab.previous": {
        const windows = currentView?.windows || [];
        const index = windows.findIndex(
          (window) => window.id === currentWindow?.id,
        );
        const next =
          windows[
            (index + (name.endsWith("next") ? 1 : -1) + windows.length) %
              windows.length
          ];
        if (next) workspace.select(hostId, sessionId, next.id);
        return;
      }
      case "client.tab.goto": {
        if (args.index === undefined) {
          setForm({
            title: "Go to tab",
            description: "Tabs are numbered from 1. Use -1 for the last tab.",
            fields: [{ name: "index", label: "Tab number", required: true }],
            submit: async (values) => {
              await execute(
                "client.tab.goto",
                { ...args, index: Number(values.index) },
                event,
              );
            },
          });
          return;
        }
        const index = Number(args.index);
        if (!Number.isInteger(index) || index === 0)
          throw new Error("Tab index must be a nonzero integer.");
        const windows = currentView?.windows || [];
        const target = windows[index > 0 ? index - 1 : windows.length + index];
        if (!target) throw new Error("There is no tab at that index.");
        workspace.select(hostId, sessionId, target.id);
        return;
      }
      case "client.tab.move":
      case "client.tab.move.backward":
      case "client.tab.move.forward": {
        if (!currentView || !currentWindow) return;
        if (name === "client.tab.move" && args.index === undefined) {
          setForm({
            title: "Move tab",
            description: "Choose the tab’s new position in this session.",
            fields: [{ name: "index", label: "Tab position", required: true }],
            submit: async (values) => {
              await execute(
                name,
                { ...args, index: Number(values.index) },
                event,
              );
            },
          });
          return;
        }
        const windows = currentView.windows;
        const index = windows.findIndex(
          (window) => window.id === currentWindow.id,
        );
        const target = name.endsWith("backward")
          ? index - 1
          : name.endsWith("forward")
            ? index + 1
            : Number(args.index) - 1;
        if (!Number.isInteger(target) || target < 0 || target >= windows.length)
          return;
        const beforeWindowId =
          target < index ? windows[target].id : windows[target + 1]?.id;
        return workspace.run(hostId, () =>
          window.rex.request("reorderWindow", {
            hostId,
            sessionId,
            windowId: currentWindow.id,
            beforeWindowId,
          }),
        );
      }
      case "client.tab.move_to_new_window": {
        if (!currentWindow) return;
        await window.rex.request("invokeAction", {
          ...terminalRef,
          action: "client.window.new",
          args: { session_id: sessionId, window_id: currentWindow.id },
        });
        const next = currentView?.windows.find(
          (window) => window.id !== currentWindow.id,
        );
        workspace.select(hostId, next ? sessionId : "", next?.id || "");
        return;
      }
      case "client.close":
        if (!currentWindow) {
          window.rex.windowControl("close");
          return;
        }
        if ((currentWindow.panes.length || 0) > 1)
          return execute("pane.close", args, event);
        return execute("client.tab.close", args, event);
      default:
        return UNHANDLED;
    }
  };
}
