import type { SelectHTMLAttributes } from "react";
import "./Field.css";
import "./BarSelect.css";

export interface BarSelectOption {
  value: string;
  label: string;
}

export interface BarSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "aria-label" | "children"
> {
  /** Nombre accesible. El campo no lleva etiqueta visible encima. */
  label: string;
  options: BarSelectOption[];
}

/**
 * Desplegable compacto de barra: campo de selección de 32 px (`--ds-control-height-sm`) con el
 * aspecto de `.ds-field__input`. Sin etiqueta visible; el nombre accesible va en `aria-label`.
 * Un texto largo se corta con puntos suspensivos.
 */
export function BarSelect({ label, options, className, ...rest }: BarSelectProps) {
  // El rótulo completo del valor elegido va en title: si el texto se corta, se lee al pasar el puntero (Barra 2e).
  const rotuloElegido = options.find((option) => option.value === String(rest.value ?? ""))?.label;
  return (
    <select
      {...rest}
      aria-label={label}
      title={rest.title ?? rotuloElegido}
      className={
        className ? `ds-field__input ds-bar-select ${className}` : "ds-field__input ds-bar-select"
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
