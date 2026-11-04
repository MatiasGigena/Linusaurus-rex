import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../electron/settings.js";
import { validateSettings } from "../electron/settings/validation.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
import {
  deleteLibraryTheme,
  renameLibraryTheme,
  resolvedImportedTheme,
  saveLibraryTheme,
} from "../src/core/themeLibrary.js";

test("preferences survive restart and returned objects cannot mutate saved settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "settings.json");
  const store = new SettingsStore(path);
  await store.load();
  const preference = {
    ...structuredClone(DEFAULT_SETTINGS),
    fontSize: 32,
    sidebarCollapsed: true,
  };
  await store.set(preference);
  const returned = store.get();
  returned.hosts[0].label = "Modified outside the store";
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.deepEqual(reopened.get(), preference);
  assert.equal(store.get().hosts[0].label, DEFAULT_SETTINGS.hosts[0].label);
});

test("legacy themes at capacity survive normalization, editing, saving, and restart without resurrecting deleted palettes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-theme-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const shared = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [
      `palette${index}`,
      `#${(0x234500 + index).toString(16)}`,
    ]),
  );
  const light = { background: "#ffffff", foreground: "#112233" };
  const dark = { background: "#112233", foreground: "#ffffff" };
  await writeFile(
    path,
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      themeLibrary: Array.from({ length: 64 }, (_, index) => ({
        id: `theme-${index}`,
        name: `Theme ${index}`,
        colors: { background: `#${index.toString(16).padStart(6, "0")}` },
      })),
      customTheme: shared,
      customLightTheme: light,
      customDarkTheme: dark,
    }),
  );
  const store = new SettingsStore(path);
  await store.load();
  const loaded = store.get();
  assert.equal(loaded.themeLibrary.length, 67);
  assert.deepEqual(resolvedImportedTheme(loaded, "light"), light);
  assert.deepEqual(resolvedImportedTheme(loaded, "dark"), dark);
  assert.throws(() => saveLibraryTheme(loaded, "Another", light), /64/);
  const renamed = renameLibraryTheme(
    loaded,
    loaded.darkThemeId,
    "Night palette",
  );
  await store.set(renamed);
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.deepEqual(reopened.get(), renamed);
  assert.equal(
    Object.hasOwn(JSON.parse(await readFile(path, "utf8")), "customTheme"),
    false,
  );
  let edited = deleteLibraryTheme(reopened.get(), loaded.darkThemeId);
  assert.equal(edited.darkThemeId, "");
  assert.deepEqual(resolvedImportedTheme(edited, "light"), light);
  while (edited.themeLibrary.length >= 64) {
    assert.throws(() => saveLibraryTheme(edited, "Still full", light), /64/);
    edited = deleteLibraryTheme(edited, edited.themeLibrary[0].id);
  }
  const added = saveLibraryTheme(edited, "New palette", dark, "dark", "new");
  await reopened.set(added);
  const final = new SettingsStore(path);
  await final.load();
  assert.deepEqual(final.get(), added);
  assert.equal(
    final.get().themeLibrary.some((theme) => theme.id === loaded.darkThemeId),
    false,
  );
  assert.deepEqual(
    final
      .get()
      .themeLibrary.find((theme) => Object.keys(theme.colors).length === 256)
      ?.colors,
    shared,
  );
});

test("concurrent preference updates leave the last requested value on disk", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const store = new SettingsStore(path);
  const updates = [14, 20, 18, 32].map((fontSize) => ({
    ...structuredClone(DEFAULT_SETTINGS),
    fontSize,
  }));
  await Promise.all(updates.map((value) => store.set(value)));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), updates.at(-1));
  assert.deepEqual(store.get(), updates.at(-1));
});

test("invalid settings cannot replace working preferences", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const store = new SettingsStore(path);
  await store.set(DEFAULT_SETTINGS);
  for (const invalid of [
    { ...DEFAULT_SETTINGS, fontSize: 100 },
    { ...DEFAULT_SETTINGS, sidebarCollapsed: "yes" },
    { ...DEFAULT_SETTINGS, hosts: [] },
    {
      ...DEFAULT_SETTINGS,
      hosts: [DEFAULT_SETTINGS.hosts[0], DEFAULT_SETTINGS.hosts[0]],
    },
    {
      ...DEFAULT_SETTINGS,
      hosts: [{ id: "bad\0host", label: "Bad", endpoint: "" }],
    },
  ])
    await assert.rejects(store.set(invalid));
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), DEFAULT_SETTINGS);
});

test("macOS theme names are accepted and unknown theme names are rejected", () => {
  const chosen = validateSettings({
    ...DEFAULT_SETTINGS,
    theme: "macos-light",
    lightTheme: "macos-light",
    darkTheme: "macos",
  });
  assert.equal(chosen.theme, "macos-light");
  assert.equal(chosen.lightTheme, "macos-light");
  assert.equal(chosen.darkTheme, "macos");
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, theme: "aqua" }));
});

test("removing a host removes a stale selection and strips unknown fields", () => {
  const result = validateSettings({
    ...DEFAULT_SETTINGS,
    lastSelection: {
      hostId: "removed",
      sessionId: "old-session",
      windowId: "old-window",
    },
    arbitraryCommand: "not a saved setting",
  });
  assert.equal(result.lastSelection, undefined);
  assert.equal("arbitraryCommand" in result, false);
});

test("failed settings loads preserve the original file and refuse writes until repaired", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const store = new SettingsStore(path);
  for (const content of ["{ invalid json", JSON.stringify({ fontSize: 100 })]) {
    await writeFile(path, content);
    await assert.rejects(store.load(), /Settings could not be loaded.*Repair/);
    await assert.rejects(
      store.set({ ...DEFAULT_SETTINGS, fontSize: 18 }),
      /Settings could not be loaded/,
    );
    assert.equal(await readFile(path, "utf8"), content);
  }
  await writeFile(path, JSON.stringify({ ...DEFAULT_SETTINGS, fontSize: 20 }));
  await store.load();
  assert.equal(store.get().fontSize, 20);
  await store.set({ ...DEFAULT_SETTINGS, fontSize: 18 });
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.equal(reopened.get().fontSize, 18);
});

test("legacy shortcut keys normalize once with canonical overrides, disabled bindings and custom actions preserved", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "linusaurus-shortcuts-upgrade-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const input = {
    ...structuredClone(DEFAULT_SETTINGS),
    shortcuts: {
      copy: "Ctrl+Alt+C",
      "client.copy": "",
      paste: "Ctrl+Alt+V",
      "command-palette": "Super+P",
      "plugin.example": "Super+E",
    },
  };
  await writeFile(path, JSON.stringify(input));
  const store = new SettingsStore(path);
  await store.load();
  const canonical = {
    "client.copy": "",
    "client.paste": "Ctrl+Alt+V",
    "client.palette.toggle": "Super+P",
    "plugin.example": "Super+E",
  };
  assert.deepEqual(store.get().shortcuts, canonical);
  await store.set(store.get());
  assert.deepEqual(
    JSON.parse(await readFile(path, "utf8")).shortcuts,
    canonical,
  );
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.deepEqual(reopened.get().shortcuts, canonical);
  assert.equal(DEFAULT_SETTINGS.shortcuts["client.copy"], "Ctrl+Shift+C");
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS.shortcuts, "copy"), false);
  const reversed = Object.fromEntries(
    Object.entries(input.shortcuts).reverse(),
  );
  assert.deepEqual(
    validateSettings({ ...input, shortcuts: reversed }).shortcuts,
    canonical,
  );
});
