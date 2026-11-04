import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Dialog } from "../Dialog";
import { errorMessage } from "../../core/workspace";
export function ConfigurationDialog({
  hostId,
  onClose,
  onReload,
}: {
  hostId: string;
  onClose(): void;
  onReload(): void;
}) {
  const [info, setInfo] = useState<{
    path: string;
    content?: string;
    editable?: boolean;
  }>();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void window.rex
      .request("configInfo", { hostId })
      .then((value) => {
        setInfo(value);
        setContent(value.content || "");
      })
      .catch((failure) => setError(errorMessage(failure)));
  }, [hostId]);
  return (
    <Dialog
      title="Rex configuration"
      subtitle="Custom Lua actions, key bindings and modes are defined in init.lua."
      wide
      className="config-dialog"
      onClose={onClose}
    >
      {info && (
        <>
          <div className="config-path">
            <code>{info.path}</code>
            <button
              className="icon-button"
              title="Copy config path"
              aria-label="Copy config path"
              onClick={() =>
                void window.rex
                  .writeClipboard(info.path)
                  .catch((failure) => setError(errorMessage(failure)))
              }
            >
              <Copy size={14} />
            </button>
          </div>
          <label className="form-field">
            Lua configuration
            <textarea
              className="form-input config-editor"
              aria-label="Lua configuration"
              spellCheck={false}
              value={content}
              readOnly={info.editable === false}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <p className="form-hint">
            Saving creates a backup of the previous local file. Remote
            configurations are edited on their host.
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Close
        </button>
        <button
          className="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void window.rex
              .request("reloadConfig", { hostId })
              .then(() => {
                onReload();
                onClose();
              })
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setSaving(false));
          }}
        >
          <RefreshCw size={13} />
          Reload from disk
        </button>
        {info?.editable !== false && info && (
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void window.rex
                .request("writeConfig", { hostId, content })
                .then(() => window.rex.request("reloadConfig", { hostId }))
                .then(() => {
                  onReload();
                  onClose();
                })
                .catch((failure) => setError(errorMessage(failure)))
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : "Save and reload"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
