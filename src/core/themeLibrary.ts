import type { Settings } from "../shared/types";

export interface LibraryTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}
export type ThemeAppearance = "light" | "dark";
export const MAX_LIBRARY_THEMES = 64;
// Older settings can contain 64 saved entries plus three distinct legacy
// palettes. Reserve enough persisted slots to migrate all three losslessly.
export const MAX_PERSISTED_LIBRARY_THEMES = MAX_LIBRARY_THEMES + 3;
export interface LegacyThemePalettes {
  customTheme?: Record<string, string>;
  customLightTheme?: Record<string, string>;
  customDarkTheme?: Record<string, string>;
}

const sameColors = (
  left: Record<string, string>,
  right: Record<string, string>,
) => {
  const a = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const b = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(a) === JSON.stringify(b);
};
const slot = (appearance: ThemeAppearance) =>
  appearance === "light" ? "lightThemeId" : "darkThemeId";
/**
 * Copy and normalize legacy input, retaining inactive palettes as named entries.
 * Throws if an additional legacy entry would exceed MAX_PERSISTED_LIBRARY_THEMES;
 * never drops palettes or changes the input to make room.
 */
export function migrateThemeLibrary(
  settings: Settings & LegacyThemePalettes,
): Settings {
  const { customTheme, customLightTheme, customDarkTheme, ...current } =
    settings;
  const next = structuredClone(current);
  const existingIds = new Set(next.themeLibrary.map((theme) => theme.id));
  const legacy = {
    shared: customTheme,
    light: customLightTheme,
    dark: customDarkTheme,
  };
  const imported = new Map<keyof typeof legacy, string>();
  for (const kind of ["shared", "light", "dark"] as const) {
    const colors = legacy[kind];
    if (!colors || !Object.keys(colors).length) continue;
    let saved = next.themeLibrary.find((theme) =>
      sameColors(theme.colors, colors),
    );
    if (!saved) {
      if (next.themeLibrary.length >= MAX_PERSISTED_LIBRARY_THEMES) {
        throw new Error(
          `Legacy palettes need more than ${MAX_PERSISTED_LIBRARY_THEMES} saved theme slots. No palettes were removed or replaced.`,
        );
      }
      const base = `legacy-${kind}`;
      let id = base,
        suffix = 2;
      while (next.themeLibrary.some((theme) => theme.id === id))
        id = `${base}-${suffix++}`;
      saved = {
        id,
        name: uniqueThemeName(next.themeLibrary, `Imported ${kind}`),
        colors: { ...colors },
      };
      next.themeLibrary.push(saved);
    }
    imported.set(kind, saved.id);
  }
  for (const appearance of ["light", "dark"] as const) {
    const selected = next[slot(appearance)];
    if (selected && existingIds.has(selected)) continue;
    // An explicitly empty appearance palette masks the shared fallback just as
    // it did before migration, but has no colors to retain as a library entry.
    const kind = legacy[appearance] === undefined ? "shared" : appearance;
    next[slot(appearance)] = imported.get(kind) || "";
  }
  return next;
}

/** Return the selected palette, or undefined for an empty or missing identifier. */
export function resolvedImportedTheme(
  settings: Settings,
  appearance: ThemeAppearance,
): Record<string, string> | undefined {
  return settings.themeLibrary.find(
    (theme) => theme.id === settings[slot(appearance)],
  )?.colors;
}

export function uniqueThemeName(
  themes: LibraryTheme[],
  preferred: string,
): string {
  const base = preferred.trim().slice(0, 80) || "Imported theme";
  const used = new Set(themes.map((theme) => theme.name.toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base.slice(0, 72)} ${suffix}`.toLocaleLowerCase()))
    suffix++;
  return `${base.slice(0, 72)} ${suffix}`;
}

/**
 * Select a saved theme and enable system appearance; an empty id clears the slot.
 * Throws for a nonempty identifier absent from the library.
 */
export function selectLibraryTheme(
  settings: Settings,
  appearance: ThemeAppearance,
  id: string,
): Settings {
  if (id && !settings.themeLibrary?.some((theme) => theme.id === id))
    throw new Error("This saved theme no longer exists.");
  return {
    ...settings,
    theme: "system",
    [slot(appearance)]: id,
  };
}

/**
 * Append a theme, optionally selecting it. Throws at MAX_LIBRARY_THEMES capacity,
 * for an empty/duplicate id or colors with no entries, or if the trimmed name is
 * outside 1–80 characters, contains controls or duplicates a name ignoring case.
 */
export function saveLibraryTheme(
  settings: Settings,
  name: string,
  colors: Record<string, string>,
  appearance?: ThemeAppearance,
  id: string = crypto.randomUUID(),
): Settings {
  const library = settings.themeLibrary || [];
  if (library.length >= MAX_LIBRARY_THEMES)
    throw new Error(
      `The library has ${library.length} themes. Remove saved themes until fewer than ${MAX_LIBRARY_THEMES} remain before importing another.`,
    );
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 80 || /[\x00-\x1f\x7f]/.test(cleaned))
    throw new Error(
      "Theme names must contain 1–80 characters without control characters.",
    );
  if (
    library.some(
      (theme) => theme.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase(),
    )
  )
    throw new Error("Choose a different name for this theme.");
  if (!id || library.some((theme) => theme.id === id))
    throw new Error("This theme identifier is already in use.");
  if (!Object.keys(colors).length)
    throw new Error("This theme does not contain any colors.");
  let next: Settings = {
    ...settings,
    themeLibrary: [...library, { id, name: cleaned, colors: { ...colors } }],
  };
  if (appearance) next = selectLibraryTheme(next, appearance, id);
  return next;
}

/**
 * Rename an existing id; throws if it is missing or the name fails the same
 * trimmed length, control-character or case-insensitive uniqueness rules as save.
 */
export function renameLibraryTheme(
  settings: Settings,
  id: string,
  name: string,
): Settings {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 80 || /[\x00-\x1f\x7f]/.test(cleaned))
    throw new Error(
      "Theme names must contain 1–80 characters without control characters.",
    );
  if (!settings.themeLibrary?.some((theme) => theme.id === id))
    throw new Error("This saved theme no longer exists.");
  if (
    settings.themeLibrary.some(
      (theme) =>
        theme.id !== id &&
        theme.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase(),
    )
  )
    throw new Error("Choose a different name for this theme.");
  return {
    ...settings,
    themeLibrary: settings.themeLibrary.map((theme) =>
      theme.id === id ? { ...theme, name: cleaned } : theme,
    ),
  };
}

/** Remove an id and clear its appearance slots; missing ids are accepted. */
export function deleteLibraryTheme(settings: Settings, id: string): Settings {
  const next = {
    ...settings,
    themeLibrary: (settings.themeLibrary || []).filter(
      (theme) => theme.id !== id,
    ),
  };
  for (const appearance of ["light", "dark"] as const) {
    if (settings[slot(appearance)] === id) {
      next[slot(appearance)] = "";
    }
  }
  return next;
}
