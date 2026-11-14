import type { ButtonHTMLAttributes } from "react";
import "./Switch.css";

/**
 * Interruptor: prende o apaga algo que queda guardado al instante (un módulo,
 * una preferencia). Para elegir dentro de un formulario que se envía después
 * se usa una casilla, no esto.
 */
export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "type" | "children"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Nombre accesible: qué se prende o apaga. */
  label: string;
  /** Texto visible al lado; por defecto no se muestra ninguno. */
  text?: string;
  /** Mientras se guarda el cambio: no admite otro clic. */
  busy?: boolean;
}

export function Switch({ checked, onChange, label, text, busy = false, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={["ds-switch", checked ? "ds-switch--on" : "", className ?? ""].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className="ds-switch__track" aria-hidden="true">
        <span className="ds-switch__thumb" />
      </span>
      {text ? <span className="ds-switch__text">{text}</span> : null}
    </button>
  );
}
