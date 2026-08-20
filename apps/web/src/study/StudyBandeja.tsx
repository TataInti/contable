import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Table } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  api,
  uploadToSignedUrl,
  type Document,
  type DocumentExtraction,
  type DocumentRequest,
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
  const { firmId, clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [showUpload, setShowUpload] = useState(false);
  const [uploadRequestItemId, setUploadRequestItemId] = useState("");
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
    enabled: Boolean(base && selectedId && detail.data?.status === "EXTRACTED"),
    retry: false,
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
  const approve = useMutation({
    mutationFn: () => api.post(`${base}/extractions/${extraction.data!.id}/approve`),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["extraction", firmId, clientId, selectedId],
      }),
  });

  const rows = documents.data ?? [];
  const pendingRequestItems = (requests.data ?? []).flatMap((request) =>
    request.items
      .filter((item) => item.status === "PENDING")
      .map((item) => ({ ...item, requestTitle: request.title })),
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
        <div className="study-page__header-actions">
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
              <Icon name={showUpload ? "close" : "upload"} size={17} />
              {showUpload ? "Cerrar carga" : "Subir documento"}
            </Button>
          ) : null}
        </div>
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
                <span className="upload-dropzone__icon">
                  <Icon name="upload" size={23} />
                </span>
                <span>
                  <strong>
                    {file ? file.name : "Arrastrá un archivo o elegilo desde tu equipo"}
                  </strong>
                  <small>
                    {file ? fileSize(file.size) : "PDF, JPG, PNG o WebP · máximo 25 MB"}
                  </small>
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
                    {extraction.data.status === "REVIEWED" ? (
                      <div className="action-receipt" role="status">
                        <Icon name="file" size={18} />
                        <span>
                          <strong>Datos listos para registrar</strong>
                          <small>
                            La creación automática se retiró para conservar el control. Podés
                            preparar un asiento manual con esta evidencia como respaldo.
                          </small>
                        </span>
                        {capabilities.has("entry.create") ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate("/contabilidad")}
                          >
                            Preparar asiento
                          </Button>
                        ) : null}
                      </div>
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
