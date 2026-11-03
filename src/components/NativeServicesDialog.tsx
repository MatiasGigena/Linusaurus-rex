import { useEffect, useState } from "react";
import { Download, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import type {
  ServerManagementInfo,
  ServerOriginPreview,
  Settings,
  UpdateState,
} from "../shared/types";
import { errorMessage } from "../core/workspace";

export function NativeServicesDialog({
  settings,
  hostId,
  initialTab = "server",
  onSave,
  onClose,
}: {
  settings: Settings;
  hostId: string;
  initialTab?: "server" | "updates";
  onSave(settings: Settings): Promise<Settings>;
  onClose(): void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [server, setServer] = useState<ServerManagementInfo>();
  const [update, setUpdate] = useState<UpdateState>();
  const [patterns, setPatterns] = useState("");
  const [preview, setPreview] = useState<ServerOriginPreview>();
  const [originNotice, setOriginNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const host = settings.hosts.find((host) => host.id === hostId);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const [management, current] = await Promise.all([
      window.rex.request("serverManagement", { hostId }),
      window.rex.request("updateStatus", {}),
    ]);
    setServer(management);
    setUpdate(current);
  };
  useEffect(() => {
    void run(load);
    const unsubscribe = window.rex.onClientEvent((event) => {
      if (event.type === "update") setUpdate(event.state);
    });
    const timer = window.setInterval(
      () => void load().catch((failure) => setError(errorMessage(failure))),
      5000,
    );
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [hostId]);
  useEffect(() => {
    setPatterns(
      (
        server?.service?.configuredOrigins ??
        host?.websocketOrigins ??
        server?.origins ??
        []
      ).join("\n"),
    );
    setPreview(undefined);
  }, [
    hostId,
    host?.websocketOrigins,
    server?.service?.configuredOrigins.join("\n"),
    server?.origins.join("\n"),
  ]);
  const origins = () =>
    patterns
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  const lifecycle = (operation: "start" | "stop" | "restart") =>
    void run(async () => {
      setServer(
        await window.rex.request("serverLifecycle", { hostId, operation }),
      );
    });
  const updateAction = (
    action: "checkUpdates" | "downloadUpdate" | "cancelUpdate",
  ) =>
    void run(async () => {
      setUpdate(await window.rex.request(action, {}));
    });
  return (
    <Dialog
      title="Linux services and updates"
      subtitle={host?.label || "Linusaurus Rex"}
      wide
      onClose={onClose}
    >
      <div className="services-tabs" role="tablist" aria-label="Linux services">
        <button
          role="tab"
          aria-selected={tab === "server"}
          onClick={() => setTab("server")}
        >
          <Server size={14} /> Rex server
        </button>
        <button
          role="tab"
          aria-selected={tab === "updates"}
          onClick={() => setTab("updates")}
        >
          <Download size={14} /> Client updates
        </button>
      </div>
      {tab === "server" ? (
        <>
          <dl className="server-facts">
            <dt>Connection</dt>
            <dd>{server?.running ? "Running" : "Stopped / unavailable"}</dd>
            <dt>Endpoint</dt>
            <dd>{server?.endpoint || host?.endpoint || "Local discovery"}</dd>
            <dt>Persistent sessions</dt>
            <dd>{server?.sessionCount ?? "Checking…"}</dd>
            <dt>Executable</dt>
            <dd>{server?.executable || "Not discovered"}</dd>
            <dt>Version</dt>
            <dd>{server?.version || "Unknown"}</dd>
            {server?.service && (
              <>
                <dt>Service</dt>
                <dd>
                  {server.service.unit} ({server.service.scope})
                </dd>
                <dt>Service state</dt>
                <dd>
                  {server.service.activeState}
                  {server.service.subState
                    ? ` / ${server.service.subState}`
                    : ""}
                </dd>
                <dt>Restart policy</dt>
                <dd>{server.service.restart}</dd>
              </>
            )}
          </dl>
          <p className="form-hint">
            Stop and restart are allowed only when Rex atomically confirms it
            has no sessions. Running shells and programs are never stopped by
            these controls.
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
          <div className="settings-section-label">WEB CLIENT ORIGINS</div>
          <p className="form-hint">
            One trusted host pattern per line, such as localhost:3000 or
            *.example.com. Changes apply at the next idle restart. An empty list
            removes additional origins.
          </p>
          {server?.service && (
            <p className="form-hint">
              Review a dedicated user service override before saving. Saving
              reloads the service configuration and leaves the running server
              and its sessions in place.
            </p>
          )}
          <dl className="server-facts">
            <dt>Running origins</dt>
            <dd>{server?.origins.join(", ") || "No additional origins"}</dd>
            {server?.service && (
              <>
                <dt>Configured origins</dt>
                <dd>
                  {server.service.configuredOrigins.join(", ") ||
                    "No additional origins"}
                </dd>
              </>
            )}
          </dl>
          <label className="form-field">
            Allowed web origins
            <textarea
              className="form-input services-origins"
              rows={4}
              value={patterns}
              disabled={
                !server?.local ||
                (!!server.service && !server.service.canManage)
              }
              onChange={(event) => {
                setPatterns(event.target.value);
                setPreview(undefined);
                setOriginNotice(undefined);
              }}
            />
          </label>
          <div className="settings-buttons">
            {server?.service ? (
              <button
                className="button"
                disabled={busy || !server.service.canManage}
                onClick={() =>
                  void run(async () => {
                    setOriginNotice(undefined);
                    setPreview(
                      await window.rex.request("previewServerOrigins", {
                        hostId,
                        origins: origins(),
                      }),
                    );
                  })
                }
              >
                Review service override
              </button>
            ) : (
              <button
                className="button"
                disabled={busy || !server?.local}
                onClick={() =>
                  void run(async () => {
                    const pending = origins();
                    await onSave({
                      ...settings,
                      hosts: settings.hosts.map((item) =>
                        item.id === hostId
                          ? { ...item, websocketOrigins: pending }
                          : item,
                      ),
                    });
                    await load();
                  })
                }
              >
                Save origin patterns
              </button>
            )}
            {!server?.service && (
              <button
                className="button"
                disabled={busy || host?.websocketOrigins === undefined}
                onClick={() =>
                  void run(async () => {
                    await onSave({
                      ...settings,
                      hosts: settings.hosts.map((item) => {
                        if (item.id !== hostId) return item;
                        const { websocketOrigins: _pending, ...rest } = item;
                        return rest;
                      }),
                    });
                    await load();
                  })
                }
              >
                Discard pending changes
              </button>
            )}
          </div>
          {preview && (
            <section
              className="service-origin-preview"
              aria-label="Service origin override preview"
            >
              <dl className="server-facts">
                <dt>Service</dt>
                <dd>{preview.unit}</dd>
                <dt>Override file</dt>
                <dd>{preview.path}</dd>
                {preview.backupPath && (
                  <>
                    <dt>Backup</dt>
                    <dd>{preview.backupPath}</dd>
                  </>
                )}
              </dl>
              <h3>Current override</h3>
              <pre>{preview.before ?? "No existing override"}</pre>
              <h3>Proposed override</h3>
              <pre>{preview.after}</pre>
              <div className="settings-buttons">
                <button
                  className="button primary"
                  disabled={busy || !server?.service?.canManage}
                  onClick={() =>
                    void run(async () => {
                      setPreview(undefined);
                      const applied = await window.rex.request(
                        "applyServerOrigins",
                        { hostId, previewId: preview.previewId },
                      );
                      setServer(applied);
                      setPreview(undefined);
                      setOriginNotice(
                        "Service override saved. It applies at the next idle restart.",
                      );
                    })
                  }
                >
                  Apply reviewed override
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setPreview(undefined)}
                >
                  Cancel review
                </button>
              </div>
            </section>
          )}
          {originNotice && (
            <p className="form-hint" role="status">
              {originNotice}
            </p>
          )}
          {server?.pendingOrigins && (
            <p className="form-hint">
              Saved origin changes are waiting for an idle restart.
            </p>
          )}
          <details className="raw-diagnostics">
            <summary>Runtime and integrity details</summary>
            <dl className="server-facts">
              <dt>Process</dt>
              <dd>{server?.pid ?? "Stopped"}</dd>
              <dt>Configuration</dt>
              <dd>{server?.configPath || "Default"}</dd>
              <dt>State directory</dt>
              <dd>{server?.stateDirectory || "Default"}</dd>
              <dt>Binary SHA-256</dt>
              <dd>{server?.binarySha256 || "Unavailable"}</dd>
              <dt>Launch arguments</dt>
              <dd>
                <code>{server?.arguments.join(" ") || "Not discovered"}</code>
              </dd>
              {server?.service && (
                <>
                  <dt>Service file</dt>
                  <dd>{server.service.fragmentPath || "Unavailable"}</dd>
                  <dt>Service overrides</dt>
                  <dd>{server.service.dropInPaths.join("\n") || "None"}</dd>
                </>
              )}
            </dl>
          </details>
        </>
      ) : (
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
              onClick={() =>
                void run(async () =>
                  setUpdate(await window.rex.request("applyUpdate", {})),
                )
              }
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
                void run(async () =>
                  setUpdate(
                    await window.rex.request("applyUpdate", { whenIdle: true }),
                  ),
                )
              }
            >
              Install when idle
            </button>
            <button
              className="button"
              disabled={
                busy ||
                !["downloading", "scheduled", "ready"].includes(
                  update?.phase || "",
                )
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
            <ShieldCheck size={12} /> Relaunching the client leaves server
            sessions running. Debian upgrades use your system’s package
            installer.
          </p>
        </>
      )}
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
    </Dialog>
  );
}
