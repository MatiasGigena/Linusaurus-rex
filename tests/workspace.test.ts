import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjacentPane,
  matchesShortcut,
  primaryActivity,
  windowTitle,
} from '../src/core/workspace.js';
test('directional pane focus prefers the pane aligned across the boundary', () => {
  const panes = [
    { id: 'left', label: '', rect: [0, 0, 0.5, 1] as [number, number, number, number] },
    { id: 'top', label: '', rect: [0.5, 0, 0.5, 0.5] as [number, number, number, number] },
    { id: 'bottom', label: '', rect: [0.5, 0.5, 0.5, 0.5] as [number, number, number, number] },
  ];
  assert.equal(adjacentPane(panes, 'top', 'down')?.id, 'bottom');
  assert.equal(adjacentPane(panes, 'bottom', 'left')?.id, 'left');
  assert.equal(adjacentPane(panes, 'left', 'left'), undefined);
});
test('shortcuts retain punctuation position on non-US layouts and require exact modifiers', () => {
  const event = {
    code: 'Comma',
    key: ';',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
  };
  assert.equal(matchesShortcut(event, 'Ctrl+Shift+Comma'), true);
  assert.equal(matchesShortcut(event, 'Ctrl+Comma'), false);
  assert.equal(matchesShortcut(event, ''), false);
});
test('attention state outranks working and user titles survive program titles', () => {
  assert.equal(
    primaryActivity([
      { id: 'a', state: 'working' },
      { id: 'b', state: 'blocked' },
    ])?.id,
    'b',
  );
  assert.equal(
    windowTitle(
      {
        id: 'w',
        label: 'My project',
        focusedBlockId: 'p',
        panes: [{ id: 'p', label: '', title: 'vim', rect: [0, 0, 1, 1] }],
      },
      true,
    ),
    'My project',
  );
});
