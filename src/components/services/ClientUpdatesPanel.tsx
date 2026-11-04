import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { Settings, UpdateState } from "../../shared/types";
import { errorMessage } from "../../core/workspace";
export function ClientUpdatesPanel({
  settings,
  onSave,
  onClose,
  active,
}: {
  settings: Settings;
  onSave(settings: Settings): Promise<Settings>;
  onClose(): void;
  active: boolean;
}) {
  const [update, setUpdate] = useState<UpdateState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.rex.onClientEvent((event) => {
      if (event.type === "update") {
        revision.current++;
        setUpdate(event.state);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);
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
  const requestUpdate = async (
    action:
      | "updateStatus"
      | "checkUpdates"
      | "downloadUpdate"
      | "cancelUpdate"
      | "applyUpdate",
    args: { whenIdle?: boolean } = {},
  ) => {
    if (!mounted.current) return;
    const requestedRevision = ++revision.current;
    const current = await window.rex.request(action, args);
    if (mounted.current && revision.current === requestedRevision) {
      revision.current++;
      setUpdate(current);
    }
  };
  const load = () => requestUpdate("updateStatus");
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
    return () => clearInterval(timer);
  }, [active]);
  const updateAction = (
    action: "checkUpdates" | "downloadUpdate" | "cancelUpdate",
  ) => void run(() => requestUpdate(action));
  return (
    <>
      <dl className="server-facts">
        <dt>Installed client</dt>
        <dd>{update?.currentVersion || "Checking…"}</dd>
        <dt>Package</dt>
        <dd>{update?.installKind || "Unknown"}</dd>
        <dt>Update state</dt>
        <dd>
          <span role="status">
            {update?.phase || "Loading…"}
            {update?.version ? ` · ${update.version}` : ""}
          </span>
        </dd>
      </dl>
      <p className="form-hint">
        Updates come from this client’s GitHub releases. Downloaded packages
        must match the release SHA-256 checksum. Rex server updates remain
        managed by your Linux package manager.
      </p>
      {update?.total ? (
        <progress
          aria-label="Update download"
          value={update.bytes || 0}
          max={update.total}
        />
      ) : null}
      {update?.error && (
        <p className="form-error" role="alert">
          {update.error}
        </p>
      )}
      <div className="settings-buttons">
        <button
          className="button"
          disabled={busy || update?.phase === "downloading"}
          onClick={() => updateAction("checkUpdates")}
        >
          <RefreshCw size={13} />
          Check for updates
        </button>
        <button
          className="button"
          disabled={busy || update?.phase !== "available"}
          onClick={() => updateAction("downloadUpdate")}
        >
          Download verified update
        </button>
        <button
          className="button"
          disabled={
            busy ||
            !update?.canApply ||
            !["ready", "scheduled"].includes(update.phase)
          }
          onClick={() => void run(() => requestUpdate("applyUpdate"))}
        >
          {update?.installKind === "deb"
            ? "Open package installer…"
            : "Install and relaunch"}
        </button>
        <button
          className="button"
          disabled={
            busy ||
            update?.installKind !== "appimage" ||
            !update?.canApply ||
            update.phase !== "ready"
          }
          onClick={() =>
            void run(() => requestUpdate("applyUpdate", { whenIdle: true }))
          }
        >
          Install when idle
        </button>
        <button
          className="button"
          disabled={
            busy ||
            !["downloading", "scheduled", "ready"].includes(update?.phase || "")
          }
          onClick={() => updateAction("cancelUpdate")}
        >
          Cancel update
        </button>
      </div>
      {(
        [
          "autoCheckUpdates",
          "autoDownloadUpdates",
          "installUpdatesWhenIdle",
        ] as const
      ).map((key, index) => (
        <label className="services-check" key={key}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(event) =>
              void run(() =>
                onSave({ ...settings, [key]: event.target.checked }),
              )
            }
          />
          {
            [
              "Check for client updates automatically",
              "Download available updates automatically",
              "Install AppImage updates when the client is idle",
            ][index]
          }
        </label>
      ))}
      <p className="form-hint">
        <ShieldCheck size={12} /> Relaunching the client leaves server sessions
        running. Debian upgrades use your system’s package installer.
      </p>
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
