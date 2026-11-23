import { useId, type ReactNode } from "react";
import "./MonthSummary.css";

/** Pendiente del mes con enlace directo a la tarea que lo resuelve. */
export interface MonthSummaryPending {
  id: string;
  label: string;
  /** Ruta de la etapa o del objeto que resuelve el pendiente. */
  href: string;
}

export interface MonthSummaryProps {
  /** Título visible de la portada. Por defecto, «Resumen del mes». */
  title?: string;
  /** Vencimiento ya formateado, por ejemplo «Vence el 20/11/2026». */
  dueLabel?: string;
  pending: readonly MonthSummaryPending[];
  /** Etapas o pasos ya listos. */
  ready: readonly string[];
  /** Importe estimado ya formateado. */
  estimatedAmount: string;
  /** Aclaración del importe, por ejemplo «Estimado; el cálculo final sale en Liquidación». */
  estimateNote?: ReactNode;
}

/**
 * Portada del Legajo: qué falta, qué está listo y el importe estimado. Cada pendiente es un
 * enlace a su etapa; la portada no repite el contenido de las etapas.
 */
export function MonthSummary({
  title = "Resumen del mes",
  dueLabel,
  pending,
  ready,
  estimatedAmount,
  estimateNote,
}: MonthSummaryProps) {
  const base = useId();
  const titleId = `${base}-titulo`;
  const faltaId = `${base}-falta`;
  const listoId = `${base}-listo`;
  const importeId = `${base}-importe`;
  return (
    <section className="month-summary" aria-labelledby={titleId}>
      <header className="month-summary__cabecera">
        <h2 id={titleId}>{title}</h2>
        {dueLabel ? <p className="month-summary__vence">{dueLabel}</p> : null}
      </header>
      <div className="month-summary__bloques">
        <section className="month-summary__bloque" aria-labelledby={faltaId}>
          <h3 id={faltaId}>Qué falta ({pending.length})</h3>
          {pending.length === 0 ? (
            <p className="month-summary__nada">No queda nada pendiente.</p>
          ) : (
            <ul className="month-summary__lista">
              {pending.map((item) => (
                <li key={item.id}>
                  <a className="month-summary__enlace" href={item.href}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="month-summary__bloque" aria-labelledby={listoId}>
          <h3 id={listoId}>Listo ({ready.length})</h3>
          {ready.length === 0 ? (
            <p className="month-summary__nada">Todavía no hay pasos listos.</p>
          ) : (
            <ul className="month-summary__lista">
              {ready.map((texto) => (
                <li key={texto}>{texto}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="month-summary__bloque" aria-labelledby={importeId}>
          <h3 id={importeId}>Importe estimado</h3>
          <p className="month-summary__importe">{estimatedAmount}</p>
          {estimateNote ? <p className="month-summary__nota">{estimateNote}</p> : null}
        </section>
      </div>
    </section>
  );
}
