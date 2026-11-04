import { dispatchTerminalCommandAsync } from "../../terminal/commands";
import type { ClientEvent } from "../../shared/types";
import {
  UNHANDLED,
  type WorkspaceActionOptions,
  type ResolvedCommand,
  type RequestClose,
} from "./context";
import { canonicalActionName } from "../../shared/actions";
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
  const requestClose: RequestClose = async (
    hostId,
    title,
    description,
    action,
  ) => {
    if (settings.confirmClose) {
      options.dialogs.open({
        kind: "confirmation",
        confirmation: {
          title,
          description,
          submit: async () => {
            await workspace.mutateHostAndRefresh(hostId, action);
          },
        },
      });
      return { status: "confirmation_required" };
    }
    await workspace.mutateHostAndRefresh(hostId, action);
  };
  const handlers = [
    createSessionActions({
      dialogs: options.dialogs,
      workspace: {
        mutateSession: workspace.mutateSession,
        select: workspace.select,
        mutateHostAndRefresh: workspace.mutateHostAndRefresh,
        refresh: workspace.refresh,
      },
      hosts: options.hosts,
      setCollapsedSessions: options.setCollapsedSessions,
      requestClose,
    }),
    createTabActions({
      dialogs: options.dialogs,
      workspace: {
        mutateSession: workspace.mutateSession,
        mutateHostAndRefresh: workspace.mutateHostAndRefresh,
        select: workspace.select,
      },
      requestClose,
    }),
    createPaneActions({
      dialogs: options.dialogs,
      workspace: { mutateHostAndRefresh: workspace.mutateHostAndRefresh },
      settings,
      requestClose,
    }),
    createPaneLayoutActions({
      dialogs: options.dialogs,
      workspace: {
        mutateSession: workspace.mutateSession,
        focusPane: workspace.focusPane,
        mutateHostAndRefresh: workspace.mutateHostAndRefresh,
        refresh: workspace.refresh,
      },
      settings,
      workspaceElement: options.workspaceElement,
    }),
    createClientActions({
      dialogs: options.dialogs,
      workspace: {
        mutateSession: workspace.mutateSession,
        select: workspace.select,
        mutateHostAndRefresh: workspace.mutateHostAndRefresh,
        dismissNotices: workspace.dismissNotices,
        saveSettings: workspace.saveSettings,
        refresh: workspace.refresh,
      },
      settings,
      hosts: options.hosts,
      interfaceTheme: options.interfaceTheme,
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
    const name = canonicalActionName(inputName);
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
      // A server can request paste while awaiting the key RPC ahead of it.
      // Acknowledge that validated enqueue so the reverse RPC can unblock.
      const completion =
        event?.type === "action" && name === "client.paste"
          ? "queued"
          : "settled";
      await dispatchTerminalCommandAsync(command, terminalRef, completion);
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
