import type { SettingsTab } from "./types";
import { AppearancePreferences } from "./AppearancePreferences";
import { TerminalPreferences } from "./TerminalPreferences";
import { NotificationPreferences } from "./NotificationPreferences";
import { AgentIntegrations } from "./AgentIntegrations";
import { Section, Toggle, Text } from "./Controls";
import { useState } from "react";
import {
  Check,
  Code2,
  Keyboard,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Bell,
} from "lucide-react";
import { Dialog } from "../Dialog";
import { migrateThemeLibrary } from "../../core/themeLibrary";
import type { Host, Settings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";
import { errorMessage } from "../../core/workspace";

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
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
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
            <AppearancePreferences
              draft={draft}
              setDraft={setDraft}
              update={update}
            />
          )}
          {tab === "terminal" && (
            <TerminalPreferences
              draft={draft}
              setDraft={setDraft}
              update={update}
            />
          )}
          {tab === "notifications" && (
            <NotificationPreferences
              draft={draft}
              setDraft={setDraft}
              update={update}
            />
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
            <AgentIntegrations
              letAgentsNameSessions={draft.letAgentsNameSessions}
              onSessionNamingChange={(value) =>
                update("letAgentsNameSessions", value)
              }
            />
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
