import { Section, Toggle, Select } from "./Controls";
import { type Settings } from "../../shared/types";
import type { PreferencesEditor } from "./types";

export function NotificationPreferences({
  draft,
  setDraft,
}: PreferencesEditor) {
  const updateNotification = <K extends keyof Settings["notifications"]>(
    key: K,
    value: Settings["notifications"][K],
  ) =>
    setDraft((previous) => ({
      ...previous,
      notifications: { ...previous.notifications, [key]: value },
    }));

  return (
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
          onChange={(value) => updateNotification("desktopEnabled", value)}
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
          onChange={(value) => updateNotification("programMessages", value)}
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
            {(["working", "blocked", "error", "done"] as const).map((kind) => (
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
                        checked={draft.notifications.channels[kind][channel]}
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
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="TAILSCALE">
        <Toggle
          label="Sign-in required"
          value={draft.notifications.tailscaleLogin}
          onChange={(value) => updateNotification("tailscaleLogin", value)}
        />
        <Toggle
          label="Device approval required"
          value={draft.notifications.tailscaleApproval}
          onChange={(value) => updateNotification("tailscaleApproval", value)}
        />
        <Toggle
          label="Connection failures"
          value={draft.notifications.tailscaleError}
          onChange={(value) => updateNotification("tailscaleError", value)}
        />
      </Section>
    </>
  );
}
