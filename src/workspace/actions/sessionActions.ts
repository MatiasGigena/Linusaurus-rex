import {
  UNHANDLED,
  type SessionActionsDependencies,
  type SessionActionsTarget,
} from "./context";

export function createSessionActions(dependencies: SessionActionsDependencies) {
  return async function sessionActions(
    context: SessionActionsTarget,
  ): Promise<unknown> {
    const { workspace, hosts, setCollapsedSessions, requestClose, dialogs } =
      dependencies;
    const { name, args, hostId, sourceHostId, sessionId, currentView } =
      context;
    const navigationHosts =
      sourceHostId === undefined
        ? hosts
        : hosts.filter((host) => host.id === sourceHostId);
    switch (name) {
      case "session.switch":
        dialogs.open({ kind: "palette", scope: "sessions" });
        return;
      case "session.new": {
        const create = async (label: string, cwd?: string) => {
          await workspace.mutateSession(
            {
              hostId,
              sessionId: (created) => created.sessionId,
              selectActive: true,
            },
            () =>
              window.rex.request("createSession", {
                hostId,
                label,
                cwd: cwd || undefined,
              }),
          );
        };
        if (args.label || args.name)
          return create(
            String(args.label || args.name),
            args.cwd ? String(args.cwd) : undefined,
          );
        dialogs.open({
          kind: "form",
          form: {
            title: "New session",
            description: "Create a persistent workspace on this Rex server.",
            fields: [
              { name: "label", label: "Session name", required: true },
              {
                name: "cwd",
                label: "Working directory",
                placeholder: "Default home directory",
              },
            ],
            submit: (values) => create(values.label, values.cwd),
          },
        });
        return;
      }
      case "session.select": {
        const target = String(
          args.session_id || args.session || args.label || "",
        );
        const matches = navigationHosts.flatMap((host) =>
          host.sessions
            .filter(
              (session) => session.id === target || session.label === target,
            )
            .map((session) => ({ host, session })),
        );
        if (matches.length === 1) {
          workspace.select(
            matches[0].host.id,
            matches[0].session.id,
            args.window_id ? String(args.window_id) : undefined,
            args.block_id ? String(args.block_id) : undefined,
          );
          return;
        }
        if (!target) {
          dialogs.open({ kind: "palette", scope: "sessions" });
          return;
        }
        throw new Error(
          matches.length
            ? "Session name is ambiguous. Use its full ID."
            : "Session was not found.",
        );
      }
      case "session.next":
      case "session.previous": {
        const all = navigationHosts.flatMap((host) =>
          host.sessions.map((session) => ({
            hostId: host.id,
            sessionId: session.id,
          })),
        );
        const index = all.findIndex(
          (item) => item.hostId === hostId && item.sessionId === sessionId,
        );
        const next =
          all[
            (index + (name === "session.next" ? 1 : -1) + all.length) %
              all.length
          ];
        if (next) workspace.select(next.hostId, next.sessionId);
        return;
      }
      case "session.rename": {
        if (!sessionId) throw new Error("Choose a session first.");
        const rename = async (label: string) => {
          await workspace.run(hostId, () =>
            window.rex.request("renameSession", { hostId, sessionId, label }),
          );
        };
        if (args.label) return rename(String(args.label));
        dialogs.open({
          kind: "form",
          form: {
            title: "Rename session",
            description: "This name is shared with your other Rex clients.",
            fields: [
              {
                name: "label",
                label: "Session name",
                value: currentView?.label,
                required: true,
              },
            ],
            submit: (values) => rename(values.label),
          },
        });
        return;
      }
      case "session.close":
        if (!sessionId) return;
        requestClose(
          hostId,
          "Close this session?",
          "All tabs, panes and running programs in this session will close on the server.",
          () => window.rex.request("destroySession", { hostId, sessionId }),
        );
        return;
      case "session.refresh":
        return workspace.refresh();
      case "session.collapse":
        setCollapsedSessions((previous) => new Set(previous).add(sessionId));
        return;
      case "session.expand":
        setCollapsedSessions((previous) => {
          const next = new Set(previous);
          next.delete(sessionId);
          return next;
        });
        return;
      case "session.collapse_others":
        setCollapsedSessions(
          new Set(
            hosts.flatMap((host) =>
              host.sessions
                .filter((session) => session.id !== sessionId)
                .map((session) => session.id),
            ),
          ),
        );
        return;
      case "session.open_on_web": {
        const endpoint = (
          hosts.find((host) => host.id === hostId)?.status?.endpoint || ""
        )
          .replace(/^wss:/, "https:")
          .replace(/^workspace:/, "http:");
        if (!/^https?:\/\//.test(endpoint))
          throw new Error(
            "This host has no web address. Configure remote serving first.",
          );
        return window.rex.request("openExternal", {
          url: new URL(`/?session=${encodeURIComponent(sessionId)}`, endpoint)
            .href,
        });
      }
      default:
        return UNHANDLED;
    }
  };
}
