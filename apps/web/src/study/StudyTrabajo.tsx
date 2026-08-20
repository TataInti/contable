import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type DocumentRequest, type FiscalYear, type JournalEntry } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import "./study.css";

interface Entry extends JournalEntry {
  rowVersion: number;
  preparedByUserId: string;
}
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
  name: string;
  instances: { id: string; periodLabel: string; dueDate: string; status: string }[];
}
interface EvidencePreview {
  url: string;
  mimeType: string | null;
  originalName: string | null;
}

const DATE = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" });

export function StudyTrabajo() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showRequest, setShowRequest] = useState(false);
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
  const [messageBody, setMessageBody] = useState("");
  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;
  const fiscalYears = useQuery({
    queryKey: ["fiscal-years", firmId, clientId],
    queryFn: () => api.get<FiscalYear[]>(`${base}/fiscal-years`),
    enabled: Boolean(base),
  });
  const [entries, requests, closes, obligations] = useQueries({
    queries: [
      {
        queryKey: ["journal-entries", firmId, clientId],
        queryFn: () => api.get<Entry[]>(`${base}/journal-entries`),
        enabled: Boolean(base),
      },
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
        queryFn: () => api.get<Obligation[]>(`${base}/obligations`),
        enabled: Boolean(base),
      },
    ],
  });
  const invalidateEntries = () =>
    queryClient.invalidateQueries({ queryKey: ["journal-entries", firmId, clientId] });
  const review = useMutation({
    mutationFn: (entryId: string) => api.post(`${base}/journal-entries/${entryId}/review`),
    onSuccess: async () => {
      await invalidateEntries();
      setReceipt("Asiento revisado. Ya puede ser contabilizado por una persona autorizada.");
    },
  });
  const post = useMutation({
    mutationFn: (entry: Entry) =>
      api.postWithHeaders(
        `${base}/journal-entries/${entry.id}/post`,
        { expectedRowVersion: entry.rowVersion },
        { "Idempotency-Key": crypto.randomUUID() },
      ),
    onSuccess: async () => {
      await invalidateEntries();
      setReceipt("Asiento contabilizado. El registro quedó inmutable y disponible en los libros.");
    },
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
  const activeFiscalYear = useMemo(
    () => fiscalYears.data?.find((year) => year.periods.some((period) => period.id === periodId)),
    [fiscalYears.data, periodId],
  );
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

  const pendingEntries = (entries.data ?? []).filter((entry) =>
    ["IN_REVIEW", "REVIEWED"].includes(entry.status),
  );
  const activeRequests = (requests.data ?? []).filter((item) => item.status !== "COMPLETED");
  const obligationRows = (obligations.data ?? []).flatMap((item) =>
    item.instances.map((instance) => ({ ...instance, name: item.name })),
  );
  const openCloses = (closes.data ?? []).filter((item) => item.status !== "FINALIZED");
  const conversationRequest = activeConversation
    ? (requests.data ?? []).find((item) => item.id === activeConversation.requestId)
    : undefined;
  const conversationThread = conversationRequest?.threads?.find(
    (thread) => thread.id === activeConversation?.threadId,
  );
  const hasQueryError =
    entries.isError || requests.isError || closes.isError || obligations.isError;

  return (
    <div className="study-page study-page--wide">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Seguimiento del cliente</p>
          <h1 className="study-page__title">Trabajo</h1>
          <p className="study-page__subtitle">
            Revisiones, pedidos, cierres y vencimientos que requieren una decisión.
          </p>
        </div>
        <div className="study-page__header-actions">
          <Button
            variant="ghost"
            onClick={() => {
              void Promise.all([
                entries.refetch(),
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
              onClick={() => setShowClose((value) => !value)}
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
              onClick={() => setShowRequest((value) => !value)}
              variant={showRequest ? "secondary" : "primary"}
            >
              <Icon name={showRequest ? "close" : "plus"} size={17} />
              {showRequest ? "Cancelar" : "Pedir documentación"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="work-summary" aria-label="Resumen del trabajo">
        <div>
          <span className="work-summary__icon work-summary__icon--info">
            <Icon name="shield" size={18} />
          </span>
          <span>
            <strong>{pendingEntries.length}</strong>
            <small>asientos por resolver</small>
          </span>
        </div>
        <div>
          <span className="work-summary__icon work-summary__icon--warn">
            <Icon name="message" size={18} />
          </span>
          <span>
            <strong>{activeRequests.length}</strong>
            <small>pedidos abiertos</small>
          </span>
        </div>
        <div>
          <span className="work-summary__icon">
            <Icon name="calendar" size={18} />
          </span>
          <span>
            <strong>{obligationRows.length}</strong>
            <small>obligaciones</small>
          </span>
        </div>
        <div>
          <span className="work-summary__icon">
            <Icon name="tasks" size={18} />
          </span>
          <span>
            <strong>{openCloses.length}</strong>
            <small>cierres en curso</small>
          </span>
        </div>
      </div>

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

      {showRequest ? (
        <section className="study-panel study-panel--form" aria-labelledby="new-request-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="new-request-title">Nuevo pedido</h2>
              <p>Describí exactamente qué necesitás y, si corresponde, cuándo.</p>
            </div>
          </div>
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
        </section>
      ) : null}

      {showClose ? (
        <section className="study-panel study-panel--form" aria-labelledby="new-close-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="new-close-title">Iniciar cierre del período</h2>
              <p>
                Definí las verificaciones del ciclo. Cada tarea se completa y queda auditada por
                separado.
              </p>
            </div>
          </div>
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
        </section>
      ) : null}

      {preview ? (
        <section className="study-panel study-panel--form" aria-labelledby="evidence-preview-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="evidence-preview-title">Evidencia</h2>
              <p>{preview.originalName ?? "Documento adjunto"}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setPreview(null)}>
              <Icon name="close" size={15} /> Cerrar
            </Button>
          </div>
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
        </section>
      ) : null}

      {activeConversation ? (
        <section
          className="study-panel study-panel--form"
          aria-labelledby="request-conversation-title"
        >
          <div className="study-panel__heading">
            <div>
              <h2 id="request-conversation-title">Conversación del pedido</h2>
              <p>{activeConversation.title}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setActiveConversation(null)}>
              <Icon name="close" size={15} /> Cerrar
            </Button>
          </div>
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
        </section>
      ) : null}

      <section className="study-panel work-review" aria-labelledby="entries-review-title">
        <div className="study-panel__heading">
          <div>
            <p className="study-page__eyebrow">Maker–checker</p>
            <h2 id="entries-review-title">Asientos por revisar</h2>
            <p>Aprobar y contabilizar son pasos separados para conservar el control.</p>
          </div>
          <span className="section-count">{pendingEntries.length}</span>
        </div>
        {entries.isLoading ? (
          <div className="query-state query-state--compact">
            <span className="loading-copy">Cargando asientos…</span>
          </div>
        ) : pendingEntries.length === 0 ? (
          <EmptyState
            size="compact"
            title="No hay asientos pendientes"
            description="Las nuevas propuestas aparecerán acá cuando sean enviadas a revisión."
            action={
              capabilities.has("entry.create") ? (
                <Button size="sm" variant="secondary" onClick={() => navigate("/contabilidad")}>
                  Crear asiento
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table
            rows={pendingEntries}
            rowKey={(entry) => entry.id}
            columns={[
              {
                key: "date",
                header: "Fecha",
                render: (entry) => DATE.format(new Date(entry.entryDate)),
              },
              {
                key: "description",
                header: "Descripción",
                render: (entry) => (
                  <div className="table-primary">
                    <strong>{entry.description}</strong>
                    <small>
                      {entry.sequenceNumber ? `Asiento #${entry.sequenceNumber}` : "Sin numerar"}
                    </small>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Estado",
                render: (entry) => <StatusBadge status={entry.status} />,
              },
              {
                key: "action",
                header: "Próximo paso",
                align: "right",
                render: (entry) =>
                  entry.status === "IN_REVIEW" && capabilities.has("entry.review") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={review.isPending}
                      onClick={() => review.mutate(entry.id)}
                    >
                      Aprobar revisión
                    </Button>
                  ) : entry.status === "REVIEWED" && capabilities.has("entry.post") ? (
                    <Button
                      size="sm"
                      loading={post.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "¿Contabilizar este asiento? Después no podrá editarse; cualquier corrección requerirá una reversión.",
                          )
                        )
                          post.mutate(entry);
                      }}
                    >
                      Contabilizar
                    </Button>
                  ) : (
                    <span className="muted-copy">Sin acciones</span>
                  ),
              },
            ]}
          />
        )}
        {review.isError || post.isError ? (
          <p className="form-error" role="alert">
            No se pudo completar la acción. Verificá maker-checker, período y versión.
          </p>
        ) : null}
      </section>

      <div className="study-columns work-columns">
        <section className="study-panel">
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
        <section className="study-panel">
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
                            onClick={() => {
                              if (
                                window.confirm(
                                  "¿Finalizar este cierre? El ciclo quedará bloqueado para auditoría.",
                                )
                              ) {
                                finalizeClose.mutate(row.id);
                              }
                            }}
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

      <section className="study-page__section">
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
    </div>
  );
}
