import type { PaneRect } from "../../src/shared/types.js";

export interface WireLayoutNode {
  block_id?: string;
  rect?: PaneRect;
  split?: {
    direction?: "horizontal" | "vertical";
    ratio?: number;
    before: WireLayoutNode;
    after: WireLayoutNode;
  };
}
export interface WireBlock {
  block_id: string;
  label?: string;
  creator_name?: string;
}
export interface WireLayer {
  layer_id?: string;
  kind?: string;
  label?: string;
  bounds?: PaneRect;
  state?: string;
  layout?: WireLayoutNode;
  blocks: WireBlock[];
}
export interface WireWindow {
  window_id: string;
  label?: string;
  focused_block_id?: string;
  zoomed_block_id?: string;
  layers: WireLayer[];
}
export interface WireSessionView {
  session_id: string;
  label?: string;
  active_window_id?: string;
  windows: WireWindow[];
}

const invalid = (): never => {
  throw new Error("Rex returned an invalid session view.");
};
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : invalid();
}
function identifier(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : invalid();
}
function collection<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function rectangle(value: unknown): PaneRect | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  )
    return invalid();
  const [x, y, width, height] = value;
  if (width <= 0 || height <= 0) return invalid();
  return [x, y, width, height];
}
function layoutNode(value: unknown, depth = 0): WireLayoutNode {
  if (depth > 128) return invalid();
  const node = object(value);
  const result: WireLayoutNode = { rect: rectangle(node.rect) };
  if (node.block_id !== undefined) result.block_id = identifier(node.block_id);
  if (node.split !== undefined) {
    if (result.block_id !== undefined) return invalid();
    const split = object(node.split);
    const direction = optionalString(split.direction);
    if (
      direction !== undefined &&
      direction !== "horizontal" &&
      direction !== "vertical"
    )
      return invalid();
    if (
      split.ratio !== undefined &&
      (typeof split.ratio !== "number" ||
        !Number.isFinite(split.ratio) ||
        split.ratio <= 0 ||
        split.ratio >= 1)
    )
      return invalid();
    result.split = {
      direction,
      ratio: split.ratio as number | undefined,
      before: layoutNode(split.before, depth + 1),
      after: layoutNode(split.after, depth + 1),
    };
  }
  return result;
}
function block(value: unknown): WireBlock {
  const item = object(value);
  return {
    block_id: identifier(item.block_id),
    label: optionalString(item.label),
    creator_name: optionalString(item.creator_name),
  };
}
function layer(value: unknown): WireLayer {
  const item = object(value);
  return {
    layer_id: optionalString(item.layer_id),
    kind: optionalString(item.kind),
    label: optionalString(item.label),
    state: optionalString(item.state),
    bounds: rectangle(item.bounds),
    blocks: collection(item.blocks, block),
    layout: item.layout === undefined ? undefined : layoutNode(item.layout),
  };
}
function window(value: unknown): WireWindow {
  const item = object(value);
  return {
    window_id: identifier(item.window_id),
    label: optionalString(item.label),
    focused_block_id: optionalString(item.focused_block_id),
    zoomed_block_id: optionalString(item.zoomed_block_id),
    layers: collection(item.layers, layer),
  };
}

/** Decode the shared layout wire contract before normalization or layout mutations. */
export function parseSessionView(value: unknown): WireSessionView {
  const item = object(value);
  if (!Array.isArray(item.windows)) return invalid();
  return {
    session_id: identifier(item.session_id),
    label: optionalString(item.label),
    active_window_id: optionalString(item.active_window_id),
    windows: item.windows.map(window),
  };
}
