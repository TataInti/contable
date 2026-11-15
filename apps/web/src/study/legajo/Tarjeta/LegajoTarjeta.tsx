import type { ReactNode } from "react";
import { Button } from "@contable/design-system";
import { Icon } from "../../../ui/Icon";
import { StatusBadge } from "../../../ui/StatusBadge";
import { WORKPAPER_STEPS } from "../etiquetas";
import { selfReviewNote } from "../formato";
import type { Workpaper } from "../tipos";

interface LegajoTarjetaProps {
  wp: Workpaper;
  etapaActiva: number;
  onCambiarEtapa: (indice: number) => void;
  /** Fila de acciones de estado; la arma la pantalla con sus mutaciones y errores. */
  acciones: ReactNode;
  /** Cuerpo de la etapa activa (las seis etapas viven en la pantalla). */
  children: ReactNode;
}

/** Tarjeta de un legajo: encabezado, estado, navegación de etapas, pie y acciones de estado (R02). */
export function LegajoTarjeta({
  wp,
  etapaActiva,
  onCambiarEtapa,
  acciones,
  children,
}: LegajoTarjetaProps) {
  const bloqueantes = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
  const etapa = WORKPAPER_STEPS[etapaActiva]!;
  const anterior = WORKPAPER_STEPS[etapaActiva - 1];
  const siguiente = WORKPAPER_STEPS[etapaActiva + 1];
  const nota = selfReviewNote(wp);

  return (
    <article className="workpaper-card">
      <div className="workpaper-card__header">
        <div>
          <h2>
            {wp.periodStart.slice(0, 7)} · Revisión {wp.revision}
          </h2>
          <StatusBadge status={wp.status} />
          {nota ? (
            <small className="muted-copy" role="status">
              {nota}
            </small>
          ) : null}
        </div>
        {bloqueantes.length > 0 ? (
          <span className="workpaper-card__blocking" role="alert">
            {bloqueantes.length} control(es) bloqueante(s)
          </span>
        ) : null}
      </div>

      <div className="workpaper-process" aria-label="Navegación del legajo">
        <div className="workpaper-process__current">
          <span className="workpaper-process__index">
            Etapa {etapaActiva + 1} de {WORKPAPER_STEPS.length}
          </span>
          <h3>{etapa.title}</h3>
          <p>{etapa.description}</p>
        </div>
        <div className="workpaper-process__controls">
          <Button
            size="sm"
            variant="secondary"
            disabled={!anterior}
            onClick={() => onCambiarEtapa(etapaActiva - 1)}
          >
            {anterior ? `Anterior: ${anterior.title}` : "Anterior"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!siguiente}
            onClick={() => onCambiarEtapa(etapaActiva + 1)}
          >
            {siguiente ? `Siguiente: ${siguiente.title}` : "Siguiente"}
          </Button>
        </div>
        <div
          className="workpaper-process__menu"
          role="tablist"
          aria-label="Menú completo del legajo"
        >
          {WORKPAPER_STEPS.map((step, index) => (
            <button
              key={step.title}
              type="button"
              role="tab"
              aria-selected={etapaActiva === index}
              aria-controls={`workpaper-${wp.id}-stage`}
              className={`workpaper-step${etapaActiva === index ? " workpaper-step--active" : ""}`}
              onClick={() => onCambiarEtapa(index)}
            >
              <span className="workpaper-step__number">{index + 1}</span>
              <span>{step.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className="workpaper-card__body"
        id={`workpaper-${wp.id}-stage`}
        role="tabpanel"
        aria-live="polite"
      >
        {children}
      </div>

      <div className="workpaper-step-footer" aria-label="Cambio de etapa">
        <Button
          size="sm"
          variant="ghost"
          disabled={!anterior}
          onClick={() => onCambiarEtapa(etapaActiva - 1)}
        >
          {anterior ? `Volver a ${anterior.title}` : "Inicio del proceso"}
        </Button>
        <span>
          {etapa.title} · {etapaActiva + 1}/{WORKPAPER_STEPS.length}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!siguiente}
          onClick={() => onCambiarEtapa(etapaActiva + 1)}
        >
          {siguiente ? `Ir a ${siguiente.title}` : "Última etapa"}
          {siguiente ? <Icon name="arrow-right" size={14} /> : null}
        </Button>
      </div>

      <div className="workpaper-card__actions">{acciones}</div>
    </article>
  );
}
