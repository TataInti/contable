import { useQuery } from "@tanstack/react-query";
import { EmptyState, Table } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { formatPortalDate, PortalLoading, PortalPageHeader } from "./PortalUI";
import "./portal.css";

interface Obligation {
  id: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  obligation: { name: string; jurisdiction?: string | null };
}

export function PortalObligaciones() {
  const { clientId } = useClientContext();
  const query = useQuery({
    queryKey: ["portal-obligations", clientId],
    queryFn: () => api.get<Obligation[]>(`/portal/clients/${clientId}/obligations`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const actionable = rows.filter(
    (row) => !["PAID", "FILED", "NOT_APPLICABLE"].includes(row.status),
  ).length;

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Calendario"
        title="Impuestos y obligaciones"
        description="Consultá las fechas y el estado que informó tu estudio."
        actions={
          <Link className="portal-secondary-link" to="/portal/mensajes">
            <Icon name="message" size={18} />
            <span>Hacer una consulta</span>
          </Link>
        }
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar sus vencimientos."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando impuestos y obligaciones…" />
      ) : query.isError ? (
        <EmptyState
          title="No pudimos cargar los vencimientos"
          description="Reintentá en unos minutos."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin vencimientos informados"
          description="Cuando tu estudio publique una obligación, aparecerá acá."
        />
      ) : (
        <section className="portal-page__section" aria-labelledby="obligations-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="obligations-title">Calendario informado</h2>
              <p>
                {actionable === 0
                  ? "No hay obligaciones que requieran seguimiento"
                  : `${actionable} ${actionable === 1 ? "obligación requiere" : "obligaciones requieren"} seguimiento`}
              </p>
            </div>
          </div>
          <Table<Obligation>
            className="portal-data-table portal-data-table--obligations"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: "Obligación",
                render: (row) => (
                  <div className="portal-table-primary">
                    <strong>{row.obligation.name}</strong>
                    {row.obligation.jurisdiction ? (
                      <span>{row.obligation.jurisdiction}</span>
                    ) : null}
                  </div>
                ),
              },
              { key: "period", header: "Período", render: (row) => row.periodLabel },
              {
                key: "due",
                header: "Vence",
                render: (row) =>
                  formatPortalDate(row.dueDate, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }),
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
            ]}
          />
          <p className="portal-page__footnote">
            <Icon name="shield" size={16} />
            <span>
              La información publicada es orientativa. Ante una duda, confirmala con tu estudio.
            </span>
          </p>
        </section>
      )}
    </div>
  );
}
