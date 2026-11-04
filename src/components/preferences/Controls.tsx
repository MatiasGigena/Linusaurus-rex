export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="preferences-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="settings-row toggle-row">
      <span>
        {label}
        {hint && <small className="form-hint">{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
export function Text({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>
        {label}
        {hint && <small className="form-hint">{hint}</small>}
      </span>
      <input
        className="form-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: (readonly [string, string])[];
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <select
        className="form-select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <span className="range-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output>
          {Number(value.toFixed(2))}
          {unit}
        </output>
      </span>
    </label>
  );
}
export function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="color"
        value={value.slice(0, 7)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
