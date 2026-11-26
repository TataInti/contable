import { SearchSelect } from "@contable/design-system";
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
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="calendario-requerido" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <div className="ds-field__control">
        <SearchSelect
          id={id}
          label={label}
          required={required}
          hideLabel
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
          allowEmpty={placeholder !== undefined}
          placeholder={placeholder ?? "Elegí…"}
          options={options}
        />
      </div>
      {error ? (
        <span className="ds-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
