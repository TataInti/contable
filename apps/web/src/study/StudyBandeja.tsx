import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field } from "@contable/design-system";
import { isManualExtractionFieldKey } from "@contable/contracts";
import {
  ApiError,
  api,
  type Document,
  type DocumentExtraction,
  type ExtractedField,
  type DocumentRequest,
} from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import {
  belongsToDocumentQueue,
  coincideConBusqueda,
  ordenarPorIngresoDescendente,
  type DocumentQueueFilter,
} from "./bandeja/colaDeDocumentos";
import { ExtractionFiscalTable } from "./ExtractionFiscalTable";
import {
  hasEffectiveFiscalData,
  isAutomatedReadingUnavailableReason,
} from "./extractionReadiness";
import { ManualExtractionFieldsDialog, type ManualExtractionFieldValue } from "./ManualExtractionFieldsDialog";
import { ManualExtractionValueControl, normalizeManualExtractionInput } from "./ManualExtractionValueControl";
import { EXTRACTION_SCALAR_FIELDS, fiscalScalarHasValue } from "./extractionScalarFields";
import { StatusBadge } from "../ui/StatusBadge";
import { ConfirmDialog, useConfirmAction } from "../ui/ConfirmAction";
import { DensePage, useDensity } from "../ui/Dense";
import "./study.css";
import { formatearFechaHora } from "../lib/formatoFechas";
import { CabeceraBandeja, type VistaBandeja } from "./bandeja/CabeceraBandeja";
import { ListaDocumentos } from "./bandeja/ListaDocumentos";
import { CargarDocumento, type CargarDocumentoHandle } from "./bandeja/CargarDocumento";
import { RechazarDocumento } from "./bandeja/RechazarDocumento";


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

export function StudyBandeja() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reprocessJobId, setReprocessJobId] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [showManualFieldsDialog, setShowManualFieldsDialog] = useState(false);
  const [manualFieldsError, setManualFieldsError] = useState<string | null>(null);
  const [manualFieldsSavedCount, setManualFieldsSavedCount] = useState<number | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReceipts, setRejectionReceipts] = useState<Record<string, string>>({});
  const [showUpload, setShowUpload] = useState(false);
  const cargaRef = useRef<CargarDocumentoHandle>(null);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState<DocumentQueueFilter>("ALL");
  const [actualizando, setActualizando] = useState(false);
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
    enabled: Boolean(base),
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
  // Más recientes primero (7b-12): la pantalla ordena por fecha de ingreso y no depende del orden de la API.
  const documentosVisibles = ordenarPorIngresoDescendente(rows).filter(
    (document) => belongsToDocumentQueue(document, documentFilter) && coincideConBusqueda(document, documentSearch),
  );
  const cantidadEnCola = (filter: DocumentQueueFilter) =>
    rows.filter((document) => belongsToDocumentQueue(document, filter)).length;
  // Una cifra sin respuesta no es 0 (C7B-5 y regla transversal): sin cliente no hay consulta; con error, «no disponible».
  const cifraDeCola = (filter: DocumentQueueFilter) => {
    if (!base) return "—";
    if (documents.isError) return "no disponible";
    if (documents.data === undefined) return "…";
    return cantidadEnCola(filter);
  };
  const vistas: VistaBandeja[] = [
    { id: "ALL", label: "Todos", value: cifraDeCola("ALL") },
    { id: "NEEDS_REVIEW", label: "Para revisar", value: cifraDeCola("NEEDS_REVIEW") },
    { id: "PROCESSING", label: "Procesando", value: cifraDeCola("PROCESSING") },
    { id: "REVIEWED", label: "Revisado", value: cifraDeCola("REVIEWED") },
    { id: "ERROR", label: "Con error", value: cifraDeCola("ERROR") },
  ];
  const pendingRequestItems = (requests.data ?? []).flatMap((request) =>
    request.items
      .filter((item) => item.status === "PENDING")
      .map((item) => ({ ...item, requestTitle: request.title })),
  );
  // C7B-5: «Ítems pendientes» se carga al abrir la pantalla; sin respuesta muestra «…» o «no disponible».
  const pendientesValor = !base
    ? "—"
    : requests.isError
      ? "no disponible"
      : requests.data === undefined
        ? "…"
        : pendingRequestItems.length;
  const actualizar = () => {
    setActualizando(true);
    // Alcance sin cambios: documentos y, con el cajón abierto, pedidos. No refresca detalle ni extracción.
    const consultas: Promise<unknown>[] = [documents.refetch()];
    if (showUpload) consultas.push(requests.refetch());
    void Promise.allSettled(consultas).finally(() => setActualizando(false));
  };
  return (
    <DensePage density={density} flow className="document-inbox">
      <CabeceraBandeja
        vistas={vistas}
        vistaActiva={documentFilter}
        vistasSeleccionables={Boolean(base)}
        onElegirVista={setDocumentFilter}
        pendientes={{ value: pendientesValor, warn: pendingRequestItems.length > 0 }}
        puedeSubir={Boolean(base) && capabilities.has("document.upload")}
        cargaAbierta={showUpload}
        onAlternarCarga={() => {
          setShowUpload((value) => !value);
          cargaRef.current?.limpiarError();
        }}
        actualizando={actualizando}
        onActualizar={actualizar}
      />

      <CargarDocumento
        ref={cargaRef}
        isOpen={showUpload && Boolean(base)}
        base={base}
        capabilities={capabilities}
        pendingRequestItems={pendingRequestItems}
        requestsLoading={requests.isLoading}
        requestsError={requests.isError}
        onRetryRequests={() => void requests.refetch()}
        onClose={() => setShowUpload(false)}
        onUploaded={setSelectedId}
      />

      {!base ? (
        <EmptyState
          title="Seleccioná un cliente"
          description="La bandeja y cada documento pertenecen a un contexto de cliente específico."
        />
      ) : (
        <>
          <div className="review-workspace">
            {/* Una consulta sin respuesta (pausada: sin conexión o pestaña oculta) sigue cargando: no es lista vacía (7b.2, cierre). */}
            <ListaDocumentos
              todos={rows}
              visibles={documentosVisibles}
              cargando={documents.isPending}
              error={documents.isError}
              onReintentar={() => void documents.refetch()}
              busqueda={documentSearch}
              onBuscar={setDocumentSearch}
              filtrada={documentFilter !== "ALL" || documentSearch.trim() !== ""}
              seleccionadoId={selectedId}
              onSeleccionar={setSelectedId}
              puedeSubir={capabilities.has("document.upload")}
              onSubir={() => setShowUpload(true)}
              onQuitarFiltros={() => {
                setDocumentFilter("ALL");
                setDocumentSearch("");
              }}
            />
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
                        ? formatearFechaHora(detail.data.createdAt)
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
                            onClick={() => setShowRejectDialog(true)}
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
      <RechazarDocumento
        isOpen={showRejectDialog}
        base={base}
        documentId={selectedId}
        extractionId={extraction.data?.id ?? null}
        onClose={() => setShowRejectDialog(false)}
        onRejected={(documentId, reason) =>
          setRejectionReceipts((current) => ({ ...current, [documentId]: reason }))
        }
      />
      <ConfirmDialog confirm={confirm} />
    </DensePage>
  );
}
