import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
import { validateSettings } from "../electron/settings/validation.js";
import { terminalServerTheme } from "../src/terminal/themes.js";
import {
  deleteLibraryTheme,
  migrateThemeLibrary,
  renameLibraryTheme,
  resolvedImportedTheme,
  saveLibraryTheme,
  selectLibraryTheme,
  uniqueThemeName,
} from "../src/core/themeLibrary.js";

const light = {
  background: "#eeeeee",
  foreground: "#112233",
  palette200: "#123456",
};
const dark = {
  background: "#112233",
  foreground: "#eeeeee",
  palette200: "#654321",
};

const fullLibrary = () =>
  Array.from({ length: 64 }, (_, index) => ({
    id: `saved-${index}`,
    name: `Saved ${index}`,
    colors: { background: `#${index.toString(16).padStart(6, "0")}` },
  }));
const sharedPalette = Object.fromEntries(
  Array.from({ length: 256 }, (_, index) => [
    `palette${index}`,
    `#${(0x123400 + index).toString(16)}`,
  ]),
);

test("full libraries preserve all distinct legacy palettes as named entries and remove legacy state", () => {
  const source = {
    ...structuredClone(DEFAULT_SETTINGS),
    themeLibrary: fullLibrary(),
    customTheme: sharedPalette,
    customLightTheme: light,
    customDarkTheme: dark,
  };
  const normalized = validateSettings(source);
  assert.equal(normalized.themeLibrary.length, 67);
  assert.deepEqual(normalized.themeLibrary.slice(0, 64), source.themeLibrary);
  for (const field of ["customTheme", "customLightTheme", "customDarkTheme"])
    assert.equal(Object.hasOwn(normalized, field), false);
  for (const colors of [sharedPalette, light, dark])
    assert.ok(
      normalized.themeLibrary.some(
        (theme) => JSON.stringify(theme.colors) === JSON.stringify(colors),
      ),
    );
  assert.deepEqual(resolvedImportedTheme(normalized, "light"), light);
  assert.deepEqual(resolvedImportedTheme(normalized, "dark"), dark);
  assert.deepEqual(validateSettings(normalized), normalized);
  assert.equal(source.themeLibrary.length, 64);
  assert.notEqual(
    normalized.themeLibrary[0].colors,
    source.themeLibrary[0].colors,
  );
});

test("legacy ingestion retains selected named themes and archives inactive legacy palettes", () => {
  const normalized = validateSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    themeLibrary: fullLibrary(),
    lightThemeId: "saved-4",
    darkThemeId: "legacy-light",
    customTheme: sharedPalette,
    customLightTheme: light,
    customDarkTheme: dark,
  });
  assert.equal(normalized.themeLibrary.length, 67);
  assert.equal(normalized.lightThemeId, "saved-4");
  assert.deepEqual(
    resolvedImportedTheme(normalized, "light"),
    fullLibrary()[4].colors,
  );
  assert.deepEqual(resolvedImportedTheme(normalized, "dark"), dark);
  assert.ok(
    normalized.themeLibrary.some(
      (theme) => Object.keys(theme.colors).length === 256,
    ),
  );
});

test("a complete shared palette keeps all 256 server colors and one selection identity for both appearances", () => {
  const normalized = validateSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    themeLibrary: fullLibrary(),
    customTheme: sharedPalette,
  });
  assert.equal(normalized.themeLibrary.length, 65);
  assert.equal(normalized.lightThemeId, normalized.darkThemeId);
  for (const appearance of ["light", "dark"] as const) {
    assert.deepEqual(
      terminalServerTheme({ ...normalized, appearance }).palette,
      Array.from(
        { length: 256 },
        (_, index) => `${index}=${sharedPalette[`palette${index}`]}`,
      ),
    );
  }
  assert.deepEqual(validateSettings(normalized), normalized);
});

test("empty appearance overrides mask the shared fallback and migration deduplicates equal palettes", () => {
  const empty = validateSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    customTheme: dark,
    customLightTheme: {},
  });
  assert.equal(empty.themeLibrary.length, 1);
  assert.equal(resolvedImportedTheme(empty, "light"), undefined);
  assert.deepEqual(resolvedImportedTheme(empty, "dark"), dark);
  const identical = validateSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    themeLibrary: fullLibrary(),
    customTheme: dark,
    customLightTheme: { ...dark },
    customDarkTheme: { ...dark },
  });
  assert.equal(identical.themeLibrary.length, 65);
  assert.equal(identical.lightThemeId, identical.darkThemeId);
  assert.throws(
    () =>
      validateSettings({ ...normalizedCapacity(), customTheme: sharedPalette }),
    /67.*No palettes were removed/,
  );
});

function normalizedCapacity() {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    themeLibrary: Array.from({ length: 67 }, (_, index) => ({
      id: `capacity-${index}`,
      name: `Capacity ${index}`,
      colors: { foreground: "#010203" },
    })),
  };
}

test("legacy palettes migrate without losing independent appearance or extended colors", () => {
  const source = {
    ...structuredClone(DEFAULT_SETTINGS),
    customLightTheme: light,
    customDarkTheme: dark,
  };
  const migrated = migrateThemeLibrary(source);
  assert.equal(migrated.themeLibrary.length, 2);
  assert.notEqual(migrated.lightThemeId, migrated.darkThemeId);
  assert.deepEqual(resolvedImportedTheme(migrated, "light"), light);
  assert.deepEqual(resolvedImportedTheme(migrated, "dark"), dark);
  assert.deepEqual(
    migrateThemeLibrary(migrated),
    migrated,
    "repeated loads must not duplicate imports",
  );
  assert.equal(
    source.themeLibrary.length,
    0,
    "migration must not mutate the loaded preferences",
  );
});

test("shared legacy palettes deduplicate while retaining both selections", () => {
  const migrated = migrateThemeLibrary({
    ...structuredClone(DEFAULT_SETTINGS),
    customTheme: dark,
  });
  assert.equal(migrated.themeLibrary.length, 1);
  assert.equal(migrated.lightThemeId, migrated.darkThemeId);
  const builtIn = selectLibraryTheme(migrated, "light", "");
  assert.equal(resolvedImportedTheme(builtIn, "light"), undefined);
  assert.deepEqual(resolvedImportedTheme(builtIn, "dark"), dark);
});

test("saving, renaming and deleting named themes preserve other appearance selections", () => {
  let settings = saveLibraryTheme(
    structuredClone(DEFAULT_SETTINGS),
    "Evening",
    dark,
    "dark",
    "evening",
  );
  settings = saveLibraryTheme(settings, "Paper", light, "light", "paper");
  const renamed = renameLibraryTheme(settings, "evening", "Twilight");
  assert.equal(
    renamed.themeLibrary.find((theme) => theme.id === "evening")?.name,
    "Twilight",
  );
  assert.equal(renamed.darkThemeId, "evening");
  assert.equal(settings.themeLibrary[0].name, "Evening");
  const removed = deleteLibraryTheme(renamed, "evening");
  assert.equal(removed.darkThemeId, "");
  assert.equal(removed.lightThemeId, "paper");
  assert.deepEqual(resolvedImportedTheme(removed, "light"), light);
  assert.equal(
    resolvedImportedTheme(migrateThemeLibrary(removed), "dark"),
    undefined,
    "deleted colors must not reappear through legacy migration",
  );
  assert.deepEqual(
    removed.themeLibrary.map((theme) => theme.id),
    ["paper"],
  );
});

test("one saved palette can serve both appearances and deletion resets both safely", () => {
  let settings = validateSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    customTheme: dark,
  });
  settings = selectLibraryTheme(settings, "light", settings.darkThemeId);
  const removed = deleteLibraryTheme(settings, settings.darkThemeId);
  assert.equal(removed.lightThemeId, "");
  assert.equal(removed.darkThemeId, "");
  assert.equal(Object.hasOwn(removed, "customTheme"), false);
  assert.equal(migrateThemeLibrary(removed).themeLibrary.length, 0);
});

test("theme names and identifiers cannot collide and library growth is bounded", () => {
  let settings = saveLibraryTheme(
    structuredClone(DEFAULT_SETTINGS),
    "Ocean",
    dark,
    undefined,
    "ocean",
  );
  assert.throws(
    () => saveLibraryTheme(settings, "oCeAn", light, undefined, "other"),
    /different name/,
  );
  assert.throws(
    () => saveLibraryTheme(settings, "Other", light, undefined, "ocean"),
    /identifier/,
  );
  assert.throws(
    () => renameLibraryTheme(settings, "missing", "Other"),
    /no longer exists/,
  );
  assert.throws(
    () => selectLibraryTheme(settings, "dark", "missing"),
    /no longer exists/,
  );
  assert.equal(uniqueThemeName(settings.themeLibrary, "Ocean"), "Ocean 2");
  for (let index = 1; index < 64; index++)
    settings = saveLibraryTheme(
      settings,
      `Theme ${index}`,
      dark,
      undefined,
      `theme-${index}`,
    );
  assert.throws(
    () => saveLibraryTheme(settings, "Overflow", light, undefined, "overflow"),
    /64/,
  );
  assert.throws(() => renameLibraryTheme(settings, "ocean", "  "), /1–80/);
});
