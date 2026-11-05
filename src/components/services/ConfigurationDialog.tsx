import { useEffect, useRef, useState } from "react";
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
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lifetime = useRef({ active: true, pending: false, saved: false });
  useEffect(() => {
    const current = { active: true, pending: false, saved: false };
    lifetime.current = current;
    setInfo(undefined);
    setContent("");
    setError(undefined);
    setSaving(false);
    setSaved(false);
    void window.rex
      .request("configInfo", { hostId })
      .then((value) => {
        if (!current.active) return;
        setInfo(value);
        setContent(value.content || "");
      })
      .catch((failure) => {
        if (current.active) setError(() => failure);
      });
    return () => {
      current.active = false;
    };
  }, [hostId]);
  const close = () => {
    lifetime.current.active = false;
    onClose();
  };
  const reload = async (write: boolean) => {
    const current = lifetime.current;
    if (!current.active || current.pending) return;
    current.pending = true;
    setSaving(true);
    setError(undefined);
    let fileSaved = current.saved;
    try {
      if (write && !fileSaved) {
        await window.rex.request("writeConfig", { hostId, content });
        if (!current.active) return;
        fileSaved = current.saved = true;
        setSaved(true);
      }
      await window.rex.request("reloadConfig", { hostId });
      if (!current.active) return;
      onReload();
      close();
    } catch (failure) {
      if (current.active)
        setError(() =>
          fileSaved
            ? new Error(
                `Configuration saved, but reload failed: ${errorMessage(failure)}. Retry reload without saving again.`,
                { cause: failure },
              )
            : failure,
        );
    } finally {
      current.pending = false;
      if (current.active) setSaving(false);
    }
  };
  return (
    <Dialog
      title="Rex configuration"
      subtitle="Custom Lua actions, key bindings and modes are defined in init.lua."
      wide
      className="config-dialog"
      onClose={close}
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
                  .catch((failure) => setError(() => failure))
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
              readOnly={info.editable === false || saved || saving}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <p className="form-hint">
            Saving creates a backup of the previous local file. Remote
            configurations are edited on their host.
          </p>
        </>
      )}
      {error !== undefined && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={close}>
          Close
        </button>
        {!saved && (
          <button
            className="button"
            disabled={saving}
            onClick={() => void reload(false)}
          >
            <RefreshCw size={13} />
            Reload from disk
          </button>
        )}
        {info?.editable !== false && info && (
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void reload(true)}
          >
            {saving
              ? saved
                ? "Reloading…"
                : "Saving…"
              : saved
                ? "Retry reload"
                : "Save and reload"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
