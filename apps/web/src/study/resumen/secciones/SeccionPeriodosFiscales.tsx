import { Table } from "@contable/design-system";
import type { ClientSummary } from "../../../lib/api";
import { formatearRango } from "../../../lib/formatoFechas";
import { DenseSection } from "../../../ui/Dense";
import { etiquetaPeriodo } from "../etiquetas";
import { SalidaConfiguracionFiscal, SummarySectionEmpty } from "../Piezas";

type Props = {
  fiscal: ClientSummary["fiscal"];
};

export function SeccionPeriodosFiscales({ fiscal }: Props) {
  return (
    <DenseSection
      id="rc-periodos-fiscales"
      title="Períodos fiscales"
      description="Períodos disponibles para asociar saldos, presentaciones y obligaciones."
      count={fiscal.periods.length}
      surface="integrated"
    >
      {fiscal.periods.length === 0 ? (
        <SummarySectionEmpty
          title="Sin períodos fiscales"
          description="Los períodos fiscales se cargan en Configuración fiscal."
          action={<SalidaConfiguracionFiscal />}
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
                  <strong>{etiquetaPeriodo(period.label)}</strong>
                  <small>{formatearRango(period.startDate, period.endDate)}</small>
                </div>
              ),
            },
          ]}
        />
      )}
    </DenseSection>
  );
}
