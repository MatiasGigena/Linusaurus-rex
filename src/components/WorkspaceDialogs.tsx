import { useState } from "react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../core/workspace";
import type { Form, Confirmation } from "../workspace/actions/context";

export function FormDialog({
  form,
  busy,
  onClose,
}: {
  form: Form;
  busy: boolean;
  onClose(): void;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.value || ""]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog title={form.title} subtitle={form.description} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || saving) return;
          setSaving(true);
          void form
            .submit(values)
            .then(onClose)
            .catch((failure) => {
              setError(errorMessage(failure));
              setSaving(false);
            });
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
            Cancel
          </button>
          <button className="button button-primary" disabled={saving || busy}>
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
}: {
  confirmation: Confirmation;
  onClose(): void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
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
          Cancel
        </button>
        <button
          className="button button-danger"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void confirmation
              .submit()
              .then(onClose)
              .catch((failure) => {
                setError(errorMessage(failure));
                setSaving(false);
              });
          }}
        >
          {saving ? "Applying…" : confirmation.label || "Close terminal"}
        </button>
      </div>
    </Dialog>
  );
}
