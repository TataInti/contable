import type { ReactNode } from "react";
import "./StepFlow.css";

export type StepStatus = "done" | "current" | "blocked" | "pending";

export interface FlowStep {
  key: string;
  label: string;
  status: StepStatus;
  /** Motivo visible cuando el paso está bloqueado o pendiente de otro: dice qué falta (P1). */
  reason?: string;
  /** Acción del paso. Solo se muestra en el paso en curso. */
  action?: ReactNode;
}

const TEXTO_ESTADO: Record<StepStatus, string> = {
  done: "Hecho",
  current: "En curso",
  blocked: "Bloqueado",
  pending: "Pendiente",
};

export interface StepFlowProps {
  /** Nombre accesible de la secuencia, por ejemplo «Cierre del mes». */
  label: string;
  steps: readonly FlowStep[];
}

/**
 * Flujo secuencial por pasos (cierre, presentación, pago). Cada paso dice su estado con texto, el
 * paso en curso lleva `aria-current="step"` y su única acción; los demás muestran el motivo.
 */
export function StepFlow({ label, steps }: StepFlowProps) {
  return (
    <ol className="step-flow" aria-label={label}>
      {steps.map((paso, indice) => (
        <li
          key={paso.key}
          className={`step-flow__paso step-flow__paso--${paso.status}`}
          data-status={paso.status}
          aria-current={paso.status === "current" ? "step" : undefined}
        >
          <span className="step-flow__marca" aria-hidden="true">
            {indice + 1}
          </span>
          <div className="step-flow__cuerpo">
            <p className="step-flow__titulo">
              <span className="step-flow__nombre">{paso.label}</span>
              <span className="step-flow__estado">{TEXTO_ESTADO[paso.status]}</span>
            </p>
            {paso.reason && paso.status !== "done" ? (
              <p className="step-flow__motivo">{paso.reason}</p>
            ) : null}
            {paso.status === "current" && paso.action ? (
              <div className="step-flow__accion">{paso.action}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
