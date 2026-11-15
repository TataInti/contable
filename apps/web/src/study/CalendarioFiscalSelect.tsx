/**
 * Select de formulario con el marcado de la guía (label.ds-field y .ds-field__input).
 * El paquete no trae un componente de select: se anota como pieza faltante en el PR.
 */
export function CalendarioFiscalSelect({
  id,
  label,
  value,
  options,
  onChange,
  onBlur,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="ds-field__control">
        <select
          id={id}
          className={`ds-field__input${error ? " ds-field__input--error" : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <span className="ds-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
