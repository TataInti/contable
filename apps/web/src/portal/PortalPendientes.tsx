import { useQuery } from "@tanstack/react-query";
import { EmptyState, Table } from "@contable/design-system";
import { Link } from "react-router-dom";
import { api, type DocumentRequest } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { formatPortalDate, PortalLoading, PortalPageHeader } from "./PortalUI";
import "./portal.css";

interface PortalDocumentRequest extends DocumentRequest {
  description?: string | null;
  dueDate?: string | null;
}

export function PortalPendientes() {
  const { clientId } = useClientContext();
  const query = useQuery({
    queryKey: ["portal-requests", clientId],
    queryFn: () =>
      api.get<PortalDocumentRequest[]>(`/portal/clients/${clientId}/document-requests`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const isPendingItem = (status: string) => status !== "ACCEPTED" && status !== "WAIVED";
  const pendingItems = rows.reduce(
    (total, request) => total + request.items.filter((item) => isPendingItem(item.status)).length,
    0,
  );

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Documentación"
        title="Documentación pendiente"
        description="Revisá qué necesita tu estudio y seguí el estado de cada pedido."
        actions={
          <Link className="portal-button-link" to="/portal/upload">
            <Icon name="upload" size={18} />
            <span>Cargar un archivo</span>
          </Link>
        }
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa en la barra superior para ver sus pedidos."
        />
      ) : query.isLoading ? (
        <PortalLoading label="Cargando pedidos…" />
      ) : query.isError ? (
        <EmptyState
          title="No pudimos cargar los pedidos"
          description="Reintentá en unos minutos."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Estás al día"
          description="No hay documentación pendiente para esta empresa."
          action={
            <Link className="portal-text-link" to="/portal/upload">
              Cargar documentación nueva
            </Link>
          }
        />
      ) : (
        <section className="portal-page__section" aria-labelledby="requests-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="requests-title">Pedidos del estudio</h2>
              <p>
                {pendingItems} {pendingItems === 1 ? "ítem pendiente" : "ítems pendientes"} en{" "}
                {rows.length} {rows.length === 1 ? "pedido" : "pedidos"}
              </p>
            </div>
          </div>
          <Table<PortalDocumentRequest>
            className="portal-data-table portal-data-table--requests"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "title",
                header: "Pedido",
                render: (row) => (
                  <div className="portal-table-primary">
                    <strong>{row.title}</strong>
                    {row.description ? <span>{row.description}</span> : null}
                  </div>
                ),
              },
              {
                key: "items",
                header: "Entrega",
                render: (row) => {
                  const pending = row.items.filter((item) => isPendingItem(item.status)).length;
                  return (
                    <span>
                      {pending === 0
                        ? "Completa"
                        : `${pending} de ${row.items.length} por entregar`}
                    </span>
                  );
                },
              },
              {
                key: "due",
                header: "Fecha solicitada",
                render: (row) =>
                  row.dueDate
                    ? formatPortalDate(row.dueDate, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      })
                    : "Sin fecha límite",
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.status} />,
              },
            ]}
          />
        </section>
      )}
    </div>
  );
}
