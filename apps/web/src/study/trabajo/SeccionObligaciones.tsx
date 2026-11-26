import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { StatusBadge } from "../../ui/StatusBadge";
import { formatearFecha } from "../../lib/formatoFechas";
import type { ClientContextValue } from "../../context/ClientContext";
import type { Obligation } from "./tipos";
import type { FilaObligacion } from "./obligaciones";

interface SeccionObligacionesProps {
  obligations: UseQueryResult<Obligation[], Error>;
  /** Solo las obligaciones sin pagar. */
  obligationRows: FilaObligacion[];
  /** Hay obligaciones en el período y todas están pagadas. */
  allPaid: boolean;
  capabilities: ClientContextValue["capabilities"];
  navigate: (ruta: string) => void;
  /** Entra al Legajo con el cliente, el mes y el impuesto de la obligación ya elegidos. */
  abrirLegajo: (taxPeriodId: string) => void;
}

export function SeccionObligaciones({
  obligations,
  obligationRows,
  allPaid,
  capabilities,
  navigate,
  abrirLegajo,
}: SeccionObligacionesProps) {
  return (
    <>
      <section className="study-panel" id="work-obligations-section">
        <div className="study-panel__heading">
          <div>
            <h2>Próximas obligaciones</h2>
          </div>
          <span className="section-count">{obligationRows.length}</span>
        </div>
        {obligations.isLoading ? (
          <div className="query-state">
            <span className="loading-copy">Cargando obligaciones…</span>
          </div>
        ) : obligationRows.length ? (
          <Table
            rows={obligationRows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Obligación", render: (row) => <strong>{row.name}</strong> },
              { key: "period", header: "Período", render: (row) => row.periodLabel },
              { key: "due", header: "Vence", render: (row) => formatearFecha(row.dueDate) },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "legajo",
                header: "Acción",
                align: "right",
                render: (row) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Abrir legajo ${row.name} ${row.periodLabel}`}
                    onClick={() => abrirLegajo(row.taxPeriodId)}
                  >
                    Abrir legajo
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState
            size="compact"
            title={allPaid ? "Todo al día" : "Sin obligaciones materializadas"}
            description={
              allPaid
                ? "Las obligaciones de este período están pagadas."
                : "No hay vencimientos configurados para este contexto."
            }
            action={
              capabilities.has("tax.profile.write") && !allPaid ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate("/configuracion-fiscal")}
                >
                  Configurar obligaciones
                </Button>
              ) : undefined
            }
          />
        )}
      </section>
    </>
  );
}
