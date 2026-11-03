import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import type { Settings } from '../shared/types';

export const TERMINAL_THEMES: Record<'graphite' | 'midnight' | 'light', ITheme> = {
  graphite: {
    background: '#353b41', foreground: '#c6cfd7', cursor: '#9bc5ab', selectionBackground: '#61757480',
    black: '#414951', red: '#d98282', green: '#87cba3', yellow: '#dfc17f', blue: '#81a9d5', magenta: '#b59bd2', cyan: '#7bc6ce', white: '#c9d3dc',
    brightBlack: '#76838e', brightRed: '#eda1a1', brightGreen: '#a3dfbc', brightYellow: '#f1d79b', brightBlue: '#a0c4ec', brightMagenta: '#ceb4eb', brightCyan: '#a0dde2', brightWhite: '#edf2f5',
  },
  midnight: {
    background: '#10151f', foreground: '#d3d9e5', cursor: '#b7dca3', selectionBackground: '#6c84aa66',
    black: '#28303e', red: '#f28291', green: '#a7d79d', yellow: '#eed19a', blue: '#8aadf4', magenta: '#c5a1ee', cyan: '#8bd5d3', white: '#cbd3e2',
    brightBlack: '#647286', brightRed: '#ffa0aa', brightGreen: '#c4e8a9', brightYellow: '#ffe6af', brightBlue: '#b1cbff', brightMagenta: '#e0bcff', brightCyan: '#a3ede5', brightWhite: '#f4f6fa',
  },
  light: {
    background: '#f5f6f3', foreground: '#27333a', cursor: '#427441', selectionBackground: '#8faeab66',
    black: '#2c363d', red: '#ab3e45', green: '#3f7548', yellow: '#916926', blue: '#356996', magenta: '#8152a0', cyan: '#277f83', white: '#a5b1b6',
    brightBlack: '#677781', brightRed: '#c75257', brightGreen: '#4f8c56', brightYellow: '#aa7c27', brightBlue: '#4b7eb3', brightMagenta: '#9968b6', brightCyan: '#3c9799', brightWhite: '#e5e9e9',
  },
};

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;
const colorByte = (value: number) => value.toString(16).padStart(2, '0');
export const DEFAULT_EXTENDED_ANSI: string[] = Array.from({ length: 240 }, (_, offset) => {
  if (offset >= 216) { const value = colorByte(8 + (offset - 216) * 10); return `#${value}${value}${value}`; }
  const levels = [0, 95, 135, 175, 215, 255];
  return `#${colorByte(levels[Math.floor(offset / 36)])}${colorByte(levels[Math.floor(offset / 6) % 6])}${colorByte(levels[offset % 6])}`;
});

export function terminalAppearance(settings: Settings, systemLight = Boolean(globalThis.matchMedia?.('(prefers-color-scheme: light)').matches)): 'light' | 'dark' {
  return settings.appearance === 'light' || (settings.appearance !== 'dark' && systemLight) ? 'light' : 'dark';
}

export function terminalThemeName(settings: Settings, systemLight = Boolean(globalThis.matchMedia?.('(prefers-color-scheme: light)').matches)): keyof typeof TERMINAL_THEMES {
  if (settings.theme !== 'system') return settings.theme;
  const light = terminalAppearance(settings, systemLight) === 'light';
  return light ? settings.lightTheme || 'light' : settings.darkTheme || 'graphite';
}

export function terminalTheme(settings: Settings): ITheme {
  const name = terminalThemeName(settings);
  const custom = (terminalAppearance(settings) === 'light' ? settings.customLightTheme : settings.customDarkTheme) ?? settings.customTheme;
  const theme: ITheme = {
    ...(TERMINAL_THEMES[name as keyof typeof TERMINAL_THEMES] ?? TERMINAL_THEMES.graphite),
    ...custom,
    ...(settings.selectionBackground ? { selectionBackground: settings.selectionBackground } : {}),
    ...(settings.selectionForeground ? { selectionForeground: settings.selectionForeground } : {}),
  };
  const extended = [...DEFAULT_EXTENDED_ANSI];
  for (const [key, value] of Object.entries(custom || {})) {
    const match = /^(?:palette[._-]?)?(\d{1,3})$/.exec(key);
    if (!match || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) continue;
    const index = Number(match[1]);
    if (index < 16) theme[ANSI_NAMES[index]] = value;
    else if (index < 256) extended[index - 16] = value;
  }
  // Supplying a complete standard cube also clears a previously imported
  // extended palette when the preference is disabled.
  theme.extendedAnsi = settings.useExtendedPalette && (terminalAppearance(settings) === 'light' ? settings.useExtendedLightPalette : settings.useExtendedDarkPalette) ? extended : [...DEFAULT_EXTENDED_ANSI];
  return theme;
}

export function terminalOptions(settings: Settings): ITerminalOptions {
  return {
    fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: settings.lineHeight ?? 1.2,
    cursorBlink: settings.cursorBlink ?? true, cursorStyle: settings.cursorStyle ?? 'block',
    scrollback: settings.scrollback ?? 10_000, scrollOnUserInput: true, convertEol: false,
    fontWeight: settings.fontWeight as ITerminalOptions['fontWeight'], fontWeightBold: settings.fontWeightBold as ITerminalOptions['fontWeightBold'],
    letterSpacing: settings.letterSpacing, minimumContrastRatio: settings.minimumContrastRatio,
    smoothScrollDuration: settings.smoothScrollDuration,
    screenReaderMode: true, theme: terminalTheme(settings), allowProposedApi: true,
  };
}

export function terminalServerTheme(settings: Settings): { foreground: string; background: string; cursor: string; palette: string[]; scheme: 'dark' | 'light' } {
  const theme = terminalTheme(settings);
  const hex = (color: string | undefined, fallback: string) => /^#[\da-f]{6}/i.test(color || '') ? color!.slice(0, 7) : fallback;
  const background = hex(theme.background, '#353b41');
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16));
  return {
    foreground: hex(theme.foreground, '#c6cfd7'), background, cursor: hex(theme.cursor, '#9bc5ab'),
    palette: [
      ...ANSI_NAMES.map((name, index) => `${index}=${hex(theme[name], TERMINAL_THEMES.graphite[name]!)}`),
      ...(theme.extendedAnsi || DEFAULT_EXTENDED_ANSI).map((color, index) => `${index + 16}=${hex(color, DEFAULT_EXTENDED_ANSI[index])}`),
    ],
    scheme: r * .299 + g * .587 + b * .114 > 140 ? 'light' : 'dark',
  };
}
