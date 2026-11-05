import { Section, Toggle, Text, Select, Range, Color } from "./Controls";
import type { PreferencesEditor } from "./types";
import { useState } from "react";
import { errorMessage } from "../../core/workspace";

export function TerminalPreferences({
  draft,
  setDraft,
  update,
}: PreferencesEditor) {
  const [error, setError] = useState<string>();
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

  return (
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
                <option key={face.postscriptName} value={face.postscriptName}>
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
            8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36,
            40, 48,
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
          onChange={(value) => update("fontStyle", value)}
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
          onChange={(value) => update("boldPolicy", value)}
        />
        <Select
          label="Italic text policy"
          value={draft.italicPolicy}
          choices={[
            ["always", "Always allow italic"],
            ["font", "Only when an italic face is available"],
            ["never", "Never render italic"],
          ]}
          onChange={(value) => update("italicPolicy", value)}
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
          onChange={(value) => update("cursorEffect", value)}
        />
        <Select
          label="Cursor style"
          value={draft.cursorStyle}
          choices={[
            ["block", "Block"],
            ["bar", "Bar"],
            ["underline", "Underline"],
          ]}
          onChange={(value) => update("cursorStyle", value)}
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
          choices={[1000, 5000, 10000, 20000, 50000, 100000].map((size) => [
            String(size),
            size.toLocaleString(),
          ])}
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
          onChange={(value) => update("appLinks", value)}
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
                      draft.trustedLinks.filter((item) => item !== link),
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
