import { useEffect, useRef, useState } from "react";
import type {
  ServerManagementInfo,
  ServerOriginPreview,
  Settings,
} from "../../shared/types";
interface Props {
  server: ServerManagementInfo | undefined;
  settings: Settings;
  hostId: string;
  onSave(settings: Settings): Promise<Settings>;
  busy: boolean;
  run(action: () => Promise<unknown>): Promise<void>;
  onServerChange(server: ServerManagementInfo): void;
  refresh(): Promise<void>;
}
export function ServerOriginsEditor({
  server,
  settings,
  hostId,
  onSave,
  busy,
  run,
  onServerChange,
  refresh,
}: Props) {
  const host = settings.hosts.find((host) => host.id === hostId);
  const [patterns, setPatterns] = useState("");
  const [preview, setPreview] = useState<ServerOriginPreview>();
  const [originNotice, setOriginNotice] = useState<string>();
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const invalidate = () => {
    revision.current++;
    setPreview(undefined);
  };
  useEffect(() => {
    setPatterns(
      (
        server?.service?.configuredOrigins ??
        host?.websocketOrigins ??
        server?.origins ??
        []
      ).join("\n"),
    );
    invalidate();
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
  return (
    <>
      <div className="settings-section-label">WEB CLIENT ORIGINS</div>
      <p className="form-hint">
        One trusted host pattern per line, such as localhost:3000 or
        *.example.com. Changes apply at the next idle restart. An empty list
        removes additional origins.
      </p>
      {server?.service && (
        <p className="form-hint">
          Review a dedicated user service override before saving. Saving reloads
          the service configuration and leaves the running server and its
          sessions in place.
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
            !server?.local || (!!server.service && !server.service.canManage)
          }
          onChange={(event) => {
            setPatterns(event.target.value);
            invalidate();
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
                const requestedRevision = revision.current;
                const reviewed = await window.rex.request(
                  "previewServerOrigins",
                  { hostId, origins: origins() },
                );
                if (mounted.current && revision.current === requestedRevision)
                  setPreview(reviewed);
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
                await refresh();
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
                await refresh();
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
              className="button button-primary"
              disabled={busy || !server?.service?.canManage}
              onClick={() =>
                void run(async () => {
                  setPreview(undefined);
                  const applied = await window.rex.request(
                    "applyServerOrigins",
                    { hostId, previewId: preview.previewId },
                  );
                  onServerChange(applied);
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
    </>
  );
}
