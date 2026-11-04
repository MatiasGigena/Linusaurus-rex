import { useEffect, useState } from "react";
import {
  WorkspaceDialogController,
  type WorkspaceDialogState,
} from "../workspace/dialogs";

export function useWorkspaceDialogs() {
  const [state, setState] = useState<WorkspaceDialogState>({});
  const [controller] = useState(() => new WorkspaceDialogController(setState));
  useEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);
  return {
    controller,
    state,
    modalOpen: !!(state.primary || state.form || state.confirmation),
  };
}
