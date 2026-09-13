import { forwardRef, type InputHTMLAttributes } from "react";
import "./Field.css";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  function Field({ label, error, hint, id, className, prefix, ...rest }, ref) {
    const inputId = id ?? rest.name;
    const errorId = error && inputId ? `${inputId}-error` : undefined;
    const hintId = hint && inputId ? `${inputId}-hint` : undefined;

    return (
      <div className="ds-field">
        {label !== undefined ? (
          <label className="ds-field__label" htmlFor={inputId}>
            {label}
          </label>
        ) : null}
        <div className="ds-field__control">
          {prefix ? (
            <span className="ds-field__prefix" aria-hidden="true">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            className={`ds-field__input${error ? " ds-field__input--error" : ""}${
              className ? ` ${className}` : ""
            }`}
            aria-invalid={error ? true : undefined}
            aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
            {...rest}
          />
        </div>
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
  },
);
