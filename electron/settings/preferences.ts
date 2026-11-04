import type { Settings } from "../../src/shared/types.js";
import { hexColor, string } from "../validation.js";

type KeysOfType<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];
type BooleanKey = KeysOfType<Settings, boolean>;
type NumericKey = KeysOfType<Settings, number>;
type TextKey = {
  [K in keyof Settings]-?: string extends Settings[K] ? K : never;
}[keyof Settings];
type EnumKey = Exclude<KeysOfType<Settings, string>, TextKey>;
function keys<T extends object>(value: T): (keyof T)[] {
  return Object.keys(value) as (keyof T)[];
}

const booleanFields = {
  sidebarCollapsed: true,
  cursorBlink: true,
  copyOnSelect: true,
  scrollOnOutput: true,
  terminalBell: true,
  letAgentsNameSessions: true,
  openLinks: true,
  mouseReporting: true,
  confirmClose: true,
  closeToTray: true,
  remoteControl: true,
  fillTabs: true,
  showPaneHeaders: true,
  highlightActivePane: true,
  focusFollowsMouse: true,
  autobalanceSplits: true,
  trackpadGestures: true,
  preferGeneratedTitles: true,
  showWindowOnLaunch: true,
  developerMode: true,
  useExtendedPalette: true,
  forceCursorStyle: true,
  ligatures: true,
  fontSmoothing: true,
  showKeyHints: true,
  showRecentPaths: true,
  preserveWindowWidth: true,
  useExtendedLightPalette: true,
  useExtendedDarkPalette: true,
  tintInterface: true,
  graphicsEnabled: true,
  forceThemePalette: true,
  displayP3: true,
  matchProgramBackground: true,
  selectionCopyAnimation: true,
  selectionRounded: true,
  smoothResize: true,
  autoCheckUpdates: true,
  autoDownloadUpdates: true,
  installUpdatesWhenIdle: true,
} satisfies Record<BooleanKey, true>;

const numericBounds: Record<NumericKey, [number, number, boolean?]> = {
  fontSize: [8, 48, true],
  interfaceZoom: [0.7, 1.5],
  scrollback: [100, 100_000, true],
  lineHeight: [1, 2],
  tabIcons: [0, 8, true],
  paddingX: [0, 80, true],
  paddingY: [0, 80, true],
  highlightOpacity: [0, 1],
  inactivePaneFade: [0, 0.8],
  fontWeight: [100, 900, true],
  fontWeightBold: [100, 900, true],
  letterSpacing: [-2, 8],
  minimumContrastRatio: [1, 21],
  smoothScrollDuration: [0, 1000, true],
  cursorBlinkInterval: [100, 2000, true],
  sidebarWidth: [190, 500],
  inactiveWindowFade: [0, 0.8],
};

const enums = {
  theme: ["macos", "macos-light", "graphite", "midnight", "light", "system"],
  appearance: ["system", "dark", "light"],
  cursorStyle: ["block", "underline", "bar"],
  tabStyle: ["left", "right", "top"],
  tabIconColors: ["always", "active-pane", "active-tab", "never"],
  paneStyle: ["comfortable", "compact"],
  sidebarGesture: ["swipe", "alt-swipe", "off"],
  animation: ["snappy", "natural", "off"],
  lightTheme: ["macos-light", "macos", "light", "graphite", "midnight"],
  darkTheme: ["macos", "macos-light", "light", "graphite", "midnight"],
  fontStyle: ["normal", "italic", "oblique"],
  appLinks: ["ask", "always", "never"],
  shellIconTheme: ["default", "theme", "accent"],
  highlightAnimation: ["fade", "move", "instant"],
  inactivePaneFadeTarget: ["content", "surfaces", "both"],
  cursorEffect: ["off", "warp", "comet", "blaze"],
  paddingColor: ["pane", "extend"],
  boldPolicy: ["always", "font", "never"],
  italicPolicy: ["always", "font", "never"],
} as const satisfies { [K in EnumKey]: readonly Settings[K][] };

function nonemptyFont(value: string) {
  if (!value.trim()) throw new Error("Choose a terminal font.");
}
function clientLabel(value: string) {
  if (Buffer.byteLength(value) > 64 || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(
      "Client label must be at most 64 bytes without control characters.",
    );
}
const textRules: Record<
  TextKey,
  { max?: number; check?(value: string, key: string): void }
> = {
  fontFamily: { check: nonemptyFont },
  globalShortcut: {},
  clientLabel: { check: clientLabel },
  highlightColor: { check: hexColor },
  startupCommand: { max: 4096 },
  selectionForeground: { check: hexColor },
  selectionBackground: { check: hexColor },
  lightThemeId: {},
  darkThemeId: {},
};

function applyEnum<K extends EnumKey>(
  key: K,
  allowed: readonly Settings[K][],
  input: Record<string, unknown>,
  result: Settings,
) {
  if (input[key] === undefined) return;
  const text = string(input[key], key, 256);
  const value = allowed.find((value) => value === text);
  if (value === undefined) throw new Error(`Invalid ${key}`);
  result[key] = value;
}

function applyBooleans(input: Record<string, unknown>, result: Settings) {
  for (const key of keys(booleanFields)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`Invalid ${key}`);
    result[key] = input[key];
  }
}
function applyNumbers(input: Record<string, unknown>, result: Settings) {
  for (const key of keys(numericBounds)) {
    const value = input[key];
    if (value === undefined) continue;
    const [min, max, whole] = numericBounds[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (whole && !Number.isInteger(value))
    )
      throw new Error(`Invalid ${key}`);
    result[key] = value;
  }
}
function applyText(input: Record<string, unknown>, result: Settings) {
  for (const key of keys(textRules)) {
    if (input[key] === undefined) continue;
    const rule = textRules[key];
    const text = string(input[key], key, rule.max ?? 256);
    rule.check?.(text, key);
    result[key] = text;
  }
}

/** Scalar families are exhaustive over Settings, so new fields require a validation rule. */
export function applyPreferences(
  input: Record<string, unknown>,
  result: Settings,
) {
  applyBooleans(input, result);
  applyNumbers(input, result);
  applyText(input, result);
  for (const key of keys(enums)) applyEnum(key, enums[key], input, result);
}
