import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Host,
} from "../src/shared/types.js";
import { migrateThemeLibrary } from "../src/core/themeLibrary.js";
import { validateOrigins } from "./features/lifecycle.js";
import { validateTrustedLink } from "./features/links.js";

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
export function string(
  value: unknown,
  name: string,
  max = 4096,
  allowNul = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowNul && value.includes("\0"))
  )
    throw new Error(`Invalid ${name}`);
  return value;
}
export function identifier(value: unknown, name: string): string {
  const result = string(value, name, 256);
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}
export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

export function validateSettings(value: unknown): Settings {
  const input = record(value);
  if (
    !Array.isArray(input.hosts) ||
    !input.hosts.length ||
    input.hosts.length > 32
  )
    throw new Error("Add between 1 and 32 hosts");
  const hosts = input.hosts.map((value): Host => {
    const host = record(value);
    const endpoint = string(host.endpoint, "host endpoint");
    if (/^(?:https?|wss?):\/\//i.test(endpoint)) {
      const url = new URL(endpoint);
      if (url.password)
        throw new Error(
          "Save HTTP gateway credentials separately from its endpoint.",
        );
    }
    const origins =
      host.websocketOrigins === undefined
        ? undefined
        : validateOrigins(host.websocketOrigins);
    return {
      ...(origins === undefined ? {} : { websocketOrigins: origins }),
      id: identifier(host.id, "host ID"),
      label: identifier(host.label, "host label"),
      endpoint,
      ...(host.startupCommand === undefined
        ? {}
        : {
            startupCommand: string(
              host.startupCommand,
              "host startup command",
              4096,
            ),
          }),
    };
  });
  if (new Set(hosts.map((host) => host.id)).size !== hosts.length)
    throw new Error("Host IDs must be unique");
  const result = structuredClone(DEFAULT_SETTINGS);
  const numericBounds: Record<string, [number, number, boolean?]> = {
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
  const enums: Record<string, string[]> = {
    theme: ["graphite", "midnight", "light", "system"],
    appearance: ["system", "dark", "light"],
    cursorStyle: ["block", "underline", "bar"],
    tabStyle: ["left", "right", "top"],
    tabIconColors: ["always", "active-pane", "active-tab", "never"],
    paneStyle: ["comfortable", "compact"],
    sidebarGesture: ["swipe", "alt-swipe", "off"],
    animation: ["snappy", "natural", "off"],
    lightTheme: ["light", "graphite", "midnight"],
    darkTheme: ["light", "graphite", "midnight"],
    fontStyle: ["normal", "italic", "oblique"],
    appLinks: ["ask", "always", "never"],
    shellIconTheme: ["default", "theme", "accent"],
    highlightAnimation: ["fade", "move", "instant"],
    inactivePaneFadeTarget: ["content", "surfaces", "both"],
    cursorEffect: ["off", "warp", "comet", "blaze"],
    paddingColor: ["pane", "extend"],
    boldPolicy: ["always", "font", "never"],
    italicPolicy: ["always", "font", "never"],
  };
  const output = result as unknown as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (
      key === "hosts" ||
      key === "notifications" ||
      key === "shortcuts" ||
      input[key] === undefined
    )
      continue;
    const item = input[key];
    if (typeof fallback === "boolean") {
      if (typeof item !== "boolean") throw new Error(`Invalid ${key}`);
      output[key] = item;
    } else if (typeof fallback === "number") {
      const [min, max, whole] = numericBounds[key] ?? [-1_000_000, 1_000_000];
      if (
        typeof item !== "number" ||
        !Number.isFinite(item) ||
        item < min ||
        item > max ||
        (whole && !Number.isInteger(item))
      )
        throw new Error(`Invalid ${key}`);
      output[key] = item;
    } else if (typeof fallback === "string") {
      const text = string(item, key, key === "startupCommand" ? 4096 : 256);
      if (enums[key] && !enums[key].includes(text))
        throw new Error(`Invalid ${key}`);
      if (
        [
          "highlightColor",
          "selectionForeground",
          "selectionBackground",
        ].includes(key) &&
        !/^#[0-9a-f]{3,8}$/i.test(text)
      )
        throw new Error(`Invalid ${key}`);
      if (key === "fontFamily" && !text.trim())
        throw new Error("Choose a terminal font.");
      if (
        key === "clientLabel" &&
        (Buffer.byteLength(text) > 64 || /[\x00-\x1f\x7f]/.test(text))
      )
        throw new Error(
          "Client label must be at most 64 bytes without control characters.",
        );
      output[key] = text;
    }
  }
  if (input.notifications !== undefined) {
    const notificationInput = record(input.notifications);
    for (const [key, fallback] of Object.entries(
      DEFAULT_SETTINGS.notifications,
    )) {
      if (key === "channels") continue;
      if (notificationInput[key] === undefined) continue;
      const item = notificationInput[key];
      if (typeof fallback === "boolean" && typeof item !== "boolean")
        throw new Error(`Invalid notification ${key}`);
      if (
        key === "position" &&
        ![
          "top-right",
          "top-left",
          "bottom-right",
          "bottom-left",
          "top-center",
          "bottom-center",
        ].includes(String(item))
      )
        throw new Error("Invalid notification position");
      (result.notifications as unknown as Record<string, unknown>)[key] = item;
    }
    const kinds = ["working", "blocked", "error", "done"] as const;
    if (notificationInput.channels !== undefined) {
      const channels = record(notificationInput.channels);
      for (const kind of kinds) {
        if (channels[kind] === undefined) continue;
        const channel = record(channels[kind]);
        for (const key of ["tabs", "desktop", "badge", "sound"] as const) {
          if (channel[key] === undefined) continue;
          if (typeof channel[key] !== "boolean")
            throw new Error(`Invalid ${kind} notification ${key}`);
          result.notifications.channels[kind][key] = channel[key];
        }
      }
    } else {
      // Version 0.1's per-state flags governed desktop notices only. Preserve
      // those choices while enabling the new independent tab/badge channels.
      for (const kind of kinds)
        if (typeof notificationInput[kind] === "boolean") {
          result.notifications.channels[kind].desktop = notificationInput[kind];
          result.notifications[kind] = true;
        }
    }
  }
  if (input.shortcuts !== undefined) {
    result.shortcuts = {};
    const shortcuts = record(input.shortcuts);
    if (Object.keys(shortcuts).length > 128)
      throw new Error("Too many shortcuts");
    for (const [key, shortcut] of Object.entries(shortcuts))
      result.shortcuts[identifier(key, "shortcut action")] = string(
        shortcut,
        "shortcut",
        120,
      );
  }
  for (const name of [
    "customTheme",
    "customLightTheme",
    "customDarkTheme",
  ] as const)
    if (input[name] !== undefined) result[name] = validateTheme(input[name]);
  if (input.themeLibrary !== undefined) {
    if (!Array.isArray(input.themeLibrary) || input.themeLibrary.length > 64)
      throw new Error("Keep at most 64 saved themes.");
    result.themeLibrary = input.themeLibrary.map((value) => {
      const theme = record(value);
      const id = identifier(theme.id, "theme ID");
      if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new Error("Invalid theme ID");
      const name = string(theme.name, "theme name", 80).trim();
      if (!name) throw new Error("Choose a theme name.");
      return { id, name, colors: validateTheme(theme.colors) };
    });
    if (
      new Set(result.themeLibrary.map((theme) => theme.id)).size !==
      result.themeLibrary.length
    )
      throw new Error("Theme IDs must be unique.");
  }
  if (input.trustedLinks !== undefined) {
    if (!Array.isArray(input.trustedLinks) || input.trustedLinks.length > 128)
      throw new Error("Too many trusted application targets");
    result.trustedLinks = [
      ...new Set(
        input.trustedLinks.map((value) =>
          validateTrustedLink(string(value, "trusted application target", 512)),
        ),
      ),
    ];
  }
  if (input.recentPaths !== undefined) {
    const history = record(input.recentPaths);
    if (Object.keys(history).length > 64)
      throw new Error("Too many path history hosts");
    result.recentPaths = Object.fromEntries(
      Object.entries(history).map(([key, paths]) => {
        if (!Array.isArray(paths) || paths.length > 20)
          throw new Error(
            "Path history must contain at most 20 paths per host",
          );
        return [
          identifier(key, "path history host"),
          paths.map((path) => string(path, "recent path", 2048)),
        ];
      }),
    );
  }
  let lastSelection: Settings["lastSelection"];
  if (input.lastSelection !== undefined) {
    const selection = record(input.lastSelection);
    const hostId = identifier(selection.hostId, "selected host");
    if (hosts.some((host) => host.id === hostId))
      lastSelection = {
        hostId,
        sessionId: string(selection.sessionId, "selected session", 256),
        windowId: string(selection.windowId, "selected tab", 256),
        ...(selection.blockId === undefined
          ? {}
          : { blockId: identifier(selection.blockId, "selected pane") }),
      };
    if (
      lastSelection &&
      !lastSelection.sessionId &&
      (lastSelection.windowId || lastSelection.blockId)
    )
      throw new Error("An empty host selection cannot contain a tab or pane.");
  }
  return migrateThemeLibrary({
    ...result,
    hosts,
    ...(lastSelection ? { lastSelection } : {}),
  });
}

function validateTheme(value: unknown): Record<string, string> {
  const theme = record(value);
  if (Object.keys(theme).length > 320)
    throw new Error("Theme has too many colors");
  return Object.fromEntries(
    Object.entries(theme).map(([key, value]) => {
      if (
        !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) ||
        typeof value !== "string" ||
        !/^#[0-9a-f]{3,8}$/i.test(value)
      )
        throw new Error("Invalid custom theme color");
      return [key, value];
    }),
  );
}

export class SettingsStore {
  private value: Settings = structuredClone(DEFAULT_SETTINGS);
  private writeQueue = Promise.resolve();
  private listeners = new Set<(settings: Settings) => void>();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    try {
      this.value = validateSettings(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn(
          "Settings could not be loaded; using defaults:",
          (error as Error).message,
        );
    }
  }
  get(): Settings {
    return structuredClone(this.value);
  }
  onChange(listener: (settings: Settings) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async set(value: unknown): Promise<Settings> {
    const settings = validateSettings(value);
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, this.path);
      this.value = settings;
      for (const listener of this.listeners) listener(this.get());
    });
    this.writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }
}
