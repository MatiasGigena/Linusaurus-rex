import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
import {
  DEFAULT_EXTENDED_ANSI,
  terminalServerTheme,
  terminalTheme,
  terminalThemeName,
} from "../src/terminal/themes.js";

test("system themes choose separate presets and honor a forced appearance", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    theme: "system" as const,
    lightTheme: "light" as const,
    darkTheme: "midnight" as const,
  };
  assert.equal(terminalThemeName(settings, true), "light");
  assert.equal(terminalThemeName(settings, false), "midnight");
  assert.equal(
    terminalThemeName({ ...settings, appearance: "light" }, false),
    "light",
  );
  assert.equal(
    terminalThemeName({ ...settings, appearance: "dark" }, true),
    "midnight",
  );
  assert.equal(
    terminalThemeName({ ...settings, theme: "graphite" }, true),
    "graphite",
  );
});

test("new installs follow the system between the macOS dark and light palettes", () => {
  assert.equal(DEFAULT_SETTINGS.theme, "system");
  assert.equal(terminalThemeName(DEFAULT_SETTINGS, false), "macos");
  assert.equal(terminalThemeName(DEFAULT_SETTINGS, true), "macos-light");
  assert.equal(
    terminalServerTheme({ ...DEFAULT_SETTINGS, appearance: "dark" }).scheme,
    "dark",
  );
  assert.equal(
    terminalServerTheme({ ...DEFAULT_SETTINGS, appearance: "light" }).scheme,
    "light",
  );
});

test("extended theme colors round-trip to Xterm and the server palette protocol", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    useExtendedPalette: true,
    customTheme: {
      palette16: "#123456",
      "palette.255": "#abcdef",
      palette1: "#fedcba",
    },
  };
  const local = terminalTheme(settings);
  const server = terminalServerTheme(settings);
  assert.equal(local.red, "#fedcba");
  assert.equal(local.extendedAnsi?.[0], "#123456");
  assert.equal(local.extendedAnsi?.[239], "#abcdef");
  assert.equal(server.palette.length, 256);
  assert.ok(server.palette.includes("1=#fedcba"));
  assert.ok(server.palette.includes("16=#123456"));
  assert.ok(server.palette.includes("255=#abcdef"));
  assert.ok(
    server.palette.every((entry) => /^\d{1,3}=#[\da-f]{6}$/i.test(entry)),
  );
  const disabled = { ...settings, useExtendedPalette: false };
  assert.deepEqual(terminalTheme(disabled).extendedAnsi, DEFAULT_EXTENDED_ANSI);
  assert.equal(terminalServerTheme(disabled).palette.length, 256);
  assert.ok(terminalServerTheme(disabled).palette.includes("16=#000000"));
  assert.ok(terminalServerTheme(disabled).palette.includes("255=#eeeeee"));
  assert.equal(DEFAULT_EXTENDED_ANSI[0], "#000000");
  assert.equal(DEFAULT_EXTENDED_ANSI[215], "#ffffff");
  assert.equal(DEFAULT_EXTENDED_ANSI[239], "#eeeeee");
});

test("independent light and dark imports take precedence over a legacy shared import", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    customTheme: { foreground: "#111111", palette16: "#101010" },
    customLightTheme: { foreground: "#222222", palette16: "#202020" },
    customDarkTheme: { foreground: "#eeeeee", palette16: "#303030" },
  };
  assert.equal(
    terminalTheme({ ...settings, appearance: "light" }).foreground,
    "#222222",
  );
  assert.equal(
    terminalTheme({ ...settings, appearance: "dark" }).foreground,
    "#eeeeee",
  );
  assert.ok(
    terminalServerTheme({ ...settings, appearance: "light" }).palette.includes(
      "16=#202020",
    ),
  );
  assert.ok(
    terminalServerTheme({ ...settings, appearance: "dark" }).palette.includes(
      "16=#303030",
    ),
  );
  assert.equal(
    terminalTheme({
      ...settings,
      appearance: "light",
      customLightTheme: undefined,
    }).foreground,
    "#111111",
  );
});

test("extended imports can be enabled independently for light and dark appearances", () => {
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    useExtendedPalette: true,
    useExtendedLightPalette: false,
    useExtendedDarkPalette: true,
    customLightTheme: { palette200: "#112233" },
    customDarkTheme: { palette200: "#445566" },
  };
  const light = terminalTheme({ ...settings, appearance: "light" });
  const dark = terminalTheme({ ...settings, appearance: "dark" });
  assert.equal(light.extendedAnsi![184], DEFAULT_EXTENDED_ANSI[184]);
  assert.equal(dark.extendedAnsi![184], "#445566");
  assert.equal(
    terminalTheme({
      ...settings,
      appearance: "dark",
      useExtendedDarkPalette: false,
    }).extendedAnsi![184],
    DEFAULT_EXTENDED_ANSI[184],
  );
});
