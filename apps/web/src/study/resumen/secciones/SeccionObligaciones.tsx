import { Table } from "@contable/design-system";
import type { ClientSummary } from "../../../lib/api";
import { StatusBadge } from "../../../ui/StatusBadge";
import { formatearFecha, formatearRango } from "../../../lib/formatoFechas";
import { displayValue } from "../etiquetas";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionObligaciones({ fiscal }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="obligations-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="obligations-title">Obligaciones materializadas</h2>
          <p>Régimen, período, vencimiento y estado de cada obligación del cliente.</p>
        </div>
        <span className="section-count">{fiscal.obligations.length}</span>
      </div>
      {fiscal.obligations.length === 0 ? (
        <SummarySectionEmpty
          title="Sin obligaciones materializadas"
          description="Las obligaciones aparecen acá cuando se generan desde la configuración fiscal."
        />
      ) : (
        <Table
          rows={fiscal.obligations}
          rowKey={(obligation) => obligation.id}
          columns={[
            {
              key: "regime",
              header: "Régimen",
              render: (obligation) => (
                <div className="summary-table__primary">
                  <strong>{obligation.regime.name}{!obligation.regime.isActive ? " (oculto)" : ""}</strong>
                  <small>
                    {obligation.regime.taxType.name}{!obligation.regime.taxType.isActive ? " (oculto)" : ""} · {obligation.regime.jurisdiction.name}{!obligation.regime.jurisdiction.isActive ? " (oculto)" : ""}
                  </small>
                </div>
              ),
            },
            {
              key: "period",
              header: "Período",
              render: (obligation) => (
                <div className="summary-table__primary">
                  <strong>{displayValue(obligation.period.label)}</strong>
                  <small>{formatearRango(obligation.period.startDate, obligation.period.endDate)}</small>
                </div>
              ),
            },
            {
              key: "dueDate",
              header: "Vencimiento",
              render: (obligation) => <span className="tabular-copy">{formatearFecha(obligation.dueDate)}</span>,
            },
            {
              key: "status",
              header: "Estado",
              render: (obligation) => <StatusBadge status={obligation.status} />,
            },
          ]}
        />
      )}
    </section>
  );
}
