import type { Settings } from "../shared/types";

export interface LibraryTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}
export type ThemeAppearance = "light" | "dark";
export const MAX_LIBRARY_THEMES = 64;

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
const legacySlot = (appearance: ThemeAppearance) =>
  appearance === "light" ? "customLightTheme" : "customDarkTheme";

/** Keep legacy imports available while moving their active selection into the named library. */
export function migrateThemeLibrary(settings: Settings): Settings {
  const next = structuredClone(settings);
  next.themeLibrary ||= [];
  next.lightThemeId ||= "";
  next.darkThemeId ||= "";
  for (const appearance of ["light", "dark"] as const) {
    const selected = next[slot(appearance)];
    if (selected && next.themeLibrary.some((theme) => theme.id === selected))
      continue;
    next[slot(appearance)] = "";
    const colors = next[legacySlot(appearance)] || next.customTheme;
    if (!colors || !Object.keys(colors).length) continue;
    let saved = next.themeLibrary.find((theme) =>
      sameColors(theme.colors, colors),
    );
    if (!saved && next.themeLibrary.length < MAX_LIBRARY_THEMES) {
      const base = `legacy-${appearance}`;
      let id = base,
        suffix = 2;
      while (next.themeLibrary.some((theme) => theme.id === id))
        id = `${base}-${suffix++}`;
      saved = {
        id,
        name: uniqueThemeName(next.themeLibrary, `Imported ${appearance}`),
        colors: { ...colors },
      };
      next.themeLibrary.push(saved);
    }
    if (saved) next[slot(appearance)] = saved.id;
  }
  return next;
}

export function resolvedImportedTheme(
  settings: Settings,
  appearance: ThemeAppearance,
): Record<string, string> | undefined {
  const saved = settings.themeLibrary?.find(
    (theme) => theme.id === settings[slot(appearance)],
  );
  return (
    saved?.colors || settings[legacySlot(appearance)] || settings.customTheme
  );
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
    [legacySlot(appearance)]: undefined,
    customTheme: undefined,
  };
}

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
      `The library can hold ${MAX_LIBRARY_THEMES} themes. Remove a saved theme before importing another.`,
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
      next[legacySlot(appearance)] = undefined;
      // A legacy shared import must not resurrect a deleted active theme.
      next.customTheme = undefined;
    }
  }
  return next;
}
