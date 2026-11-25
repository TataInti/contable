import { Table } from "@contable/design-system";
import type { ClientSummary } from "../../../lib/api";
import { StatusBadge } from "../../../ui/StatusBadge";
import { formatearFecha, formatearPeriodo } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { etiquetaPeriodo } from "../etiquetas";
import { SalidaConfiguracionFiscal, SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionObligaciones({ fiscal }: Props) {
  // Los períodos fiscales viven acá: los que todavía no tienen obligación se listan debajo de la tabla.
  const conObligacion = new Set(fiscal.obligations.map((obligation) => obligation.period.id));
  const sinObligacion = fiscal.periods.filter((period) => !conObligacion.has(period.id));
  return (
    <DenseSection
      id="rc-obligaciones"
      title="Obligaciones"
      description="Régimen, período, vencimiento y estado de cada obligación del cliente."
      count={fiscal.obligations.length}
      surface="integrated"
    >
      {fiscal.obligations.length === 0 ? (
        <SummarySectionEmpty
          title="Sin obligaciones"
          description="Las obligaciones aparecen acá cuando se generan en Configuración fiscal."
          action={<SalidaConfiguracionFiscal />}
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
                <span>{obligation.period.label ? etiquetaPeriodo(obligation.period.label) : formatearPeriodo(obligation.period.startDate, obligation.period.endDate)}</span>
              ),
            },
            {
              key: "dueDate",
              header: "Vence",
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
      {sinObligacion.length > 0 ? (
        <p className="client-summary__periods-note">
          Períodos fiscales sin obligación:{" "}
          {sinObligacion
            .map((period) => `${period.taxType.name} · ${period.label ? etiquetaPeriodo(period.label) : formatearPeriodo(period.startDate, period.endDate)}`)
            .join(", ")}
          .
        </p>
      ) : null}
    </DenseSection>
  );
}
