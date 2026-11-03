import type { ProgramActivity, RexPane, RexWindow, SessionView } from '../shared/types';

export const viewKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;
export const paneKey = (hostId: string, sessionId: string, blockId: string) =>
  `${hostId}/${sessionId}/${blockId}`;
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);

export function adjacentPane(
  panes: RexPane[],
  currentId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): RexPane | undefined {
  const current = panes.find((pane) => pane.id === currentId);
  if (!current) return panes[0];
  const [x, y, width, height] = current.rect;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return panes
    .filter((pane) => pane.id !== currentId)
    .map((pane) => {
      const [px, py, pw, ph] = pane.rect;
      const dx = px + pw / 2 - cx;
      const dy = py + ph / 2 - cy;
      const valid =
        direction === 'left'
          ? dx < -0.001
          : direction === 'right'
            ? dx > 0.001
            : direction === 'up'
              ? dy < -0.001
              : dy > 0.001;
      const horizontal = direction === 'left' || direction === 'right';
      return {
        pane,
        valid,
        distance:
          (horizontal ? Math.abs(dx) : Math.abs(dy)) +
          (horizontal ? Math.abs(dy) : Math.abs(dx)) * 2,
      };
    })
    .filter((item) => item.valid)
    .sort((a, b) => a.distance - b.distance)[0]?.pane;
}

const PRIORITY: Record<ProgramActivity['state'], number> = {
  blocked: 0,
  error: 1,
  done: 2,
  working: 3,
  idle: 4,
};
export function primaryActivity(activities: ProgramActivity[]): ProgramActivity | undefined {
  return [...activities].sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state])[0];
}
export function activityLabel(activity?: ProgramActivity): string {
  if (!activity) return '';
  if (activity.message) return activity.message;
  if (activity.state === 'blocked')
    return activity.kind === 'permission'
      ? 'Needs approval'
      : activity.kind === 'auth'
        ? 'Needs sign-in'
        : activity.kind === 'question'
          ? 'Question'
          : 'Needs input';
  return { blocked: 'Needs input', working: 'Working', error: 'Error', done: 'Done', idle: 'Idle' }[
    activity.state
  ];
}
export function windowTitle(window: RexWindow, generated: boolean): string {
  if (window.label && !/^(Shell|Terminal|Window [\da-f]+)$/i.test(window.label))
    return window.label;
  const pane = window.panes.find((pane) => pane.id === window.focusedBlockId) || window.panes[0];
  if (generated && pane?.program)
    return `${pane.program}${pane.cwd ? ` ${pane.cwd.split('/').filter(Boolean).at(-1) || '/'} ` : ''}`.trim();
  return pane?.title || window.label;
}
export function findBlockWindow(
  view: SessionView | undefined,
  blockId: string,
): RexWindow | undefined {
  return view?.windows.find((window) => window.panes.some((pane) => pane.id === blockId));
}

/** Match DOM key codes, so punctuation shortcuts do not depend on a US layout. */
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  shortcut: string,
): boolean {
  if (!shortcut.trim()) return false;
  const pieces = shortcut
    .toLowerCase()
    .split('+')
    .map((piece) => piece.trim());
  const key = pieces.at(-1) || '';
  if (
    event.ctrlKey !== pieces.includes('ctrl') ||
    event.metaKey !== (pieces.includes('meta') || pieces.includes('super')) ||
    event.shiftKey !== pieces.includes('shift') ||
    event.altKey !== pieces.includes('alt')
  )
    return false;
  const code = event.code
    .toLowerCase()
    .replace(/^key/, '')
    .replace(/^digit/, '');
  return (
    code === key ||
    event.key.toLowerCase() === key ||
    (
      {
        comma: ',',
        period: '.',
        slash: '/',
        equal: '=',
        minus: '-',
        bracketleft: '[',
        bracketright: ']',
      } as Record<string, string>
    )[code] === key
  );
}
