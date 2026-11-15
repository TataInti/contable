import { StatusBadge } from "../../../ui/StatusBadge";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
  activeActivities: number;
};

export function SeccionActividades({ fiscal, activeActivities }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="activities-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="activities-title">Actividades registradas</h2>
          <p>{activeActivities} vigentes · la principal aparece primero.</p>
        </div>
        <span className="section-count">{fiscal.activities.length}</span>
      </div>
      {fiscal.activities.length === 0 ? (
        <SummarySectionEmpty
          title="Sin actividades"
          description="Las actividades económicas se administran desde configuración fiscal."
        />
      ) : (
        <ul className="client-summary__detail-list">
          {fiscal.activities.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.activity.name}{!item.activity.isActive ? " (oculto)" : ""}</strong>
                <small>
                  {item.activity.code} · {item.activity.jurisdiction.name}{!item.activity.jurisdiction.isActive ? " (oculto)" : ""}
                </small>
                <small>Desde {formatearFecha(item.validFrom)}{item.validTo ? ` · hasta ${formatearFecha(item.validTo)}` : ""}</small>
              </div>
              <StatusBadge
                status="INFO"
                label={item.isPrimary ? "Principal" : "Secundaria"}
                className="status-badge--regular"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
