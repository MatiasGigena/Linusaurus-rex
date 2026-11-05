import {
  WorkspaceReconciliationError,
  type WorkspaceOperations,
} from "../../core/workspaceOperations";
import { errorMessage } from "../../core/workspace";
import type { TerminalRef } from "../../shared/types";
import { dispatchTerminalCommandAsync } from "../../terminal/commands";

/** Insert a safely quoted path or open a tab there, then remember the chosen path. */
export async function pickDirectoryPath(
  workspace: Pick<
    WorkspaceOperations,
    "getSettings" | "saveSettings" | "mutateSession"
  >,
  choice: { mode: "insert" | "directory"; ref: TerminalRef },
  path: string,
): Promise<void> {
  const target = choice.ref;
  if (choice.mode === "insert")
    await dispatchTerminalCommandAsync(
      { command: "paste", text: `'${path.replaceAll("'", "'\\''")}'` },
      target,
    );
  else
    await workspace.mutateSession(
      {
        hostId: target.hostId,
        sessionId: target.sessionId,
        selectActive: true,
      },
      () =>
        window.rex.request("newWindow", {
          hostId: target.hostId,
          sessionId: target.sessionId,
          label: path.split("/").filter(Boolean).at(-1) || "Shell",
          cwd: path,
        }),
    );
  try {
    const settings = workspace.getSettings();
    if (!settings) throw new Error("Workspace settings are not available.");
    await workspace.saveSettings({
      ...settings,
      recentPaths: {
        ...settings.recentPaths,
        [target.hostId]: [
          path,
          ...(settings.recentPaths[target.hostId] || []).filter(
            (value) => value !== path,
          ),
        ].slice(0, 20),
      },
    });
  } catch (cause) {
    throw new WorkspaceReconciliationError(
      cause,
      `The ${choice.mode === "insert" ? "path was inserted" : "terminal was opened"}, but saving recent paths failed: ${errorMessage(cause)} Dismiss or refresh to check the completed change.`,
    );
  }
}
