import { TerminalPane, type TerminalPaneProps } from "../../terminal/TerminalPane";
import { BlockInspector } from "../../blocks/BlockInspector";
import { OnboardingPane } from "./OnboardingPane";

export function WorkspacePane(props: TerminalPaneProps) {
  if (props.pane.creator === "com.superlogical.onboarding")
    return <OnboardingPane {...props} />;
  return props.pane.creator &&
    props.pane.creator !== "com.superlogical.terminal" ? (
    <BlockInspector {...props} />
  ) : (
    <TerminalPane {...props} />
  );
}
