import type { InputHTMLAttributes } from "react";
import "./Field.css";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Field({ label, error, hint, id, className, ...rest }: FieldProps) {
  const inputId = id ?? rest.name;
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  const hintId = hint && inputId ? `${inputId}-hint` : undefined;

  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={`ds-field__input${error ? " ds-field__input--error" : ""}${
          className ? ` ${className}` : ""
        }`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {hint && !error ? (
        <span className="ds-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ds-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
