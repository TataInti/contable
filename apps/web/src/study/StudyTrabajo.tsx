import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type DocumentRequest, type FiscalYear } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { ActionDrawer } from "../ui/ActionDrawer";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseAlert,
  DenseHeader,
  DensePage,
  StatStrip,
  useDensity,
} from "../ui/Dense";
import "./study.css";

interface CloseCycle {
  id: string;
  status: string;
  workItems: { id: string; title: string; status: string }[];
}
interface RequestThread {
  id: string;
  visibility: string;
  messages: {
    id: string;
    authorUserId: string;
    body: string;
    visibility: string;
    createdAt: string;
  }[];
}
interface WorkDocumentRequest extends DocumentRequest {
  description?: string | null;
  dueDate?: string | null;
  threads?: RequestThread[];
}
interface Obligation {
  id: string;
  status: string;
  dueDate: string | null;
  regime: {
    name: string;
    taxType: { name: string };
    jurisdiction: { name: string };
  };
  period: { id: string; label: string | null; startDate: string; endDate: string };
}
interface EvidencePreview {
  url: string;
  mimeType: string | null;
  originalName: string | null;
}

const DATE = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" });

export function StudyTrabajo() {
  const [density] = useDensity();
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showRequest, setShowRequest] = useState(false);
  const confirm = useConfirmAction();
  const [showClose, setShowClose] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [request, setRequest] = useState({ title: "", description: "", item: "", dueDate: "" });
  const [closeItems, setCloseItems] = useState(
    "Revisar documentación\nConciliar saldos\nValidar obligaciones\nPreparar cierre",
  );
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [activeConversation, setActiveConversation] = useState<{
    requestId: string;
    threadId: string;
    title: string;
  } | null>(null);
  const [activeReviewRequestId, setActiveReviewRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;
  const fiscalYears = useQuery({
    queryKey: ["fiscal-years", firmId, clientId],
    queryFn: () => api.get<FiscalYear[]>(`${base}/fiscal-years`),
    enabled: Boolean(base),
  });
  const [requests, closes, obligations] = useQueries({
    queries: [
      {
        queryKey: ["document-requests", firmId, clientId],
        queryFn: () => api.get<WorkDocumentRequest[]>(`${base}/document-requests`),
        enabled: Boolean(base),
      },
      {
        queryKey: ["close-cycles", firmId, clientId],
        queryFn: () => api.get<CloseCycle[]>(`${base}/close-cycles`),
        enabled: Boolean(base),
      },
      {
        queryKey: ["obligations", firmId, clientId],
        queryFn: () => api.get<Obligation[]>(`${base}/tax-obligations`),
        enabled: Boolean(base),
      },
    ],
  });
  const createRequest = useMutation({
    mutationFn: () =>
      api.post(`${base}/document-requests`, {
        title: request.title.trim(),
        ...(request.description.trim() ? { description: request.description.trim() } : {}),
        dueDate: request.dueDate || undefined,
        items: [{ description: request.item.trim(), required: true }],
      }),
    onSuccess: () => {
      setShowRequest(false);
      setRequest({ title: "", description: "", item: "", dueDate: "" });
      setReceipt("Pedido creado. Quedó disponible para el seguimiento con el cliente.");
      void queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] });
    },
  });
  const previewEvidence = useMutation({
    mutationFn: (itemId: string) =>
      api.get<EvidencePreview>(`${base}/document-request-items/${itemId}/preview`),
    onSuccess: (data) => setPreview(data),
  });
  const refreshRequests = () => {
    void queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] });
  };
  const sendRequest = useMutation({
    mutationFn: (requestId: string) => api.post(`${base}/document-requests/${requestId}/send`),
    onSuccess: () => {
      setReceipt("Pedido enviado al portal del cliente.");
      refreshRequests();
    },
  });
  const acceptItem = useMutation({
    mutationFn: ({ requestId, itemId }: { requestId: string; itemId: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/accept`),
    onSuccess: () => {
      setReceipt("Ítem aceptado. El estado del pedido se recalculó.");
      refreshRequests();
    },
  });
  const waiveItem = useMutation({
    mutationFn: ({ requestId, itemId }: { requestId: string; itemId: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/waive`),
    onSuccess: () => {
      setReceipt("Ítem eximido. El estado del pedido se recalculó.");
      refreshRequests();
    },
  });
  const rejectItem = useMutation({
    mutationFn: ({ requestId, itemId, reason }: { requestId: string; itemId: string; reason: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/reject`, { reason }),
    onSuccess: () => {
      setRejectReason("");
      setReceipt("Ítem rechazado y devuelto al cliente con el motivo indicado.");
      refreshRequests();
    },
  });
  const activeFiscalYear = useMemo(
    () => fiscalYears.data?.find((year) => year.periods.some((period) => period.id === periodId)),
    [fiscalYears.data, periodId],
  );
  const selectedAccountingPeriod = activeFiscalYear?.periods.find((period) => period.id === periodId);
  const createClose = useMutation({
    mutationFn: () => {
      if (!base || !periodId || !activeFiscalYear) {
        throw new Error("Elegí un período contable abierto para iniciar el cierre.");
      }
      const items = closeItems
        .split("\n")
        .map((title) => title.trim())
        .filter(Boolean)
        .map((title, index) => ({
          code: `CIERRE_${index + 1}_${
            title
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^A-Za-z0-9]+/g, "_")
              .replace(/^_|_$/g, "")
              .slice(0, 45) || "TAREA"
          }`,
          title,
        }));
      if (items.length === 0) throw new Error("Ingresá al menos una tarea de cierre.");
      return api.post(`${base}/close-cycles`, {
        fiscalYearId: activeFiscalYear.id,
        periodId,
        items,
      });
    },
    onSuccess: () => {
      setShowClose(false);
      setReceipt("Cierre iniciado. Las tareas quedan disponibles para control y finalización.");
      void queryClient.invalidateQueries({ queryKey: ["close-cycles", firmId, clientId] });
    },
  });
  const completeCloseItem = useMutation({
    mutationFn: ({ cycleId, workItemId }: { cycleId: string; workItemId: string }) =>
      api.post(`${base}/close-cycles/${cycleId}/work-items/${workItemId}/complete`),
    onSuccess: () => {
      setReceipt("Tarea de cierre completada.");
      void queryClient.invalidateQueries({ queryKey: ["close-cycles", firmId, clientId] });
    },
  });
  const finalizeClose = useMutation({
    mutationFn: (cycleId: string) => api.post(`${base}/close-cycles/${cycleId}/finalize`),
    onSuccess: () => {
      setReceipt("Cierre finalizado. El ciclo quedó registrado para auditoría.");
      void queryClient.invalidateQueries({ queryKey: ["close-cycles", firmId, clientId] });
    },
  });
  const openConversation = useMutation({
    mutationFn: async (row: WorkDocumentRequest) => {
      const current = row.threads?.find((thread) => thread.visibility === "SHARED");
      if (current) return { requestId: row.id, title: row.title, threadId: current.id };
      const created = await api.post<RequestThread>(`${base}/document-requests/${row.id}/threads`, {
        visibility: "SHARED",
      });
      return { requestId: row.id, title: row.title, threadId: created.id };
    },
    onSuccess: (conversation) => {
      setActiveConversation(conversation);
      void queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] });
    },
  });
  const sendMessage = useMutation({
    mutationFn: () => {
      if (!activeConversation || !messageBody.trim()) throw new Error("Escribí un mensaje.");
      return api.post(`${base}/threads/${activeConversation.threadId}/messages`, {
        body: messageBody.trim(),
        visibility: "SHARED",
      });
    },
    onSuccess: () => {
      setMessageBody("");
      setReceipt("Mensaje enviado al pedido documental.");
      void queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] });
    },
  });

  if (!base)
    return (
      <div className="study-page">
        <EmptyState
          title="Seleccioná un cliente"
          description="El trabajo se organiza dentro de un cliente y período concretos."
        />
      </div>
    );

  const activeRequests = (requests.data ?? []).filter((item) => item.status !== "COMPLETED");
  const obligationRows = (obligations.data ?? [])
    .filter((item) => {
      if (!selectedAccountingPeriod) return true;
      return (
        item.period.startDate.slice(0, 10) === selectedAccountingPeriod.startDate.slice(0, 10) &&
        item.period.endDate.slice(0, 10) === selectedAccountingPeriod.endDate.slice(0, 10)
      );
    })
    .map((item) => ({
    id: item.id,
    name: `${item.regime.taxType.name} · ${item.regime.jurisdiction.name}`,
    periodLabel:
      item.period.label ??
      `${DATE.format(new Date(item.period.startDate))} → ${DATE.format(new Date(item.period.endDate))}`,
    dueDate: item.dueDate ?? item.period.endDate,
    status: item.status,
    }));
  const openCloses = (closes.data ?? []).filter((item) => item.status !== "FINALIZED");
  const conversationRequest = activeConversation
    ? (requests.data ?? []).find((item) => item.id === activeConversation.requestId)
    : undefined;
  const conversationThread = conversationRequest?.threads?.find(
    (thread) => thread.id === activeConversation?.threadId,
  );
  const reviewRequest = activeReviewRequestId
    ? (requests.data ?? []).find((item) => item.id === activeReviewRequestId)
    : undefined;
  const hasQueryError =
    requests.isError || closes.isError || obligations.isError;

  return (
    <DensePage density={density} flow>
      <DenseHeader
        eyebrow="Seguimiento del cliente"
        title="Trabajo"
        description="Revisiones, pedidos, cierres y vencimientos que requieren una decisión."
        actions={
          <>
          <Button
            variant="ghost"
            onClick={() => {
              void Promise.all([
                requests.refetch(),
                closes.refetch(),
                obligations.refetch(),
              ]);
            }}
          >
            Actualizar
          </Button>
          {capabilities.has("period.soft_close") ? (
            <Button
              onClick={() => {
                setShowRequest(false);
                setShowClose((value) => !value);
              }}
              variant={showClose ? "secondary" : "ghost"}
              disabled={!periodId || !activeFiscalYear}
              title={
                !activeFiscalYear
                  ? "Seleccioná un período contable para abrir el cierre"
                  : undefined
              }
            >
              <Icon name={showClose ? "close" : "tasks"} size={17} />
              {showClose ? "Cancelar cierre" : "Iniciar cierre"}
            </Button>
          ) : null}
          {capabilities.has("request.manage") ? (
            <Button
              onClick={() => {
                setShowClose(false);
                setShowRequest((value) => !value);
              }}
              variant={showRequest ? "secondary" : "primary"}
            >
              <Icon name={showRequest ? "close" : "plus"} size={17} />
              {showRequest ? "Cancelar" : "Pedir documentación"}
            </Button>
          ) : null}
        
          </>
        }
      />

      <StatStrip
        label="Resumen del trabajo"
        items={[
          { key: "requests", label: "Pedidos abiertos", value: activeRequests.length, tone: activeRequests.length > 0 ? "warn" : undefined },
          { key: "closes", label: "Cierres en curso", value: openCloses.length },
          { key: "obligations", label: "Obligaciones", value: obligationRows.length },
        ]}
      />
      <DenseAlert
        tone="ok"
        action={
          activeRequests.length && capabilities.has("request.manage") ? (
            <Button size="sm" onClick={() => setShowRequest(true)}>Verificar pedidos</Button>
          ) : !openCloses.length && capabilities.has("request.manage") ? (
            <Button size="sm" onClick={() => setShowRequest(true)}>Pedir documentación</Button>
          ) : capabilities.has("period.soft_close") ? (
            <Button size="sm" onClick={() => setShowClose(true)} disabled={!periodId || !activeFiscalYear}>Iniciar cierre</Button>
          ) : undefined
        }
      >
        <strong>Próximo paso:</strong>{" "}
        {activeRequests.length
          ? "Revisá los pedidos abiertos y pedí la evidencia que todavía falta."
          : openCloses.length
            ? "Continuá el cierre que está en curso para este período."
            : "Iniciá un pedido documental para reunir la evidencia del período."}
      </DenseAlert>




      {receipt ? (
        <div className="action-receipt action-receipt--page" role="status">
          <Icon name="check" size={19} />
          <span>
            <strong>Acción completada</strong>
            <small>{receipt}</small>
          </span>
          <button type="button" aria-label="Cerrar confirmación" onClick={() => setReceipt(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      {hasQueryError ? (
        <div className="query-warning" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <strong>Parte de la información no pudo cargarse.</strong> Podés seguir trabajando con
            los datos disponibles.
          </span>
        </div>
      ) : null}

      <ActionDrawer
        isOpen={showRequest}
        onClose={() => setShowRequest(false)}
        eyebrow="Cliente"
        title="Nuevo pedido"
        description="Describí exactamente qué necesitás y, si corresponde, cuándo debe entregarse."
      >
        <form
          className="study-inline-form study-inline-form--request"
          onSubmit={(event) => {
            event.preventDefault();
            createRequest.mutate();
          }}
        >
          <Field
            id="request-title"
            label="Asunto"
            value={request.title}
            onChange={(event) => setRequest({ ...request, title: event.target.value })}
            maxLength={200}
            required
          />
          <Field
            id="request-item"
            label="Documento solicitado"
            value={request.item}
            onChange={(event) => setRequest({ ...request, item: event.target.value })}
            maxLength={500}
            required
          />
          <label className="ds-field" htmlFor="request-description">
            <span className="ds-field__label">Instrucciones para el cliente</span>
            <textarea
              id="request-description"
              className="study-textarea"
              rows={2}
              value={request.description}
              onChange={(event) => setRequest({ ...request, description: event.target.value })}
              maxLength={4000}
              placeholder="Indicá el período, formato o detalle que necesitás."
            />
          </label>
          <Field
            id="request-due"
            label="Fecha límite"
            type="date"
            value={request.dueDate}
            onChange={(event) => setRequest({ ...request, dueDate: event.target.value })}
          />
          {createRequest.isError ? (
            <p className="form-error study-inline-form__feedback" role="alert">
              No se pudo crear el pedido. Revisá los datos e intentá nuevamente.
            </p>
          ) : null}
          <div className="study-inline-form__actions">
            <Button
              type="submit"
              loading={createRequest.isPending}
              disabled={!request.title.trim() || !request.item.trim()}
            >
              Crear pedido
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={showClose}
        onClose={() => setShowClose(false)}
        eyebrow="Control"
        title="Iniciar cierre del período"
        description="Definí las verificaciones del ciclo. Cada tarea se completa y queda auditada por separado."
      >
        <form
          className="study-page__form"
          onSubmit={(event) => {
            event.preventDefault();
            createClose.mutate();
          }}
        >
          <label className="ds-field" htmlFor="close-items">
            <span className="ds-field__label">Tareas de cierre</span>
            <textarea
              id="close-items"
              className="study-textarea"
              rows={5}
              value={closeItems}
              onChange={(event) => setCloseItems(event.target.value)}
              placeholder="Una tarea por línea"
              required
            />
            <small className="study-page__hint">
              Se crearán {closeItems.split("\n").filter((item) => item.trim()).length} tareas.
            </small>
          </label>
          {!activeFiscalYear ? (
            <p className="form-error" role="alert">
              Seleccioná un período contable abierto antes de iniciar el cierre.
            </p>
          ) : null}
          {createClose.isError ? (
            <p className="form-error" role="alert">
              {createClose.error.message}
            </p>
          ) : null}
          <div className="study-inline-form__actions">
            <Button
              type="submit"
              loading={createClose.isPending}
              disabled={!activeFiscalYear || !periodId}
            >
              Crear ciclo de cierre
            </Button>
          </div>
        </form>
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(reviewRequest)}
        onClose={() => {
          setActiveReviewRequestId(null);
          setRejectReason("");
        }}
        eyebrow="Pedido documental"
        title="Revisión de ítems"
        description={reviewRequest?.title}
      >
        {reviewRequest ? (
          <div className="study-page__form">
            <p className="study-page__hint">
              Estado del pedido: <strong>{reviewRequest.status}</strong>. La completitud se deriva
              de los ítems aceptados o eximidos.
            </p>
            <div className="request-review-list">
              {reviewRequest.items.map((item) => {
                const canResolve = item.status === "ATTACHED";
                return (
                  <div key={item.id} className="request-review-list__item">
                    <div>
                      <strong>{item.description}</strong>
                      <small>
                        {item.required ? "Requerido" : "Opcional"} · {item.status}
                      </small>
                    </div>
                    {canResolve && capabilities.has("request.manage") ? (
                      <div className="table-actions">
                        <Button
                          size="sm"
                          loading={acceptItem.isPending}
                          onClick={() => acceptItem.mutate({ requestId: reviewRequest.id, itemId: item.id })}
                        >
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={waiveItem.isPending}
                          onClick={() => waiveItem.mutate({ requestId: reviewRequest.id, itemId: item.id })}
                        >
                          Eximir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={rejectItem.isPending}
                          disabled={!rejectReason.trim()}
                          onClick={() =>
                            rejectItem.mutate({
                              requestId: reviewRequest.id,
                              itemId: item.id,
                              reason: rejectReason.trim(),
                            })
                          }
                        >
                          Rechazar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {reviewRequest.items.some((item) => item.status === "ATTACHED") &&
            capabilities.has("request.manage") ? (
              <>
                <label className="ds-field" htmlFor="request-reject-reason">
                  <span className="ds-field__label">Motivo de rechazo</span>
                  <textarea
                    id="request-reject-reason"
                    className="study-textarea"
                    rows={2}
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="Indicá qué debe corregir el cliente."
                  />
                </label>
                <p className="study-page__hint">
                  Para rechazar un ítem, elegí el motivo y usá la acción correspondiente en la
                  fila.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        eyebrow="Evidencia"
        title="Documento adjunto"
        description={preview?.originalName ?? "Vista previa de la evidencia asociada al pedido."}
        size="wide"
      >
        {preview ? (
          <div className="evidence-preview">
            {preview.mimeType === "application/pdf" ? (
              <iframe
                src={preview.url}
                title="Vista previa del documento"
                className="evidence-preview__frame"
              />
            ) : (
              <img
                src={preview.url}
                alt="Vista previa del documento"
                className="evidence-preview__image"
              />
            )}
            <a
              className="evidence-preview__link"
              href={preview.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir en pestaña nueva
            </a>
          </div>
        ) : null}
      </ActionDrawer>

      <ActionDrawer
        isOpen={Boolean(activeConversation)}
        onClose={() => setActiveConversation(null)}
        eyebrow="Pedido documental"
        title="Conversación"
        description={activeConversation?.title}
      >
        {activeConversation ? (
          <>
            {conversationThread?.messages.length ? (
              <div className="request-message-list" aria-live="polite">
                {conversationThread.messages.map((message) => (
                  <div key={message.id} className="request-message-list__item">
                    <strong>{message.visibility === "SHARED" ? "Compartido" : "Interno"}</strong>
                    <p>{message.body}</p>
                    <small>{DATE.format(new Date(message.createdAt))}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-copy">
                Todavía no hay mensajes. Dejá una instrucción o consulta para el cliente.
              </p>
            )}
            {capabilities.has("message.shared") ? (
              <form
                className="study-page__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMessage.mutate();
                }}
              >
                <label className="ds-field" htmlFor="request-message">
                  <span className="ds-field__label">Mensaje compartido</span>
                  <textarea
                    id="request-message"
                    className="study-textarea"
                    rows={3}
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    maxLength={5000}
                    placeholder="Escribí una instrucción clara para el cliente."
                  />
                </label>
                {sendMessage.isError ? (
                  <p className="form-error">{sendMessage.error.message}</p>
                ) : null}
                <div className="study-inline-form__actions">
                  <Button
                    type="submit"
                    loading={sendMessage.isPending}
                    disabled={!messageBody.trim()}
                  >
                    Enviar mensaje
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </ActionDrawer>

      <div className="study-columns work-columns">
        <section className="study-panel" id="work-requests-section">
          <div className="study-panel__heading">
            <div>
              <p className="study-page__eyebrow">Cliente</p>
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
                      <strong>{row.title}</strong>
                      <small>
                        {
                          row.items.filter(
                            (item) => item.status !== "ACCEPTED" && item.status !== "WAIVED",
                          ).length
                        }{" "}
                        ítems pendientes
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
            <EmptyState
              size="compact"
              title="Sin pedidos abiertos"
              description="El cliente no tiene documentación pendiente."
              action={
                capabilities.has("request.manage") ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowRequest(true)}>
                    Crear pedido
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>
        <section className="study-panel" id="work-closes-section">
          <div className="study-panel__heading">
            <div>
              <p className="study-page__eyebrow">Control</p>
              <h2>Cierres</h2>
            </div>
            <span className="section-count">{openCloses.length}</span>
          </div>
          {closes.isLoading ? (
            <div className="query-state query-state--compact">
              <span className="loading-copy">Cargando cierres…</span>
            </div>
          ) : openCloses.length ? (
            <Table
              rows={openCloses}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "status",
                  header: "Estado",
                  render: (row) => <StatusBadge status={row.status} />,
                },
                {
                  key: "progress",
                  header: "Avance",
                  render: (row) => {
                    const done = row.workItems.filter((item) => item.status === "DONE").length;
                    return (
                      <div className="progress-cell">
                        <progress
                          value={done}
                          max={Math.max(row.workItems.length, 1)}
                          aria-label={`${done} de ${row.workItems.length} tareas completas`}
                        />
                        <small>
                          {done} de {row.workItems.length}
                        </small>
                      </div>
                    );
                  },
                },
                {
                  key: "actions",
                  header: "Acciones",
                  align: "right",
                  render: (row) => {
                    const next = row.workItems.find((item) => item.status !== "DONE");
                    const ready = row.workItems.length > 0 && !next;
                    if (!capabilities.has("period.soft_close"))
                      return <span className="muted-copy">—</span>;
                    return (
                      <div className="table-actions">
                        {next ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={completeCloseItem.isPending}
                            onClick={() =>
                              completeCloseItem.mutate({ cycleId: row.id, workItemId: next.id })
                            }
                          >
                            Completar: {next.title}
                          </Button>
                        ) : ready ? (
                          <Button
                            size="sm"
                            loading={finalizeClose.isPending}
                            onClick={() =>
                              confirm.ask({
                                title: "¿Finalizar este cierre?",
                                description:
                                  "El ciclo quedará bloqueado para auditoría y no podrá volver a un estado anterior.",
                                confirmLabel: "Finalizar cierre",
                                onConfirm: () => finalizeClose.mutate(row.id),
                              })
                            }
                          >
                            Finalizar cierre
                          </Button>
                        ) : null}
                      </div>
                    );
                  },
                },
              ]}
            />
          ) : (
            <EmptyState
              size="compact"
              title="Sin ciclos de cierre"
              description="Cuando se abra un cierre vas a ver su avance acá."
              action={
                capabilities.has("period.soft_close") && activeFiscalYear ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowClose(true)}>
                    Iniciar cierre
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>
      </div>

      <section className="study-page__section" id="work-obligations-section">
        <div className="section-heading">
          <div>
            <p className="study-page__eyebrow">Agenda fiscal</p>
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
              { key: "due", header: "Vence", render: (row) => DATE.format(new Date(row.dueDate)) },
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
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
