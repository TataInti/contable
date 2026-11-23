import { useId, type ReactNode } from "react";
import "./MonthSummary.css";
import type { FlowStep } from "./StepFlow.js";
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
  const estado = (status: string) => {
    const normalized = status.toUpperCase();
    if (["READY", "DONE", "COMPLETED"].includes(normalized)) return "Listo";
    if (["BLOCKING"].includes(normalized)) return "Bloqueante";
    if (["PENDING", "WAITING", "EN_ESPERA"].includes(normalized)) return "En espera";
    if (["NEEDS_REVIEW", "REVIEW", "WARN"].includes(normalized)) return "Revisar";
    return status;
  };
  return (
    <section className={`month-summary${demo ? " month-summary--reference" : ""}`} aria-labelledby={titleId}>
      {demo ? (
        <div className="cover-grid">
          <section className="month-summary__reference-main">
            <p className="ds-text-help month-summary__eyebrow">Resumen del mes</p>
            <h2 className="ds-title-section" id={titleId}>{title}</h2>
            {dueLabel ? <p className="ds-text-body month-summary__vence">{dueLabel}</p> : null}
            <h3 className="ds-title-block" id={faltaId}>Impuestos del período</h3>
            <div className="tax-list" aria-label="Impuestos del período">
              {taxes.map((tax) => (
                <div className="tax-row" key={tax.id}><div><b>{tax.label}</b><div className="ds-text-help">{tax.detail}</div></div><StatusBadge status={tax.status} label={estado(tax.status)} /><b>{tax.amount}</b></div>
              ))}
            </div>
            <h3 className="ds-title-block" id={listoId}>Requiere atención</h3>
            <div className="work-list" aria-label="Requiere atención">
              {alerts.map((item) => (
                <a className="work-row" href={item.href} key={item.id}><span><b>{item.label}</b><span className="ds-text-help">{item.detail}</span></span><StatusBadge status={item.status} label={estado(item.status)} /><span>{item.action} →</span></a>
              ))}
            </div>
          </section>
          <aside aria-labelledby={importeId}>
            <h3 className="ds-title-block" id={importeId}>Avance del cierre</h3>
            <ol className="progress" aria-label="Avance del cierre">
              {steps.map((step, index) => {
                const status = step.status === "done" ? "READY" : step.status === "blocked" ? "BLOCKING" : step.status === "pending" ? "PENDING" : "IN_PROGRESS";
                return <li className="progress-row" key={step.key}><span className="step-no">{index + 1}</span><span className="progress-row__content"><b>{step.label}</b><span className="ds-text-help">{step.reason}</span></span><StatusBadge status={status} label={estado(status)} /></li>;
              })}
            </ol>
          </aside>
        </div>
      ) : (
        <>
          <header className="month-summary__cabecera">
            <div><p className="month-summary__eyebrow">Resumen del mes</p><h2 id={titleId}>{title}</h2></div>
            {dueLabel ? <p className="month-summary__vence">{dueLabel}</p> : null}
          </header>
          <div className="month-summary__bloques">
            <section className="month-summary__bloque" aria-labelledby={faltaId}><h3 id={faltaId}>Qué falta ({pending.length})</h3>{pending.length === 0 ? <p className="month-summary__nada">No queda nada pendiente.</p> : <ul className="month-summary__lista">{pending.map((item) => <li key={item.id}><a className="month-summary__enlace" href={item.href}>{item.label}</a></li>)}</ul>}</section>
            <section className="month-summary__bloque" aria-labelledby={listoId}><h3 id={listoId}>Listo ({ready.length})</h3>{ready.length === 0 ? <p className="month-summary__nada">Todavía no hay pasos listos.</p> : <ul className="month-summary__lista">{ready.map((texto) => <li key={texto}>{texto}</li>)}</ul>}</section>
            <section className="month-summary__bloque" aria-labelledby={importeId}><h3 id={importeId}>Importe estimado</h3><p className="month-summary__importe">{estimatedAmount}</p>{estimateNote ? <p className="month-summary__nota">{estimateNote}</p> : null}</section>
          </div>
        </>
      )}
    </section>
  );
}
