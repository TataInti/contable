import { Field, type FieldProps } from "@contable/design-system";
import { formatearFecha } from "../../lib/formatoFechas";
import { fechaLarga } from "./fechas";

/**
 * Campo de fecha con el valor elegido leído debajo en dd/mm/aaaa y en letras: el navegador muestra
 * el formato de su idioma (en inglés, mm/dd/aaaa) y el contador no tiene que adivinar.
 */
export function CampoFecha({ value, ...props }: Omit<FieldProps, "type">) {
  const texto = typeof value === "string" ? value : "";
  return (
    <div className="ds-field">
      <Field {...props} type="date" value={value} />
      {texto ? <span className="ds-field__hint" aria-live="polite">{formatearFecha(texto)} · {fechaLarga(texto)}</span> : null}
    </div>
  );
}
