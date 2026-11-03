const palette = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const normalize = (input: string) => COLOR.test(input.trim()) ? input.trim().toLowerCase() : undefined;

/** Parse only color entries, never executable theme directives or external XML entities. */
export function parseTheme(source: string): Record<string, string> {
  if (source.length > 1024 * 1024) throw new Error('Theme files must be smaller than 1 MiB.');
  const colors: Record<string, string> = {};
  if (source.includes('<plist')) {
    const labels: Record<string, string> = { 'Background Color': 'background', 'Foreground Color': 'foreground', 'Cursor Color': 'cursor', 'Selected Text Color': 'selectionForeground', 'Selection Color': 'selectionBackground' };
    for (let i = 0; i < 16; i++) labels[`Ansi ${i} Color`] = palette[i];
    for (const [label, key] of Object.entries(labels)) {
      const match = source.match(new RegExp(`<key>\\s*${label}\\s*</key>\\s*<dict>([\\s\\S]*?)</dict>`, 'i'));
      if (!match) continue;
      const parts = ['Red', 'Green', 'Blue'].map(channel => {
        const part = match[1].match(new RegExp(`<key>\\s*${channel} Component\\s*</key>\\s*<(?:real|integer)>\\s*([0-9.eE+-]+)\\s*</(?:real|integer)>`, 'i'));
        return part ? Number(part[1]) : NaN;
      });
      if (parts.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) colors[key] = `#${parts.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
    }
  } else {
    const labels: Record<string, string> = { background: 'background', foreground: 'foreground', 'cursor-color': 'cursor', 'cursor-text': 'cursorAccent', 'selection-background': 'selectionBackground', 'selection-foreground': 'selectionForeground' };
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, input] = match;
      if (name === 'palette') {
        const entry = input.match(/^(\d+)\s*=\s*(#[0-9a-f]{3,8})\s*$/i);
        if (entry && Number(entry[1])<=255 && normalize(entry[2])) colors[palette[Number(entry[1])]||`palette${Number(entry[1])}`] = normalize(entry[2])!;
      } else if (labels[name] && normalize(input)) colors[labels[name]] = normalize(input)!;
    }
  }
  if (!Object.keys(colors).length) throw new Error('No supported colors found. Choose a Ghostty theme or iTerm color file.');
  return colors;
}
