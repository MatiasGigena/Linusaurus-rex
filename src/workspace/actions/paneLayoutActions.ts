import type { RexPane, LayoutActionArgs } from "../../shared/types";
import { adjacentPane } from "../../core/workspace";
import { UNHANDLED, type ActionContext } from "./context";

export async function paneLayoutActions(
  context: ActionContext,
): Promise<unknown> {
  const {
    ws,
    settings,
    workspaceElement,
    setForm,
    inspectAfter,
    focusPane,
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
      const directions: Record<string, "left" | "right" | "above" | "below"> = {
        left: "left",
        right: "right",
        up: "above",
        down: "below",
        above: "above",
        below: "below",
        auto,
      };
      const direction =
        directions[String(args.direction || name.split(".").at(-1))] || "right";
      await ws.run(async () => {
        await window.rex.request("split", {
          ...terminalRef,
          direction,
          ratio: typeof args.ratio === "number" ? args.ratio : undefined,
        });
        if (settings.autobalanceSplits)
          await window.rex.request("layoutAction", {
            ...terminalRef,
            operation: "balance",
          });
      });
      return inspectAfter(hostId, sessionId);
    }
    case "pane.focus":
    case "pane.focus.left":
    case "pane.focus.right":
    case "pane.focus.up":
    case "pane.focus.down":
    case "pane.focus_next":
    case "pane.focus_previous": {
      if (!currentWindow) return;
      if (name === "pane.focus" && !args.block_id && !args.direction) {
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
          String(args.direction || name.split(".").at(-1)) as "left",
        );
      if (target)
        return focusPane(target, {
          hostId,
          sessionId,
          windowId: currentWindow.id,
        });
      return;
    }
    case "pane.move":
    case "pane.move.left":
    case "pane.move.right":
    case "pane.move.up":
    case "pane.move.down": {
      requirePane();
      if (!currentWindow) return;
      const direction = String(args.direction || name.split(".").at(-1));
      const target = args.anchor_id
        ? currentWindow.panes.find((pane) => pane.id === String(args.anchor_id))
        : ["left", "right", "up", "down"].includes(direction)
          ? adjacentPane(currentWindow.panes, blockId, direction as "left")
          : undefined;
      if (!target) {
        setForm({
          title: "Move pane",
          description: "Choose the destination pane and a direction.",
          fields: [
            { name: "anchor", label: "Destination pane ID", required: true },
            {
              name: "direction",
              label: "Direction",
              value: "right",
              required: true,
            },
          ],
          submit: async (values) => {
            if (!["left", "right", "above", "below"].includes(values.direction))
              throw new Error("Use left, right, above or below.");
            await ws.run(() =>
              window.rex.request("movePane", {
                ...terminalRef,
                anchorBlockId: values.anchor,
                direction: values.direction as "right",
              }),
            );
          },
        });
        return;
      }
      return ws.run(() =>
        window.rex.request("movePane", {
          ...terminalRef,
          anchorBlockId: target.id,
          direction:
            (({ up: "above", down: "below" } as Record<string, string>)[
              direction
            ] as "above") || (direction as "right"),
        }),
      );
    }
    case "pane.swap":
      requirePane();
      return ws.run(() =>
        window.rex.request("swapPanes", {
          ...terminalRef,
          otherBlockId: String(args.other_block_id),
        }),
      );
    case "pane.balance":
      requirePane();
      return ws.run(() =>
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
            await ws.run(() =>
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
      const result = await ws.run(() =>
        window.rex.request("layoutAction", {
          ...terminalRef,
          ...operationArgs,
        }),
      );
      await inspectAfter(hostId, sessionId, operation === "moveToNewTab");
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
      return ws.refresh();
    }
    default:
      return UNHANDLED;
  }
}
