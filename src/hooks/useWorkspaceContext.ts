import { useCallback, useEffect, useRef } from "react";
import { errorMessage } from "../core/workspace";
import type { Host, Selection } from "../shared/types";

// Live readers revoke old requests even before a selection/settings change commits.
interface WorkspaceContextInputs {
  initialized(): boolean;
  selection(): Selection | undefined;
  focusedPane(): string | undefined;
  hosts(): readonly Pick<Host, "id" | "endpoint">[] | undefined;
  onError(message: string): void;
}

/** Publishes current UI intent, retrying failed context only at existing events. */
export function useWorkspaceContext(inputs: WorkspaceContextInputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const mounted = useRef(true);
  const uiBusyRef = useRef(false);
  const revision = useRef(0);
  const needsRetry = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      needsRetry.current = false;
    };
  }, []);

  const publishContext = useCallback(() => {
    // Until native window settings arrive, absent selection means uninitialized,
    // not an explicit clear of the window's launch target.
    if (!window.rex || !mounted.current || !latest.current.initialized())
      return;
    const requestedRevision = ++revision.current;
    const configuredEndpoints = () =>
      JSON.stringify(
        latest.current.hosts()?.map(({ id, endpoint }) => [id, endpoint]),
      );
    const configuration = configuredEndpoints();
    const selection = latest.current.selection();
    const focusedPane = latest.current.focusedPane();
    const uiBusy = uiBusyRef.current;
    const ownsPublication = () =>
      mounted.current &&
      revision.current === requestedRevision &&
      configuration === configuredEndpoints() &&
      latest.current.selection() === selection &&
      latest.current.focusedPane() === focusedPane &&
      uiBusyRef.current === uiBusy;
    needsRetry.current = false;
    void window.rex
      .request("setContext", {
        selection: selection ? { ...selection, blockId: focusedPane } : null,
        visible: !document.hidden,
        uiBusy,
      })
      .catch((failure) => {
        if (!ownsPublication()) return;
        needsRetry.current = true;
        latest.current.onError(`Workspace context: ${errorMessage(failure)}`);
      });
  }, []);
  const publishUiBusy = useCallback(
    (uiBusy: boolean) => {
      if (
        !mounted.current ||
        (uiBusyRef.current === uiBusy && !needsRetry.current)
      )
        return;
      uiBusyRef.current = uiBusy;
      publishContext();
    },
    [publishContext],
  );
  const retryContext = useCallback(() => {
    if (needsRetry.current) publishContext();
  }, [publishContext]);

  const initialized = inputs.initialized();
  const selection = inputs.selection();
  const focusedPane = inputs.focusedPane();
  const hosts = inputs.hosts();
  useEffect(() => {
    if (!window.rex) return;
    publishContext();
    const visibility = () => publishContext();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [initialized, selection, focusedPane, hosts, publishContext]);

  return { publishUiBusy, retryContext };
}
