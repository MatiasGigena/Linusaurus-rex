import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Keyboard,
  Palette,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import type { TerminalPaneProps } from "../terminal/TerminalPane";
import { errorMessage } from "../core/workspace";

const STEPS = [
  "welcome",
  "appearance",
  "shortcuts",
  "agents",
  "practice",
  "done",
];
export function OnboardingPane({
  pane,
  terminalRef,
  settings,
  visible = true,
  onFocus,
  onClose,
  onAction,
}: TerminalPaneProps) {
  const [step, setStep] = useState("welcome");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { hostId, sessionId, blockId } = terminalRef;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const state = (await window.rex.request("callBlock", {
      hostId,
      sessionId,
      blockId,
      method: "state",
      args: {},
    })) as { step?: string };
    setStep(STEPS.includes(state.step || "") ? state.step! : "welcome");
  };
  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    const read = () =>
      void load().catch((failure) => {
        if (mounted) setError(errorMessage(failure));
      });
    read();
    const timer = window.setInterval(read, 2000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [hostId, sessionId, blockId, visible]);
  const move = (next: string) =>
    void run(async () => {
      await window.rex.request("callBlock", {
        hostId,
        sessionId,
        blockId,
        method: "set_step",
        args: { step: next },
      });
      setStep(next);
    });
  const index = STEPS.indexOf(step);
  return (
    <section
      className="onboarding-pane"
      aria-label="Rex tutorial"
      onPointerDown={onFocus}
    >
      <header className="pane-header">
        <span>
          <Sparkles size={14} />
          {pane.label || "Getting started"}
        </span>
        <button
          className="icon-button"
          aria-label="Close tutorial pane"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      <div className="onboarding-body">
        <nav aria-label="Tutorial steps">
          {STEPS.map((value, position) => (
            <button
              key={value}
              className={value === step ? "is-current" : ""}
              aria-current={value === step ? "step" : undefined}
              disabled={busy}
              onClick={() => move(value)}
            >
              <span>
                {position < index ? <Check size={11} /> : position + 1}
              </span>
              {
                [
                  "Welcome",
                  "Appearance",
                  "Keyboard",
                  "Agents",
                  "Practice",
                  "Ready",
                ][position]
              }
            </button>
          ))}
        </nav>
        <div className="onboarding-page" key={step}>
          {step === "welcome" && (
            <>
              <Sparkles size={35} />
              <h1>Your persistent Linux workspace</h1>
              <p>
                This walkthrough is a real Rex block. Its progress is saved on
                your server and can be resumed from another client.
              </p>
              <p>
                Sessions contain tabs, and tabs contain panes. Closing this app
                leaves your shells and programs running. Closing a server pane
                or session ends its programs.
              </p>
            </>
          )}
          {step === "appearance" && (
            <>
              <Palette size={32} />
              <h1>Make the terminal yours</h1>
              <p>
                Choose a starting palette, then use the theme library to import
                and name more themes for light and dark appearances.
              </p>
              <div className="onboarding-themes">
                {(
                  [
                    ["macos", "macOS Dark"],
                    ["macos-light", "macOS Light"],
                    ["graphite", "Graphite"],
                    ["midnight", "Midnight"],
                    ["light", "Light"],
                  ] as const
                ).map(([theme, label]) => (
                  <button
                    key={theme}
                    className={`onboarding-theme ${theme}`}
                    aria-pressed={settings.theme === theme}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const latest = await window.rex.getSettings();
                        await window.rex.setSettings({
                          ...latest,
                          theme,
                          lightThemeId: "",
                          darkThemeId: "",
                        });
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="button"
                onClick={() => onAction?.("client.settings")}
              >
                Open appearance settings
              </button>
            </>
          )}
          {step === "shortcuts" && (
            <>
              <Keyboard size={32} />
              <h1>Keep your hands on the keyboard</h1>
              <dl className="server-facts">
                {[
                  ["command-palette", "Find a command"],
                  ["session-switcher", "Switch session"],
                  ["split-right", "Split right"],
                  ["zoom", "Zoom or restore a pane"],
                  ["find", "Search terminal output"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      <kbd>{settings.shortcuts[key]}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p>
                Hold Shift to select text in a program that uses mouse
                reporting. Right-click a tab or pane for its commands.
              </p>
              <button
                className="button"
                onClick={() => onAction?.("client.shortcuts.edit")}
              >
                Customize shortcuts
              </button>
            </>
          )}
          {step === "agents" && (
            <>
              <Sparkles size={32} />
              <h1>Connect your coding agents</h1>
              <p>
                Rex integrations let supported agents arrange panes, inspect
                output, and use the client’s actions.
              </p>
              <p>
                The Agents screen previews the files and commands before
                installation. You can complete this tutorial without installing
                an integration.
              </p>
              <button
                className="button"
                onClick={() => onAction?.("client.agents.setup")}
              >
                Review agent integrations
              </button>
            </>
          )}
          {step === "practice" && (
            <>
              <Terminal size={32} />
              <h1>Try a terminal beside this tutorial</h1>
              <p>
                Open a shell in this tutorial session, type a command, and try a
                split or terminal search. Your existing sessions stay separate.
              </p>
              <button
                className="button button-primary"
                onClick={() => onAction?.("pane.split.right")}
              >
                Open a practice terminal
              </button>
              <p>
                Use the sidebar to return to your other sessions. This
                walkthrough remains saved here.
              </p>
            </>
          )}
          {step === "done" && (
            <>
              <Check size={36} />
              <h1>You’re ready</h1>
              <p>
                Your tutorial progress is saved. Keep this workspace for
                practice, or close the tutorial session from its sidebar menu
                when you are finished.
              </p>
              <button
                className="button"
                onClick={() => onAction?.("session.switch")}
              >
                Switch to a session
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            className="button"
            disabled={busy || index === 0}
            onClick={() => move(STEPS[index - 1])}
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <span>
            {index + 1} / {STEPS.length}
          </span>
          <button
            className="button button-primary"
            disabled={busy || index === STEPS.length - 1}
            onClick={() => move(STEPS[index + 1])}
          >
            Next
            <ArrowRight size={13} />
          </button>
        </footer>
      </div>
    </section>
  );
}
