import type { NavigateFunction } from "react-router-dom";
import { Button } from "@contable/design-system";
import type { ClientSummary } from "../../../lib/api";
import { formatearFecha } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { StatusBadge } from "../../../ui/StatusBadge";
import { SummaryFact } from "../Piezas";

type Props = {
  client: ClientSummary["client"];
  profile: ClientSummary["client"]["profile"];
  fiscal: ClientSummary["fiscal"];
  openAccountingYearCount: number;
  activeActivities: number;
  navigate: NavigateFunction;
};

export function SeccionResumen({ client, profile, fiscal, openAccountingYearCount, activeActivities, navigate }: Props) {
  return (
    <DenseSection
      id="rc-resumen"
      title="Resumen"
      description="Una lectura rápida para decidir dónde continuar."
      surface="integrated"
      actions={
        <div className="client-summary__overview-meta">
          <span className="client-summary__overview-status">
            <span>Estado</span>
            <StatusBadge status={client.status} variant="pill" />
          </span>
          <span className="client-summary__overview-created">
            Alta en el estudio {formatearFecha(client.createdAt)}
          </span>
          <span className="client-summary__updated">Actualizado {formatearFecha(client.updatedAt)}</span>
        </div>
      }
    >
      <dl className="client-summary__overview-facts">
        <SummaryFact
          label="Ficha contable"
          value={<StatusBadge status={profile ? "CONFIGURED" : "PENDING"} className="status-badge--regular" />}
        />
        <SummaryFact
          label="Configuración fiscal"
          value={
            <StatusBadge
              status={client.onboarding?.completed ? "COMPLETED" : "PENDING"}
              className="status-badge--regular"
            />
          }
        />
        {openAccountingYearCount > 0 ? (
          <SummaryFact
            label={openAccountingYearCount === 1 ? "Ejercicio contable" : "Ejercicios contables"}
            value={String(openAccountingYearCount)}
          />
        ) : null}
        <SummaryFact
          label="Actividades registradas"
          value={String(fiscal.activities.length)}
          detail={`${activeActivities} vigente${activeActivities === 1 ? "" : "s"}`}
        />
        <SummaryFact
          label={fiscal.obligations.length === 1 ? "Obligación materializada" : "Obligaciones materializadas"}
          value={String(fiscal.obligations.length)}
        />
      </dl>
      <div className="client-summary__overview-links">
        <h3>Accesos rápidos</h3>
        <ul>
          <li>
            <Button type="button" variant="text" size="row" onClick={() => navigate("/expediente-mensual")}>
              <strong>Cargar período</strong>
            </Button>
          </li>
          <li>
            <Button type="button" variant="text" size="row" onClick={() => navigate("/configuracion-fiscal")}>
              <strong>Materializar obligaciones</strong>
            </Button>
          </li>
          <li>
            <Button type="button" variant="text" size="row" onClick={() => navigate("/configuracion-fiscal")}>
              <strong>Nueva versión del perfil</strong>
            </Button>
          </li>
        </ul>
      </div>
    </DenseSection>
  );
}
