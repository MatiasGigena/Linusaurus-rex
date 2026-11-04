import { DEFAULT_SETTINGS, type Settings } from "../../shared/types";
import { saveLibraryTheme, uniqueThemeName } from "../../core/themeLibrary";
import type { SettingsTab } from "../../components/preferences/types";
import type { WorkspaceOperations } from "../../core/workspaceOperations";
import {
  UNHANDLED,
  type ClientActionsDependencies,
  type ClientActionsTarget,
} from "./context";

export async function persistSidebarWidth(
  workspace: Pick<WorkspaceOperations, "saveSettings">,
  settings: Settings,
  width: number,
): Promise<void> {
  if (!settings.preserveWindowWidth)
    await window.rex.request("resizeWindow", {
      deltaWidth: width - settings.sidebarWidth,
    });
  await workspace.saveSettings({ ...settings, sidebarWidth: width });
}

export function createClientActions(dependencies: ClientActionsDependencies) {
  return async function clientActions(
    context: ClientActionsTarget,
  ): Promise<unknown> {
    const {
      workspace,
      settings,
      hosts,
      interfaceTheme,
      setPalette,
      setSettingsTab,
      setDiagnostics,
      setPairing,
      setEditingHost,
      setConfirmation,
      setForm,
      setActivityOnly,
      setActivityOpen,
      setActivityGroup,
    } = dependencies;
    const { name, args, hostId, sourceHostId } = context;
    switch (name) {
      case "client.palette.toggle":
        setPalette((previous) => (previous ? undefined : "all"));
        return;
      case "client.settings":
        setSettingsTab(
          [
            "appearance",
            "terminal",
            "notifications",
            "hosts",
            "integrations",
            "shortcuts",
            "server",
          ].includes(String(args.tab))
            ? (args.tab as SettingsTab)
            : "appearance",
        );
        return;
      case "client.shortcuts.edit":
        setSettingsTab("shortcuts");
        return;
      case "client.agents.setup":
        setSettingsTab("integrations");
        return;
      case "client.diagnostics":
        setDiagnostics(true);
        return;
      case "client.pair_device":
        setPairing(true);
        return;
      case "client.onboarding": {
        const { result: tutorial } = await workspace.mutateSession(
          { hostId, sessionId: (created) => created.sessionId },
          () => window.rex.request("createTutorial", { hostId }),
        );
        workspace.select(
          hostId,
          tutorial.sessionId,
          tutorial.windowId,
          tutorial.blockId,
        );
        return tutorial;
      }
      case "client.update.accept":
        return window.rex.request("applyUpdate", {});
      case "client.update.accept_when_idle":
        return window.rex.request("applyUpdate", { whenIdle: true });
      case "client.server.restart":
        return workspace.run(hostId, () =>
          window.rex.request("serverLifecycle", {
            hostId,
            operation: "restart",
          }),
        );
      case "client.notice.dismiss":
        workspace.dismissNotices();
        return;
      case "client.host.add":
        setEditingHost(null);
        return;
      case "client.host.remove": {
        const host = settings.hosts.find((host) => host.id === hostId);
        if (!host || host.id === "local")
          throw new Error(
            "The local host is retained. Edit its endpoint in Settings.",
          );
        setConfirmation({
          title: `Forget ${host.label}?`,
          description:
            "The saved connection and its stored credentials will be removed. Server sessions keep running.",
          label: "Forget host",
          submit: async () => {
            await window.rex.request("removeCredentials", { hostId });
            await workspace.saveSettings({
              ...settings,
              hosts: settings.hosts.filter((item) => item.id !== hostId),
            });
            await workspace.refresh();
          },
        });
        return;
      }
      case "client.host.switch": {
        const next = settings.hosts.find(
          (host) =>
            host.id === String(args.host_id || args.host || "") ||
            host.label === String(args.host || ""),
        );
        if (next) {
          if (sourceHostId !== undefined && next.id !== sourceHostId)
            throw new Error(
              "A server-originated action cannot navigate to another host.",
            );
          const first = hosts.find((host) => host.id === next.id)?.sessions[0];
          if (first) workspace.select(next.id, first.id);
          else setEditingHost(next);
        } else setPalette("sessions");
        return;
      }
      case "client.font.increase":
        return workspace.saveSettings({
          ...settings,
          fontSize: Math.min(48, settings.fontSize + 1),
        });
      case "client.font.decrease":
        return workspace.saveSettings({
          ...settings,
          fontSize: Math.max(8, settings.fontSize - 1),
        });
      case "client.font.reset":
        return workspace.saveSettings({
          ...settings,
          fontSize: DEFAULT_SETTINGS.fontSize,
        });
      case "client.sidebar.toggle":
        if (!settings.preserveWindowWidth)
          await window.rex.request("resizeWindow", {
            deltaWidth: settings.sidebarCollapsed
              ? settings.sidebarWidth
              : -settings.sidebarWidth,
          });
        return workspace.saveSettings({
          ...settings,
          sidebarCollapsed: !settings.sidebarCollapsed,
        });
      case "client.sidebar.activity.toggle":
        setActivityOnly((previous) => !previous);
        setActivityOpen(true);
        return;
      case "client.sidebar.activity.by_session":
        setActivityGroup("session");
        setActivityOpen(true);
        return;
      case "client.sidebar.activity.by_priority":
        setActivityGroup("priority");
        setActivityOpen(true);
        return;
      case "client.sidebar.filter.focus":
        if (settings.sidebarCollapsed)
          await workspace.saveSettings({
            ...settings,
            sidebarCollapsed: false,
          });
        setTimeout(
          () => window.dispatchEvent(new Event("rex-sidebar-filter")),
          0,
        );
        return;
      case "client.tab_style.toggle":
        return workspace.saveSettings({
          ...settings,
          tabStyle:
            settings.tabStyle === "left"
              ? "top"
              : settings.tabStyle === "top"
                ? "right"
                : "left",
        });
      case "client.theme.change":
        setSettingsTab("appearance");
        return;
      case "client.theme.import": {
        const imported = await window.rex.request("importTheme", {});
        if (imported) {
          const light =
            settings.appearance === "light" ||
            (settings.appearance === "system" &&
              matchMedia("(prefers-color-scheme: light)").matches);
          return workspace.saveSettings(
            saveLibraryTheme(
              settings,
              uniqueThemeName(
                settings.themeLibrary,
                `Imported ${light ? "light" : "dark"}`,
              ),
              imported,
              light ? "light" : "dark",
            ),
          );
        }
        return;
      }
      case "client.appearance.switch_mode": {
        const current =
          settings.theme === "system" ? interfaceTheme : settings.theme;
        const opposite: Partial<Record<string, Settings["theme"]>> = {
          macos: "macos-light",
          "macos-light": "macos",
          light: "graphite",
        };
        return workspace.saveSettings({
          ...settings,
          theme: opposite[current ?? ""] ?? "light",
        });
      }
      case "client.config.copy_path": {
        const info = await window.rex.request("configInfo", { hostId });
        return window.rex.writeClipboard(info.path);
      }
      case "client.config.reload":
        await window.rex.request("reloadConfig", { hostId });
        await workspace.refresh();
        return;
      case "client.mode.enter":
        if (!args.name) {
          setForm({
            title: "Enter key mode",
            description: "Choose a mode declared in the resolved Rex keymap.",
            fields: [{ name: "name", label: "Mode name", required: true }],
            submit: async (values) => {
              await window.rex.request("keyMode", {
                hostId,
                operation: "enter",
                name: values.name,
              });
            },
          });
          return;
        }
        return window.rex.request("keyMode", {
          hostId,
          operation: "enter",
          name: String(args.name),
        });
      case "client.mode.exit":
      case "client.mode.exit_all":
        return window.rex.request("keyMode", {
          hostId,
          operation: name.endsWith("exit_all") ? "exitAll" : "exit",
        });
      default:
        return UNHANDLED;
    }
  };
}
