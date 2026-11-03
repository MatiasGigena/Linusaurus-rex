import { useEffect, useState } from "react";
import {
  ArrowUp,
  File,
  Folder,
  FolderOpen,
  Home,
  Link2,
  RefreshCw,
} from "lucide-react";
import { Dialog } from "./Dialog";
import type { RexMethods, TerminalRef } from "../shared/types";
import { errorMessage } from "../core/workspace";
export function DirectoryDialog({
  terminalRef,
  mode,
  recent,
  onPick,
  onClose,
}: {
  terminalRef: TerminalRef;
  mode: "insert" | "directory";
  recent: string[];
  onPick(path: string): Promise<void>;
  onClose(): void;
}) {
  const [directory, setDirectory] =
    useState<RexMethods["listDirectory"]["result"]>();
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const load = async (next: string) => {
    setLoading(true);
    setError(undefined);
    setSelected("");
    setFilter("");
    try {
      const result = await window.rex.request("listDirectory", {
        ...terminalRef,
        path: next,
        files: mode === "insert",
        limit: 2000,
      });
      setDirectory(result);
      setPath(result.path || next);
      if (result.status !== "ok")
        setError(
          result.status === "denied"
            ? "Permission denied for this directory."
            : result.status === "not_dir"
              ? "This path is not a directory."
              : "The directory does not exist.",
        );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load("");
  }, [terminalRef.hostId, terminalRef.sessionId, terminalRef.blockId]);
  const fullPath = (name: string) =>
    `${directory?.path.replace(/\/$/, "") || ""}/${name}` || "/";
  const pick = async (value: string) => {
    if (saving || !value) return;
    setSaving(true);
    try {
      await onPick(value);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setSaving(false);
    }
  };
  const entries = (directory?.entries || [])
    .filter((entry) =>
      entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name),
    );
  return (
    <Dialog
      title={mode === "insert" ? "Insert path" : "Open directory"}
      subtitle="Browse files on the selected Rex server."
      onClose={onClose}
      wide
      className="directory-dialog"
    >
      <form
        className="directory-address"
        onSubmit={(event) => {
          event.preventDefault();
          void load(path);
        }}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Parent directory"
          title="Parent directory"
          onClick={() =>
            void load(path.split("/").slice(0, -1).join("/") || "/")
          }
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Home directory"
          title="Home directory"
          onClick={() => void load("~")}
        >
          <Home size={15} />
        </button>
        <input
          className="form-input"
          aria-label="Directory path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <button className="button" disabled={loading}>
          Go
        </button>
      </form>
      {recent.length > 0 && (
        <div className="recent-paths">
          <span>Recent</span>
          {recent.slice(0, 5).map((value) => (
            <button
              key={value}
              title={value}
              onClick={() =>
                mode === "insert" ? void pick(value) : void load(value)
              }
            >
              {value.split("/").filter(Boolean).at(-1) || "/"}
            </button>
          ))}
        </div>
      )}
      <label className="directory-filter">
        <input
          className="form-input"
          aria-label="Filter directory entries"
          placeholder="Filter files and folders…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <small>{entries.length} entries</small>
      </label>
      <div
        className="directory-entries"
        role="listbox"
        aria-label="Directory entries"
        onKeyDown={(event) => {
          const options = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ),
          );
          if (!options.length) return;
          const focused = options.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            focused >= 0
              ? focused
              : Math.max(
                  0,
                  entries.findIndex((entry) => entry.name === selected),
                );
          if (event.key === "Enter") {
            event.preventDefault();
            const entry = entries[index];
            if (!entry) return;
            if (entry.file) void pick(fullPath(entry.name));
            else {
              const list = event.currentTarget;
              void load(fullPath(entry.name)).then(() =>
                requestAnimationFrame(() =>
                  list
                    .querySelector<HTMLButtonElement>('[role="option"]')
                    ?.focus(),
                ),
              );
            }
            return;
          }
          const next =
            event.key === "ArrowDown"
              ? Math.min(options.length - 1, index + 1)
              : event.key === "ArrowUp"
                ? Math.max(0, index - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : undefined;
          if (next !== undefined) {
            event.preventDefault();
            setSelected(entries[next].name);
            options[next].focus();
            options[next].scrollIntoView({ block: "nearest" });
          }
        }}
      >
        {loading ? (
          <div className="directory-empty">
            <RefreshCw size={17} className="spinning" />
            Reading directory…
          </div>
        ) : entries.length ? (
          entries.map((entry, index) => (
            <button
              role="option"
              aria-selected={selected === entry.name}
              tabIndex={
                index ===
                Math.max(
                  0,
                  entries.findIndex((entry) => entry.name === selected),
                )
                  ? 0
                  : -1
              }
              onFocus={() => setSelected(entry.name)}
              key={entry.name}
              className={selected === entry.name ? "is-selected" : ""}
              onClick={() => setSelected(entry.name)}
              onDoubleClick={() =>
                entry.file
                  ? void pick(fullPath(entry.name))
                  : void load(fullPath(entry.name))
              }
            >
              {entry.file ? <File size={16} /> : <Folder size={16} />}
              <span>{entry.name}</span>
              {entry.symlink && <Link2 size={12} />}
              <small>{entry.file ? "File" : "Folder"}</small>
            </button>
          ))
        ) : (
          <div className="directory-empty">
            {error
              ? "Could not read this directory."
              : "This directory is empty."}
          </div>
        )}
      </div>
      {directory?.truncated && (
        <p className="form-hint">
          Showing the first 2,000 entries. Enter a more specific path to browse
          a large directory.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        {selected &&
          !directory?.entries.find((entry) => entry.name === selected)
            ?.file && (
            <button
              className="button"
              onClick={() => void load(fullPath(selected))}
            >
              <FolderOpen size={14} />
              Browse selected
            </button>
          )}
        <button
          className="button button-primary"
          disabled={saving || loading || directory?.status !== "ok"}
          onClick={() =>
            void pick(selected ? fullPath(selected) : directory?.path || "")
          }
        >
          {saving
            ? "Opening…"
            : mode === "insert"
              ? "Insert selected path"
              : "Open terminal here"}
        </button>
      </div>
    </Dialog>
  );
}
