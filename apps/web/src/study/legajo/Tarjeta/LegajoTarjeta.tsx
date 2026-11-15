import type { ReactNode } from "react";
import { Button } from "@contable/design-system";
import { DenseTabs } from "../../../ui/Dense";
import { Icon } from "../../../ui/Icon";
import { StatusBadge } from "../../../ui/StatusBadge";
import { WORKPAPER_STEPS } from "../etiquetas";
import { selfReviewNote } from "../formato";
import type { Workpaper } from "../tipos";
import { pluralizar } from "../textos";
import { formatearMes } from "../../../lib/formatoFechas";

interface LegajoTarjetaProps {
  wp: Workpaper;
  etapaActiva: number;
  onCambiarEtapa: (indice: number) => void;
  /** Acción primaria de la tarjeta (la de su estado): va en la línea «ETAPA N DE 6», antes de la barra de etapas. */
  accionPrincipal?: ReactNode;
  /** Acciones secundarias de estado; las arma la pantalla con sus mutaciones y errores. */
  acciones: ReactNode;
  /** Cuerpo de la etapa activa (las seis etapas viven en la pantalla). */
  children: ReactNode;
}

/** Tarjeta de la revisión vigente: encabezado, estado, etapas con DenseTabs (C05), un solo pie y acciones (R02). */
export function LegajoTarjeta({
  wp,
  etapaActiva,
  onCambiarEtapa,
  accionPrincipal,
  acciones,
  children,
}: LegajoTarjetaProps) {
  const bloqueantes = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
  const etapa = WORKPAPER_STEPS[etapaActiva]!;
  const anterior = WORKPAPER_STEPS[etapaActiva - 1];
  const siguiente = WORKPAPER_STEPS[etapaActiva + 1];
  const nota = selfReviewNote(wp);
  const idPrefix = `workpaper-${wp.id}`;

  return (
    <article className="workpaper-card">
      <div className="workpaper-card__header">
        <div>
          <h2>
            {formatearMes(wp.periodStart)} · Revisión {wp.revision}
          </h2>
          <StatusBadge status={wp.status} />
          {nota ? (
            <small className="muted-copy" role="status">
              {nota}
            </small>
          ) : null}
        </div>
        {bloqueantes.length > 0 ? (
          <span className="workpaper-card__blocking">
            {pluralizar(bloqueantes.length, "control bloqueante", "controles bloqueantes")}
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
        <div className="workpaper-process__nav">
          {accionPrincipal ? (
            <div className="workpaper-process__accion">{accionPrincipal}</div>
          ) : null}
          <DenseTabs
            label="Menú completo del legajo"
            idPrefix={idPrefix}
            tabs={WORKPAPER_STEPS.map((step, index) => ({ id: String(index), label: step.title }))}
            active={String(etapaActiva)}
            onChange={(id) => onCambiarEtapa(Number(id))}
          />
        </div>
      </div>

      <div
        className="workpaper-card__body"
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${etapaActiva}`}
        aria-live="polite"
      >
        {children}
      </div>

      {/* Las acciones secundarias van debajo del cuerpo de la etapa; la primaria, en el encabezado. */}
      <div className="workpaper-card__actions">{acciones}</div>

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
    </article>
  );
}
