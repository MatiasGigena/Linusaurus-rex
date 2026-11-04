import type { RexPane, LayoutActionArgs, RexMethods } from "../../shared/types";
import { adjacentPane } from "../../core/workspace";
import { WorkspaceReconciliationError } from "../../core/workspaceOperations";
import {
  UNHANDLED,
  type PaneLayoutActionsDependencies,
  type PaneLayoutActionsTarget,
} from "./context";

type FocusDirection = "left" | "right" | "up" | "down";
type MoveDirection = RexMethods["movePane"]["args"]["direction"];

function focusDirection(value: unknown): FocusDirection {
  if (
    value === "left" ||
    value === "right" ||
    value === "up" ||
    value === "down"
  )
    return value;
  throw new Error("Use left, right, up or down for the pane direction.");
}
function moveDirection(value: unknown): MoveDirection {
  if (value === "up") return "above";
  if (value === "down") return "below";
  if (
    value === "left" ||
    value === "right" ||
    value === "above" ||
    value === "below"
  )
    return value;
  throw new Error("Use left, right, above or below for the pane direction.");
}

export function createPaneLayoutActions(
  dependencies: PaneLayoutActionsDependencies,
) {
  return async function paneLayoutActions(
    context: PaneLayoutActionsTarget,
  ): Promise<unknown> {
    const { workspace, settings, workspaceElement, setForm } = dependencies;
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
      requirePane,
      execute,
    } = context;
    switch (name) {
      case "pane.split":
      case "pane.split.left":
      case "pane.split.right":
      case "pane.split.up":
      case "pane.split.down":
      case "pane.split.auto": {
        requirePane();
        const auto =
          targetPane &&
          targetPane.rect[2] * (workspaceElement.current?.clientWidth || 1) >
            targetPane.rect[3] *
              (workspaceElement.current?.clientHeight || 1) *
              1.4
            ? "right"
            : "below";
        const requested =
          args.direction === undefined
            ? name === "pane.split"
              ? "right"
              : name.split(".").at(-1)
            : args.direction;
        const direction =
          requested === "auto" ? auto : moveDirection(requested);
        let balancingFailure: { cause: unknown } | undefined;
        const completed = await workspace.mutateSession(
          { hostId, sessionId },
          async () => {
            await window.rex.request("split", {
              ...terminalRef,
              direction,
              ratio: typeof args.ratio === "number" ? args.ratio : undefined,
            });
            if (settings.autobalanceSplits) {
              try {
                await window.rex.request("layoutAction", {
                  ...terminalRef,
                  operation: "balance",
                });
              } catch (cause) {
                // The split is committed. Reconcile it even when this optional
                // follow-up fails; recovery must never replay the split.
                balancingFailure = { cause };
              }
            }
          },
        );
        if (balancingFailure) {
          const { cause } = balancingFailure;
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new WorkspaceReconciliationError(
            cause,
            `The split completed, but balancing the panes failed: ${detail} Refresh the layout to check the result; do not repeat the split.`,
          );
        }
        return completed.view;
      }
      case "pane.focus":
      case "pane.focus.left":
      case "pane.focus.right":
      case "pane.focus.up":
      case "pane.focus.down":
      case "pane.focus_next":
      case "pane.focus_previous": {
        if (!currentWindow) return;
        if (
          name === "pane.focus" &&
          !args.block_id &&
          args.direction === undefined
        ) {
          setForm({
            title: "Focus pane",
            description: "Choose the pane by its block ID.",
            fields: [{ name: "block", label: "Pane ID", required: true }],
            submit: async (values) => {
              await execute(
                "pane.focus",
                { ...args, block_id: values.block },
                event,
              );
            },
          });
          return;
        }
        let target: RexPane | undefined;
        if (name === "pane.focus" && args.block_id)
          target = currentWindow.panes.find(
            (pane) => pane.id === String(args.block_id),
          );
        else if (name === "pane.focus_next" || name === "pane.focus_previous") {
          const index = currentWindow.panes.findIndex(
            (pane) => pane.id === blockId,
          );
          target =
            currentWindow.panes[
              (index +
                (name.endsWith("next") ? 1 : -1) +
                currentWindow.panes.length) %
                currentWindow.panes.length
            ];
        } else
          target = adjacentPane(
            currentWindow.panes,
            blockId,
            focusDirection(
              args.direction === undefined
                ? name.split(".").at(-1)
                : args.direction,
            ),
          );
        if (target)
          return workspace.focusPane({ hostId, sessionId, blockId: target.id });
        return;
      }
      case "pane.move":
      case "pane.move.left":
      case "pane.move.right":
      case "pane.move.up":
      case "pane.move.down": {
        requirePane();
        if (!currentWindow) return;
        const requested =
          args.direction === undefined
            ? name === "pane.move"
              ? undefined
              : name.split(".").at(-1)
            : args.direction;
        const direction =
          requested === undefined ? undefined : moveDirection(requested);
        const target = args.anchor_id
          ? currentWindow.panes.find(
              (pane) => pane.id === String(args.anchor_id),
            )
          : direction
            ? adjacentPane(
                currentWindow.panes,
                blockId,
                direction === "above"
                  ? "up"
                  : direction === "below"
                    ? "down"
                    : direction,
              )
            : undefined;
        if (!target || !direction) {
          setForm({
            title: "Move pane",
            description: "Choose the destination pane and a direction.",
            fields: [
              {
                name: "anchor",
                label: "Destination pane ID",
                value: target?.id,
                required: true,
              },
              {
                name: "direction",
                label: "Direction",
                value: "right",
                required: true,
              },
            ],
            submit: async (values) => {
              const direction = moveDirection(values.direction);
              await workspace.run(hostId, () =>
                window.rex.request("movePane", {
                  ...terminalRef,
                  anchorBlockId: values.anchor,
                  direction,
                }),
              );
            },
          });
          return;
        }
        return workspace.run(hostId, () =>
          window.rex.request("movePane", {
            ...terminalRef,
            anchorBlockId: target.id,
            direction,
          }),
        );
      }
      case "pane.swap":
        requirePane();
        return workspace.run(hostId, () =>
          window.rex.request("swapPanes", {
            ...terminalRef,
            otherBlockId: String(args.other_block_id),
          }),
        );
      case "pane.balance":
        requirePane();
        return workspace.run(hostId, () =>
          window.rex.request("layoutAction", {
            ...terminalRef,
            operation: "balance",
          }),
        );
      case "pane.float":
      case "pane.minimize_floating":
      case "pane.restore_floating":
      case "pane.move_to_new_tab":
      case "pane.move_to_tab": {
        requirePane();
        const operations: Record<
          string,
          "float" | "minimize" | "restore" | "moveToNewTab" | "moveToTab"
        > = {
          "pane.float": "float",
          "pane.minimize_floating": "minimize",
          "pane.restore_floating": "restore",
          "pane.move_to_new_tab": "moveToNewTab",
          "pane.move_to_tab": "moveToTab",
        };
        const operation = operations[name];
        if (operation === "moveToTab" && !args.window_id) {
          setForm({
            title: "Move pane to tab",
            description: "Enter the destination tab ID from this session.",
            fields: [
              { name: "windowId", label: "Destination tab ID", required: true },
            ],
            submit: async (values) => {
              await workspace.run(hostId, () =>
                window.rex.request("layoutAction", {
                  ...terminalRef,
                  operation,
                  targetWindowId: values.windowId,
                }),
              );
            },
          });
          return;
        }
        let operationArgs: LayoutActionArgs;
        if (operation === "moveToTab") {
          operationArgs = { operation, targetWindowId: String(args.window_id) };
        } else if (operation === "minimize" || operation === "restore") {
          const layerId = args.layer_id
            ? String(args.layer_id)
            : targetPane?.layerId;
          if (!layerId) throw new Error("Choose a floating pane.");
          operationArgs = { operation, layerId };
        } else operationArgs = { operation };
        const { result } = await workspace.mutateSession(
          { hostId, sessionId, selectActive: operation === "moveToNewTab" },
          () =>
            window.rex.request("layoutAction", {
              ...terminalRef,
              ...operationArgs,
            }),
        );
        return result;
      }
      case "pane.minimize_all_floating": {
        if (!currentWindow) return;
        for (const pane of currentWindow.panes.filter(
          (pane) => pane.layerKind === "floating" && Boolean(pane.layerId),
        ))
          await window.rex.request("layoutAction", {
            hostId,
            sessionId,
            blockId: pane.id,
            operation: "minimize",
            layerId: pane.layerId || "",
          });
        return workspace.refresh();
      }
      default:
        return UNHANDLED;
    }
  };
}
