import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { StatusBadge } from "../../ui/StatusBadge";
import { formatearFecha } from "../../lib/formatoFechas";
import type { ClientContextValue } from "../../context/ClientContext";
import type { Obligation } from "./tipos";
import type { FilaObligacion } from "./obligaciones";

interface SeccionObligacionesProps {
  obligations: UseQueryResult<Obligation[], Error>;
  obligationRows: FilaObligacion[];
  capabilities: ClientContextValue["capabilities"];
  navigate: (ruta: string) => void;
}

export function SeccionObligaciones({
  obligations,
  obligationRows,
  capabilities,
  navigate,
}: SeccionObligacionesProps) {
  return (
    <>
      <section className="study-page__section" id="work-obligations-section">
        <div className="section-heading">
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
            ]}
          />
        ) : (
          <EmptyState
            size="compact"
            title="Sin obligaciones materializadas"
            description="No hay vencimientos configurados para este contexto."
            action={
              capabilities.has("tax.profile.write") ? (
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
