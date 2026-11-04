import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../core/workspace";
import { WorkspaceReconciliationError } from "../core/workspaceOperations";
import type { Form, Confirmation } from "../workspace/actions/context";

type SubmissionPhase = "ready" | "saving" | "committed" | "refreshing";

/** A completed write can recover by reading, never by invoking submit again. */
function useMutationDialog(
  owner: Form | Confirmation,
  onClose: () => void,
  onRefresh?: () => Promise<void>,
) {
  type Submission = {
    owner: Form | Confirmation;
    phase: SubmissionPhase;
    error?: string;
    committedError?: string;
  };
  const [saved, setSaved] = useState<Submission>({ owner, phase: "ready" });
  const state: Submission =
    saved.owner === owner ? saved : { owner, phase: "ready" };
  const phase = useRef({ owner, value: "ready" as SubmissionPhase });
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ownsDialog = () => mounted.current && currentOwner.current === owner;
  const update = (next: Omit<Submission, "owner">) => {
    if (!ownsDialog()) return;
    phase.current = { owner, value: next.phase };
    setSaved({ ...next, owner });
  };
  const close = () => {
    if (ownsDialog()) onClose();
  };
  return {
    ...state,
    committed: state.phase === "committed" || state.phase === "refreshing",
    submit(operation: () => Promise<unknown>) {
      if (
        !ownsDialog() ||
        (phase.current.owner === owner && phase.current.value !== "ready")
      )
        return;
      update({ phase: "saving" });
      void Promise.resolve()
        .then(operation)
        .then(close, (failure) => {
          const committed = failure instanceof WorkspaceReconciliationError;
          const error = errorMessage(failure);
          update({
            phase: committed ? "committed" : "ready",
            error,
            committedError: committed ? error : undefined,
          });
        });
    },
    refresh() {
      if (
        !ownsDialog() ||
        phase.current.owner !== owner ||
        phase.current.value !== "committed" ||
        !onRefresh
      )
        return;
      update({ ...state, phase: "refreshing" });
      void Promise.resolve()
        .then(onRefresh)
        .then(close, (failure) => {
          update({
            phase: "committed",
            committedError: state.committedError,
            error: `${state.committedError}\nRefresh failed: ${errorMessage(failure)}`,
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
  const initialValues = () =>
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.value || ""]),
    );
  const [draft, setDraft] = useState(() => ({
    owner: form,
    values: initialValues(),
  }));
  const values = draft.owner === form ? draft.values : initialValues();
  const setValues = (next: Record<string, string>) =>
    setDraft({ owner: form, values: next });
  const submission = useMutationDialog(form, onClose, onRefresh);
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
  const submission = useMutationDialog(confirmation, onClose, onRefresh);
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
