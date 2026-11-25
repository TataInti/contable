import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Notice, useNotify } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { api, type FiscalYear } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { DenseHeader, DensePage, useDensity } from "../ui/Dense";
import "./study.css";
import type { CloseCycle, EvidencePreview, Obligation, RequestThread, WorkDocumentRequest } from "./trabajo/tipos";
import { filasDeObligaciones } from "./trabajo/obligaciones";
import { CajonNuevoPedido } from "./trabajo/CajonNuevoPedido";
import { CajonIniciarCierre } from "./trabajo/CajonIniciarCierre";
import { CajonRevision } from "./trabajo/CajonRevision";
import { CajonEvidencia } from "./trabajo/CajonEvidencia";
import { CajonConversacion } from "./trabajo/CajonConversacion";
import { SeccionPedidos } from "./trabajo/SeccionPedidos";
import { SeccionCierres } from "./trabajo/SeccionCierres";
import { abrirLegajoDeObligacion } from "./panel/abrirCliente";
import { SeccionObligaciones } from "./trabajo/SeccionObligaciones";
import { CargarDocumento } from "./bandeja/CargarDocumento";

export function StudyTrabajo() {
  const [density] = useDensity();
  const { firmId, clientId, periodId, capabilities, setClientId } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showRequest, setShowRequest] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // La clave cambia en cada apertura: la carga arranca limpia y preselecciona el pedido de la fila.
  const [uploadKey, setUploadKey] = useState(0);
  const [uploadRequestId, setUploadRequestId] = useState<string | null>(null);
  // Precarga la Bandeja al abrir Trabajo: su «Subir documento» tiene el mismo nombre que el de
  // este encabezado, y así el cambio de página se ve enseguida en vez de esperar la carga del módulo.
  useEffect(() => {
    void import("./StudyBandeja");
  }, []);
  const confirm = useConfirmAction();
  const [showClose, setShowClose] = useState(false);
  const notify = useNotify();
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
      notify.success("Pedido creado. Quedó disponible para el seguimiento con el cliente.");
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
      notify.success("Pedido enviado al portal del cliente.");
      refreshRequests();
    },
  });
  const acceptItem = useMutation({
    mutationFn: ({ requestId, itemId }: { requestId: string; itemId: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/accept`),
    onSuccess: () => {
      notify.success("Ítem aceptado. El estado del pedido se recalculó.");
      refreshRequests();
    },
  });
  const waiveItem = useMutation({
    mutationFn: ({ requestId, itemId }: { requestId: string; itemId: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/waive`),
    onSuccess: () => {
      notify.success("Ítem eximido. El estado del pedido se recalculó.");
      refreshRequests();
    },
  });
  const rejectItem = useMutation({
    mutationFn: ({ requestId, itemId, reason }: { requestId: string; itemId: string; reason: string }) =>
      api.post(`${base}/document-requests/${requestId}/items/${itemId}/reject`, { reason }),
    onSuccess: () => {
      setRejectReason("");
      notify.success("Ítem rechazado y devuelto al cliente con el motivo indicado.");
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
      notify.success("Cierre iniciado. Las tareas quedan disponibles para control y finalización.");
      void queryClient.invalidateQueries({ queryKey: ["close-cycles", firmId, clientId] });
    },
  });
  const completeCloseItem = useMutation({
    mutationFn: ({ cycleId, workItemId }: { cycleId: string; workItemId: string }) =>
      api.post(`${base}/close-cycles/${cycleId}/work-items/${workItemId}/complete`),
    onSuccess: () => {
      notify.success("Tarea de cierre completada.");
      void queryClient.invalidateQueries({ queryKey: ["close-cycles", firmId, clientId] });
    },
  });
  const finalizeClose = useMutation({
    mutationFn: (cycleId: string) => api.post(`${base}/close-cycles/${cycleId}/finalize`),
    onSuccess: () => {
      notify.success("Cierre finalizado. El ciclo quedó registrado para auditoría.");
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
      notify.success("Mensaje enviado al pedido documental.");
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
  const pendingRequestItems = (requests.data ?? []).flatMap((request) =>
    request.items
      .filter((item) => item.status === "PENDING")
      .map((item) => ({ ...item, requestTitle: request.title })),
  );
  // Preselección: el pedido de la fila; si no hay fila, el único ítem pendiente del cliente.
  const pedidoDeLaFila = uploadRequestId
    ? (requests.data ?? []).find((request) => request.id === uploadRequestId)
    : undefined;
  const itemInicial = pedidoDeLaFila
    ? pedidoDeLaFila.items.find((item) => item.status === "PENDING")?.id
    : pendingRequestItems.length === 1
      ? pendingRequestItems[0]?.id
      : undefined;
  const openUpload = (requestId: string | null = null) => {
    setShowRequest(false);
    setShowClose(false);
    setUploadRequestId(requestId);
    setUploadKey((value) => value + 1);
    setUploadOpen(true);
  };
  const obligationRows = filasDeObligaciones(obligations.data, selectedAccountingPeriod);
  const pendingObligationRows = obligationRows.filter((row) => row.status !== "PAID");
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
    <DensePage density={density} flow className="study-trabajo">
      <DenseHeader
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
          {capabilities.has("document.upload") ? (
            <Button variant="secondary" onClick={() => openUpload()}>
              Subir documento
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

      {hasQueryError ? (
        <Notice tone="warning">
          <strong>Parte de la información no pudo cargarse.</strong> Podés seguir trabajando con
          los datos disponibles.
        </Notice>
      ) : null}

      <CajonNuevoPedido
        showRequest={showRequest}
        setShowRequest={setShowRequest}
        request={request}
        setRequest={setRequest}
        createRequest={createRequest}
      />

      <CajonIniciarCierre
        showClose={showClose}
        setShowClose={setShowClose}
        closeItems={closeItems}
        setCloseItems={setCloseItems}
        activeFiscalYear={activeFiscalYear}
        periodId={periodId}
        createClose={createClose}
      />

      <CargarDocumento
        key={uploadKey}
        isOpen={uploadOpen}
        base={base}
        capabilities={capabilities}
        pendingRequestItems={pendingRequestItems}
        requestsLoading={requests.isLoading}
        requestsError={requests.isError}
        onRetryRequests={() => void requests.refetch()}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => undefined}
        itemInicial={itemInicial}
        onCrearPedido={() => {
          setUploadOpen(false);
          setShowRequest(true);
        }}
        onVerEnBandeja={() => navigate("/bandeja")}
      />

      <CajonRevision
        reviewRequest={reviewRequest}
        setActiveReviewRequestId={setActiveReviewRequestId}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        capabilities={capabilities}
        acceptItem={acceptItem}
        waiveItem={waiveItem}
        rejectItem={rejectItem}
      />

      <CajonEvidencia preview={preview} setPreview={setPreview} />

      <CajonConversacion
        activeConversation={activeConversation}
        setActiveConversation={setActiveConversation}
        conversationThread={conversationThread}
        capabilities={capabilities}
        messageBody={messageBody}
        setMessageBody={setMessageBody}
        sendMessage={sendMessage}
      />

      <div className="study-columns work-columns">
        <SeccionPedidos
          requests={requests}
          activeRequests={activeRequests}
          capabilities={capabilities}
          previewEvidence={previewEvidence}
          openConversation={openConversation}
          sendRequest={sendRequest}
          setActiveReviewRequestId={setActiveReviewRequestId}
          setShowRequest={setShowRequest}
          onSubir={(requestId) => openUpload(requestId)}
        />
        <SeccionCierres
          closes={closes}
          openCloses={openCloses}
          capabilities={capabilities}
          completeCloseItem={completeCloseItem}
          finalizeClose={finalizeClose}
          confirm={confirm}
          activeFiscalYear={activeFiscalYear}
          periodId={periodId}
          setShowClose={(abrir) => {
            setShowRequest(false);
            setShowClose(abrir);
          }}
        />
        <SeccionObligaciones
          obligations={obligations}
          obligationRows={pendingObligationRows}
          allPaid={obligationRows.length > 0 && pendingObligationRows.length === 0}
          capabilities={capabilities}
          navigate={navigate}
          abrirLegajo={(taxPeriodId) => {
            if (firmId && clientId) {
              abrirLegajoDeObligacion({ firmId, clientId, taxPeriodId, setClientId, navigate });
            }
          }}
        />
      </div>

      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
