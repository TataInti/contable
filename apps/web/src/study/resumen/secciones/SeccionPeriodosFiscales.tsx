import { Table } from "@contable/design-system";
import type { ClientSummary } from "../../../lib/api";
import { formatearRango } from "../../../lib/formatoFechas";
import { displayValue } from "../etiquetas";
import { SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionPeriodosFiscales({ fiscal }: Props) {
  return (
    <section className="client-summary__detail-section" aria-labelledby="tax-periods-title">
      <div className="client-summary__detail-heading">
        <div>
          <h2 id="tax-periods-title">Períodos fiscales</h2>
          <p>Períodos disponibles para asociar saldos, presentaciones y obligaciones.</p>
        </div>
        <span className="section-count">{fiscal.periods.length}</span>
      </div>
      {fiscal.periods.length === 0 ? (
        <SummarySectionEmpty
          title="Sin períodos fiscales"
          description="La configuración fiscal todavía no tiene períodos para este cliente."
        />
      ) : (
        <Table
          rows={fiscal.periods}
          rowKey={(period) => period.id}
          columns={[
            {
              key: "taxType",
              header: "Impuesto",
              render: (period) => (
                <div className="summary-table__primary">
                  <strong>{period.taxType.name}{!period.taxType.isActive ? " (oculto)" : ""}</strong>
                  <small>{period.taxType.code}{!period.taxType.isActive ? " (oculto)" : ""}</small>
                </div>
              ),
            },
            {
              key: "range",
              header: "Período",
              render: (period) => (
                <div className="summary-table__primary">
                  <strong>{displayValue(period.label)}</strong>
                  <small>{formatearRango(period.startDate, period.endDate)}</small>
                </div>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
