import type { WorkspaceOperations } from "../../core/workspaceOperations";
import type { TerminalRef } from "../../shared/types";

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
    await window.rex.request("paste", {
      ...target,
      text: `'${path.replaceAll("'", "'\\''")}'`,
    });
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
}
