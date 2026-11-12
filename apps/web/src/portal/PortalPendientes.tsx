import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { Link, useNavigate } from "react-router-dom";
import { api, type DocumentRequest } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import {
  formatPortalDate,
  PortalLoading,
  PortalPageHeader,
  PortalRetryButton,
} from "./PortalUI";
import { SectionIndex } from "../ui/SectionIndex";
import "./portal.css";

interface PortalDocumentRequest extends DocumentRequest {
  description?: string | null;
  dueDate?: string | null;
}

export function PortalPendientes() {
  const { clientId, capabilities } = useClientContext();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["portal-requests", clientId],
    queryFn: () =>
      api.get<PortalDocumentRequest[]>(`/portal/clients/${clientId}/document-requests`),
    enabled: Boolean(clientId),
  });
  const rows = query.data ?? [];
  const isPendingItem = (status: string) => status === "PENDING";
  const pendingItems = rows.reduce(
    (total, request) => total + request.items.filter((item) => isPendingItem(item.status)).length,
    0,
  );
  const firstPendingRequest = rows.find((request) =>
    request.items.some((item) => isPendingItem(item.status)),
  );
  const firstPendingItem = firstPendingRequest?.items.find((item) => isPendingItem(item.status));
  const nextUploadUrl =
    firstPendingRequest && firstPendingItem
      ? `/portal/upload?pedido=${encodeURIComponent(firstPendingRequest.title)}&item=${encodeURIComponent(firstPendingItem.description)}&itemId=${encodeURIComponent(firstPendingItem.id)}`
      : "/portal/upload";

  return (
    <div className="portal-page">
      <PortalPageHeader
        eyebrow="Documentación"
        title="Documentación pendiente"
        description="Revisá qué necesita tu estudio y seguí el estado de cada pedido."
        actions={capabilities.has("portal.documents.upload") ? (
          <Button
            href="/portal/upload"
            variant="primary"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(event.currentTarget.pathname);
            }}
          >
            <Icon name="upload" size={18} />
            <span>Cargar un archivo</span>
          </Button>
        ) : undefined}
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
          action={<PortalRetryButton onRetry={() => void query.refetch()} />}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Estás al día"
          description="No hay documentación pendiente para esta empresa."
          action={capabilities.has("portal.documents.upload") ? (
            <Link className="portal-text-link" to="/portal/upload">
              Cargar documentación nueva
            </Link>
          ) : undefined}
        />
      ) : (
        <>
          <SectionIndex
            items={[
              { id: "pending-status-title", label: "Resumen", meta: `${pendingItems} pendientes` },
              { id: "requests-title", label: "Pedidos", meta: String(rows.length) },
            ]}
          />
          <section className="portal-guidance" aria-labelledby="pending-next-step-title">
            <div className="portal-guidance__context">
              <span className="portal-guidance__icon" aria-hidden="true">
                <Icon name="tasks" size={19} />
              </span>
              <div>
                <p className="portal-guidance__eyebrow" id="pending-status-title">Estado de la documentación</p>
                <p>
                  Tu estudio tiene {rows.length} {rows.length === 1 ? "pedido abierto" : "pedidos abiertos"} y faltan {pendingItems} {pendingItems === 1 ? "archivo" : "archivos"} por entregar.
                </p>
              </div>
            </div>
            <div className="portal-guidance__next">
              <div>
                <p className="portal-guidance__eyebrow">Próximo paso</p>
                <h2 id="pending-next-step-title">
                  {pendingItems > 0 ? "Aportá el primer archivo pendiente" : "Revisá las entregas completadas"}
                </h2>
              </div>
              {pendingItems > 0 && capabilities.has("portal.documents.upload") ? (
                <Button
                  href={nextUploadUrl}
                  variant="primary"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    navigate(`${event.currentTarget.pathname}${event.currentTarget.search}${event.currentTarget.hash}`);
                  }}
                >
                  Aportar archivo <Icon name="arrow-right" size={17} />
                </Button>
              ) : null}
            </div>
          </section>
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
              {
                key: "actions",
                header: "Acciones",
                render: (row) => (
                  <RequestItems
                    request={row}
                    canUpload={capabilities.has("portal.documents.upload")}
                  />
                ),
              },
            ]}
          />
          </section>
        </>
      )}
    </div>
  );
}

function RequestItems({
  request,
  canUpload,
}: {
  request: PortalDocumentRequest;
  canUpload: boolean;
}) {
  const pending = request.items.filter((item) => item.status === "PENDING");
  const uploadFor = (item: DocumentRequest["items"][number]) =>
    `/portal/upload?pedido=${encodeURIComponent(request.title)}&item=${encodeURIComponent(item.description)}&itemId=${encodeURIComponent(item.id)}`;

  if (pending.length === 0) {
    return (
      <details>
        <summary>Ver entrega</summary>
        <ul>
          {request.items.map((item) => (
            <li key={item.id}>
              {item.description} · <StatusBadge status={item.status} />
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <details>
      <summary>{pending.length === 1 ? "Resolver ítem" : `Resolver ${pending.length} ítems`}</summary>
      <ul>
        {request.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.description}</strong>
              {item.required ? <span> · Requerido</span> : <span> · Opcional</span>}
              <div>
                <StatusBadge status={item.status} />
              </div>
            </div>
            {item.status === "PENDING" && canUpload ? (
              <Link className="portal-text-link" to={uploadFor(item)}>
                Aportar archivo
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
