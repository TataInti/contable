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
  return (
    <select
      {...rest}
      aria-label={label}
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
