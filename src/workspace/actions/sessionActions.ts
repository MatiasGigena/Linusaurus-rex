import { UNHANDLED, type ActionContext } from "./context";

export async function sessionActions(context: ActionContext): Promise<unknown> {
  const {
    ws,
    hosts,
    setPalette,
    setForm,
    setCollapsedSessions,
    requestClose,
    inspectAfter,
    name,
    args,
    hostId,
    sessionId,
    currentView,
  } = context;
  switch (name) {
    case "session.switch":
      setPalette("sessions");
      return;
    case "session.new": {
      const create = async (label: string, cwd?: string) => {
        await ws.run(async () => {
          const created = await window.rex.request("createSession", {
            hostId,
            label,
            cwd: cwd || undefined,
          });
          await inspectAfter(hostId, created.sessionId, true);
        });
      };
      if (args.label || args.name)
        return create(
          String(args.label || args.name),
          args.cwd ? String(args.cwd) : undefined,
        );
      setForm({
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
      });
      return;
    }
    case "session.select": {
      const target = String(
        args.session_id || args.session || args.label || "",
      );
      const matches = hosts.flatMap((host) =>
        host.sessions
          .filter(
            (session) => session.id === target || session.label === target,
          )
          .map((session) => ({ host, session })),
      );
      if (matches.length === 1) {
        ws.select(
          matches[0].host.id,
          matches[0].session.id,
          args.window_id ? String(args.window_id) : undefined,
          args.block_id ? String(args.block_id) : undefined,
        );
        return;
      }
      if (!target) {
        setPalette("sessions");
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
      const all = hosts.flatMap((host) =>
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
          (index + (name === "session.next" ? 1 : -1) + all.length) % all.length
        ];
      if (next) ws.select(next.hostId, next.sessionId);
      return;
    }
    case "session.rename": {
      if (!sessionId) throw new Error("Choose a session first.");
      const rename = async (label: string) => {
        await ws.run(() =>
          window.rex.request("renameSession", { hostId, sessionId, label }),
        );
      };
      if (args.label) return rename(String(args.label));
      setForm({
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
      });
      return;
    }
    case "session.close":
      if (!sessionId) return;
      requestClose(
        "Close this session?",
        "All tabs, panes and running programs in this session will close on the server.",
        () => window.rex.request("destroySession", { hostId, sessionId }),
      );
      return;
    case "session.refresh":
      return ws.refresh();
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
        .replace(/^ws:/, "http:");
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
}
