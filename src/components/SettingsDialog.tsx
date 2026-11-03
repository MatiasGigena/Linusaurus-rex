import { useEffect, useState } from "react";
import {
  Check,
  Code2,
  Keyboard,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  Bell,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { ThemeLibrary } from "./ThemeLibrary";
import { migrateThemeLibrary } from "../core/themeLibrary";
import type { Host, IntegrationPreview, Settings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { errorMessage } from "../core/workspace";

export type SettingsTab =
  | "appearance"
  | "terminal"
  | "notifications"
  | "hosts"
  | "integrations"
  | "shortcuts"
  | "server";
interface Props {
  settings: Settings;
  initialTab?: SettingsTab;
  onSave(settings: Settings): Promise<Settings>;
  onClose(): void;
  onAddHost(): void;
  onEditHost(host: Host): void;
  onConfig(): void;
  onDiagnostics(): void;
  onNativeServices?(): void;
}
const tabs = [
  ["appearance", "Appearance", Palette],
  ["terminal", "Terminal", TerminalSquare],
  ["notifications", "Notifications", Bell],
  ["hosts", "Hosts", Server],
  ["integrations", "Agents", Code2],
  ["shortcuts", "Keyboard", Keyboard],
  ["server", "Server", Monitor],
] as const;

export function SettingsDialog({
  settings,
  initialTab = "appearance",
  onSave,
  onClose,
  onAddHost,
  onEditHost,
  onConfig,
  onDiagnostics,
  onNativeServices,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState(() => migrateThemeLibrary(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [integrationOutput, setIntegrationOutput] = useState("");
  const [agents, setAgents] = useState<string[]>([
    "claude",
    "codex",
    "opencode",
    "pi",
  ]);
  const [preview, setPreview] = useState<IntegrationPreview>();
  const [integrating, setIntegrating] = useState(false);
  const [fontFaces, setFontFaces] = useState<
    {
      family: string;
      fullName: string;
      style: string;
      postscriptName: string;
    }[]
  >();
  const [fontLoading, setFontLoading] = useState(false);
  const browseFonts = async () => {
    setFontLoading(true);
    try {
      const query = (
        window as Window & {
          queryLocalFonts?: () => Promise<
            {
              family: string;
              fullName: string;
              style: string;
              postscriptName: string;
            }[]
          >;
        }
      ).queryLocalFonts;
      if (!query)
        throw new Error(
          "This desktop runtime does not expose local fonts. Enter an installed font family directly.",
        );
      setFontFaces(
        (await query()).sort(
          (a, b) =>
            a.family.localeCompare(b.family) || a.style.localeCompare(b.style),
        ),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setFontLoading(false);
    }
  };
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const updateNotification = <K extends keyof Settings["notifications"]>(
    key: K,
    value: Settings["notifications"][K],
  ) =>
    setDraft((previous) => ({
      ...previous,
      notifications: { ...previous.notifications, [key]: value },
    }));
  useEffect(() => {
    if (tab === "integrations")
      void window.rex
        .request("integrationsStatus", {})
        .then((result) => setIntegrationOutput(result.output))
        .catch((failure) => setIntegrationOutput(errorMessage(failure)));
  }, [tab]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setSaving(false);
    }
  };
  const makePreview = async (operation: "setup" | "remove") => {
    setIntegrating(true);
    setError(undefined);
    try {
      const result = await window.rex.request("integrationsPreview", {
        operation,
        agents,
        letAgentsNameSessions: draft.letAgentsNameSessions,
      });
      setPreview(result);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setIntegrating(false);
    }
  };
  return (
    <Dialog
      title="Settings"
      subtitle="Your workspace, your way."
      wide
      onClose={onClose}
      className="preferences-dialog"
    >
      <form onSubmit={(event) => void save(event)} className="preferences-form">
        <nav className="preferences-tabs" aria-label="Settings categories">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <div className="preferences-content">
          {tab === "appearance" && (
            <>
              <Section title="LOOK & LAYOUT">
                <Select
                  label="Theme"
                  value={draft.theme}
                  choices={[
                    ["graphite", "Graphite"],
                    ["midnight", "Midnight"],
                    ["light", "Paper"],
                    ["system", "Follow system"],
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
                    ["light", "Paper"],
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
                    ["graphite", "Graphite"],
                    ["midnight", "Midnight"],
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
                    update(
                      "shellIconTheme",
                      value as Settings["shellIconTheme"],
                    )
                  }
                />
              </Section>
              <Section title="NAMED THEMES">
                <ThemeLibrary
                  settings={draft}
                  onChange={setDraft}
                  onError={setError}
                />
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
                    update(
                      "sidebarGesture",
                      value as Settings["sidebarGesture"],
                    )
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
            </>
          )}
          {tab === "terminal" && (
            <>
              <Section title="TYPOGRAPHY">
                <Text
                  label="Font family and fallbacks"
                  value={draft.fontFamily}
                  onChange={(value) => update("fontFamily", value)}
                />
                <div className="settings-buttons">
                  <button
                    type="button"
                    className="button"
                    disabled={fontLoading}
                    onClick={() => void browseFonts()}
                  >
                    {fontLoading ? "Reading fonts…" : "Browse installed fonts"}
                  </button>
                </div>
                {fontFaces && (
                  <label className="form-field">
                    Installed font face
                    <select
                      className="form-select"
                      defaultValue=""
                      onChange={(event) => {
                        const face = fontFaces.find(
                          (face) => face.postscriptName === event.target.value,
                        );
                        if (!face) return;
                        const style = face.style.toLowerCase();
                        const weight = /black|heavy/.test(style)
                          ? 900
                          : /extra.?bold/.test(style)
                            ? 800
                            : /semi.?bold|demi/.test(style)
                              ? 600
                              : /bold/.test(style)
                                ? 700
                                : /extra.?light/.test(style)
                                  ? 200
                                  : /light/.test(style)
                                    ? 300
                                    : /medium/.test(style)
                                      ? 500
                                      : 400;
                        setDraft((previous) => ({
                          ...previous,
                          fontFamily: `${JSON.stringify(face.family)}, monospace`,
                          fontStyle: /italic/.test(style)
                            ? "italic"
                            : /oblique/.test(style)
                              ? "oblique"
                              : "normal",
                          fontWeight: weight,
                        }));
                      }}
                    >
                      <option value="" disabled>
                        Choose a family and face…
                      </option>
                      {fontFaces.map((face) => (
                        <option
                          key={face.postscriptName}
                          value={face.postscriptName}
                        >
                          {face.fullName} · {face.style}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Select
                  label="Font size"
                  value={String(draft.fontSize)}
                  choices={[
                    8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28,
                    32, 36, 40, 48,
                  ].map((size) => [String(size), `${size} px`])}
                  onChange={(value) => update("fontSize", Number(value))}
                />
                <Range
                  label="Font weight"
                  value={draft.fontWeight}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(value) => update("fontWeight", value)}
                />
                <Select
                  label="Font style"
                  value={draft.fontStyle}
                  choices={[
                    ["normal", "Regular"],
                    ["italic", "Italic"],
                    ["oblique", "Oblique"],
                  ]}
                  onChange={(value) =>
                    update("fontStyle", value as Settings["fontStyle"])
                  }
                />
                <Toggle
                  label="Font smoothing"
                  value={draft.fontSmoothing}
                  onChange={(value) => update("fontSmoothing", value)}
                />
                <Toggle
                  label="Programming ligatures"
                  value={draft.ligatures}
                  onChange={(value) => update("ligatures", value)}
                />
                <Select
                  label="Bold text policy"
                  value={draft.boldPolicy}
                  choices={[
                    ["always", "Always allow bold"],
                    ["font", "Only when a bold face is available"],
                    ["never", "Never render bold"],
                  ]}
                  onChange={(value) =>
                    update("boldPolicy", value as Settings["boldPolicy"])
                  }
                />
                <Select
                  label="Italic text policy"
                  value={draft.italicPolicy}
                  choices={[
                    ["always", "Always allow italic"],
                    ["font", "Only when an italic face is available"],
                    ["never", "Never render italic"],
                  ]}
                  onChange={(value) =>
                    update("italicPolicy", value as Settings["italicPolicy"])
                  }
                />
                <Range
                  label="Bold weight"
                  value={draft.fontWeightBold}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(value) => update("fontWeightBold", value)}
                />
                <Range
                  label="Character spacing"
                  value={draft.letterSpacing}
                  min={-2}
                  max={8}
                  step={0.25}
                  unit="px"
                  onChange={(value) => update("letterSpacing", value)}
                />
                <Range
                  label="Line height"
                  value={draft.lineHeight}
                  min={1}
                  max={2}
                  step={0.05}
                  onChange={(value) => update("lineHeight", value)}
                />
                <Range
                  label="Minimum text contrast"
                  value={draft.minimumContrastRatio}
                  min={1}
                  max={21}
                  step={0.5}
                  onChange={(value) => update("minimumContrastRatio", value)}
                />
                <div
                  className="font-preview"
                  style={{
                    fontFamily: draft.fontFamily,
                    fontSize: draft.fontSize,
                    fontWeight: draft.fontWeight,
                    letterSpacing: draft.letterSpacing,
                    lineHeight: draft.lineHeight,
                  }}
                >
                  ~/workspace ❯ git status
                  <br />
                  <span>All systems ready. λ 0123456789</span>
                </div>
              </Section>
              <Section title="RENDERING">
                <Toggle
                  label="Render inline terminal images"
                  hint="Images are decoded with bounded memory and follow terminal scrolling."
                  value={draft.graphicsEnabled}
                  onChange={(value) => update("graphicsEnabled", value)}
                />
                <Toggle
                  label="Force theme palette for RGB text"
                  value={draft.forceThemePalette}
                  onChange={(value) => update("forceThemePalette", value)}
                />
                <Toggle
                  label="Use Display P3 colors when available"
                  hint="Requires display and browser color-space support."
                  value={draft.displayP3}
                  onChange={(value) => update("displayP3", value)}
                />
                <Toggle
                  label="Smooth terminal resizing"
                  value={draft.smoothResize}
                  onChange={(value) => update("smoothResize", value)}
                />
              </Section>
              <Section title="CURSOR & INPUT">
                <Select
                  label="Cursor effect"
                  value={draft.cursorEffect}
                  choices={[
                    ["off", "Off"],
                    ["warp", "Warp"],
                    ["comet", "Comet"],
                    ["blaze", "Blaze"],
                  ]}
                  onChange={(value) =>
                    update("cursorEffect", value as Settings["cursorEffect"])
                  }
                />
                <Select
                  label="Cursor style"
                  value={draft.cursorStyle}
                  choices={[
                    ["block", "Block"],
                    ["bar", "Bar"],
                    ["underline", "Underline"],
                  ]}
                  onChange={(value) =>
                    update("cursorStyle", value as Settings["cursorStyle"])
                  }
                />
                <Toggle
                  label="Blink cursor"
                  value={draft.cursorBlink}
                  onChange={(value) => update("cursorBlink", value)}
                />
                <Range
                  label="Cursor blink interval"
                  value={draft.cursorBlinkInterval}
                  min={100}
                  max={2000}
                  step={50}
                  unit="ms"
                  onChange={(value) => update("cursorBlinkInterval", value)}
                />
                <Toggle
                  label="Force cursor style over application requests"
                  value={draft.forceCursorStyle}
                  onChange={(value) => update("forceCursorStyle", value)}
                />
                <Toggle
                  label="Send mouse and wheel events to terminal programs"
                  value={draft.mouseReporting}
                  onChange={(value) => update("mouseReporting", value)}
                />
                <Toggle
                  label="Audible terminal bell"
                  value={draft.terminalBell}
                  onChange={(value) => update("terminalBell", value)}
                />
              </Section>
              <Section title="SCROLLBACK & SELECTION">
                <Select
                  label="Scrollback lines"
                  value={String(draft.scrollback)}
                  choices={[1000, 5000, 10000, 20000, 50000, 100000].map(
                    (size) => [String(size), size.toLocaleString()],
                  )}
                  onChange={(value) => update("scrollback", Number(value))}
                />
                <Range
                  label="Smooth scrolling"
                  value={draft.smoothScrollDuration}
                  min={0}
                  max={500}
                  step={25}
                  unit="ms"
                  onChange={(value) => update("smoothScrollDuration", value)}
                />
                <Toggle
                  label="Scroll to new output"
                  value={draft.scrollOnOutput}
                  onChange={(value) => update("scrollOnOutput", value)}
                />
                <Toggle
                  label="Copy selected text automatically"
                  value={draft.copyOnSelect}
                  onChange={(value) => update("copyOnSelect", value)}
                />
                <Color
                  label="Selection text"
                  value={draft.selectionForeground}
                  onChange={(value) => update("selectionForeground", value)}
                />
                <Color
                  label="Selection background"
                  value={draft.selectionBackground}
                  onChange={(value) => update("selectionBackground", value)}
                />
              </Section>
              <Section title="LINKS & SHELL">
                <Toggle
                  label="Open web links from terminal"
                  value={draft.openLinks}
                  onChange={(value) => update("openLinks", value)}
                />
                <Select
                  label="Links that open applications"
                  value={draft.appLinks}
                  choices={[
                    ["ask", "Ask first"],
                    ["always", "Always open"],
                    ["never", "Never open"],
                  ]}
                  onChange={(value) =>
                    update("appLinks", value as Settings["appLinks"])
                  }
                />
                {draft.trustedLinks.length > 0 && (
                  <div className="trusted-links">
                    {draft.trustedLinks.map((link) => (
                      <div key={link}>
                        <code>{link}</code>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            update(
                              "trustedLinks",
                              draft.trustedLinks.filter(
                                (item) => item !== link,
                              ),
                            )
                          }
                        >
                          Remove trust
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Toggle
                  label="Show recently used paths in path browser"
                  value={draft.showRecentPaths}
                  onChange={(value) => update("showRecentPaths", value)}
                />
                <Toggle
                  label="Prefer program and directory over shell titles"
                  value={draft.preferGeneratedTitles}
                  onChange={(value) => update("preferGeneratedTitles", value)}
                />
                <Text
                  label="Startup command"
                  hint="Leave empty for the server's default login shell. Applies to new terminals."
                  value={draft.startupCommand}
                  onChange={(value) => update("startupCommand", value)}
                />
              </Section>
            </>
          )}
          {tab === "notifications" && (
            <>
              <Section title="PROGRAM ACTIVITY">
                <Toggle
                  label="Show activity in tabs"
                  value={draft.notifications.showInTabs}
                  onChange={(value) => updateNotification("showInTabs", value)}
                />
                <Toggle
                  label="Include idle programs in activity"
                  value={draft.notifications.includeIdle}
                  onChange={(value) => updateNotification("includeIdle", value)}
                />
                <Toggle
                  label="Show each program separately"
                  value={draft.notifications.eachProcess}
                  onChange={(value) => updateNotification("eachProcess", value)}
                />
                <Toggle
                  label="Enable notifications"
                  value={draft.notifications.enabled}
                  onChange={(value) => updateNotification("enabled", value)}
                />
                <Toggle
                  label="Desktop notifications"
                  value={draft.notifications.desktopEnabled}
                  onChange={(value) =>
                    updateNotification("desktopEnabled", value)
                  }
                />
                <Toggle
                  label="Badge application icon"
                  value={draft.notifications.badge}
                  onChange={(value) => updateNotification("badge", value)}
                />
                <Toggle
                  label="Notification sounds"
                  value={draft.notifications.sound}
                  onChange={(value) => updateNotification("sound", value)}
                />
              </Section>
              <Section title="NOTIFY WHEN">
                <Toggle
                  label="A program is working"
                  value={draft.notifications.working}
                  onChange={(value) => updateNotification("working", value)}
                />
                <Toggle
                  label="A program needs input or approval"
                  value={draft.notifications.blocked}
                  onChange={(value) => updateNotification("blocked", value)}
                />
                <Toggle
                  label="A program reports an error"
                  value={draft.notifications.error}
                  onChange={(value) => updateNotification("error", value)}
                />
                <Toggle
                  label="A background program finishes"
                  value={draft.notifications.done}
                  onChange={(value) => updateNotification("done", value)}
                />
                <Toggle
                  label="A program sends a terminal notification"
                  value={draft.notifications.programMessages}
                  onChange={(value) =>
                    updateNotification("programMessages", value)
                  }
                />
                <Select
                  label="In-app notification position"
                  value={draft.notifications.position}
                  choices={[
                    ["top-right", "Top right"],
                    ["top-center", "Top center"],
                    ["top-left", "Top left"],
                    ["bottom-right", "Bottom right"],
                    ["bottom-center", "Bottom center"],
                    ["bottom-left", "Bottom left"],
                  ]}
                  onChange={(value) =>
                    updateNotification(
                      "position",
                      value as Settings["notifications"]["position"],
                    )
                  }
                />
              </Section>
              <Section title="CHANNELS BY ACTIVITY">
                <table className="notification-channels">
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Tabs</th>
                      <th>Desktop</th>
                      <th>Badge</th>
                      <th>Sound</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["working", "blocked", "error", "done"] as const).map(
                      (kind) => (
                        <tr key={kind}>
                          <td>
                            {
                              {
                                working: "Working",
                                blocked: "Needs attention",
                                error: "Error",
                                done: "Done",
                              }[kind]
                            }
                          </td>
                          {(["tabs", "desktop", "badge", "sound"] as const).map(
                            (channel) => (
                              <td key={channel}>
                                <input
                                  type="checkbox"
                                  aria-label={`${kind}: ${channel}`}
                                  checked={
                                    draft.notifications.channels[kind][channel]
                                  }
                                  onChange={(event) =>
                                    updateNotification("channels", {
                                      ...draft.notifications.channels,
                                      [kind]: {
                                        ...draft.notifications.channels[kind],
                                        [channel]: event.target.checked,
                                      },
                                    })
                                  }
                                />
                              </td>
                            ),
                          )}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </Section>
              <Section title="TAILSCALE">
                <Toggle
                  label="Sign-in required"
                  value={draft.notifications.tailscaleLogin}
                  onChange={(value) =>
                    updateNotification("tailscaleLogin", value)
                  }
                />
                <Toggle
                  label="Device approval required"
                  value={draft.notifications.tailscaleApproval}
                  onChange={(value) =>
                    updateNotification("tailscaleApproval", value)
                  }
                />
                <Toggle
                  label="Connection failures"
                  value={draft.notifications.tailscaleError}
                  onChange={(value) =>
                    updateNotification("tailscaleError", value)
                  }
                />
              </Section>
            </>
          )}
          {tab === "hosts" && (
            <Section title="SAVED HOSTS">
              {draft.hosts.map((host) => (
                <div className="settings-host" key={host.id}>
                  <Server size={16} />
                  <div>
                    <strong>{host.label}</strong>
                    <span>
                      {host.endpoint || "Automatic local socket discovery"}
                    </span>
                  </div>
                  <button
                    className="button"
                    type="button"
                    onClick={() => onEditHost(host)}
                  >
                    Edit
                  </button>
                  {host.id !== "local" && (
                    <button
                      className="button"
                      type="button"
                      onClick={() =>
                        update(
                          "hosts",
                          draft.hosts.filter((item) => item.id !== host.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="text-button" onClick={onAddHost}>
                <Plus size={14} />
                Connect another host
              </button>
              <p className="form-hint">
                Unix sockets, HTTPS/WSS, and saved Rex endpoints. Credentials
                are kept separately in the system keyring where available.
              </p>
            </Section>
          )}
          {tab === "integrations" && (
            <>
              <Section title="CODING AGENTS">
                <p className="form-hint">
                  Install Rex's skill and hooks so coding agents can manage your
                  terminals. Changes are previewed before applying.
                </p>
                <div className="agent-choices">
                  {["claude", "codex", "opencode", "pi"].map((agent) => (
                    <label key={agent}>
                      <input
                        type="checkbox"
                        checked={agents.includes(agent)}
                        onChange={(event) => {
                          setAgents(
                            event.target.checked
                              ? [...agents, agent]
                              : agents.filter((value) => value !== agent),
                          );
                          setPreview(undefined);
                        }}
                      />
                      {
                        (
                          {
                            claude: "Claude Code",
                            codex: "Codex",
                            opencode: "OpenCode",
                            pi: "Pi",
                          } as Record<string, string>
                        )[agent]
                      }
                    </label>
                  ))}
                </div>
                <Toggle
                  label="Let agents name sessions"
                  value={draft.letAgentsNameSessions}
                  onChange={(value) => {
                    update("letAgentsNameSessions", value);
                    setPreview(undefined);
                  }}
                />
                <div className="settings-buttons">
                  <button
                    className="button"
                    type="button"
                    disabled={integrating || !agents.length}
                    onClick={() => void makePreview("setup")}
                  >
                    Preview install / update
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={integrating || !agents.length}
                    onClick={() => void makePreview("remove")}
                  >
                    Preview removal
                  </button>
                </div>
              </Section>
              {preview && (
                <Section title="REVIEW CHANGES">
                  <pre
                    className="settings-output"
                    tabIndex={0}
                    aria-label="Agent integration status"
                  >
                    {preview.output}
                  </pre>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={integrating}
                    onClick={() => {
                      setIntegrating(true);
                      void window.rex
                        .request("integrationsApply", {
                          previewId: preview.previewId,
                        })
                        .then((result) => {
                          setIntegrationOutput(result.output);
                          setPreview(undefined);
                        })
                        .catch((failure) => setError(errorMessage(failure)))
                        .finally(() => setIntegrating(false));
                    }}
                  >
                    <ShieldCheck size={14} />
                    {integrating ? "Applying…" : "Apply these changes"}
                  </button>
                </Section>
              )}
              <Section title="CURRENT INTEGRATION STATUS">
                <pre
                  className="settings-output"
                  tabIndex={0}
                  aria-label="Agent integration status"
                >
                  {integrationOutput || "Checking installed agents…"}
                </pre>
              </Section>
            </>
          )}
          {tab === "shortcuts" && (
            <>
              <Section title="SHORTCUTS">
                <p className="form-hint">
                  Use Ctrl, Alt, Shift or Super joined with a physical key, for
                  example Ctrl+Shift+P. Clear a shortcut to let Rex's Lua keymap
                  handle it.
                </p>
                {Object.entries(draft.shortcuts).map(([command, shortcut]) => (
                  <Text
                    key={command}
                    label={command.replaceAll("-", " ")}
                    value={shortcut}
                    onChange={(value) =>
                      update("shortcuts", {
                        ...draft.shortcuts,
                        [command]: value,
                      })
                    }
                  />
                ))}
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    update("shortcuts", { ...DEFAULT_SETTINGS.shortcuts })
                  }
                >
                  Restore default shortcuts
                </button>
                <Text
                  label="Global show/hide shortcut"
                  hint="Works while another app is focused; leave empty to disable."
                  value={draft.globalShortcut}
                  onChange={(value) => update("globalShortcut", value)}
                />
              </Section>
              <Section title="SERVER KEYMAP">
                <Toggle
                  label="Show key sequence hints"
                  value={draft.showKeyHints}
                  onChange={(value) => update("showKeyHints", value)}
                />
                <p className="form-hint">
                  Custom Rex bindings, sequences and key modes run on the
                  server. Edit init.lua to bind actions; reload it to apply
                  changes.
                </p>
                <button className="button" type="button" onClick={onConfig}>
                  Open Rex configuration…
                </button>
              </Section>
            </>
          )}
          {tab === "server" && (
            <>
              <Section title="CLIENT">
                <Text
                  label="Client label"
                  hint="Used by rex client ls and rex -C to target this app."
                  value={draft.clientLabel}
                  onChange={(value) => update("clientLabel", value)}
                />
                <Toggle
                  label="Allow remote client actions"
                  value={draft.remoteControl}
                  onChange={(value) => update("remoteControl", value)}
                />
                <Toggle
                  label="Developer mode"
                  value={draft.developerMode}
                  onChange={(value) => update("developerMode", value)}
                />
              </Section>
              <Section title="REX SERVER">
                <div className="settings-buttons">
                  <button
                    className="button"
                    type="button"
                    onClick={onDiagnostics}
                  >
                    <RefreshCw size={13} />
                    Connection diagnostics
                  </button>
                  <button className="button" type="button" onClick={onConfig}>
                    Edit Rex configuration…
                  </button>
                  {onNativeServices && (
                    <button
                      className="button"
                      type="button"
                      onClick={onNativeServices}
                    >
                      Updates and Linux services…
                    </button>
                  )}
                </div>
                <p className="form-hint">
                  Your existing server and sessions are retained. Configuration
                  changes take effect only when you save and reload them.
                </p>
              </Section>
            </>
          )}
        </div>
        <div className="preferences-bottom">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button button-primary" disabled={saving}>
              <Check size={14} />
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="preferences-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="settings-row toggle-row">
      <span>
        {label}
        {hint && <small className="form-hint">{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
function Text({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>
        {label}
        {hint && <small className="form-hint">{hint}</small>}
      </span>
      <input
        className="form-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: (readonly [string, string])[];
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <select
        className="form-select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <span className="range-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>
          {Number(value.toFixed(2))}
          {unit}
        </output>
      </span>
    </label>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="color"
        value={value.slice(0, 7)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
