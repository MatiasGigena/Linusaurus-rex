import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../core/workspace";
import { decodeServerDetails, type ServerDetails } from "../core/serverDetails";
import type { ServerActionCommand } from "../shared/types";
interface DiagnosticsDialogProps {
  hostId?: string;
  endpoint?: string;
  onClose(): void;
  onServerAction(...request: ServerActionCommand): void;
}
export function DiagnosticsDialog(props: DiagnosticsDialogProps) {
  return (
    <DiagnosticsReport
      key={JSON.stringify([props.hostId, props.endpoint])}
      {...props}
    />
  );
}
function DiagnosticsReport({
  hostId,
  onClose,
  onServerAction,
}: DiagnosticsDialogProps) {
  const [report, setReport] = useState<Record<string, unknown>>();
  const [details, setDetails] = useState<ServerDetails>();
  const [error, setError] = useState<string>();
  const [hostname, setHostname] = useState("");
  const [controlUrl, setControlUrl] = useState("");
  const [tags, setTags] = useState("");
  const [allowMembers, setAllowMembers] = useState(false);
  const mounted = useRef(true);
  const requestRevision = useRef(0);
  const reportFailure = (failure: unknown) => {
    if (mounted.current) setError(errorMessage(failure));
  };
  const load = () => {
    if (!mounted.current) return;
    const request = ++requestRevision.current;
    const ownsRequest = () =>
      mounted.current && requestRevision.current === request;
    void Promise.all([
      window.rex.request("diagnostics", { hostId }),
      hostId
        ? window.rex.request("serverAction", { hostId, action: "status" })
        : Promise.resolve({}),
    ])
      .then(([info, status]) => {
        if (!ownsRequest()) return;
        const server = decodeServerDetails(status);
        const next = {
          report: { ...info, status: server },
          details: server,
          allowMembers: server.tailscale?.allow_tailnet_members ?? false,
          controlUrl: server.tailscale?.control_url ?? "",
          tags: (server.tailscale?.tags ?? []).join(", "),
          hostname: server.tailscale?.dns_name?.split(".")[0] ?? "",
        };
        setReport(next.report);
        setDetails(next.details);
        setAllowMembers(next.allowMembers);
        setControlUrl(next.controlUrl);
        setTags(next.tags);
        setHostname(next.hostname);
        setError(undefined);
      })
      .catch((failure) => {
        if (ownsRequest()) reportFailure(failure);
      });
  };
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      requestRevision.current++;
    };
  }, []);
  const ts = details?.tailscale;
  const remoteUrl = ts?.https?.url;
  const authUrl = ts?.auth_url;
  const startArgs = {
    allow_tailnet_members: allowMembers,
    ...(hostname.trim() ? { hostname: hostname.trim() } : {}),
    ...(controlUrl.trim() ? { control_url: controlUrl.trim() } : {}),
    ...(tags.trim()
      ? {
          advertise_tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }
      : {}),
  };
  return (
    <Dialog
      title="Connection diagnostics"
      subtitle="Client, server and remote-access details."
      wide
      onClose={onClose}
    >
      {details && (
        <dl className="server-facts">
          <dt>API compatibility</dt>
          <dd>
            {details.api_min_revision || 7}–{details.api_revision || "unknown"}
          </dd>
          <dt>Server started</dt>
          <dd>
            {details.started_at
              ? new Date(details.started_at).toLocaleString()
              : "Unknown"}
          </dd>
          <dt>Sessions</dt>
          <dd>{details.session_count ?? "Unknown"}</dd>
        </dl>
      )}
      {ts && (
        <>
          <div className="settings-section-label">TAILSCALE REMOTE ACCESS</div>
          <dl className="server-facts">
            <dt>Connection</dt>
            <dd>{ts.state}</dd>
            <dt>HTTPS certificate</dt>
            <dd>{ts.https?.state || "Not serving"}</dd>
            <dt>Address</dt>
            <dd>
              {remoteUrl || ts.dns_name || "Not assigned"}
              {remoteUrl && (
                <button
                  className="icon-button"
                  aria-label="Copy remote address"
                  onClick={() =>
                    void window.rex
                      .writeClipboard(remoteUrl)
                      .catch(reportFailure)
                  }
                >
                  <Copy size={12} />
                </button>
              )}
            </dd>
            <dt>Account</dt>
            <dd>{ts.account?.login_name || "Not signed in"}</dd>
            <dt>Tags</dt>
            <dd>{ts.tags?.join(", ") || "None"}</dd>
          </dl>
          {ts.error && <p className="form-error">{ts.error}</p>}
          <label className="form-field">
            Preferred hostname
            <input
              className="form-input"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="rex"
            />
          </label>
          <label className="form-field">
            Control server (optional)
            <input
              className="form-input"
              value={controlUrl}
              onChange={(event) => setControlUrl(event.target.value)}
              placeholder="Tailscale default, or https://headscale.example.com"
            />
          </label>
          <label className="form-field">
            Tags (optional)
            <input
              className="form-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="tag:rex, tag:development"
            />
          </label>
          <label className="server-access-policy">
            <input
              type="checkbox"
              checked={allowMembers}
              onChange={(event) => setAllowMembers(event.target.checked)}
            />
            Allow tailnet members permitted by your tailnet's access rules
          </label>
          <p className="form-hint">
            When off, access is limited to the Tailscale account that signed in.
            Hostname, control-server and tag changes apply when enrollment
            starts.
          </p>
          <div className="settings-buttons">
            <button
              className="button"
              onClick={() => onServerAction("tailscale.enable", startArgs)}
            >
              Apply access policy / enable…
            </button>
            <button
              className="button"
              onClick={() => onServerAction("tailscale.disable")}
            >
              Disable serving…
            </button>
            {authUrl && (
              <button
                className="button"
                onClick={() =>
                  void window.rex
                    .request("openExternal", { url: authUrl })
                    .catch(reportFailure)
                }
              >
                <ExternalLink size={13} />
                Continue sign-in
              </button>
            )}
            <button
              className="button"
              onClick={() => onServerAction("tailscale.login")}
            >
              Start sign-in…
            </button>
            <button
              className="button"
              onClick={() => onServerAction("tailscale.logout")}
            >
              {ts.state === "needs_login" ? "Cancel enrollment…" : "Sign out…"}
            </button>
            <button
              className="button"
              onClick={() => onServerAction("tailscale.rename", { hostname })}
            >
              Rename host…
            </button>
          </div>
        </>
      )}
      <details className="raw-diagnostics">
        <summary>Full diagnostic report</summary>
        <pre className="diagnostic-output">
          {report
            ? JSON.stringify(report, null, 2)
            : error || "Reading server status…"}
        </pre>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={load}>
          <RefreshCw size={13} />
          Refresh
        </button>
        <button
          className="button"
          disabled={!report}
          onClick={() =>
            void window.rex
              .writeClipboard(JSON.stringify(report, null, 2))
              .catch(reportFailure)
          }
        >
          <Copy size={13} />
          Copy report
        </button>
        <button className="button button-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
