import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
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
  let settings = saveLibraryTheme(
    { ...structuredClone(DEFAULT_SETTINGS), customTheme: dark },
    "Shared",
    dark,
    "dark",
    "shared",
  );
  settings = selectLibraryTheme(settings, "light", "shared");
  const removed = deleteLibraryTheme(settings, "shared");
  assert.equal(removed.lightThemeId, "");
  assert.equal(removed.darkThemeId, "");
  assert.equal(removed.customTheme, undefined);
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
