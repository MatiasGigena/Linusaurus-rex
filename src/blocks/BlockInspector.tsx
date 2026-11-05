import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Box,
  Code2,
  Download,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import type { RexPane, Settings, TerminalRef } from "../shared/types";
import { formatBlockResult, inspectMethods, parseMethodArgs } from "./methods";
import "../terminal/terminal.css";

// String preview bounds count decoded UTF-16 units rather than response bytes.
const MAX_PREVIEW_CHARACTERS = 256 * 1024;

export interface BlockInspectorProps {
  pane: RexPane;
  terminalRef: TerminalRef;
  settings: Settings;
  onFocus(): void;
  onClose(): void;
}

export function BlockInspector(props: BlockInspectorProps) {
  const { hostId, sessionId, blockId } = props.terminalRef;
  const endpoint = props.settings.hosts.find(
    (host) => host.id === hostId,
  )?.endpoint;
  return (
    <InspectBlock
      key={JSON.stringify([hostId, sessionId, blockId, endpoint])}
      {...props}
    />
  );
}
function InspectBlock({
  pane,
  terminalRef,
  settings,
  onFocus,
  onClose,
}: BlockInspectorProps) {
  const [info, setInfo] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState("");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  const loadRequest = useRef(0);
  const callRequest = useRef(0);
  const selectedMethod = useRef(method);
  selectedMethod.current = method;
  const chooseMethod = (next: string) => {
    if (next !== selectedMethod.current) {
      callRequest.current++;
      setRunning(false);
      setArgs("{}");
      setResult(undefined);
      setError(undefined);
    }
    selectedMethod.current = next;
    setMethod(next);
  };
  const methods = useMemo(() => inspectMethods(info), [info]);
  const selected = methods.find((item) => item.name === method);
  const { hostId, sessionId, blockId } = terminalRef;
  const ref = { hostId, sessionId, blockId };
  const load = async () => {
    if (!mounted.current) return;
    const request = ++loadRequest.current;
    const ownsRequest = () =>
      mounted.current && loadRequest.current === request;
    setLoading(true);
    setError(undefined);
    try {
      const next = await window.rex.request("blockInfo", ref);
      if (!ownsRequest()) return;
      setInfo(next);
      const available = inspectMethods(next);
      chooseMethod(
        available.some((item) => item.name === selectedMethod.current)
          ? selectedMethod.current
          : available[0]?.name || "",
      );
    } catch (failure) {
      if (ownsRequest())
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (ownsRequest()) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadRequest.current++;
      callRequest.current++;
    };
  }, []);
  const call = async (event: React.FormEvent) => {
    event.preventDefault();
    if (running || !method) return;
    const request = ++callRequest.current;
    const ownsRequest = () =>
      mounted.current && callRequest.current === request;
    setRunning(true);
    setError(undefined);
    try {
      const value = await window.rex.request("callBlock", {
        ...ref,
        method,
        args: parseMethodArgs(args),
      });
      if (ownsRequest()) setResult(formatBlockResult(value));
    } catch (failure) {
      if (ownsRequest())
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (ownsRequest()) setRunning(false);
    }
  };
  const save = async () => {
    const request = callRequest.current;
    try {
      await window.rex.request("pickPath", {
        save: true,
        content: result || "null",
        defaultPath: "rex-block-result.json",
      });
    } catch (failure) {
      if (mounted.current && callRequest.current === request)
        setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <section
      className="block-inspector"
      aria-label={`${pane.label} block inspector`}
      onPointerDown={onFocus}
    >
      <header className="pane-header">
        <span>
          <Box size={14} />
          {pane.label}
          <span className="block-plugin-badge">BLOCK PLUGIN</span>
        </span>
        <div>
          <button
            className="icon-button"
            title="Reload block methods"
            aria-label="Reload block methods"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={13} />
          </button>
          <button
            className="icon-button"
            title="Close block"
            aria-label="Close block"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="block-inspector-body">
        <div className="block-inspector-heading">
          <Code2 size={22} />
          <div>
            <h2>Block method inspector</h2>
            <p>{pane.creator || "Unknown creator"}</p>
          </div>
        </div>
        <p className="block-inspector-note">
          This plugin has no native view in Linusaurus Rex. You can inspect its
          server-provided methods and explicitly call them here.
        </p>
        {loading ? (
          <p className="block-inspector-note" role="status">
            Loading methods from Rex…
          </p>
        ) : methods.length ? (
          <form onSubmit={(event) => void call(event)}>
            <label className="form-field">
              Server method
              <select
                className="form-select"
                value={method}
                onChange={(event) => chooseMethod(event.target.value)}
              >
                {methods.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {selected?.description && (
              <p className="block-method-description">{selected.description}</p>
            )}
            {selected?.schema && (
              <details className="block-schema">
                <summary>Argument schema</summary>
                <pre>{formatBlockResult(selected.schema)}</pre>
              </details>
            )}
            <label className="form-field">
              Arguments as JSON
              <textarea
                className="form-input block-arguments"
                value={args}
                spellCheck={false}
                onChange={(event) => setArgs(event.target.value)}
                rows={6}
                style={{ fontFamily: settings.fontFamily }}
              />
            </label>
            <div className="block-inspector-actions">
              <span className="form-hint">
                The selected method runs on the Rex server.
              </span>
              <button
                className="button button-primary"
                disabled={running || !method}
              >
                <Play size={13} />
                {running ? "Running…" : "Run method"}
              </button>
            </div>
          </form>
        ) : (
          <p className="block-inspector-note">
            This server did not expose methods for this block. Reload to check
            again, or use a client that supports this plugin’s native view.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        {result !== undefined && (
          <div className="block-result">
            <div>
              <strong>Result</strong>
              <button
                type="button"
                className="button"
                onClick={() => void save()}
              >
                <Download size={12} />
                Save JSON
              </button>
            </div>
            <pre style={{ fontFamily: settings.fontFamily }}>
              {result.slice(0, MAX_PREVIEW_CHARACTERS)}
            </pre>
            {result.length > MAX_PREVIEW_CHARACTERS && (
              <p className="form-hint">
                Showing a shortened preview. Save JSON to inspect the complete
                response.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
