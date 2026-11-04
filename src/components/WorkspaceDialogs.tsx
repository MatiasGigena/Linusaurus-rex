import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../core/workspace";
import { WorkspaceReconciliationError } from "../core/workspaceOperations";
import type { Form, Confirmation } from "../workspace/actions/context";

type SubmissionPhase = "ready" | "saving" | "committed" | "refreshing";

/** A completed write can recover by reading, never by invoking submit again. */
function useMutationDialog(
  onClose: () => void,
  onRefresh?: () => Promise<void>,
) {
  const [state, setState] = useState<{
    phase: SubmissionPhase;
    error?: string;
  }>({ phase: "ready" });
  const phase = useRef<SubmissionPhase>("ready");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const update = (next: typeof state) => {
    phase.current = next.phase;
    if (mounted.current) setState(next);
  };
  const close = () => {
    if (mounted.current) onClose();
  };
  return {
    ...state,
    committed: state.phase === "committed" || state.phase === "refreshing",
    submit(operation: () => Promise<unknown>) {
      if (phase.current !== "ready") return;
      update({ phase: "saving" });
      void Promise.resolve()
        .then(operation)
        .then(close, (failure) => {
          update({
            phase:
              failure instanceof WorkspaceReconciliationError
                ? "committed"
                : "ready",
            error: errorMessage(failure),
          });
        });
    },
    refresh() {
      if (phase.current !== "committed" || !onRefresh) return;
      update({ ...state, phase: "refreshing" });
      void Promise.resolve()
        .then(onRefresh)
        .then(close, (failure) => {
          update({
            phase: "committed",
            error: `${state.error}\nRefresh failed: ${errorMessage(failure)}`,
          });
        });
    },
  };
}

export function FormDialog({
  form,
  busy,
  onClose,
  onRefresh,
}: {
  form: Form;
  busy: boolean;
  onClose(): void;
  onRefresh?(): Promise<void>;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.value || ""]),
    ),
  );
  const submission = useMutationDialog(onClose, onRefresh);
  const saving = submission.phase === "saving";
  const { error } = submission;
  return (
    <Dialog title={form.title} subtitle={form.description} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) submission.submit(() => form.submit(values));
        }}
      >
        {form.fields.map((field, index) => (
          <label className="form-field" key={field.name}>
            {field.label}
            {field.multiline ? (
              <textarea
                className="form-input"
                aria-label={field.label}
                value={values[field.name]}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            ) : (
              <input
                className="form-input"
                data-autofocus={index === 0 ? true : undefined}
                required={field.required}
                value={values[field.name]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {submission.committed ? "Dismiss" : "Cancel"}
          </button>
          {submission.committed && onRefresh && (
            <button
              type="button"
              className="button"
              disabled={submission.phase === "refreshing" || busy}
              onClick={submission.refresh}
            >
              {submission.phase === "refreshing"
                ? "Refreshing…"
                : "Refresh workspace"}
            </button>
          )}
          <button
            className="button button-primary"
            disabled={submission.phase !== "ready" || busy}
          >
            {saving || busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ConfirmDialog({
  confirmation,
  onClose,
  onRefresh,
}: {
  confirmation: Confirmation;
  onClose(): void;
  onRefresh?(): Promise<void>;
}) {
  const submission = useMutationDialog(onClose, onRefresh);
  const saving = submission.phase === "saving";
  const { error } = submission;
  return (
    <Dialog
      title={confirmation.title}
      subtitle={confirmation.description}
      onClose={onClose}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          {submission.committed ? "Dismiss" : "Cancel"}
        </button>
        {submission.committed && onRefresh && (
          <button
            className="button"
            disabled={submission.phase === "refreshing"}
            onClick={submission.refresh}
          >
            {submission.phase === "refreshing"
              ? "Refreshing…"
              : "Refresh workspace"}
          </button>
        )}
        <button
          className="button button-danger"
          disabled={submission.phase !== "ready"}
          onClick={() => submission.submit(confirmation.submit)}
        >
          {saving ? "Applying…" : confirmation.label || "Close terminal"}
        </button>
      </div>
    </Dialog>
  );
}
