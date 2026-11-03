import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCompositionKey, isNativeText, keyboardPayload, physicalKeyName, pointerCell, type KeyboardLike } from '../src/terminal/keys.js';

const event = (input: Partial<KeyboardLike>): KeyboardLike => ({ code: 'KeyA', key: 'a', type: 'keydown', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...input });

test('physical keys keep their positions while text follows a non-US keyboard layout', () => {
  const french = keyboardPayload(event({ code: 'KeyQ', key: 'a' }), new Map([['KeyQ', 'a']]));
  assert.deepEqual(french, { key: 'key_q', text: 'a', mods: '', consumed_mods: '', unshifted_codepoint: 97, composing: false, action: 'press' });
  const shifted = keyboardPayload(event({ code: 'Digit1', key: '1', shiftKey: true }), new Map([['Digit1', '&']]));
  assert.equal(shifted?.text, '1');
  assert.equal(shifted?.unshifted_codepoint, '&'.codePointAt(0));
  assert.equal(shifted?.consumed_mods, 'shift');
});

test('AltGr text consumes its Ctrl+Alt modifiers instead of becoming a control chord', () => {
  const payload = keyboardPayload(event({ code: 'KeyQ', key: '@', ctrlKey: true, altKey: true, getModifierState: (name) => name === 'AltGraph' }), new Map([['KeyQ', 'q']]));
  assert.equal(payload?.text, '@');
  assert.equal(payload?.mods, 'ctrl+alt');
  assert.equal(payload?.consumed_mods, 'ctrl+alt');
  assert.equal(payload?.unshifted_codepoint, 113);
});

test('control keys, key releases and repeats do not inject duplicate text', () => {
  assert.equal(keyboardPayload(event({ code: 'KeyC', key: 'c', ctrlKey: true }))?.text, '');
  assert.equal(keyboardPayload(event({ code: 'Enter', key: 'Enter' }))?.text, '\n');
  assert.equal(keyboardPayload(event({ code: 'Tab', key: 'Tab' }))?.text, '\t');
  assert.equal(keyboardPayload(event({ type: 'keyup' }))?.text, '');
  assert.equal(keyboardPayload(event({ type: 'keyup' }))?.action, 'release');
  assert.equal(keyboardPayload(event({ repeat: true }))?.action, 'repeat');
});

test('IME and dead-key composition use the native text path exactly once', () => {
  for (const input of [{ key: 'Dead' }, { key: 'Process' }, { keyCode: 229 }, { isComposing: true }]) {
    assert.equal(isCompositionKey(event(input)), true);
    assert.equal(keyboardPayload(event(input)), undefined);
  }
  assert.equal(isNativeText('日本語'), true);
  assert.equal(isNativeText('é'), true);
  assert.equal(isNativeText('\x1b[1;1R'), false, 'Xterm device-status replies belong to the server emulator');
  assert.equal(isNativeText('\x1b[?1;2c'), false, 'Xterm device-attributes replies must not be echoed to Rex');
});

test('physical naming matches Ghostty including Meta keys and numpad/function digits', () => {
  for (const [code, key] of [['KeyA', 'key_a'], ['Digit7', 'digit_7'], ['F12', 'f12'], ['Numpad0', 'numpad_0'], ['ArrowUp', 'arrow_up'], ['IntlBackslash', 'intl_backslash'], ['MetaLeft', 'meta_left']]) assert.equal(physicalKeyName(code), key);
  assert.equal(physicalKeyName('Unidentified'), undefined);
  assert.equal(physicalKeyName('LaunchMediaPlayer'), undefined);
  assert.equal(keyboardPayload(event({ code: 'LaunchMediaPlayer', key: 'LaunchMediaPlayer' })), undefined);
  assert.equal(keyboardPayload(event({ code: '', key: 'é' }))?.text, 'é');
});

test('pointer cells use zero-based server coordinates and clamp outside drags', () => {
  const rect = { left: 10, top: 20, width: 800, height: 400 };
  assert.deepEqual(pointerCell(10, 20, rect, 80, 20), { x: 0, y: 0 });
  assert.deepEqual(pointerCell(405, 225, rect, 80, 20), { x: 39, y: 10 });
  assert.deepEqual(pointerCell(-100, 900, rect, 80, 20), { x: 0, y: 19 });
  assert.deepEqual(pointerCell(810, 420, rect, 80, 20), { x: 79, y: 19 });
});
