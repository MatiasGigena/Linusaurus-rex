import { useState } from "react";
import { Section, Toggle, Select, Range, Color } from "./Controls";
import { ThemeLibrary } from "./ThemeLibrary";
import { type Settings } from "../../shared/types";
import type { PreferencesEditor } from "./types";

export function AppearancePreferences({
  draft,
  setDraft,
  update,
}: PreferencesEditor) {
  const [error, setError] = useState<string>();
  return (
    <>
      <Section title="LOOK & LAYOUT">
        <Select
          label="Theme"
          value={draft.theme}
          choices={[
            ["system", "Follow system"],
            ["macos", "macOS Dark"],
            ["macos-light", "macOS Light"],
            ["graphite", "Graphite"],
            ["midnight", "Midnight"],
            ["light", "Paper"],
          ]}
          onChange={(value) =>
            setDraft((previous) =>
              value === "system"
                ? { ...previous, theme: "system" }
                : {
                    ...previous,
                    theme: value as Settings["theme"],
                    customTheme: undefined,
                    customLightTheme: undefined,
                    customDarkTheme: undefined,
                    lightThemeId: "",
                    darkThemeId: "",
                  },
            )
          }
        />
        <Select
          label="Light appearance palette"
          value={draft.lightTheme}
          choices={[
            ["macos-light", "macOS Light"],
            ["light", "Paper"],
            ["macos", "macOS Dark"],
            ["graphite", "Graphite"],
            ["midnight", "Midnight"],
          ]}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              theme: "system",
              lightTheme: value as Settings["lightTheme"],
              lightThemeId: "",
              customLightTheme: undefined,
              customTheme: undefined,
            }))
          }
        />
        <Select
          label="Dark appearance palette"
          value={draft.darkTheme}
          choices={[
            ["macos", "macOS Dark"],
            ["graphite", "Graphite"],
            ["midnight", "Midnight"],
            ["macos-light", "macOS Light"],
            ["light", "Paper"],
          ]}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              theme: "system",
              darkTheme: value as Settings["darkTheme"],
              darkThemeId: "",
              customDarkTheme: undefined,
              customTheme: undefined,
            }))
          }
        />
        {(["light", "dark"] as const).map((appearance) => (
          <Toggle
            key={appearance}
            label={`Use extended palette in ${appearance} appearance`}
            value={
              draft.useExtendedPalette &&
              (appearance === "light"
                ? draft.useExtendedLightPalette
                : draft.useExtendedDarkPalette)
            }
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                useExtendedPalette: true,
                useExtendedLightPalette:
                  previous.useExtendedPalette &&
                  previous.useExtendedLightPalette,
                useExtendedDarkPalette:
                  previous.useExtendedPalette &&
                  previous.useExtendedDarkPalette,
                [appearance === "light"
                  ? "useExtendedLightPalette"
                  : "useExtendedDarkPalette"]: value,
              }))
            }
          />
        ))}
        <Select
          label="Appearance"
          value={draft.appearance}
          choices={[
            ["system", "System"],
            ["dark", "Dark"],
            ["light", "Light"],
          ]}
          onChange={(value) =>
            update("appearance", value as Settings["appearance"])
          }
        />
        <Range
          label="Interface zoom"
          value={Math.round(draft.interfaceZoom * 100)}
          min={70}
          max={150}
          step={5}
          unit="%"
          onChange={(value) => update("interfaceZoom", value / 100)}
        />
        <Select
          label="Tab placement"
          value={draft.tabStyle}
          choices={[
            ["left", "Left sidebar"],
            ["right", "Right sidebar"],
            ["top", "Above terminals"],
          ]}
          onChange={(value) =>
            update("tabStyle", value as Settings["tabStyle"])
          }
        />
        <Toggle
          label="Fill the horizontal tab bar"
          value={draft.fillTabs}
          onChange={(value) => update("fillTabs", value)}
        />
        <Range
          label="Program icons per tab"
          value={draft.tabIcons}
          min={0}
          max={5}
          onChange={(value) => update("tabIcons", value)}
        />
        <Select
          label="Color tab icons"
          value={draft.tabIconColors}
          choices={[
            ["always", "Always"],
            ["active-pane", "Focused pane"],
            ["active-tab", "Active tab"],
            ["never", "Never"],
          ]}
          onChange={(value) =>
            update("tabIconColors", value as Settings["tabIconColors"])
          }
        />
        <Toggle
          label="Tint interface with terminal theme"
          value={draft.tintInterface}
          onChange={(value) => update("tintInterface", value)}
        />
        <Select
          label="Shell icon theme"
          value={draft.shellIconTheme}
          choices={[
            ["default", "Default artwork"],
            ["theme", "Theme background and foreground"],
            ["accent", "Theme accent"],
          ]}
          onChange={(value) =>
            update("shellIconTheme", value as Settings["shellIconTheme"])
          }
        />
      </Section>
      <Section title="NAMED THEMES">
        <ThemeLibrary settings={draft} onChange={setDraft} onError={setError} />
      </Section>
      <Section title="PANES">
        <Select
          label="Pane spacing"
          value={draft.paneStyle}
          choices={[
            ["comfortable", "Comfortable"],
            ["compact", "Compact"],
          ]}
          onChange={(value) =>
            update("paneStyle", value as Settings["paneStyle"])
          }
        />
        <Toggle
          label="Show pane headers"
          value={draft.showPaneHeaders}
          onChange={(value) => update("showPaneHeaders", value)}
        />
        <Toggle
          label="Match full-screen program backgrounds"
          value={draft.matchProgramBackground}
          onChange={(value) => update("matchProgramBackground", value)}
        />
        <Select
          label="Padding color"
          value={draft.paddingColor}
          choices={[
            ["pane", "Pane background"],
            ["extend", "Extend edge-cell backgrounds"],
          ]}
          onChange={(value) =>
            update("paddingColor", value as Settings["paddingColor"])
          }
        />
        <Range
          label="Horizontal padding"
          value={draft.paddingX}
          min={0}
          max={40}
          unit="px"
          onChange={(value) => update("paddingX", value)}
        />
        <Range
          label="Vertical padding"
          value={draft.paddingY}
          min={0}
          max={40}
          unit="px"
          onChange={(value) => update("paddingY", value)}
        />
        <Toggle
          label="Highlight focused pane"
          value={draft.highlightActivePane}
          onChange={(value) => update("highlightActivePane", value)}
        />
        <Color
          label="Highlight color"
          value={draft.highlightColor}
          onChange={(value) => update("highlightColor", value)}
        />
        <Range
          label="Highlight strength"
          value={Math.round(draft.highlightOpacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => update("highlightOpacity", value / 100)}
        />
        <Select
          label="Active pane highlight animation"
          value={draft.highlightAnimation}
          choices={[
            ["fade", "Fade"],
            ["move", "Move"],
            ["instant", "Instant"],
          ]}
          onChange={(value) =>
            update(
              "highlightAnimation",
              value as Settings["highlightAnimation"],
            )
          }
        />
        <Select
          label="Fade inactive pane elements"
          value={draft.inactivePaneFadeTarget}
          choices={[
            ["content", "Terminal content"],
            ["surfaces", "Pane surfaces"],
            ["both", "Surfaces and content"],
          ]}
          onChange={(value) =>
            update(
              "inactivePaneFadeTarget",
              value as Settings["inactivePaneFadeTarget"],
            )
          }
        />
        <Range
          label="Fade inactive panes"
          value={Math.round(draft.inactivePaneFade * 100)}
          min={0}
          max={80}
          unit="%"
          onChange={(value) => update("inactivePaneFade", value / 100)}
        />
        <Toggle
          label="Focus follows mouse"
          value={draft.focusFollowsMouse}
          onChange={(value) => update("focusFollowsMouse", value)}
        />
        <Toggle
          label="Balance splits after adding or closing panes"
          value={draft.autobalanceSplits}
          onChange={(value) => update("autobalanceSplits", value)}
        />
        <Toggle
          label="Trackpad pinch to zoom pane"
          value={draft.trackpadGestures}
          onChange={(value) => update("trackpadGestures", value)}
        />
        <Select
          label="Sidebar gesture"
          value={draft.sidebarGesture}
          choices={[
            ["off", "Off"],
            ["swipe", "Horizontal swipe"],
            ["alt-swipe", "Alt + swipe"],
          ]}
          onChange={(value) =>
            update("sidebarGesture", value as Settings["sidebarGesture"])
          }
        />
        <Select
          label="Animation"
          value={draft.animation}
          choices={[
            ["snappy", "Snappy"],
            ["natural", "Natural"],
            ["off", "Off"],
          ]}
          onChange={(value) =>
            update("animation", value as Settings["animation"])
          }
        />
      </Section>
      <Section title="WINDOW">
        <Range
          label="Fade inactive windows"
          value={draft.inactiveWindowFade}
          min={0}
          max={0.8}
          step={0.05}
          onChange={(value) => update("inactiveWindowFade", value)}
        />
        <Toggle
          label="Preserve window width when resizing the sidebar"
          value={draft.preserveWindowWidth}
          onChange={(value) => update("preserveWindowWidth", value)}
        />
        <Range
          label="Sidebar width"
          value={draft.sidebarWidth}
          min={190}
          max={500}
          step={10}
          onChange={(value) => update("sidebarWidth", value)}
        />
        <Toggle
          label="Confirm before closing terminals"
          value={draft.confirmClose}
          onChange={(value) => update("confirmClose", value)}
        />
        <Toggle
          label="Keep running in the system tray when closed"
          value={draft.closeToTray}
          onChange={(value) => update("closeToTray", value)}
        />
        <Toggle
          label="Show workspace on launch"
          value={draft.showWindowOnLaunch}
          onChange={(value) => update("showWindowOnLaunch", value)}
        />
      </Section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
