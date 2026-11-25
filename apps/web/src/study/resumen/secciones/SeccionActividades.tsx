import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { SalidaConfiguracionFiscal, SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
  activeActivities: number;
};

export function SeccionActividades({ fiscal, activeActivities }: Props) {
  return (
    <DenseSection
      id="rc-actividades"
      title="Actividades registradas"
      description={`${activeActivities} vigentes · la principal aparece primero.`}
      count={fiscal.activities.length}
      surface="integrated"
    >
      {fiscal.activities.length === 0 ? (
        <SummarySectionEmpty
          title="Sin actividades"
          description="Las actividades se administran en Configuración fiscal."
          action={<SalidaConfiguracionFiscal />}
        />
      ) : (
        <ul className="client-summary__detail-list">
          {fiscal.activities.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.activity.name}{!item.activity.isActive ? " (oculto)" : ""}</strong>
                <small>
                  {item.activity.code}{!item.activity.jurisdiction.isActive ? " (oculto)" : ""}
                </small>
                <small>Desde {formatearFecha(item.validFrom)}{item.validTo ? ` · hasta ${formatearFecha(item.validTo)}` : ""}</small>
              </div>
              <StatusBadge
                status="INFO"
                label={`${item.isPrimary ? "Principal" : "Secundaria"} en ${item.activity.jurisdiction.name}`}
                className="status-badge--regular"
              />
            </li>
          ))}
        </ul>
      )}
    </DenseSection>
  );
}
