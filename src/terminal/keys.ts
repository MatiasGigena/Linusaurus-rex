/** Browser keyboard events retain both physical position and layout-produced text. */
export interface KeyboardLike {
  code: string;
  key: string;
  type: string;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getModifierState?(modifier: string): boolean;
}

export interface TerminalKeyEvent {
  key: string;
  mods: string;
  consumed_mods: string;
  text: string;
  unshifted_codepoint: number;
  composing: boolean;
  action: 'press' | 'release' | 'repeat';
}

const logicalNames: Record<string, string> = {
  Enter: 'enter', Backspace: 'backspace', Delete: 'delete', Escape: 'escape', Tab: 'tab',
  ArrowLeft: 'arrow_left', ArrowRight: 'arrow_right', ArrowUp: 'arrow_up', ArrowDown: 'arrow_down',
  Home: 'home', End: 'end', PageUp: 'page_up', PageDown: 'page_down', Insert: 'insert', ' ': 'space',
};
const punctuation: Record<string, string> = {
  '-': 'minus', '=': 'equal', '[': 'bracket_left', ']': 'bracket_right', '\\': 'backslash',
  ';': 'semicolon', "'": 'quote', ',': 'comma', '.': 'period', '/': 'slash', '`': 'backquote',
};
const basePunctuation: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: ' ',
};
// Names published by Rex's keyboard schema. Unknown browser media/system keys
// must not turn an otherwise healthy terminal into a failed input connection.
const namedKeys = new Set(`backquote backslash bracket_left bracket_right comma equal intl_backslash intl_ro intl_yen minus period quote semicolon slash alt_left alt_right backspace caps_lock context_menu control_left control_right enter meta_left meta_right shift_left shift_right space tab convert kana_mode non_convert delete end help home insert page_down page_up arrow_down arrow_left arrow_right arrow_up num_lock numpad_add numpad_backspace numpad_clear numpad_clear_entry numpad_comma numpad_decimal numpad_divide numpad_enter numpad_equal numpad_memory_add numpad_memory_clear numpad_memory_recall numpad_memory_store numpad_memory_subtract numpad_multiply numpad_paren_left numpad_paren_right numpad_subtract numpad_separator numpad_up numpad_down numpad_right numpad_left numpad_begin numpad_home numpad_end numpad_insert numpad_delete numpad_page_up numpad_page_down escape fn fn_lock print_screen scroll_lock pause browser_back browser_favorites browser_forward browser_home browser_refresh browser_search browser_stop eject launch_app_1 launch_app_2 launch_mail media_play_pause media_select media_stop media_track_next media_track_previous power sleep audio_volume_down audio_volume_mute audio_volume_up wake_up copy cut paste`.split(' '));
const supportedKey = (name: string) => namedKeys.has(name) || /^(?:key_[a-z]|digit_[0-9]|numpad_[0-9]|f(?:[1-9]|1\d|2[0-5]))$/.test(name);

/** Ghostty uses snake_case W3C physical codes, retaining function-key numbers. */
export function physicalKeyName(code: string): string | undefined {
  if (!code || code === 'Unidentified') return undefined;
  if (/^F\d{1,2}$/.test(code)) return supportedKey(code.toLowerCase()) ? code.toLowerCase() : undefined;
  if (!/^[A-Z][A-Za-z0-9]+$/.test(code)) return undefined;
  const name = code.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Za-z])(\d)/g, '$1_$2').toLowerCase();
  return supportedKey(name) ? name : undefined;
}

function logicalKeyName(key: string): string | undefined {
  if (logicalNames[key]) return logicalNames[key];
  if (/^F\d{1,2}$/.test(key)) return physicalKeyName(key);
  if (/^[a-z]$/i.test(key)) return `key_${key.toLowerCase()}`;
  if (/^[0-9]$/.test(key)) return `digit_${key}`;
  return punctuation[key];
}

export function isCompositionKey(event: KeyboardLike): boolean {
  return event.isComposing === true || event.keyCode === 229 || ['Dead', 'Process', 'Unidentified'].includes(event.key);
}

export function keyModifiers(event: Pick<KeyboardLike, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'getModifierState'>, includeShift = true): string {
  const names = [
    includeShift && event.shiftKey && 'shift', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.metaKey && 'super',
    event.getModifierState?.('CapsLock') && 'caps_lock', event.getModifierState?.('NumLock') && 'num_lock',
  ];
  return names.filter(Boolean).join('+');
}

export function keyboardPayload(event: KeyboardLike, layout?: ReadonlyMap<string, string>): TerminalKeyEvent | undefined {
  if (isCompositionKey(event)) return undefined;
  const key = physicalKeyName(event.code) ?? logicalKeyName(event.key) ?? ([...event.key].length === 1 ? 'unidentified' : undefined);
  if (!key) return undefined;
  const release = event.type === 'keyup';
  const altGraph = Boolean(event.getModifierState?.('AltGraph'));
  const printable = [...event.key].length === 1;
  const plainText = !event.metaKey && (!event.ctrlKey || altGraph);
  let text = '';
  if (!release && printable && plainText) text = event.key;
  else if (!release && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (event.key === 'Enter') text = '\n';
    if (event.key === 'Tab') text = '\t';
  }
  const consumed: string[] = [];
  if (text && event.shiftKey) consumed.push('shift');
  if (text && altGraph) consumed.push('ctrl', 'alt');
  const mapped = layout?.get(event.code);
  const base = mapped && [...mapped].length === 1 ? mapped
    : printable && (!event.shiftKey || /^\p{L}$/u.test(event.key)) ? event.key.toLowerCase()
      : /^Digit[0-9]$/.test(event.code) ? event.code.slice(-1)
        : basePunctuation[event.code] || '';
  return {
    key, mods: keyModifiers(event), consumed_mods: consumed.join('+'), text,
    unshifted_codepoint: base.codePointAt(0) ?? 0, composing: false,
    action: release ? 'release' : event.repeat ? 'repeat' : 'press',
  };
}

/** Clamp a pointer to the server's zero-based grid, including drags beyond an edge. */
export function pointerCell(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, cols: number, rows: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(cols - 1, Math.floor((clientX - rect.left) / Math.max(1, rect.width) * cols))),
    y: Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / Math.max(1, rect.height) * rows))),
  };
}

/** Parser-generated terminal replies must never be sent back to Rex's own emulator. */
export function isNativeText(data: string): boolean {
  return data.length > 0 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(data);
}
