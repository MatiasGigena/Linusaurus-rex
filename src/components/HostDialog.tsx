import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import type { Host } from "../shared/types";
import { errorMessage } from "../core/workspace";

export type Credentials = {
  username?: string;
  password?: string;
  token?: string;
};
export function HostDialog({
  host,
  onSave,
  onClose,
}: {
  host?: Host;
  onSave(host: Host, credentials?: Credentials): Promise<void>;
  onClose(): void;
}) {
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
  const [stored, setStored] = useState(false);
  const [secure, setSecure] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (host)
      void window.rex
        .request("credentialStatus", { hostId: host.id })
        .then((status) => {
          setStored(status.stored);
          setSecure(status.secureStorageAvailable);
        })
        .catch(() => {});
  }, [host]);
  return (
    <Dialog
      title={host ? "Edit host" : "Connect another host"}
      subtitle="Attach to an existing Rex server over a Unix socket or HTTPS/WSS."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (saving) return;
          setSaving(true);
          const credentials =
            auth === "basic"
              ? { username, password }
              : auth === "token"
                ? { token }
                : undefined;
          void onSave(
            {
              id: host?.id || crypto.randomUUID(),
              label: label.trim(),
              endpoint: endpoint.trim(),
              ...(startupMode === "inherit"
                ? {}
                : {
                    startupCommand:
                      startupMode === "server" ? "" : startupCommand.trim(),
                  }),
            },
            credentials,
          )
            .then(onClose)
            .catch((failure) => {
              setError(errorMessage(failure));
              setSaving(false);
            });
        }}
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
                : "Rex peer / Tailscale access"}
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
              onClick={() =>
                void window.rex
                  .request("removeCredentials", { hostId: host.id })
                  .then(() => setStored(false))
                  .catch((failure) => setError(errorMessage(failure)))
              }
            >
              Forget
            </button>
          </div>
        )}
        <p className="form-hint">
          {secure === false
            ? "Unlock or enable a system keyring before saving credentials."
            : "Saved credentials are encrypted with the system keyring. TLS certificates are verified for HTTPS/WSS."}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={saving || !label.trim()}
          >
            {saving ? "Connecting…" : "Save and connect"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
