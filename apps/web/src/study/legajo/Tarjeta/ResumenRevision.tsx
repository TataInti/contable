import { getStatusBadgeMeta } from "@contable/design-system";
import type { Workpaper } from "../tipos";

interface ResumenRevisionProps {
  wp: Workpaper;
  vigente: Workpaper;
}

/** Revisión reemplazada: resumen de solo lectura, sin etapas ni acciones (D6a). */
export function ResumenRevision({ wp, vigente }: ResumenRevisionProps) {
  return (
    <article className="workpaper-card workpaper-card--resumen">
      <div className="workpaper-card__header">
        <div>
          <h2>
            {wp.periodStart.slice(0, 7)} · Revisión {wp.revision}
          </h2>
          <p className="muted-copy">
            {`Revisión ${wp.revision} · ${getStatusBadgeMeta(wp.status).label} · reemplazada por la revisión ${vigente.revision}`}
          </p>
        </div>
      </div>
    </article>
  );
}
