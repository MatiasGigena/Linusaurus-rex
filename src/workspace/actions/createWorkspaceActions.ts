import { dispatchTerminalCommandAsync } from "../../terminal/commands";
import { viewKey } from "../../core/workspace";
import type { ClientEvent } from "../../shared/types";
import {
  UNHANDLED,
  type WorkspaceActionOptions,
  type ActionContext,
} from "./context";
import { sessionActions } from "./sessionActions";
import { tabActions } from "./tabActions";
import { paneLayoutActions } from "./paneLayoutActions";
import { paneActions } from "./paneActions";
import { clientActions } from "./clientActions";
export const aliases: Record<string, string> = {
  "new-session": "session.new",
  "session-switcher": "session.switch",
  "new-window": "client.tab.new",
  "close-window": "client.tab.close",
  "close-pane": "pane.close",
  "toggle-sidebar": "client.sidebar.toggle",
  "command-palette": "client.palette.toggle",
  settings: "client.settings",
  "split-right": "pane.split.right",
  "split-below": "pane.split.down",
  zoom: "pane.zoom",
  find: "client.find.open",
  "font-increase": "client.font.increase",
  "font-decrease": "client.font.decrease",
  "font-reset": "client.font.reset",
  "next-tab": "client.tab.next",
  "previous-tab": "client.tab.previous",
  "focus-left": "pane.focus.left",
  "focus-right": "pane.focus.right",
  "focus-up": "pane.focus.up",
  "focus-down": "pane.focus.down",
};
const nativeActions = new Set([
  "client.window.new",
  "client.window.close",
  "client.window.fullscreen.toggle",
  "client.visibility.toggle",
  "client.version.copy",
  "client.debug.copy",
]);

export function createWorkspaceActions(options: WorkspaceActionOptions) {
  const {
    ws,
    settings,
    views,
    selection,
    focusedPane,
    keymaps,
    activeHost,
    activePane,
  } = options;
  const execute = async (
    inputName: string,
    args: Record<string, unknown> = {},
    event?: ClientEvent,
  ): Promise<unknown> => {
    if (!settings) return;
    const name = aliases[inputName] || inputName;
    const hostId = String(
      args.host_id ||
        (event && "hostId" in event ? event.hostId : undefined) ||
        selection?.hostId ||
        activeHost?.id ||
        "local",
    );
    const sessionId = String(
      args.session_id ||
        (event && "sessionId" in event ? event.sessionId : undefined) ||
        selection?.sessionId ||
        "",
    );
    const currentView = views[viewKey(hostId, sessionId)];
    const requestedBlock =
      args.block_id ||
      (event && "blockId" in event ? event.blockId : undefined);
    const currentWindow =
      (requestedBlock
        ? currentView?.windows.find((window) =>
            window.panes.some((pane) => pane.id === requestedBlock),
          )
        : undefined) ||
      currentView?.windows.find(
        (window) => window.id === String(args.window_id || selection?.windowId),
      ) ||
      currentView?.windows.find(
        (window) => window.id === currentView.activeWindowId,
      ) ||
      currentView?.windows[0];
    const displayedContext =
      selection?.hostId === hostId &&
      selection.sessionId === sessionId &&
      selection.windowId === currentWindow?.id;
    const blockId = String(
      args.block_id ||
        (event && "blockId" in event ? event.blockId : undefined) ||
        (displayedContext ? activePane?.id : undefined) ||
        currentWindow?.focusedBlockId ||
        currentWindow?.panes[0]?.id ||
        "",
    );
    const terminalRef = { hostId, sessionId, blockId };
    const targetPane = currentWindow?.panes.find((pane) => pane.id === blockId);
    const localCommand = async (command: string) => {
      requirePane();
      if (!currentWindow || !targetPane)
        throw new Error("The target pane is no longer available.");
      if (!displayedContext || focusedPane !== blockId) {
        ws.select(hostId, sessionId, currentWindow.id, blockId);
      }
      await dispatchTerminalCommandAsync(command, terminalRef);
    };
    const requirePane = () => {
      if (!sessionId || !blockId)
        throw new Error("Select a terminal pane first.");
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
    ) {
      return localCommand(name);
    }

    const context: ActionContext = {
      ...options,
      settings,
      name,
      args,
      event,
      hostId,
      sessionId,
      currentView,
      currentWindow,
      displayedContext,
      blockId,
      terminalRef,
      targetPane,
      localCommand,
      requirePane,
      execute,
    };
    for (const handler of [
      sessionActions,
      tabActions,
      paneLayoutActions,
      paneActions,
      clientActions,
    ]) {
      const result = await handler(context);
      if (result !== UNHANDLED) return result;
    }
    {
      const action = keymaps[hostId]?.actions.find(
        (action) => action.name === name,
      );
      if (action && action.kind !== "client")
        return window.rex.request("invokeAction", {
          ...terminalRef,
          action: name,
          args,
        });
      throw new Error(`This action is not available on this client: ${name}`);
    }
  };
  return execute;
}
