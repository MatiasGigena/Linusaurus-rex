import type { PaneDivider } from "../../shared/types";
import { errorMessage } from "../../core/workspace";
import { parseMethodArgs } from "../../terminal/blocks";
import { WorkspaceReconciliationError } from "../../core/workspaceOperations";
import {
  UNHANDLED,
  type PaneActionsDependencies,
  type PaneActionsTarget,
} from "./context";

export function createPaneActions(dependencies: PaneActionsDependencies) {
  return async function paneActions(
    context: PaneActionsTarget,
  ): Promise<unknown> {
    const { workspace, settings, requestClose, dialogs } = dependencies;
    const {
      name,
      args,
      event,
      hostId,
      sessionId,
      currentWindow,
      blockId,
      terminalRef,
      targetPane,
      localCommand,
      requirePane,
      execute,
      assertCurrentHost,
    } = context;
    switch (name) {
      case "pane.close":
        requirePane();
        return requestClose(
          hostId,
          "Close this pane?",
          "This terminal and its running program will close on the Rex server.",
          async () => {
            const remaining = currentWindow?.panes.find(
              (pane) => pane.id !== blockId,
            );
            await window.rex.request("closePane", terminalRef);
            if (settings.autobalanceSplits && remaining) {
              try {
                await window.rex.request("layoutAction", {
                  ...terminalRef,
                  blockId: remaining.id,
                  operation: "balance",
                });
              } catch (failure) {
                throw new WorkspaceReconciliationError(
                  failure,
                  `The pane closed, but balancing the remaining panes failed: ${errorMessage(failure)} Refresh the layout to check the result; do not repeat the closure.`,
                );
              }
            }
          },
        );
      case "pane.zoom":
        requirePane();
        return workspace.mutateHostAndRefresh(hostId, () =>
          window.rex.request("zoom", terminalRef),
        );
      case "pane.copy_id":
        requirePane();
        return window.rex.writeClipboard(blockId);
      case "pane.resize": {
        requirePane();
        if (!targetPane)
          throw new Error("The target pane is no longer available.");
        const dividers = [...(currentWindow?.dividers || [])].sort((a, b) => {
          const score = (divider: PaneDivider) => {
            const [x, y, w, h] = targetPane?.rect || [0, 0, 1, 1];
            const [dx, dy, dw, dh] = divider.rect;
            const line =
              divider.direction === "horizontal"
                ? dx + dw * divider.ratio
                : dy + dh * divider.ratio;
            const distance =
              divider.direction === "horizontal"
                ? Math.min(Math.abs(x - line), Math.abs(x + w - line))
                : Math.min(Math.abs(y - line), Math.abs(y + h - line));
            return distance * 100 + dw * dh;
          };
          return score(a) - score(b);
        });
        if (!dividers.length)
          throw new Error("This tab has no split border to resize.");
        const resize = async (border: number, ratio: number) => {
          const divider = dividers[border - 1];
          if (!divider)
            throw new Error(`Choose a border from 1 to ${dividers.length}.`);
          if (!(ratio > 0 && ratio < 1))
            throw new Error("Enter a percentage between 1 and 99.");
          await workspace.mutateHostAndRefresh(hostId, () =>
            window.rex.request("resizeDivider", {
              hostId,
              sessionId,
              ...divider,
              ratio,
            }),
          );
        };
        if (typeof args.ratio === "number")
          return resize(Number(args.border || 1), args.ratio);
        dialogs.open({
          kind: "form",
          form: {
            title: "Resize split",
            description:
              "The nearest border to the target pane comes first. " +
              dividers
                .map(
                  (divider, index) =>
                    `${index + 1}: ${divider.direction === "horizontal" ? "left/right" : "upper/lower"}`,
                )
                .join("; "),
            fields: [
              ...(dividers.length > 1
                ? [
                    {
                      name: "border",
                      label: "Border number",
                      value: "1",
                      required: true,
                    },
                  ]
                : []),
              {
                name: "ratio",
                label: "Before-side percentage",
                value: String(Math.round(dividers[0].ratio * 100)),
                required: true,
              },
            ],
            submit: async (values) => {
              await execute(
                "pane.resize",
                {
                  ...args,
                  host_id: hostId,
                  session_id: sessionId,
                  window_id: currentWindow?.id,
                  block_id: blockId,
                  border: Number(values.border || 1),
                  ratio: Number(values.ratio) / 100,
                },
                event,
              );
            },
          },
        });
        return;
      }
      case "pane.rename":
        requirePane();
        dialogs.open({
          kind: "form",
          form: {
            title: "Rename pane",
            description: "A label shared with other Rex clients.",
            fields: [
              {
                name: "label",
                label: "Pane name",
                value: targetPane?.label,
                required: true,
              },
            ],
            submit: async (values) => {
              assertCurrentHost();
              await workspace.mutateHostAndRefresh(hostId, () =>
                window.rex.request("renamePane", {
                  ...terminalRef,
                  label: values.label,
                }),
              );
            },
          },
        });
        return;
      case "pane.go_to_directory":
        requirePane();
        dialogs.open({
          kind: "directory",
          choice: { mode: "directory", ref: terminalRef },
        });
        return;
      case "pane.insert_path":
        requirePane();
        dialogs.open({
          kind: "directory",
          choice: { mode: "insert", ref: terminalRef },
        });
        return;
      case "pane.send_key":
      case "client.key.forward": {
        requirePane();
        const send = (key: string, mods: string, text = "") =>
          window.rex.request("invokeAction", {
            ...terminalRef,
            action: "pane.send_key",
            args: { key, mods, text },
          });
        if (!args.key) {
          dialogs.open({
            kind: "form",
            form: {
              title: "Send key",
              description: "Send one Ghostty key name to the target program.",
              fields: [
                { name: "key", label: "Key", value: "enter", required: true },
                { name: "mods", label: "Modifiers", placeholder: "ctrl+shift" },
              ],
              submit: async (values) => {
                assertCurrentHost();
                await send(values.key, values.mods || "");
              },
            },
          });
          return;
        }
        return send(
          String(args.key),
          String(args.mods || ""),
          String(args.text || ""),
        );
      }
      case "client.find.open":
        return localCommand("find");
      case "client.find.next":
        return localCommand("find-next");
      case "client.find.previous":
        return localCommand("find-previous");
      case "client.prompt.previous":
        return localCommand("prompt-previous");
      case "client.prompt.next":
        return localCommand("prompt-next");
      case "pane.clear_content":
      case "clear-scrollback-server":
        requirePane();
        return window.rex.request("invokeAction", {
          ...terminalRef,
          action: "com.superlogical.terminal.clear",
        });
      case "pane.reset_terminal":
        requirePane();
        dialogs.open({
          kind: "confirmation",
          confirmation: {
            title: "Reset terminal?",
            description:
              "Reset the terminal emulator and clear its screen and scrollback. The program keeps running.",
            label: "Reset terminal",
            submit: async () => {
              assertCurrentHost();
              await window.rex.request("invokeAction", {
                ...terminalRef,
                action: "com.superlogical.terminal.reset",
              });
            },
          },
        });
        return;
      case "client.copy":
        return localCommand("copy");
      case "client.paste":
        return localCommand("paste");
      case "pane.new_block": {
        const creators = await window.rex.request("creators", { hostId });
        const advertisedCreators =
          creators && typeof creators === "object" && "creators" in creators
            ? creators.creators
            : undefined;
        const flavors = Array.isArray(advertisedCreators)
          ? advertisedCreators.flatMap((creator: unknown): string[] => {
              if (
                !creator ||
                typeof creator !== "object" ||
                !("flavors" in creator) ||
                !Array.isArray(creator.flavors)
              )
                return [];
              return creator.flavors.flatMap((item: unknown): string[] =>
                item &&
                typeof item === "object" &&
                "flavor" in item &&
                typeof item.flavor === "string"
                  ? [item.flavor]
                  : [],
              );
            })
          : [];
        const advertised = [...new Set(flavors)];
        dialogs.open({
          kind: "form",
          form: {
            title: "Create block",
            description: `${advertised.length ? `Available flavors: ${advertised.join(", ")}.` : "This server has not advertised any block flavors."} Non-terminal blocks expose their available methods in the inspector.`,
            fields: [
              { name: "flavor", label: "Block flavor", required: true },
              {
                name: "options",
                label: "Options (JSON)",
                value: "{}",
                multiline: true,
              },
            ],
            submit: async (values) => {
              assertCurrentHost();
              await workspace.mutateHostAndRefresh(hostId, () =>
                window.rex.request("createBlock", {
                  hostId,
                  sessionId,
                  windowId: currentWindow?.id,
                  flavor: values.flavor,
                  options: parseMethodArgs(values.options || "{}"),
                }),
              );
            },
          },
        });
        return;
      }
      default:
        return UNHANDLED;
    }
  };
}
