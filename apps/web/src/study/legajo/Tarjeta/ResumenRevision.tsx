import { getStatusBadgeMeta } from "@contable/design-system";
import type { Workpaper } from "../tipos";

interface ResumenRevisionProps {
  /** Revisión anterior, que se muestra en solo lectura. */
  wp: Workpaper;
  /** Revisión que la reemplaza. */
  reemplazadaPor: Workpaper;
}

/** Revisión reemplazada: resumen de solo lectura, sin acciones (Saldos y Cálculo no tienen datos por revisión). */
export function ResumenRevision({ wp, reemplazadaPor }: ResumenRevisionProps) {
  return (
    <section className="workpaper-resumen" aria-label={`Revisión ${wp.revision} en solo lectura`}>
      <h2>
        {wp.periodStart.slice(0, 7)} · Revisión {wp.revision}
      </h2>
      <p className="muted-copy">
        {`Revisión ${wp.revision} · ${getStatusBadgeMeta(wp.status).label} · reemplazada por la revisión ${reemplazadaPor.revision}`}
      </p>
    </section>
  );
}
