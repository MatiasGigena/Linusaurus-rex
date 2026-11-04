import { dispatchTerminalCommandAsync } from "../../terminal/commands";
import { errorMessage } from "../../core/workspace";
import type { ClientEvent } from "../../shared/types";
import {
  UNHANDLED,
  type WorkspaceActionOptions,
  type ResolvedCommand,
  type RequestClose,
} from "./context";
import { aliases } from "./aliases";
import { resolveCommandTarget } from "./resolveCommandTarget";
import { createSessionActions } from "./sessionActions";
import { createTabActions } from "./tabActions";
import { createPaneActions } from "./paneActions";
import { createPaneLayoutActions } from "./paneLayoutActions";
import { createClientActions } from "./clientActions";
const nativeActions = new Set([
  "client.window.new",
  "client.window.close",
  "client.window.fullscreen.toggle",
  "client.visibility.toggle",
  "client.version.copy",
  "client.debug.copy",
]);

export function createWorkspaceActions(options: WorkspaceActionOptions) {
  const { workspace, settings } = options;
  if (!settings) return async () => undefined;
  const requestClose: RequestClose = (hostId, title, description, action) => {
    if (settings.confirmClose)
      options.setConfirmation({
        title,
        description,
        submit: async () => {
          await workspace.run(hostId, action);
        },
      });
    else
      void workspace
        .run(hostId, action)
        .catch((failure) => options.onError(errorMessage(failure)));
  };
  const handlers = [
    createSessionActions({
      workspace: {
        mutateSession: workspace.mutateSession,
        select: workspace.select,
        run: workspace.run,
        refresh: workspace.refresh,
      },
      hosts: options.hosts,
      setPalette: options.setPalette,
      setForm: options.setForm,
      setCollapsedSessions: options.setCollapsedSessions,
      requestClose,
    }),
    createTabActions({
      workspace: {
        mutateSession: workspace.mutateSession,
        run: workspace.run,
        select: workspace.select,
      },
      setForm: options.setForm,
      requestClose,
    }),
    createPaneActions({
      workspace: { run: workspace.run },
      settings,
      setConfirmation: options.setConfirmation,
      setForm: options.setForm,
      setDirectoryBrowser: options.setDirectoryBrowser,
      setReport: options.setReport,
      requestClose,
    }),
    createPaneLayoutActions({
      workspace: {
        mutateSession: workspace.mutateSession,
        focusPane: workspace.focusPane,
        run: workspace.run,
        refresh: workspace.refresh,
      },
      settings,
      workspaceElement: options.workspaceElement,
      setForm: options.setForm,
    }),
    createClientActions({
      workspace: {
        mutateSession: workspace.mutateSession,
        select: workspace.select,
        run: workspace.run,
        dismissNotices: workspace.dismissNotices,
        saveSettings: workspace.saveSettings,
        refresh: workspace.refresh,
      },
      settings,
      hosts: options.hosts,
      interfaceTheme: options.interfaceTheme,
      setPalette: options.setPalette,
      setSettingsTab: options.setSettingsTab,
      setDiagnostics: options.setDiagnostics,
      setPairing: options.setPairing,
      setEditingHost: options.setEditingHost,
      setConfirmation: options.setConfirmation,
      setForm: options.setForm,
      setActivityOnly: options.setActivityOnly,
      setActivityOpen: options.setActivityOpen,
      setActivityGroup: options.setActivityGroup,
    }),
  ];
  const execute = async (
    inputName: string,
    args: Record<string, unknown> = {},
    event?: ClientEvent,
  ): Promise<unknown> => {
    const name = aliases[inputName] || inputName;
    const target = resolveCommandTarget(name, args, event, options);
    const {
      hostId,
      sessionId,
      currentWindow,
      displayedContext,
      blockId,
      terminalRef,
      targetPane,
    } = target;
    const requirePane = () => {
      if (!sessionId || !blockId)
        throw new Error("Select a terminal pane first.");
    };
    const localCommand = async (command: string) => {
      requirePane();
      if (!currentWindow || !targetPane)
        throw new Error("The target pane is no longer available.");
      if (!displayedContext || options.focusedPane !== blockId)
        workspace.select(hostId, sessionId, currentWindow.id, blockId);
      await dispatchTerminalCommandAsync(command, terminalRef);
    };
    if (nativeActions.has(name))
      return window.rex.request("invokeAction", {
        ...terminalRef,
        action: name,
        args,
      });
    if (
      [
        "copy",
        "paste",
        "select-all",
        "scroll-top",
        "scroll-bottom",
        "clear-content",
        "clear-scrollback",
        "find-next",
        "find-previous",
        "prompt-previous",
        "prompt-next",
      ].includes(name)
    )
      return localCommand(name);
    const command: ResolvedCommand = {
      ...target,
      localCommand,
      requirePane,
      execute,
    };
    for (const handler of handlers) {
      const result = await handler(command);
      if (result !== UNHANDLED) return result;
    }
    const action = options.keymaps[hostId]?.actions.find(
      (action) => action.name === name,
    );
    if (action && action.kind !== "client")
      return window.rex.request("invokeAction", {
        ...terminalRef,
        action: name,
        args,
      });
    throw new Error(`This action is not available on this client: ${name}`);
  };
  return execute;
}
