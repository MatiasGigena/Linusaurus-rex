import {
  TerminalPane,
  type TerminalPaneProps,
} from "../../terminal/TerminalPane";
import { BlockInspector } from "../../blocks/BlockInspector";
import { OnboardingPane } from "./OnboardingPane";
import type { WorkspaceOperations } from "../../core/workspaceOperations";

export function WorkspacePane({
  workspace,
  ...props
}: TerminalPaneProps & {
  workspace: Pick<WorkspaceOperations, "getSettings" | "saveSettings">;
}) {
  if (props.pane.creator === "com.superlogical.onboarding")
    return <OnboardingPane {...props} workspace={workspace} />;
  return props.pane.creator &&
    props.pane.creator !== "com.superlogical.terminal" ? (
    <BlockInspector {...props} />
  ) : (
    <TerminalPane {...props} />
  );
}
