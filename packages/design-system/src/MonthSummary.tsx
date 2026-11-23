import { useId, type ReactNode } from "react";
import "./MonthSummary.css";
import { StepFlow, type FlowStep } from "./StepFlow.js";
import { StatusBadge } from "./StatusBadge.js";

/** Pendiente del mes con enlace directo a la tarea que lo resuelve. */
export interface MonthSummaryPending {
  id: string;
  label: string;
  /** Ruta de la etapa o del objeto que resuelve el pendiente. */
  href: string;
}

export interface MonthSummaryTax {
  id: string;
  label: string;
  detail: string;
  status: string;
  amount: string;
}

export interface MonthSummaryAlert {
  id: string;
  label: string;
  detail: string;
  status: string;
  action: string;
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
  taxes?: readonly MonthSummaryTax[];
  alerts?: readonly MonthSummaryAlert[];
  steps?: readonly FlowStep[];
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
  taxes = [],
  alerts = [],
  steps = [],
}: MonthSummaryProps) {
  const base = useId();
  const titleId = `${base}-titulo`;
  const faltaId = `${base}-falta`;
  const listoId = `${base}-listo`;
  const importeId = `${base}-importe`;
  const demo = taxes.length > 0 || alerts.length > 0 || steps.length > 0;
  return (
    <section className={`month-summary${demo ? " month-summary--reference" : ""}`} aria-labelledby={titleId}>
      <header className="month-summary__cabecera">
        <div><p className="month-summary__eyebrow">Resumen del mes</p><h2 id={titleId}>{title}</h2></div>
        {dueLabel ? <p className="month-summary__vence">{dueLabel}</p> : null}
      </header>
      {demo ? (
        <div className="month-summary__reference-grid">
          <div className="month-summary__reference-main">
            <section className="month-summary__bloque" aria-labelledby={faltaId}>
              <h3 id={faltaId}>Impuestos del período</h3>
              <ul className="month-summary__lista month-summary__taxes">
                {taxes.map((tax) => <li key={tax.id}><span className="month-summary__copy"><strong>{tax.label}</strong><small>{tax.detail}</small></span><StatusBadge status={tax.status} /><strong className="month-summary__amount">{tax.amount}</strong></li>)}
              </ul>
            </section>
            <section className="month-summary__bloque" aria-labelledby={listoId}>
              <h3 id={listoId}>Requiere atención</h3>
              <ul className="month-summary__lista month-summary__alerts">
                {alerts.map((item) => <li key={item.id}><span className="month-summary__copy"><strong>{item.label}</strong><small>{item.detail}</small></span><StatusBadge status={item.status} /><a className="month-summary__enlace" href={item.href}>{item.action} →</a></li>)}
              </ul>
            </section>
          </div>
          <section className="month-summary__flow" aria-labelledby={importeId}>
            <h3 id={importeId}>Avance del cierre</h3>
            <StepFlow label="Avance del cierre" steps={steps} />
          </section>
        </div>
      ) : (
        <div className="month-summary__bloques">
          <section className="month-summary__bloque" aria-labelledby={faltaId}><h3 id={faltaId}>Qué falta ({pending.length})</h3>{pending.length === 0 ? <p className="month-summary__nada">No queda nada pendiente.</p> : <ul className="month-summary__lista">{pending.map((item) => <li key={item.id}><a className="month-summary__enlace" href={item.href}>{item.label}</a></li>)}</ul>}</section>
          <section className="month-summary__bloque" aria-labelledby={listoId}><h3 id={listoId}>Listo ({ready.length})</h3>{ready.length === 0 ? <p className="month-summary__nada">Todavía no hay pasos listos.</p> : <ul className="month-summary__lista">{ready.map((texto) => <li key={texto}>{texto}</li>)}</ul>}</section>
          <section className="month-summary__bloque" aria-labelledby={importeId}><h3 id={importeId}>Importe estimado</h3><p className="month-summary__importe">{estimatedAmount}</p>{estimateNote ? <p className="month-summary__nota">{estimateNote}</p> : null}</section>
        </div>
      )}
    </section>
  );
}
