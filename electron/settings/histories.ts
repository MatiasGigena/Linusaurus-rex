import type { Settings } from "../../src/shared/types.js";
import { validateTrustedLink } from "../features/links.js";
import { identifier, record, string } from "../validation.js";

export function validateShortcuts(value: unknown): Settings["shortcuts"] {
  const shortcuts = record(value);
  if (Object.keys(shortcuts).length > 128)
    throw new Error("Too many shortcuts");
  return Object.fromEntries(
    Object.entries(shortcuts).map(([key, shortcut]) => [
      identifier(key, "shortcut action"),
      string(shortcut, "shortcut", 120),
    ]),
  );
}

export function validateTrustedLinks(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new Error("Too many trusted application targets");
  return [
    ...new Set(
      value.map((value) =>
        validateTrustedLink(string(value, "trusted application target", 512)),
      ),
    ),
  ];
}

export function validateRecentPaths(value: unknown): Settings["recentPaths"] {
  const history = record(value);
  if (Object.keys(history).length > 64)
    throw new Error("Too many path history hosts");
  return Object.fromEntries(
    Object.entries(history).map(([key, paths]) => {
      if (!Array.isArray(paths) || paths.length > 20)
        throw new Error("Path history must contain at most 20 paths per host");
      return [
        identifier(key, "path history host"),
        paths.map((path) => string(path, "recent path", 2048)),
      ];
    }),
  );
}
