import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";
import { terminalTheme } from "../terminal/themes";

/** Applies document appearance and follows the desktop's preferred color scheme. */
export function useInterfaceAppearance(settings: Settings | undefined) {
  const [interfaceTheme, setInterfaceTheme] = useState<string>();
  useEffect(() => {
    if (!settings) return;
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const theme =
        settings.theme === "system"
          ? settings.appearance === "light" ||
            (settings.appearance === "system" && media.matches)
            ? settings.lightTheme
            : settings.darkTheme
          : settings.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.chrome = theme.startsWith("macos")
        ? "macos"
        : "default";
      setInterfaceTheme(theme);
      document.documentElement.dataset.animation = settings.animation;
      // The stock highlight is tuned for Graphite; macOS uses its accent instead.
      document.documentElement.style.setProperty(
        "--active-pane-color",
        theme.startsWith("macos") &&
          settings.highlightColor === DEFAULT_SETTINGS.highlightColor
          ? "var(--mac-accent)"
          : settings.highlightColor,
      );
      document.documentElement.style.setProperty(
        "--active-pane-opacity",
        String(settings.highlightActivePane ? settings.highlightOpacity : 0),
      );
      const resolved = terminalTheme(settings);
      const root = document.documentElement;
      root.dataset.tintInterface = String(settings.tintInterface);
      for (const [key, value] of Object.entries({
        "--terminal-background": resolved.background,
        "--shell-background": resolved.background,
        "--shell-foreground": resolved.foreground,
        "--resolved-background": resolved.background,
        "--resolved-foreground": resolved.foreground,
        "--theme-accent": resolved.green,
      }))
        if (value) root.style.setProperty(key, value);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [
    settings?.theme,
    settings?.appearance,
    settings?.lightTheme,
    settings?.darkTheme,
    settings?.animation,
    settings?.highlightColor,
    settings?.highlightOpacity,
    settings?.highlightActivePane,
    settings?.themeLibrary,
    settings?.lightThemeId,
    settings?.darkThemeId,
    settings?.tintInterface,
  ]);
  return interfaceTheme;
}
