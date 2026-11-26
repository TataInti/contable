import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button, Table } from "@contable/design-system";
import { Icon } from "../../ui/Icon";
import { StatusBadge } from "../../ui/StatusBadge";
import type { ClientContextValue } from "../../context/ClientContext";
import type { ConversacionActiva } from "./CajonConversacion";
import type { EvidencePreview, WorkDocumentRequest } from "./tipos";

interface SeccionPedidosProps {
  requests: UseQueryResult<WorkDocumentRequest[], Error>;
  activeRequests: WorkDocumentRequest[];
  capabilities: ClientContextValue["capabilities"];
  previewEvidence: UseMutationResult<EvidencePreview, Error, string>;
  openConversation: UseMutationResult<ConversacionActiva, Error, WorkDocumentRequest>;
  sendRequest: UseMutationResult<unknown, Error, string>;
  setActiveReviewRequestId: (id: string | null) => void;
  /** Abre la carga de documentos apuntada al pedido de la fila. */
  onSubir: (requestId: string) => void;
}

export function SeccionPedidos({
  requests,
  activeRequests,
  capabilities,
  previewEvidence,
  openConversation,
  sendRequest,
  setActiveReviewRequestId,
  onSubir,
}: SeccionPedidosProps) {
  return (
    <>
      <>
        <section className="study-panel" id="work-requests-section">
          <div className="study-panel__heading">
            <div>
              <h2>Pedidos documentales</h2>
            </div>
            <span className="section-count">{activeRequests.length}</span>
          </div>
          {requests.isLoading ? (
            <div className="query-state query-state--compact">
              <span className="loading-copy">Cargando pedidos…</span>
            </div>
          ) : activeRequests.length ? (
            <Table
              rows={activeRequests}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "title",
                  header: "Pedido",
                  render: (row) => (
                    <div className="table-primary">
                      <strong title={row.title}>{row.title}</strong>
                      <small>
                        {(() => {
                          const pendientes = row.items.filter(
                            (item) => item.status !== "ACCEPTED" && item.status !== "WAIVED",
                          ).length;
                          return `${pendientes} ${pendientes === 1 ? "ítem pendiente" : "ítems pendientes"}`;
                        })()}
                      </small>
                    </div>
                  ),
                },
                {
                  key: "status",
                  header: "Estado",
                  render: (row) => <StatusBadge status={row.status} />,
                },
                {
                  key: "evidence",
                  header: "Evidencia",
                  align: "right",
                  render: (row) => {
                    const attached = row.items.find((item) => item.status === "ATTACHED");
                    return attached ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={previewEvidence.isPending}
                        onClick={() => previewEvidence.mutate(attached.id)}
                      >
                        <Icon name="file" size={15} /> Ver
                      </Button>
                    ) : (
                      <span className="muted-copy">—</span>
                    );
                  },
                },
                {
                  key: "conversation",
                  header: "Conversación",
                  align: "right",
                  render: (row) =>
                    capabilities.has("message.shared") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={openConversation.isPending}
                        onClick={() => openConversation.mutate(row)}
                      >
                        <Icon name="message" size={15} /> Mensaje
                      </Button>
                    ) : (
                      <span className="muted-copy">—</span>
                    ),
                },
                {
                  key: "actions",
                  header: "Acciones",
                  align: "right",
                  render: (row) => (
                    <div className="table-actions">
                      {row.status === "DRAFT" && capabilities.has("request.manage") ? (
                        <Button
                          size="sm"
                          loading={sendRequest.isPending}
                          onClick={() => sendRequest.mutate(row.id)}
                        >
                          Enviar pedido
                        </Button>
                      ) : null}
                      {capabilities.has("document.upload") &&
                      row.items.some((item) => item.status === "PENDING") ? (
                        <Button size="sm" variant="ghost" onClick={() => onSubir(row.id)}>
                          Subir
                        </Button>
                      ) : null}
                      {capabilities.has("request.manage") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setActiveReviewRequestId(row.id)}
                        >
                          Revisar
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <p className="empty-line">
              <span>Sin pedidos abiertos</span>
            </p>

          )}
        </section>
      </>
    </>
  );
}
