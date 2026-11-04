import { DEFAULT_SETTINGS, type Settings } from "../../src/shared/types.js";
import { migrateThemeLibrary } from "../../src/core/themeLibrary.js";
import { record } from "../validation.js";
import { validateHosts, validateLastSelection } from "./hosts.js";
import { applyPreferences } from "./preferences.js";
import { validateNotifications } from "./notifications.js";
import { applyThemes } from "./themes.js";
import {
  validateRecentPaths,
  validateShortcuts,
  validateTrustedLinks,
} from "./histories.js";

export function validateSettings(value: unknown): Settings {
  const input = record(value);
  const hosts = validateHosts(input.hosts);
  const result = structuredClone(DEFAULT_SETTINGS);
  applyPreferences(input, result);
  result.notifications = validateNotifications(input.notifications);
  if (input.shortcuts !== undefined)
    result.shortcuts = validateShortcuts(input.shortcuts);
  applyThemes(input, result);
  if (input.trustedLinks !== undefined)
    result.trustedLinks = validateTrustedLinks(input.trustedLinks);
  if (input.recentPaths !== undefined)
    result.recentPaths = validateRecentPaths(input.recentPaths);
  const lastSelection = validateLastSelection(input.lastSelection, hosts);
  return migrateThemeLibrary({
    ...result,
    hosts,
    ...(lastSelection ? { lastSelection } : {}),
  });
}
