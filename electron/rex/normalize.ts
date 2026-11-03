import type { PaneRect as Rect, PaneDivider, RexPane, SessionView } from '../../src/shared/types.js';

type RawNode = { block_id?: string; rect?: Rect; split?: { direction?: string; ratio?: number; before: RawNode; after: RawNode } };
type RawBlock = { block_id: string; label?: string; creator_name?: string };
type RawLayer = { layer_id?: string; kind?: string; label?: string; bounds?: Rect; state?: string; layout?: RawNode; blocks?: RawBlock[] };
type RawWindow = { window_id: string; label?: string; focused_block_id?: string; zoomed_block_id?: string; layers?: RawLayer[] };
type RawView = { session_id: string; label?: string; active_window_id?: string; windows?: RawWindow[] };
const leaf = (node?: RawNode): string => node?.block_id || (node?.split ? leaf(node.split.before) || leaf(node.split.after) : '');
const boundsOf = (node?: RawNode): Rect => {
  if (node?.rect) return node.rect;
  if (!node?.split) return [0, 0, 1, 1];
  const a = boundsOf(node.split.before), b = boundsOf(node.split.after);
  const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]);
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
};

/** The server owns the layout, including nested dividers and floating layers. */
export function normalizeView(value: unknown): SessionView {
  const view = value as RawView;
  if (!view || typeof view.session_id !== 'string' || !Array.isArray(view.windows)) throw new Error('Rex returned an invalid session view.');
  return {
    id: view.session_id, label: view.label || 'Untitled session', activeWindowId: view.active_window_id ?? '',
    windows: view.windows.map(window => {
      const panes: RexPane[] = [], dividers: PaneDivider[] = [];
      const minimizedLayers: { id: string; label: string; blockId: string }[] = [];
      for (const layer of window.layers ?? []) {
        if (layer.state === 'minimized') {
          minimizedLayers.push({ id: layer.layer_id || '', label: layer.label || layer.blocks?.[0]?.label || 'Floating pane', blockId: leaf(layer.layout) || layer.blocks?.[0]?.block_id || '' });
          continue;
        }
        const blocks = new Map((layer.blocks ?? []).map(block => [block.block_id, block]));
        const bounds = layer.bounds ?? [0, 0, 1, 1];
        const absolute = (rect: Rect): Rect => [bounds[0] + rect[0] * bounds[2], bounds[1] + rect[1] * bounds[3], rect[2] * bounds[2], rect[3] * bounds[3]];
        const visit = (node?: RawNode) => {
          if (!node) return;
          if (node.split) {
            const rect = boundsOf(node), before = boundsOf(node.split.before), after = boundsOf(node.split.after);
            const direction = node.split.direction === 'vertical' || (node.split.direction !== 'horizontal' && before[1] !== after[1]) ? 'vertical' : 'horizontal';
            const ratio = node.split.ratio ?? (direction === 'horizontal' ? before[2] / rect[2] : before[3] / rect[3]);
            dividers.push({ direction, beforeBlockId: leaf(node.split.before), afterBlockId: leaf(node.split.after), ratio, rect: absolute(rect) });
            visit(node.split.before); visit(node.split.after); return;
          }
          if (!node.block_id) return;
          const block = blocks.get(node.block_id);
          panes.push({ id: node.block_id, label: block?.label || 'Shell', creator: block?.creator_name,
            layerId: layer.layer_id, layerKind: layer.kind,
            rect: absolute(node.rect ?? [0, 0, 1, 1]),
          });
        };
        visit(layer.layout);
      }
      const zoomed = panes.find(pane => pane.id === window.zoomed_block_id);
      return { id: window.window_id, label: window.label || 'Shell', focusedBlockId: window.focused_block_id ?? '',
        zoomedBlockId: window.zoomed_block_id, minimizedLayers,
        dividers: zoomed ? [] : dividers,
        panes: zoomed ? [{ ...zoomed, rect: [0, 0, 1, 1] as Rect }] : panes,
      };
    }),
  };
}
