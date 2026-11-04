import { useState } from "react";
import { Download, Palette, Save, Trash2 } from "lucide-react";
import type { Settings } from "../../shared/types";
import { TERMINAL_THEMES } from "../../terminal/themes";
import {
  deleteLibraryTheme,
  renameLibraryTheme,
  resolvedImportedTheme,
  saveLibraryTheme,
  selectLibraryTheme,
  uniqueThemeName,
  type LibraryTheme,
  type ThemeAppearance,
} from "../../core/themeLibrary";
import { errorMessage } from "../../core/workspace";

export function ThemeLibrary({
  settings,
  onChange,
  onError,
}: {
  settings: Settings;
  onChange(settings: Settings): void;
  onError(message?: string): void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const draft = settings;
  const apply = (operation: () => Settings) => {
    try {
      onChange(operation());
      onError(undefined);
    } catch (failure) {
      onError(errorMessage(failure));
    }
  };
  const importTheme = async (appearance: ThemeAppearance) => {
    setLoading(true);
    try {
      const colors = await window.rex.request("importTheme", {});
      if (colors)
        apply(() =>
          saveLibraryTheme(
            draft,
            uniqueThemeName(draft.themeLibrary, `Imported ${appearance}`),
            colors,
            appearance,
          ),
        );
    } catch (failure) {
      onError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  };
  const saveCurrent = (appearance: ThemeAppearance) =>
    apply(() => {
      const builtIn =
        TERMINAL_THEMES[
          appearance === "light" ? draft.lightTheme : draft.darkTheme
        ];
      const colors =
        resolvedImportedTheme(draft, appearance) ||
        Object.fromEntries(
          Object.entries(builtIn).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      return saveLibraryTheme(
        draft,
        uniqueThemeName(draft.themeLibrary, `Saved ${appearance}`),
        colors,
        appearance,
      );
    });
  return (
    <div className="theme-library">
      <p className="form-hint">
        Import Ghostty or iTerm palettes, keep them by name, and choose a
        different saved theme for each appearance. Changes take effect when you
        save settings.
      </p>
      {(["light", "dark"] as const).map((appearance) => (
        <div className="theme-library-slot" key={appearance}>
          <label className="form-field">
            Saved {appearance} theme
            <select
              className="form-select"
              value={
                appearance === "light" ? draft.lightThemeId : draft.darkThemeId
              }
              onChange={(event) =>
                apply(() =>
                  selectLibraryTheme(draft, appearance, event.target.value),
                )
              }
            >
              <option value="">
                Built-in{" "}
                {appearance === "light" ? draft.lightTheme : draft.darkTheme}{" "}
                palette
              </option>
              {draft.themeLibrary.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-buttons">
            <button
              type="button"
              className="button"
              disabled={loading}
              onClick={() => void importTheme(appearance)}
            >
              <Download size={13} />
              Import {appearance} palette…
            </button>
            <button
              type="button"
              className="button"
              onClick={() => saveCurrent(appearance)}
            >
              <Save size={13} />
              Save current {appearance} palette
            </button>
          </div>
        </div>
      ))}
      {draft.themeLibrary.length > 0 ? (
        <div
          className="theme-library-list"
          role="list"
          aria-label="Saved themes"
        >
          {draft.themeLibrary.map((theme: LibraryTheme) => (
            <div className="theme-library-entry" role="listitem" key={theme.id}>
              <div
                className="theme-swatches"
                role="img"
                aria-label={`${theme.name} colors: background ${theme.colors.background || "default"}, foreground ${theme.colors.foreground || "default"}`}
                style={{ background: theme.colors.background || "#353b41" }}
              >
                {[
                  "foreground",
                  "red",
                  "green",
                  "yellow",
                  "blue",
                  "magenta",
                  "cyan",
                ].map((key) => (
                  <span
                    key={key}
                    style={{
                      background:
                        theme.colors[key] ||
                        theme.colors.foreground ||
                        "#c6cfd7",
                    }}
                  />
                ))}
              </div>
              <input
                className="form-input"
                aria-label={`Theme name ${theme.name}`}
                maxLength={80}
                value={names[theme.id] ?? theme.name}
                onChange={(event) =>
                  setNames((previous) => ({
                    ...previous,
                    [theme.id]: event.target.value,
                  }))
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Rename ${theme.name}`}
                title="Save name"
                disabled={
                  names[theme.id] === undefined ||
                  names[theme.id].trim() === theme.name
                }
                onClick={() =>
                  apply(() =>
                    renameLibraryTheme(draft, theme.id, names[theme.id]),
                  )
                }
              >
                <Save size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${theme.name}`}
                title="Remove from library"
                onClick={() => apply(() => deleteLibraryTheme(draft, theme.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="theme-library-empty">
          <Palette size={18} />
          <span>
            No saved themes yet. Import a palette or save the current colors.
          </span>
        </div>
      )}
    </div>
  );
}
