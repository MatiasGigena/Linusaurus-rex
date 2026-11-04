import type { Settings } from "../../src/shared/types.js";
import { hexColor, identifier, record, string } from "../validation.js";

export function validateTheme(value: unknown): Record<string, string> {
  const theme = record(value);
  if (Object.keys(theme).length > 320)
    throw new Error("Theme has too many colors");
  return Object.fromEntries(
    Object.entries(theme).map(([key, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key))
        throw new Error("Invalid custom theme color");
      return [key, hexColor(value, "custom theme color")];
    }),
  );
}

export function applyThemes(input: Record<string, unknown>, result: Settings) {
  for (const name of [
    "customTheme",
    "customLightTheme",
    "customDarkTheme",
  ] as const) {
    if (input[name] !== undefined) result[name] = validateTheme(input[name]);
  }
  if (input.themeLibrary === undefined) return;
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
