import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import type { Host } from "../shared/types";
import { errorMessage } from "../core/workspace";
import {
  HostSaveIncompleteError,
  type Credentials,
} from "../workspace/actions/hostActions";

type HostDialogProps = {
  host?: Host;
  onSave(
    host: Host,
    credentials?: Credentials,
    isActive?: () => boolean,
  ): Promise<void>;
  onClose(): void;
};
type CredentialDiscovery =
  | { phase: "pending" }
  | { phase: "known"; stored: boolean; secureStorageAvailable: boolean }
  | { phase: "failed"; message: string };

export function HostDialog(props: HostDialogProps) {
  return (
    <HostForm
      key={JSON.stringify([props.host?.id, props.host?.endpoint])}
      {...props}
    />
  );
}

function HostForm({ host, onSave, onClose }: HostDialogProps) {
  const [draftId] = useState(() => host?.id || crypto.randomUUID());
  const [label, setLabel] = useState(host?.label || "");
  const [endpoint, setEndpoint] = useState(host?.endpoint || "");
  const [auth, setAuth] = useState<"none" | "basic" | "token">("none");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [startupMode, setStartupMode] = useState<
    "inherit" | "server" | "custom"
  >(
    host?.startupCommand === undefined
      ? "inherit"
      : host.startupCommand
        ? "custom"
        : "server",
  );
  const [startupCommand, setStartupCommand] = useState(
    host?.startupCommand || "",
  );
  const [savedDiscovery, setDiscovery] = useState<
    CredentialDiscovery | undefined
  >(() => (host ? { phase: "pending" } : undefined));
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const [forgetting, setForgetting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [recovery, setRecovery] = useState<HostSaveIncompleteError>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!host) return;
    let active = true;
    setDiscovery({ phase: "pending" });
    void window.rex
      .request("credentialStatus", { hostId: host.id })
      .then((status) => {
        if (active) setDiscovery({ phase: "known", ...status });
      })
      .catch((failure) => {
        if (active)
          setDiscovery({ phase: "failed", message: errorMessage(failure) });
      });
    return () => {
      active = false;
    };
  }, [host?.id, host?.endpoint, discoveryRevision]);
  const endpointChanged = host && endpoint.trim() !== host.endpoint;
  const discovery = endpointChanged ? undefined : savedDiscovery;
  const stored = discovery?.phase === "known" && discovery.stored;
  return (
    <Dialog
      title={host ? "Edit host" : "Connect another host"}
      subtitle="Attach to an existing Rex server over a Unix socket or HTTPS/WSS."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (savingNow.current) return;
          savingNow.current = true;
          setError(undefined);
          setSaving(true);
          const credentials =
            auth === "basic"
              ? { username, password }
              : auth === "token"
                ? { token }
                : undefined;
          const draft = {
            id: draftId,
            label: label.trim(),
            endpoint: endpoint.trim(),
            ...(host?.endpoint === endpoint.trim() &&
            host.websocketOrigins !== undefined
              ? { websocketOrigins: host.websocketOrigins }
              : {}),
            ...(startupMode === "inherit"
              ? {}
              : {
                  startupCommand:
                    startupMode === "server" ? "" : startupCommand.trim(),
                }),
          };
          void Promise.resolve()
            .then(() =>
              recovery
                ? recovery.retry()
                : onSave(draft, credentials, () => mounted.current),
            )
            .then(() => {
              if (mounted.current) onClose();
            })
            .catch((failure) => {
              if (!mounted.current) return;
              if (failure instanceof HostSaveIncompleteError)
                setRecovery(failure);
              setError(errorMessage(failure));
              savingNow.current = false;
              setSaving(false);
            });
        }}
      >
        <fieldset
          disabled={saving || !!recovery}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <label className="form-field">
            Display name
            <input
              className="form-input"
              data-autofocus
              required
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. studio-linux"
            />
          </label>
          <label className="form-field">
            Rex endpoint or account@host
            <input
              className="form-input"
              required={host?.id !== "local"}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="unix:///run/user/1000/rex/server.sock or https://host"
            />
          </label>
          <label className="form-field">
            Startup program
            <select
              className="form-select"
              value={startupMode}
              onChange={(event) =>
                setStartupMode(event.target.value as typeof startupMode)
              }
            >
              <option value="inherit">
                Inherit client default (local servers)
              </option>
              <option value="server">Server's default login shell</option>
              <option value="custom">Custom command</option>
            </select>
          </label>
          {startupMode === "custom" && (
            <label className="form-field">
              Startup command for this host
              <input
                className="form-input"
                value={startupCommand}
                onChange={(event) => setStartupCommand(event.target.value)}
                required
                placeholder="/usr/bin/fish --login"
              />
            </label>
          )}
          <label className="form-field">
            Optional HTTP gateway authentication
            <select
              className="form-select"
              value={auth}
              onChange={(event) => setAuth(event.target.value as typeof auth)}
            >
              <option value="none">
                {stored
                  ? "Keep saved credentials"
                  : !host || discovery?.phase === "known"
                    ? "Rex peer / Tailscale access"
                    : "Keep authentication unchanged"}
              </option>
              <option value="basic">HTTP gateway username and password</option>
              <option value="token">HTTP gateway bearer token</option>
            </select>
          </label>
          {auth === "basic" && (
            <>
              <label className="form-field">
                Username
                <input
                  className="form-input"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="form-field">
                Password
                <input
                  className="form-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          )}
          {auth === "token" && (
            <label className="form-field">
              Access token
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
          )}
          {stored && host && (
            <div className="stored-credentials">
              <ShieldCheck size={14} />
              <span>Credentials saved separately from preferences</span>
              <button
                className="text-button"
                type="button"
                disabled={forgetting || saving}
                onClick={() => {
                  setError(undefined);
                  setForgetting(true);
                  void window.rex
                    .request("removeCredentials", { hostId: host.id })
                    .then(() => {
                      if (mounted.current)
                        setDiscovery((previous) =>
                          previous?.phase === "known"
                            ? { ...previous, stored: false }
                            : previous,
                        );
                    })
                    .catch((failure) => {
                      if (mounted.current) setError(errorMessage(failure));
                    })
                    .finally(() => {
                      if (mounted.current) setForgetting(false);
                    });
                }}
              >
                {forgetting ? "Forgetting…" : "Forget"}
              </button>
            </div>
          )}
          {endpointChanged && (
            <p className="form-hint">
              Save the new endpoint to check its saved credentials.
            </p>
          )}
          {host && discovery?.phase === "pending" && (
            <p className="form-hint" role="status">
              Checking saved credentials and system keyring…
            </p>
          )}
          {discovery?.phase === "failed" && (
            <div className="form-error" role="alert">
              <p>Saved credentials could not be checked: {discovery.message}</p>
              <button
                className="text-button"
                type="button"
                onClick={() => setDiscoveryRevision((previous) => previous + 1)}
              >
                Retry credential check
              </button>
            </div>
          )}
          {discovery?.phase === "known" && !discovery.stored && (
            <p className="form-hint">No credentials are saved for this host.</p>
          )}
          <p className="form-hint">
            {discovery?.phase === "known"
              ? discovery.secureStorageAvailable
                ? "Saved credentials are encrypted with the system keyring. TLS certificates are verified for HTTPS/WSS."
                : "Unlock or enable a system keyring before saving credentials."
              : "HTTP gateway credentials require a system keyring. TLS certificates are verified for HTTPS/WSS."}
          </p>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onClose}>
            {recovery ? "Dismiss" : "Cancel"}
          </button>
          <button
            className="button button-primary"
            disabled={saving || !label.trim()}
          >
            {saving
              ? recovery?.stage === "refresh"
                ? "Refreshing…"
                : "Connecting…"
              : recovery
                ? recovery.stage === "credentials"
                  ? "Retry credential storage"
                  : "Refresh workspace"
                : "Save and connect"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
