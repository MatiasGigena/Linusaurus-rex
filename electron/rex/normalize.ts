import type { PaneRect as Rect, RexPane, SessionView } from '../../src/shared/types.js';

type RawNode = { block_id?: string; rect?: Rect; split?: { before: RawNode; after: RawNode } };
type RawBlock = { block_id: string; label?: string; creator_name?: string };
type RawLayer = { bounds?: Rect; state?: string; layout?: RawNode; blocks?: RawBlock[] };
type RawWindow = { window_id: string; label?: string; focused_block_id?: string; zoomed_block_id?: string; layers?: RawLayer[] };
type RawView = { session_id: string; label?: string; active_window_id?: string; windows?: RawWindow[] };

/** Convert server-owned layout rectangles without inventing local split state. */
export function normalizeView(value: unknown): SessionView {
  const view = value as RawView;
  if (!view || typeof view.session_id !== 'string' || !Array.isArray(view.windows)) {
    throw new Error('Rex returned an invalid session view.');
  }
  return {
    id: view.session_id,
    label: view.label || 'Untitled session',
    activeWindowId: view.active_window_id ?? '',
    windows: view.windows.map(window => {
      const panes: RexPane[] = [];
      for (const layer of window.layers ?? []) {
        if (layer.state === 'minimized') continue;
        const blocks = new Map((layer.blocks ?? []).map(block => [block.block_id, block]));
        const bounds = layer.bounds ?? [0, 0, 1, 1];
        const visit = (node?: RawNode) => {
          if (!node) return;
          if (node.split) { visit(node.split.before); visit(node.split.after); return; }
          if (!node.block_id) return;
          const block = blocks.get(node.block_id);
          const rect = node.rect ?? [0, 0, 1, 1];
          panes.push({
            id: node.block_id,
            label: block?.label || 'Shell',
            creator: block?.creator_name,
            rect: [bounds[0] + rect[0] * bounds[2], bounds[1] + rect[1] * bounds[3], rect[2] * bounds[2], rect[3] * bounds[3]],
          });
        };
        visit(layer.layout);
      }
      const zoomed = panes.find(pane => pane.id === window.zoomed_block_id);
      return {
        id: window.window_id,
        label: window.label || 'Shell',
        focusedBlockId: window.focused_block_id ?? '',
        panes: zoomed ? [{ ...zoomed, rect: [0, 0, 1, 1] as Rect }] : panes,
      };
    }),
  };
}
