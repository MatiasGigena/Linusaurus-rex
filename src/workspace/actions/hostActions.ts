import type { WorkspaceOperations } from "../../core/workspaceOperations";
import { errorMessage } from "../../core/workspace";
import type { Host } from "../../shared/types";

export type Credentials = {
  username?: string;
  password?: string;
  token?: string;
};

/** Settings committed; this continuation owns only the remaining connection stages. */
export class HostSaveIncompleteError extends Error {
  readonly code?: string;
  readonly method?: string;
  #retry: () => Promise<void>;
  constructor(
    readonly hostId: string,
    readonly stage: "credentials" | "refresh",
    cause: unknown,
    retry: () => Promise<void>,
  ) {
    super(
      `The host was saved, but ${stage === "credentials" ? "saving credentials" : "refreshing the workspace"} failed: ${errorMessage(cause)}`,
      { cause },
    );
    this.name = "HostSaveIncompleteError";
    this.#retry = retry;
    if (cause && typeof cause === "object") {
      if ("code" in cause && typeof cause.code === "string")
        this.code = cause.code;
      if ("method" in cause && typeof cause.method === "string")
        this.method = cause.method;
    }
  }
  retry(): Promise<void> {
    return this.#retry();
  }
}

export function createHostSaver(
  workspace: Pick<
    WorkspaceOperations,
    "getSettings" | "saveSettings" | "refresh"
  >,
  reconnected: (hostId: string) => void,
) {
  return async (
    host: Host,
    credentials?: Credentials,
    isActive: () => boolean = () => true,
  ): Promise<void> => {
    if (!isActive()) throw new Error("The host form is no longer open.");
    const settings = workspace.getSettings();
    if (!settings) throw new Error("Workspace settings are not available.");
    const { id: hostId, endpoint } = host;
    const pendingCredentials = credentials && { ...credentials };
    await workspace.saveSettings({
      ...settings,
      hosts: settings.hosts.some((item) => item.id === host.id)
        ? settings.hosts.map((item) => (item.id === host.id ? host : item))
        : [...settings.hosts, host],
    });
    let stage: "credentials" | "refresh" = pendingCredentials
      ? "credentials"
      : "refresh";
    let reconnectedOnce = false;
    let complete = false;
    let inFlight: Promise<void> | undefined;
    const requireCurrent = () => {
      if (!isActive()) throw new Error("The host form is no longer open.");
      if (
        !workspace
          .getSettings()
          ?.hosts.some(
            (current) => current.id === hostId && current.endpoint === endpoint,
          )
      )
        throw new Error(
          "The saved host configuration changed. Reopen the host before connecting.",
        );
    };
    const finish = async () => {
      try {
        requireCurrent();
        if (stage === "credentials") {
          await window.rex.request("setCredentials", {
            hostId,
            ...pendingCredentials,
          });
          stage = "refresh";
        }
        requireCurrent();
        if (!reconnectedOnce) {
          reconnectedOnce = true;
          reconnected(hostId);
        }
        requireCurrent();
        await workspace.refresh();
        requireCurrent();
        complete = true;
      } catch (failure) {
        throw new HostSaveIncompleteError(hostId, stage, failure, retry);
      }
    };
    const retry = (): Promise<void> => {
      if (complete) return Promise.resolve();
      if (!inFlight)
        inFlight = Promise.resolve()
          .then(finish)
          .finally(() => {
            inFlight = undefined;
          });
      return inFlight;
    };
    return retry();
  };
}
