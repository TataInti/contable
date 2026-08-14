import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import {
  ApiError,
  api,
  uploadToSignedUrl,
  type Account,
  type Document,
  type DocumentExtraction,
  type FiscalYear,
  type JournalEntry,
} from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
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
  issueDate: "Fecha de emisión",
  totalAmount: "Importe total",
  netAmount: "Neto gravado",
  vatAmount: "IVA",
  issuerTaxId: "CUIT del emisor",
  issuerName: "Emisor",
  voucherNumber: "Número de comprobante",
  voucherType: "Tipo de comprobante",
  pointOfSale: "Punto de venta",
  currency: "Moneda",
};

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

export function StudyBandeja() {
  const { firmId, clientId, periodId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [entryResult, setEntryResult] = useState<JournalEntry | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  const detail = useQuery({
    queryKey: ["document", firmId, clientId, selectedId],
    queryFn: () => api.get<Document>(`${base}/documents/${selectedId}`),
    enabled: Boolean(base && selectedId),
    refetchInterval: 3_000,
  });
  const extraction = useQuery({
    queryKey: ["extraction", firmId, clientId, selectedId],
    queryFn: () => api.get<DocumentExtraction>(`${base}/documents/${selectedId}/extraction`),
    enabled: Boolean(base && selectedId && detail.data?.status === "EXTRACTED"),
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["accounts", firmId, clientId],
    queryFn: () => api.get<Account[]>(`${base}/accounts`),
    enabled: Boolean(base && selectedId),
  });
  const fiscalYears = useQuery({
    queryKey: ["fiscal-years", firmId, clientId],
    queryFn: () => api.get<FiscalYear[]>(`${base}/fiscal-years`),
    enabled: Boolean(base && selectedId),
  });

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
  useEffect(() => {
    const list = accounts.data ?? [];
    if (!debitAccountId && list[0]) setDebitAccountId(list[0].id);
    if (!creditAccountId && list[1]) setCreditAccountId(list[1].id);
  }, [accounts.data, debitAccountId, creditAccountId]);

  const chooseFile = (selected: File | null) => {
    const error = validateFile(selected);
    setUploadDone(false);
    setUploadError(error);
    setFile(error ? null : selected);
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !base) throw new Error("Falta seleccionar un archivo");
      const session = await api.post<UploadSession>(`${base}/document-upload-sessions`, {
        expectedMime: file.type || undefined,
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
      void queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
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
  const approve = useMutation({
    mutationFn: () => api.post(`${base}/extractions/${extraction.data!.id}/approve`),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["extraction", firmId, clientId, selectedId],
      }),
  });
  const createEntry = useMutation({
    mutationFn: async () => {
      const selectedPeriod = fiscalYears.data
        ?.flatMap((year) => year.periods.map((period) => ({ ...period, fiscalYearId: year.id })))
        .find((period) => period.id === periodId);
      if (!selectedPeriod) throw new Error("Seleccioná un período abierto");
      const totalField = extraction.data?.fields.find((field) => field.key === "totalAmount");
      const amount = totalField ? corrections[totalField.id] : undefined;
      if (!amount || Number(amount) <= 0)
        throw new Error("La extracción no contiene un total válido");
      const dateField = extraction.data?.fields.find((field) => field.key === "issueDate");
      const entry = await api.post<JournalEntry>(`${base}/journal-entries`, {
        fiscalYearId: selectedPeriod.fiscalYearId,
        periodId: selectedPeriod.id,
        entryDate:
          (dateField && corrections[dateField.id]) || new Date().toISOString().slice(0, 10),
        description: `Comprobante ${detail.data?.fileVersions?.[0]?.originalName ?? selectedId}`,
        reference: selectedId ?? undefined,
        sourceType: "DOCUMENT",
        lines: [
          {
            accountId: debitAccountId,
            currencyCode: "ARS",
            debitOriginal: amount,
            creditOriginal: "0",
            debitFunctional: amount,
            creditFunctional: "0",
          },
          {
            accountId: creditAccountId,
            currencyCode: "ARS",
            debitOriginal: "0",
            creditOriginal: amount,
            debitFunctional: "0",
            creditFunctional: amount,
          },
        ],
      });
      return api.post<JournalEntry>(`${base}/journal-entries/${entry.id}/submit`);
    },
    onSuccess: (entry) => {
      setEntryResult(entry);
      void queryClient.invalidateQueries({ queryKey: ["journal-entries", firmId, clientId] });
    },
  });

  const rows = documents.data ?? [];
  const total = useMemo(
    () => extraction.data?.fields.find((field) => field.key === "totalAmount"),
    [extraction.data],
  );
  return (
    <div className="study-page study-page--wide">
      <div className="study-page__header">
        <div>
          <p className="study-page__eyebrow">Ingreso y evidencia</p>
          <h1 className="study-page__title">Bandeja documental</h1>
          <p className="study-page__subtitle">
            Cargá comprobantes, validá los datos extraídos y prepará el asiento sin perder la
            evidencia.
          </p>
        </div>
        {base && capabilities.has("document.upload") ? (
          <Button
            onClick={() => {
              setShowUpload((value) => !value);
              setUploadDone(false);
            }}
            variant={showUpload ? "secondary" : "primary"}
          >
            <Icon name={showUpload ? "close" : "upload"} size={17} />
            {showUpload ? "Cerrar carga" : "Subir documento"}
          </Button>
        ) : null}
      </div>

      {showUpload && base ? (
        <section className="study-panel upload-panel" aria-labelledby="study-upload-title">
          <div className="study-panel__heading">
            <div>
              <h2 id="study-upload-title">Nuevo documento</h2>
              <p>
                El archivo pasa por validación, antivirus y extracción antes de estar disponible.
              </p>
            </div>
            <span className="secure-note">
              <Icon name="shield" size={15} /> Carga segura
            </span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
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
              <span className="upload-dropzone__icon">
                <Icon name="upload" size={23} />
              </span>
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
                <Icon name="check" size={18} />
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
                disabled={!file}
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
        </section>
      ) : null}

      {!base ? (
        <EmptyState
          title="Seleccioná un cliente"
          description="La bandeja y cada documento pertenecen a un contexto de cliente específico."
        />
      ) : (
        <div className="review-workspace">
          <section className="review-list" aria-label="Documentos">
            <div className="review-list__heading">
              <div>
                <h2>Documentos</h2>
                <span>{documents.isLoading ? "…" : rows.length}</span>
              </div>
              <small>Más recientes primero</small>
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
                rows={rows}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "document",
                    header: "Documento",
                    render: (row) => (
                      <button
                        className="document-link"
                        aria-current={selectedId === row.id ? "true" : undefined}
                        onClick={() => {
                          setSelectedId(row.id);
                          setEntryResult(null);
                        }}
                      >
                        <span className="document-link__icon">
                          <Icon name="file" size={17} />
                        </span>
                        <span>
                          <strong>
                            {row.fileVersions?.[0]?.originalName ?? row.id.slice(0, 8)}
                          </strong>
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
                  <span className="review-detail__file-icon">
                    <Icon name="file" size={21} />
                  </span>
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
                  <StatusBadge status={detail.data?.status} />
                </div>
                {detail.data?.status !== "EXTRACTED" ? (
                  <div className="processing-state">
                    <span className="processing-state__icon">
                      <Icon name="spark" size={21} />
                    </span>
                    <div>
                      <h3>Procesando comprobante</h3>
                      <p>
                        La validación y extracción continúan en segundo plano. Esta vista se
                        actualiza automáticamente.
                      </p>
                      <span className="processing-state__track">
                        <span />
                      </span>
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
                      <span>{extraction.data.fields.length} campos</span>
                    </div>
                    <div className="extraction-fields">
                      {extraction.data.fields.map((field) => (
                        <div className="extraction-field" key={field.id}>
                          <Field
                            id={`extracted-${field.id}`}
                            label={FIELD_LABELS[field.key] ?? field.key}
                            value={corrections[field.id] ?? ""}
                            hint={`Confianza ${Math.round(field.confidence * 100)}% · ${field.correction ? "corregido manualmente" : "valor extraído"}`}
                            onChange={(event) =>
                              setCorrections((current) => ({
                                ...current,
                                [field.id]: event.target.value,
                              }))
                            }
                            onBlur={() => {
                              const next = corrections[field.id] ?? "";
                              const original =
                                field.correction ?? field.normalizedValue ?? field.rawValue ?? "";
                              if (next && next !== original)
                                correct.mutate({ fieldId: field.id, correction: next });
                            }}
                          />
                          <span
                            className={`confidence-mark confidence-mark--${field.confidence >= 0.9 ? "high" : field.confidence >= 0.7 ? "medium" : "low"}`}
                            aria-hidden="true"
                          />
                        </div>
                      ))}
                    </div>
                    {correct.isError ? (
                      <p className="form-error" role="alert">
                        No se pudo guardar una corrección. Volvé a intentarlo.
                      </p>
                    ) : null}
                    {capabilities.has("document.review") &&
                    extraction.data.status !== "REVIEWED" ? (
                      <div className="review-actions">
                        <p>
                          <Icon name="shield" size={16} /> Confirmá que los datos coinciden con la
                          evidencia antes de aprobar.
                        </p>
                        <Button
                          onClick={() => {
                            if (
                              window.confirm(
                                "¿Confirmás que revisaste los datos contra el comprobante?",
                              )
                            )
                              approve.mutate();
                          }}
                          loading={approve.isPending}
                        >
                          Aprobar extracción
                        </Button>
                      </div>
                    ) : null}
                    {extraction.data.status === "REVIEWED" ? (
                      <div className="action-receipt">
                        <Icon name="check" size={18} />
                        <span>
                          <strong>Extracción revisada</strong>
                          <small>
                            Los campos están listos para preparar la propuesta contable.
                          </small>
                        </span>
                      </div>
                    ) : null}
                    {extraction.data.status === "REVIEWED" && capabilities.has("entry.create") ? (
                      <section className="entry-proposal">
                        <div className="entry-proposal__heading">
                          <div>
                            <p className="study-page__eyebrow">Siguiente paso</p>
                            <h3>Propuesta de asiento</h3>
                          </div>
                          <strong>
                            {total
                              ? new Intl.NumberFormat("es-AR", {
                                  style: "currency",
                                  currency: "ARS",
                                }).format(Number(corrections[total.id] ?? 0))
                              : "Sin total"}
                          </strong>
                        </div>
                        <div className="entry-proposal__accounts">
                          <label className="ds-field">
                            <span className="ds-field__label">Cuenta de débito</span>
                            <select
                              className="ctxbar__input"
                              value={debitAccountId}
                              onChange={(event) => setDebitAccountId(event.target.value)}
                            >
                              {accounts.data?.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.code} · {account.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="ds-field">
                            <span className="ds-field__label">Cuenta de crédito</span>
                            <select
                              className="ctxbar__input"
                              value={creditAccountId}
                              onChange={(event) => setCreditAccountId(event.target.value)}
                            >
                              {accounts.data?.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.code} · {account.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {createEntry.isError ? (
                          <p className="form-error" role="alert">
                            {createEntry.error.message}
                          </p>
                        ) : null}
                        {entryResult ? (
                          <div className="action-receipt" role="status">
                            <Icon name="check" size={18} />
                            <span>
                              <strong>Asiento enviado a revisión</strong>
                              <small>
                                La propuesta quedó separada de la aprobación documental.
                              </small>
                            </span>
                          </div>
                        ) : (
                          <Button
                            onClick={() => createEntry.mutate()}
                            loading={createEntry.isPending}
                            disabled={
                              !periodId ||
                              !debitAccountId ||
                              !creditAccountId ||
                              debitAccountId === creditAccountId
                            }
                          >
                            Crear y enviar a revisión
                          </Button>
                        )}
                      </section>
                    ) : null}
                  </>
                ) : (
                  <EmptyState title="La extracción todavía no está disponible" />
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
