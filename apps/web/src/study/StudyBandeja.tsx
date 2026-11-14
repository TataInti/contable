import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { isManualExtractionFieldKey } from "@contable/contracts";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  api,
  uploadToSignedUrl,
  type Document,
  type DocumentExtraction,
  type ExtractedField,
  type DocumentRequest,
} from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { belongsToDocumentQueue, type DocumentQueueFilter } from "./documentQueue";
import { ExtractionFiscalTable } from "./ExtractionFiscalTable";
import {
  hasEffectiveFiscalData,
  isAutomatedReadingUnavailableReason,
} from "./extractionReadiness";
import { ManualExtractionFieldsDialog, type ManualExtractionFieldValue } from "./ManualExtractionFieldsDialog";
import { ManualExtractionValueControl, normalizeManualExtractionInput } from "./ManualExtractionValueControl";
import { EXTRACTION_SCALAR_FIELDS, fiscalScalarHasValue } from "./extractionScalarFields";
import { ActionDrawer } from "../ui/ActionDrawer";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import {
  DenseHeader,
  DensePage,
  DenseSearch,
  DenseToolbar,
  StatStrip,
  useDensity,
} from "../ui/Dense";
import "./study.css";

interface UploadSession {
  sessionId: string;
  presignedUrl: string;
  objectKey: string;
}
interface UploadComplete {
  documentId: string;
  status: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const FIELD_LABELS: Record<string, string> = {
  voucherType: "Tipo de documento",
  letter: "Letra",
  pointOfSale: "Punto de venta",
  voucherNumber: "Número",
  issueDate: "Fecha",
  issuerTaxId: "CUIT emisor",
  receiverTaxId: "CUIT receptor",
  issuerName: "Razón social emisor",
  receiverName: "Razón social receptor",
  vatCondition: "Condición frente al IVA",
  netAmount: "Neto gravado",
  vatRate: "Alícuota de IVA",
  vatAmount: "Importe de IVA",
  nonTaxableAmount: "No gravado",
  exemptAmount: "Exento",
  perceptionType: "Tipo de percepción",
  perceptionAmount: "Importe de percepción",
  totalAmount: "Total",
  currency: "Moneda",
  cae: "CAE",
  caeExpiration: "Vencimiento del CAE",
};

const REJECTION_REASONS = [
  { value: "ILLEGIBLE", label: "Ilegible" },
  { value: "DUPLICATE", label: "Duplicado" },
  { value: "NOT_A_VOUCHER", label: "No es un comprobante" },
  { value: "OTHER_CLIENT", label: "Datos de otro cliente" },
  { value: "OTHER", label: "Otro" },
] as const;

function validateFile(selected: File | null) {
  if (!selected) return "Elegí un archivo para continuar.";
  if (!ALLOWED_TYPES.has(selected.type) || selected.size > MAX_FILE_SIZE)
    return "Elegí un PDF, JPG, PNG o WebP de hasta 25 MB.";
  return null;
}

function fileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(size / 1024)} KB`;
}

function documentFileName(document: Document) {
  return document.fileVersions?.[0]?.originalName ?? document.id.slice(0, 8);
}

function documentTypeLabel(document: Document) {
  const mimeType = document.fileVersions?.[0]?.mimeType ?? "";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("webp")) return "WEBP";
  return "IMAGEN";
}

function normalizeDocumentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR");
}

export function StudyBandeja() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reprocessJobId, setReprocessJobId] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [showManualFieldsDialog, setShowManualFieldsDialog] = useState(false);
  const [manualFieldsError, setManualFieldsError] = useState<string | null>(null);
  const [manualFieldsSavedCount, setManualFieldsSavedCount] = useState<number | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReasonCode, setRejectionReasonCode] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [rejectionReceipts, setRejectionReceipts] = useState<Record<string, string>>({});
  const [showUpload, setShowUpload] = useState(false);
  const [uploadRequestItemId, setUploadRequestItemId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState<DocumentQueueFilter>("ALL");
  const base = firmId && clientId ? `/firms/${firmId}/clients/${clientId}` : null;
  const documents = useQuery({
    queryKey: ["documents", firmId, clientId],
    queryFn: () => api.get<Document[]>(`${base}/documents`),
    enabled: Boolean(base),
    refetchInterval: (query) =>
      (query.state.data as Document[] | undefined)?.some((doc) =>
        ["UPLOADED", "VALIDATING"].includes(doc.status),
      )
        ? 3_000
        : false,
  });
  const requests = useQuery({
    queryKey: ["document-requests", firmId, clientId],
    queryFn: () => api.get<DocumentRequest[]>(`${base}/document-requests`),
    enabled: Boolean(base && showUpload),
  });
  const detail = useQuery({
    queryKey: ["document", firmId, clientId, selectedId],
    queryFn: () => api.get<Document>(`${base}/documents/${selectedId}`),
    enabled: Boolean(base && selectedId),
    refetchInterval: 3_000,
  });
  const extraction = useQuery({
    queryKey: ["extraction", firmId, clientId, selectedId],
    queryFn: () => api.get<DocumentExtraction>(`${base}/documents/${selectedId}/extraction`),
    enabled: Boolean(
      base && selectedId && (detail.data?.status === "EXTRACTED" || detail.data?.status === "REVIEWED"),
    ),
    retry: false,
  });
  const correctableExtractionFields = (extraction.data?.fields ?? []).filter(
    (field) => FIELD_LABELS[field.key],
  );
  // Sin datos leídos ni correcciones vigentes no hay nada que aprobar.
  const canApproveExtraction = hasEffectiveFiscalData(
    extraction.data?.voucherData ?? null,
    correctableExtractionFields,
    corrections,
  );
  const canLoadManualFields =
    capabilities.has("document.review") &&
    (extraction.data?.status === "GENERATED" || extraction.data?.status === "NEEDS_REVIEW");
  const hasEmptyScalarFields = Boolean(
    extraction.data &&
      EXTRACTION_SCALAR_FIELDS.some(
        (field) => !fiscalScalarHasValue(extraction.data!.voucherData, extraction.data!.fields, field),
      ),
  );
  const canReprocessExtraction = Boolean(
    capabilities.has("document.review") &&
      detail.data?.status === "EXTRACTED" &&
      extraction.data &&
      ["GENERATED", "NEEDS_REVIEW"].includes(extraction.data.status),
  );
  const manualFieldCount = (extraction.data?.fields ?? []).filter(
    (field) => field.method?.toUpperCase() === "HUMAN" || Boolean(field.correction?.trim()),
  ).length;
  const reprocessShouldBeHighlighted = Boolean(
    extraction.data &&
      (extraction.data.promptVersion === "voucher-ar-v1" ||
        extraction.data.ocrEngine === "tesseract-ocr" ||
        !hasEffectiveFiscalData(
          extraction.data.voucherData,
          correctableExtractionFields,
          corrections,
        ) ||
        isAutomatedReadingUnavailableReason(extraction.data.reviewReason ?? "") ||
        (extraction.data.reviewIssues ?? []).some((issue) =>
          isAutomatedReadingUnavailableReason(issue.reason),
        )),
  );

  useEffect(() => {
    if (extraction.data)
      setCorrections(
        Object.fromEntries(
          extraction.data.fields.map((field) => [
            field.id,
            field.correction ?? field.normalizedValue ?? field.rawValue ?? "",
          ]),
        ),
      );
  }, [extraction.data]);

  const chooseFile = (selected: File | null) => {
    const error = validateFile(selected);
    setUploadDone(false);
    setUploadError(error);
    setFile(error ? null : selected);
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !base) throw new Error("Falta seleccionar un archivo");
      if (!uploadRequestItemId) throw new Error("Elegí el pedido al que corresponde el archivo");
      const session = await api.post<UploadSession>(`${base}/document-upload-sessions`, {
        expectedMime: file.type || undefined,
        requestItemId: uploadRequestItemId,
      });
      await uploadToSignedUrl(session.presignedUrl, file);
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return api.post<UploadComplete>(
        `${base}/document-upload-sessions/${session.sessionId}/complete`,
        {
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          sha256,
          objectKey: session.objectKey,
        },
      );
    },
    onSuccess: (document) => {
      setUploadDone(true);
      setFile(null);
      setSelectedId(document.documentId);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] }),
      ]);
    },
    onError: (error) =>
      setUploadError(error instanceof ApiError ? error.message : "No se pudo subir el documento."),
  });
  const correct = useMutation({
    mutationFn: ({ fieldId, correction }: { fieldId: string; correction: string }) =>
      api.patch(`${base}/extractions/${extraction.data!.id}/fields/${fieldId}`, {
        correction,
        reason: "Corrección manual en bandeja",
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["extraction", firmId, clientId, selectedId],
      }),
  });
  const persistCorrection = (field: ExtractedField) => {
    const next = corrections[field.id] ?? "";
    const original = field.correction ?? field.normalizedValue ?? field.rawValue ?? "";
    if (!next || next === original) return;

    if (isManualExtractionFieldKey(field.key)) {
      const normalized = normalizeManualExtractionInput(field.key, next);
      if (normalized) correct.mutate({ fieldId: field.id, correction: normalized });
      return;
    }

    correct.mutate({ fieldId: field.id, correction: next });
  };
  const addManualFields = useMutation({
    mutationFn: (fields: ManualExtractionFieldValue[]) =>
      api.put<{ status: string; savedCount: number; addedCount: number }>(
        `${base}/extractions/${extraction.data!.id}/fields`,
        { fields },
      ),
    onMutate: () => setManualFieldsError(null),
    onSuccess: async (result) => {
      const queryKey = ["extraction", firmId, clientId, selectedId];
      try {
        await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
        await queryClient.fetchQuery({
          queryKey,
          queryFn: () => api.get<DocumentExtraction>(`${base}/documents/${selectedId}/extraction`),
          staleTime: 0,
        });
        setManualFieldsSavedCount(result.savedCount);
        setShowManualFieldsDialog(false);
      } catch {
        setManualFieldsError("Los datos se guardaron, pero no se pudo recargar la extracción. Volvé a intentar guardar.");
      }
    },
    onError: (error) => {
      setManualFieldsError(
        error instanceof ApiError ? error.message : "No se pudieron guardar los datos. Volvé a intentarlo.",
      );
    },
  });
  const openManualFields = () => {
    addManualFields.reset();
    setManualFieldsError(null);
    setManualFieldsSavedCount(null);
    setShowManualFieldsDialog(true);
  };
  const approve = useMutation({
    mutationFn: () => api.post(`${base}/extractions/${extraction.data!.id}/approve`),
    onSuccess: () =>
      // El documento pasa a "Revisado": la lista de documentos también se refresca, si no el Legajo
      // no lo ofrece como respaldo hasta que vence la caché.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["extraction", firmId, clientId, selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
      ]),
  });
  const reject = useMutation({
    mutationFn: ({ extractionId, reason }: { documentId: string; extractionId: string; reason: string }) =>
      api.post(`${base}/extractions/${extractionId}/reject`, { reason }),
    onSuccess: (_result, variables) => {
      setRejectionReceipts((current) => ({
        ...current,
        [variables.documentId]: variables.reason,
      }));
      setShowRejectDialog(false);
      setRejectionReasonCode("");
      setRejectionNote("");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["document", firmId, clientId, variables.documentId] }),
      ]);
    },
  });
  const reprocess = useMutation({
    mutationFn: () => {
      if (!base || !selectedId) throw new Error("Seleccioná un documento para releer.");
      return api.post<{ status: string; processingJobId: string }>(`${base}/documents/${selectedId}/reprocess`);
    },
    onSuccess: async (result) => {
      setReprocessJobId(result.processingJobId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["document", firmId, clientId, selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["extraction", firmId, clientId, selectedId] }),
      ]);
    },
  });
  // G2-07.5: ver/descargar el archivo subido. La URL firmada se pide al servidor
  // en el momento (reautoriza por RLS) y sólo se expone una vez validada.
  const openFile = useMutation({
    mutationFn: async (documentId: string) => {
      const preview = await api.get<{ url: string }>(
        `${base}/documents/${documentId}/preview`,
      );
      window.open(preview.url, "_blank", "noopener,noreferrer");
    },
  });
  const fileReady =
    Boolean(detail.data) &&
    (detail.data?.fileVersions?.[0]?.bucket === "originals" ||
      detail.data?.status === "EXTRACTED" ||
      detail.data?.fileVersions?.[0]?.antivirusStatus === "CLEAN");
  const rejectionReceipt = detail.data ? rejectionReceipts[detail.data.id] : undefined;
  const activeReprocessJob = detail.data?.processingJobs?.some(
    (job) => job.type === "REPROCESS" && ["QUEUED", "RUNNING"].includes(job.status),
  ) ?? false;
  const trackedReprocessJob = detail.data?.processingJobs?.find((job) => job.id === reprocessJobId);
  const reprocessIsActive =
    reprocess.isPending ||
    activeReprocessJob ||
    Boolean(reprocessJobId && (!trackedReprocessJob || ["QUEUED", "RUNNING"].includes(trackedReprocessJob.status)));
  const completedReprocessJobId = detail.data?.processingJobs?.find(
    (job) => job.id === reprocessJobId && job.type === "REPROCESS" && ["SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELED"].includes(job.status),
  )?.id ?? detail.data?.processingJobs?.find(
    (job) => job.type === "REPROCESS" && ["SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELED"].includes(job.status),
  )?.id;

  useEffect(() => {
    setReprocessJobId(null);
  }, [selectedId]);

  useEffect(() => {
    if (!completedReprocessJobId) return;
    setReprocessJobId((current) => current === completedReprocessJobId ? null : current);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
      queryClient.invalidateQueries({ queryKey: ["document", firmId, clientId, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ["extraction", firmId, clientId, selectedId] }),
    ]);
  }, [completedReprocessJobId, firmId, clientId, selectedId, queryClient]);

  const rows = documents.data ?? [];
  const normalizedDocumentSearch = normalizeDocumentSearch(documentSearch.trim());
  const visibleRows = rows.filter((document) => {
    if (!belongsToDocumentQueue(document, documentFilter)) return false;
    if (!normalizedDocumentSearch) return true;
    return normalizeDocumentSearch(
      `${documentFileName(document)} ${document.status} ${document.category ?? ""} ${document.direction ?? ""} ${document.createdAt}`,
    ).includes(normalizedDocumentSearch);
  });
  const documentQueue = [
    { id: "ALL" as const, label: "Todos", count: rows.length },
    {
      id: "NEEDS_REVIEW" as const,
      label: "Para revisar",
      count: rows.filter((document) => belongsToDocumentQueue(document, "NEEDS_REVIEW")).length,
    },
    {
      id: "PROCESSING" as const,
      label: "Procesando",
      count: rows.filter((document) => belongsToDocumentQueue(document, "PROCESSING")).length,
    },
    {
      id: "REVIEWED" as const,
      label: "Revisados",
      count: rows.filter((document) => belongsToDocumentQueue(document, "REVIEWED")).length,
    },
    {
      id: "ERROR" as const,
      label: "Con error",
      count: rows.filter((document) => belongsToDocumentQueue(document, "ERROR")).length,
    },
  ];
  const pendingRequestItems = (requests.data ?? []).flatMap((request) =>
    request.items
      .filter((item) => item.status === "PENDING")
      .map((item) => ({ ...item, requestTitle: request.title })),
  );
  return (
    <DensePage density={density} flow className="document-inbox">
      <DenseHeader
        eyebrow="Ingreso y evidencia"
        title="Bandeja documental"
        description="Cargá comprobantes, validá los datos extraídos y prepará el asiento sin perder la evidencia."
        actions={
          <>
          <Button
            variant="ghost"
            onClick={() => {
              void documents.refetch();
              if (showUpload) void requests.refetch();
              }}
            >
              Actualizar
            </Button>
          {base && capabilities.has("document.upload") ? (
            <Button
              onClick={() => {
                setShowUpload((value) => !value);
                setUploadDone(false);
                setUploadError(null);
              }}
              variant={showUpload ? "secondary" : "primary"}
            >
              {showUpload ? "Cerrar carga" : "Subir documento"}
            </Button>
          ) : null}
        
          </>
        }
      />

      <StatStrip
        label="Vistas de la bandeja"
        items={[
          ...documentQueue.map((queue) => ({
            key: queue.id,
            label: queue.label,
            value: documents.isLoading ? "…" : queue.count,
            active: base ? documentFilter === queue.id : false,
            onSelect: base ? () => setDocumentFilter(queue.id) : undefined,
          })),
          {
            key: "pending-items",
            label: "Ítems pendientes",
            value: pendingRequestItems.length,
            tone: pendingRequestItems.length > 0 ? ("warn" as const) : undefined,
          },
        ]}
      />




      <ActionDrawer
        isOpen={showUpload && Boolean(base)}
        onClose={() => {
          setShowUpload(false);
          setFile(null);
          setUploadError(null);
        }}
        eyebrow="Bandeja"
        title="Nuevo documento"
        description="El archivo pasa por validación, antivirus y extracción antes de estar disponible."
        size="wide"
      >
        <p className="secure-note upload-panel__secure-note">Carga segura</p>
        {requests.isLoading ? (
          <div className="query-state query-state--compact" role="status">
            <span className="loading-copy">Buscando pedidos abiertos…</span>
          </div>
        ) : requests.isError ? (
          <EmptyState
            size="compact"
            title="No se pudieron cargar los pedidos"
            description="Reintentá antes de asociar un documento a la evidencia solicitada."
            action={
              <Button size="sm" variant="secondary" onClick={() => void requests.refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : pendingRequestItems.length === 0 ? (
          <EmptyState
            size="compact"
            title="Primero creá un pedido documental"
            description="Cada carga queda vinculada a un ítem solicitado para preservar la trazabilidad."
            action={
              capabilities.has("request.manage") ? (
                <Button size="sm" onClick={() => navigate("/trabajo")}>
                  Ir a pedidos
                </Button>
              ) : undefined
            }
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <label className="ds-field" htmlFor="upload-request-item">
              <span className="ds-field__label">Corresponde a</span>
              <select
                id="upload-request-item"
                className="ctxbar__input"
                value={uploadRequestItemId}
                onChange={(event) => setUploadRequestItemId(event.target.value)}
                required
              >
                <option value="">Elegí el ítem solicitado</option>
                {pendingRequestItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.requestTitle} · {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label
              className={`upload-dropzone${dragging ? " upload-dropzone--dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                chooseFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              />
              <span>
                <strong>
                  {file ? file.name : "Arrastrá un archivo o elegilo desde tu equipo"}
                </strong>
                <small>{file ? fileSize(file.size) : "PDF, JPG, PNG o WebP · máximo 25 MB"}</small>
              </span>
              <span className="upload-dropzone__action">Elegir archivo</span>
            </label>
            {uploadError ? (
              <p className="form-error" role="alert">
                {uploadError}
              </p>
            ) : null}
            {uploadDone ? (
              <div className="action-receipt" role="status">
                <span>
                  <strong>Documento recibido</strong>
                  <small>Ya ingresó al circuito de validación y procesamiento.</small>
                </span>
              </div>
            ) : null}
            <div className="upload-panel__actions">
              <Button
                type="submit"
                loading={upload.isPending}
                loadingLabel="Subiendo documento"
                disabled={!file || !uploadRequestItemId}
              >
                Subir y procesar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowUpload(false);
                  setFile(null);
                  setUploadError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </ActionDrawer>

      {!base ? (
        <EmptyState
          title="Seleccioná un cliente"
          description="La bandeja y cada documento pertenecen a un contexto de cliente específico."
        />
      ) : (
        <>
          <DenseToolbar>
            <DenseSearch
              value={documentSearch}
              onChange={setDocumentSearch}
              placeholder="Nombre, categoría o estado…"
              label="Buscar"
            />
            <select
              className="dense-select"
              aria-label="Estado"
              value={documentFilter}
              onChange={(event) => setDocumentFilter(event.target.value as DocumentQueueFilter)}
            >
              {documentQueue.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.label}
                </option>
              ))}
            </select>
          </DenseToolbar>


          <div className="review-workspace">
          <section className="review-list" aria-label="Documentos">
            <div className="review-list__heading">
              <div>
                <h2>Documentos</h2>
                <span>{documents.isLoading ? "…" : visibleRows.length}</span>
              </div>
              <small>{visibleRows.length === rows.length ? "Más recientes primero" : `de ${rows.length}`}</small>
            </div>
            {documents.isLoading ? (
              <div className="query-state query-state--compact" role="status">
                <span className="loading-copy">Cargando documentos…</span>
              </div>
            ) : documents.isError ? (
              <EmptyState
                size="compact"
                title="No se pudo cargar la bandeja"
                action={
                  <button className="text-action" onClick={() => void documents.refetch()}>
                    Reintentar
                  </button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                size="compact"
                title="Bandeja vacía"
                description="Subí un archivo para iniciar el flujo."
                action={
                  capabilities.has("document.upload") ? (
                    <Button size="sm" onClick={() => setShowUpload(true)}>
                      Subir documento
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Table
                rows={visibleRows}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    size="compact"
                    title="No hay documentos en esta vista"
                    description="Probá con otro estado o ajustá la búsqueda."
                  />
                }
                columns={[
                  {
                    key: "document",
                    header: "Documento",
                    render: (row) => (
                      <button
                        type="button"
                        className="document-link"
                        aria-current={selectedId === row.id ? "true" : undefined}
                        onClick={() => {
                          setSelectedId(row.id);
                        }}
                      >
                        <span className="document-link__type">{documentTypeLabel(row)}</span>
                        <span>
                          <strong>{documentFileName(row)}</strong>
                          <small>
                            {new Intl.DateTimeFormat("es-AR").format(new Date(row.createdAt))}
                          </small>
                        </span>
                      </button>
                    ),
                  },
                  {
                    key: "status",
                    header: "Estado",
                    render: (row) => <StatusBadge status={row.status} />,
                  },
                ]}
              />
              )}
            </section>
          <aside className="review-detail" aria-live="polite">
            {!selectedId ? (
              <EmptyState
                title="Elegí un documento"
                description="Vas a revisar sus datos y preparar el asiento en este panel."
                action={
                  rows.length > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedId(rows[0]!.id)}
                    >
                      Abrir el más reciente
                    </Button>
                  ) : undefined
                }
              />
            ) : detail.isLoading ? (
              <div className="query-state">
                <span className="loading-copy">Abriendo documento…</span>
              </div>
            ) : detail.isError ? (
              <EmptyState
                title="No se pudo abrir el documento"
                action={
                  <Button variant="secondary" onClick={() => void detail.refetch()}>
                    Reintentar
                  </Button>
                }
              />
            ) : (
              <>
                <div className="review-detail__heading">
                  <div>
                    <h2>{detail.data?.fileVersions?.[0]?.originalName ?? "Documento"}</h2>
                    <p>
                      Ingresó{" "}
                      {detail.data?.createdAt
                        ? new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(
                            new Date(detail.data.createdAt),
                          )
                        : "recientemente"}
                    </p>
                  </div>
                  <div className="review-detail__actions">
                    {fileReady ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={openFile.isPending}
                        disabled={openFile.isPending}
                        title="Ver o descargar el archivo"
                        onClick={() => openFile.mutate(detail.data!.id)}
                      >
                        Ver archivo
                      </Button>
                    ) : null}
                    <StatusBadge status={detail.data?.status} />
                  </div>
                </div>
                {rejectionReceipt ? (
                  <div className="action-receipt action-receipt--rejected" role="status">
                    <span>
                      <strong>Documento rechazado</strong>
                      <small>Motivo: {rejectionReceipt}</small>
                    </span>
                  </div>
                ) : detail.data?.status !== "EXTRACTED" && detail.data?.status !== "REVIEWED" ? (
                  <div className="processing-state">
                    <div>
                      <h3>{reprocessIsActive ? "Releyendo…" : "Procesando comprobante"}</h3>
                      <p>
                        {reprocessIsActive
                          ? "La lectura nueva continúa en segundo plano. Esta vista se actualiza automáticamente."
                          : "La validación y extracción continúan en segundo plano. Esta vista se actualiza automáticamente."}
                      </p>
                      <span className="processing-state__track">
                        <span />
                      </span>
                      {reprocessIsActive && capabilities.has("document.review") ? (
                        <Button size="sm" variant="secondary" loading disabled>
                          Releyendo…
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : extraction.isLoading ? (
                  <div className="query-state">
                    <span className="loading-copy">Recuperando campos extraídos…</span>
                  </div>
                ) : extraction.data ? (
                  <>
                    <div className="extraction-heading">
                      <div>
                        <p className="study-page__eyebrow">Datos detectados</p>
                        <h3>Revisá contra el comprobante</h3>
                      </div>
                      <span>
                        {extraction.data.fields.filter((field) => FIELD_LABELS[field.key]).length} campos corregibles
                      </span>
                    </div>
                    <ExtractionFiscalTable
                      voucherData={extraction.data.voucherData}
                      documentReviewReason={extraction.data.reviewReason}
                      reviewIssues={extraction.data.reviewIssues}
                      fields={extraction.data.fields}
                      onAddManualData={canLoadManualFields ? openManualFields : undefined}
                    />
                    {manualFieldsSavedCount !== null ? (
                      <p className="manual-fields-saved" role="status">
                        Datos guardados: {manualFieldsSavedCount} {manualFieldsSavedCount === 1 ? "campo" : "campos"}.
                      </p>
                    ) : null}
                    {extraction.data.fields.some((field) => FIELD_LABELS[field.key]) ? (
                      <section
                        className="extraction-corrections"
                        aria-labelledby="extraction-corrections-title"
                      >
                        <h4 id="extraction-corrections-title">Corregir campos detectados</h4>
                        <div className="extraction-fields">
                          {extraction.data.fields
                            .filter((field) => FIELD_LABELS[field.key])
                            .map((field) => (
                              <div className="extraction-field" key={field.id}>
                                {isManualExtractionFieldKey(field.key) ? (
                                  <ManualExtractionValueControl
                                    fieldKey={field.key}
                                    id={`extracted-${field.id}`}
                                    label={FIELD_LABELS[field.key]!}
                                    value={corrections[field.id] ?? ""}
                                    hint={`Confianza ${Math.round(field.confidence * 100)}% · ${field.correction ? "corregido manualmente" : "valor extraído"}`}
                                    layout="field"
                                    showValidation={
                                      (corrections[field.id] ?? "") !==
                                      (field.correction ?? field.normalizedValue ?? field.rawValue ?? "")
                                    }
                                    onChange={(value) =>
                                      setCorrections((current) => ({ ...current, [field.id]: value }))
                                    }
                                    onBlur={() => persistCorrection(field)}
                                  />
                                ) : (
                                  <Field
                                    id={`extracted-${field.id}`}
                                    label={FIELD_LABELS[field.key]!}
                                    value={corrections[field.id] ?? ""}
                                    hint={`Confianza ${Math.round(field.confidence * 100)}% · ${field.correction ? "corregido manualmente" : "valor extraído"}`}
                                    onChange={(event) =>
                                      setCorrections((current) => ({
                                        ...current,
                                        [field.id]: event.target.value,
                                      }))
                                    }
                                    onBlur={() => persistCorrection(field)}
                                  />
                                )}
                                <span
                                  className={`confidence-mark confidence-mark--${field.confidence >= 0.9 ? "high" : field.confidence >= 0.7 ? "medium" : "low"}`}
                                  aria-hidden="true"
                                />
                              </div>
                            ))}
                        </div>
                      </section>
                    ) : null}
                    {correct.isError ? (
                      <p className="form-error" role="alert">
                        No se pudo guardar una corrección. Volvé a intentarlo.
                      </p>
                    ) : null}
                    {capabilities.has("document.review") &&
                    extraction.data.status !== "REVIEWED" ? (
                      <div className="review-actions">
                        <div className="review-actions__copy">
                          <p>Confirmá que los datos coinciden con la evidencia antes de aprobar.</p>
                          {canApproveExtraction ? null : (
                            <p className="review-actions__hint" role="note">
                              Cargá al menos un dato para aprobar.
                            </p>
                          )}
                        </div>
                        <div className="review-actions__buttons">
                          {canLoadManualFields && hasEmptyScalarFields ? (
                            <Button variant="ghost" onClick={openManualFields}>
                              Cargar datos a mano
                            </Button>
                          ) : null}
                          {canReprocessExtraction ? (
                            <Button
                              variant={reprocessShouldBeHighlighted ? "primary" : "secondary"}
                              loading={reprocess.isPending}
                              disabled={reprocessIsActive}
                              onClick={() => {
                                const description = [
                                  "Se volverá a leer el documento con IA. La lectura anterior y lo que cargaste a mano se conservan en el historial.",
                                  manualFieldCount > 0
                                    ? `Tiene ${manualFieldCount} campos cargados o corregidos a mano: no se copian a la lectura nueva; podés volver a cargarlos.`
                                    : null,
                                ].filter(Boolean).join(" ");
                                confirm.ask({
                                  title: "¿Releer el documento con IA?",
                                  description,
                                  confirmLabel: "Releer con IA",
                                  onConfirm: () => reprocess.mutate(),
                                });
                              }}
                            >
                              {reprocessIsActive ? "Releyendo…" : "Releer con IA"}
                            </Button>
                          ) : null}
                          <Button
                            onClick={() =>
                              confirm.ask({
                                title: "¿Aprobar la extracción?",
                                description:
                                  "Confirmá que revisaste los datos contra el comprobante. La aprobación queda registrada en la auditoría.",
                                confirmLabel: "Aprobar extracción",
                                onConfirm: () => approve.mutate(),
                              })
                            }
                            loading={approve.isPending}
                            disabled={!canApproveExtraction}
                          >
                            Aprobar extracción
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => {
                              reject.reset();
                              setRejectionReasonCode("");
                              setRejectionNote("");
                              setShowRejectDialog(true);
                            }}
                          >
                            Rechazar
                          </Button>
                        </div>
                        {reprocess.isError ? (
                          <p className="form-error" role="alert">
                            {reprocess.error instanceof ApiError
                              ? reprocess.error.message
                              : "No se pudo releer el documento. Volvé a intentarlo."}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {extraction.data.status === "REVIEWED" ? (
                      <div className="action-receipt">
                        <span>
                          <strong>Extracción revisada</strong>
                          <small>
                            Los campos están listos para preparar la propuesta contable.
                          </small>
                        </span>
                      </div>
                    ) : null}
                    {extraction.data.status === "REVIEWED" ? (
                      <div className="action-receipt" role="status">
                        <span>
                          <strong>Datos listos para registrar</strong>
                          <small>
                            La creación automática se retiró para conservar el control. La
                            evidencia queda disponible como respaldo del legajo.
                          </small>
                        </span>
                      </div>
                    ) : null}
                    {showManualFieldsDialog ? (
                      <ManualExtractionFieldsDialog
                        fields={extraction.data.fields}
                        voucherData={extraction.data.voucherData}
                        isSaving={addManualFields.isPending}
                        error={manualFieldsError}
                        onSave={(fields) => addManualFields.mutate(fields)}
                        onClose={() => setShowManualFieldsDialog(false)}
                      />
                    ) : null}
                  </>
                ) : (
                  <EmptyState title="La extracción todavía no está disponible" />
                )}
              </>
            )}
          </aside>
          </div>
        </>
      )}
      <ActionDrawer
        isOpen={showRejectDialog}
        onClose={() => setShowRejectDialog(false)}
        eyebrow="Revisión documental"
        title="¿Rechazar este documento?"
        description="Elegí el motivo del rechazo. La decisión queda registrada y el documento sale de Para revisar."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowRejectDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="document-rejection-form"
              variant="danger"
              loading={reject.isPending}
              disabled={!rejectionReasonCode || reject.isPending}
            >
              Confirmar rechazo
            </Button>
          </>
        }
      >
        <form
          id="document-rejection-form"
          onSubmit={(event) => {
            event.preventDefault();
            const selectedReason = REJECTION_REASONS.find(
              (option) => option.value === rejectionReasonCode,
            );
            if (!selectedReason || !selectedId || !extraction.data) return;
            const reason = [selectedReason.label, rejectionNote.trim()].filter(Boolean).join(" — ");
            reject.mutate({
              documentId: selectedId,
              extractionId: extraction.data.id,
              reason,
            });
          }}
        >
          <label className="ds-field" htmlFor="document-rejection-reason">
            <span className="ds-field__label">Motivo del rechazo</span>
            <select
              id="document-rejection-reason"
              className="ctxbar__input"
              value={rejectionReasonCode}
              onChange={(event) => setRejectionReasonCode(event.target.value)}
              required
            >
              <option value="">Elegí un motivo</option>
              {REJECTION_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field" htmlFor="document-rejection-note">
            <span className="ds-field__label">Detalle (opcional)</span>
            <textarea
              id="document-rejection-note"
              className="study-textarea"
              rows={3}
              maxLength={450}
              value={rejectionNote}
              onChange={(event) => setRejectionNote(event.target.value)}
              placeholder="Agregá un detalle para facilitar la revisión."
            />
          </label>
          {reject.isError ? (
            <p className="form-error" role="alert">
              {reject.error instanceof ApiError
                ? reject.error.message
                : "No se pudo rechazar el documento. Volvé a intentarlo."}
            </p>
          ) : null}
        </form>
      </ActionDrawer>
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
