import type {
  Host,
  LayoutActionArgs,
  TerminalRef,
} from "../../src/shared/types.js";
import { parseSessionView, type WireLayoutNode } from "../rex/session-view.js";

type Caller = (
  host: Host,
  method: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;
type LayoutRequest = Pick<TerminalRef, "sessionId" | "blockId"> &
  LayoutActionArgs;
interface CreatedWindow {
  window_id: string;
  block_ids: string[];
}

export function validateBounds(
  value: unknown,
): [number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    throw new Error("Invalid floating pane bounds.");
  const [x, y, width, height] = value;
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1.000001 ||
    y + height > 1.000001
  )
    throw new Error("Floating panes must fit inside the workspace.");
  return [x, y, width, height];
}

function createdWindow(value: unknown): CreatedWindow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Rex returned an invalid new window.");
  const result = value as Record<string, unknown>;
  if (
    typeof result.window_id !== "string" ||
    !result.window_id ||
    !Array.isArray(result.block_ids) ||
    !result.block_ids.length ||
    result.block_ids.some((id) => typeof id !== "string" || !id)
  )
    throw new Error("Rex returned an invalid new window.");
  return {
    window_id: result.window_id,
    block_ids: result.block_ids as string[],
  };
}

function firstBlock(node?: WireLayoutNode): string | undefined {
  return (
    node?.block_id ||
    (node?.split &&
      (firstBlock(node.split.before) || firstBlock(node.split.after)))
  );
}
async function balance(
  call: Caller,
  host: Host,
  sessionId: string,
  node?: WireLayoutNode,
): Promise<void> {
  if (!node?.split) return;
  const before = firstBlock(node.split.before),
    after = firstBlock(node.split.after);
  if (before && after) {
    const direction = node.split.direction ?? "horizontal";
    await call(host, "session.resize_pane", {
      session_id: sessionId,
      direction,
      before_block_id: before,
      after_block_id: after,
      ratio: 0.5,
    });
  }
  await balance(call, host, sessionId, node.split.before);
  await balance(call, host, sessionId, node.split.after);
}

export async function layoutAction(
  call: Caller,
  host: Host,
  args: LayoutRequest,
) {
  const { sessionId, blockId, operation } = args;
  const ref = { session_id: sessionId, block_id: blockId };
  if (operation === "float")
    return call(host, "session.float_block", {
      ...ref,
      bounds: [0.15, 0.15, 0.7, 0.7],
    });
  if (operation === "minimize" || operation === "restore") {
    return call(host, "session.set_layer_state", {
      session_id: sessionId,
      layer_id: args.layerId,
      state: operation === "minimize" ? "minimized" : "normal",
      ...(operation === "restore" ? { focus: true } : {}),
    });
  }
  if (operation === "balance") {
    const view = parseSessionView(
      await call(host, "session.view", { session_id: sessionId }),
    );
    const window = view.windows.find((window) =>
      window.layers.some((layer) =>
        layer.blocks.some((block) => block.block_id === blockId),
      ),
    );
    if (!window) throw new Error("The pane no longer exists.");
    for (const layer of window.layers)
      await balance(call, host, sessionId, layer.layout);
    return;
  }
  let created: CreatedWindow | undefined;
  try {
    let targetBlock: string | undefined;
    if (operation === "moveToNewTab") {
      created = createdWindow(
        await call(host, "session.new_window", {
          session_id: sessionId,
          window_label: "Terminal",
          layout: { block: { flavor: "com.superlogical.terminal.shell" } },
          focus: false,
        }),
      );
      targetBlock = created.block_ids[0];
    } else if (operation === "moveToTab") {
      const view = parseSessionView(
        await call(host, "session.view", { session_id: sessionId }),
      );
      targetBlock = view.windows.find(
        (window) => window.window_id === args.targetWindowId,
      )?.focused_block_id;
    } else throw new Error("Unsupported layout operation.");
    if (!targetBlock || targetBlock === blockId)
      throw new Error("Choose another tab with a terminal.");
    await call(host, "session.move_block", {
      ...ref,
      anchor_block_id: targetBlock,
      direction: "horizontal",
      side: "after",
    });
    if (created)
      await call(host, "block.close", {
        session_id: sessionId,
        block_id: targetBlock,
      });
    await call(host, "session.focus_block", ref);
  } catch (error) {
    if (created) {
      const temporary = created;
      // Only the temporary placeholder is ours to clean up. A moved user pane must survive.
      const view = await call(host, "session.view", { session_id: sessionId })
        .then(parseSessionView)
        .catch(() => undefined);
      const window = view?.windows.find(
        (window) => window.window_id === temporary.window_id,
      );
      const blocks = window?.layers.flatMap((layer) => layer.blocks) ?? [];
      if (
        blocks.length === 1 &&
        blocks[0].block_id === temporary.block_ids[0]
      ) {
        await call(host, "session.close_window", {
          session_id: sessionId,
          window_id: temporary.window_id,
        }).catch(() => {});
      }
    }
    throw error;
  }
}
