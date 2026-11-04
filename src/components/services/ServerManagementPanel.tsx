import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ServerManagementInfo, Settings } from "../../shared/types";
import { errorMessage } from "../../core/workspace";
import { ServerConnectionFacts, ServerRuntimeDetails } from "./ServerFacts";
import { ServerOriginsEditor } from "./ServerOriginsEditor";
export function ServerManagementPanel({
  settings,
  hostId,
  onSave,
  onClose,
  active,
}: {
  settings: Settings;
  hostId: string;
  onSave(settings: Settings): Promise<Settings>;
  onClose(): void;
  active: boolean;
}) {
  const host = settings.hosts.find((host) => host.id === hostId);
  const [server, setServer] = useState<ServerManagementInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const updateServer = (info: ServerManagementInfo) => {
    revision.current++;
    if (mounted.current) setServer(info);
  };
  const load = async () => {
    if (!mounted.current) return;
    const requestRevision = ++revision.current;
    const info = await window.rex.request("serverManagement", { hostId });
    if (mounted.current && revision.current === requestRevision)
      setServer(info);
  };
  const run = async (action: () => Promise<unknown>) => {
    if (!mounted.current) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    void run(load);
    const timer = window.setInterval(
      () =>
        void load().catch((failure) => {
          if (mounted.current) setError(errorMessage(failure));
        }),
      5000,
    );
    return () => {
      clearInterval(timer);
    };
  }, [hostId, active]);
  const lifecycle = (operation: "start" | "stop" | "restart") =>
    void run(async () =>
      updateServer(
        await window.rex.request("serverLifecycle", { hostId, operation }),
      ),
    );
  return (
    <>
      <ServerConnectionFacts server={server} host={host} />
      <p className="form-hint">
        Stop and restart are allowed only when Rex atomically confirms it has no
        sessions. Running shells and programs are never stopped by these
        controls.
      </p>
      {server?.reason && <p className="form-hint">{server.reason}</p>}
      <div className="settings-buttons">
        <button
          className="button"
          disabled={busy || !server?.canManage || server.running}
          onClick={() => lifecycle("start")}
        >
          Start server
        </button>
        <button
          className="button"
          disabled={
            busy ||
            !server?.canManage ||
            !server.running ||
            server.sessionCount > 0
          }
          onClick={() => lifecycle("stop")}
        >
          Stop idle server
        </button>
        <button
          className="button"
          disabled={
            busy ||
            !server?.canManage ||
            !server.running ||
            server.sessionCount > 0
          }
          onClick={() => lifecycle("restart")}
        >
          Restart idle server
        </button>
      </div>
      <ServerOriginsEditor
        server={server}
        settings={settings}
        hostId={hostId}
        onSave={onSave}
        busy={busy}
        run={run}
        onServerChange={updateServer}
        refresh={load}
      />
      <ServerRuntimeDetails server={server} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void run(load)}
        >
          <RefreshCw size={13} />
          Refresh
        </button>
        <button className="button button-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
