import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Table } from "@contable/design-system";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, type Document, uploadToSignedUrl } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "../ui/StatusBadge";
import {
  formatFileSize,
  formatPortalDate,
  PortalLoading,
  PortalPageHeader,
  PortalRetryButton,
} from "./PortalUI";
import { SectionIndex } from "../ui/SectionIndex";
import "./portal.css";

interface UploadSession {
  sessionId: string;
  presignedUrl: string;
  objectKey: string;
}

interface FilePreview {
  url: string;
  mimeType: string | null;
  originalName: string | null;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function canPreview(document: Document): boolean {
  // La URL firmada sólo se expone tras la validación (fuera de cuarentena).
  const version = document.fileVersions?.[0];
  return Boolean(version && version.antivirusStatus === "CLEAN");
}

export function PortalUpload() {
  const { clientId, capabilities } = useClientContext();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [category, setCategory] = useState<"OTRO" | "ACUSE">("OTRO");
  const requestedBy = searchParams.get("pedido");
  const requestedItem = searchParams.get("item");
  const requestItemId = searchParams.get("itemId");
  const documents = useQuery({
    queryKey: ["portal-documents", clientId],
    queryFn: () => api.get<Document[]>(`/portal/clients/${clientId}/documents`),
    enabled: Boolean(clientId) && capabilities.has("portal.results.read"),
  });
  // G2-07.5: preview/descarga de un documento propio. Se pide la URL firmada
  // al servidor al momento de abrir (reautoriza por RLS) y no se expone la
  // clave del objeto en el cliente.
  const preview = useMutation({
    mutationFn: (documentId: string) =>
      api.get<FilePreview>(`/portal/clients/${clientId}/documents/${documentId}/preview`),
    onSuccess: (data) => {
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
  });

  // G0-05 + G5: READONLY no puede subir documentos (PLAN §4.2).
  if (!capabilities.has("portal.documents.upload")) {
    return (
      <div className="portal-page">
        <PortalPageHeader
          eyebrow="Documentación"
          title="Subir documentos"
          description="Tu perfil es de sólo lectura y no puede cargar archivos."
        />
        <EmptyState
          title="Sin permiso para subir"
          description="Contactá a tu estudio si necesitás aportar documentación."
        />
      </div>
    );
  }

  const selectFile = (selected: File | null) => {
    if (selected && (!ALLOWED_TYPES.has(selected.type) || selected.size > MAX_FILE_SIZE)) {
      setFile(null);
      setError("Elegí un PDF, JPG, PNG o WebP de hasta 25 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(selected);
    setDone(null);
    setError(null);
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0] ?? null);
  };

  const removeFile = () => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !clientId) return;
    setUploading(true);
    setError(null);
    setDone(null);
    try {
      // 1. Crear sesión de upload → URL firmada
      const session = await api.post<UploadSession>(
        `/portal/clients/${clientId}/document-upload-sessions`,
        {
          expectedMime: file.type || undefined,
          ...(requestItemId ? { requestItemId } : {}),
          ...(category !== "OTRO" ? { category } : {}),
        },
      );
      // 2. Subir a la URL firmada (MinIO)
      await uploadToSignedUrl(session.presignedUrl, file);
      // 3. Completar upload
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const body = {
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sha256,
        objectKey: session.objectKey,
      };
      await api.post<{ data?: unknown }>(
        `/portal/clients/${clientId}/document-upload-sessions/${session.sessionId}/complete`,
        body,
      );
      setDone(
        requestItemId
          ? "Documento subido y asociado al ítem solicitado. Ya lo estamos validando."
          : "Documento subido correctamente. Ya lo estamos validando.",
      );
      void queryClient.invalidateQueries({ queryKey: ["portal-documents", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["portal-summary", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["portal-requests", clientId] });
      setFile(null);
      setCategory("OTRO");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(
        err instanceof ApiError && err.status > 0 && err.status < 500
          ? err.message
          : "No pudimos subir el documento. Reintentá en unos minutos.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="portal-page portal-page--upload">
      <PortalPageHeader
        eyebrow="Documentación"
        title="Subir documentos"
        description="Entregá archivos a tu estudio de manera segura y en pocos pasos."
      />

      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa en la barra superior antes de cargar documentación."
        />
      ) : (
        <>
          <SectionIndex
            items={[
              { id: "upload-next-step-title", label: "Nueva carga" },
              { id: "upload-help-title", label: "Cómo funciona" },
              ...(capabilities.has("portal.results.read")
                ? [{ id: "recent-documents-title", label: "Cargas recientes" }]
                : []),
            ]}
          />
          <section className="portal-guidance portal-guidance--upload" aria-labelledby="upload-next-step-title">
            <div className="portal-guidance__context">
              <span className="portal-guidance__icon" aria-hidden="true">
                <Icon name="upload" size={19} />
              </span>
              <div>
                <p className="portal-guidance__eyebrow">Destino de la carga</p>
                <p>
                  {requestedItem
                    ? `Este archivo se asociará a “${requestedItem}”.`
                    : "El archivo quedará disponible para tu estudio dentro de esta empresa."}
                </p>
              </div>
            </div>
            <div className="portal-guidance__next">
              <div>
                <p className="portal-guidance__eyebrow">Próximo paso</p>
                <h2 id="upload-next-step-title">Elegí el archivo que querés enviar</h2>
              </div>
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                Elegir archivo
              </Button>
            </div>
          </section>
          <div className="portal-upload-layout">
          <form className="portal-upload" onSubmit={onSubmit}>
            {requestedBy || requestedItem ? (
              <div className="portal-inline-alert" role="status">
                <Icon name="tasks" size={17} />
                <span>
                  {requestedItem ? `Estás aportando: ${requestedItem}. ` : "Estás aportando documentación. "}
                  {requestedBy ? `Pedido: ${requestedBy}. ` : ""}
                  {requestItemId
                    ? "Al finalizar, el archivo se asociará a este ítem y quedará disponible para tu estudio."
                    : "Al finalizar, el archivo quedará disponible para tu estudio dentro de esta empresa."}
                </span>
              </div>
            ) : null}
            <div
              className={`portal-dropzone${dragging ? " portal-dropzone--dragging" : ""}${file ? " portal-dropzone--selected" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!uploading) selectFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                ref={inputRef}
                id="archivo"
                className="portal-dropzone__input"
                type="file"
                aria-label="Archivo"
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                onChange={onFile}
                disabled={uploading}
              />
              <label className="portal-dropzone__label" htmlFor="archivo">
                <span className="portal-dropzone__icon" aria-hidden="true">
                  <Icon name="upload" size={26} />
                </span>
                <span className="portal-dropzone__title">
                  <strong>Archivo</strong>
                </span>
                <span className="portal-dropzone__prompt">
                  Arrastrá un archivo acá o <strong>elegilo desde tu equipo</strong>
                </span>
                <span className="portal-dropzone__hint">PDF, JPG, PNG o WebP · Hasta 25 MB</span>
              </label>
            </div>

            <label className="portal-upload__category">
              <span>Tipo de documento</span>
              <select
                className="portal-upload__category-select"
                value={category}
                onChange={(event) => setCategory(event.target.value as "OTRO" | "ACUSE")}
                disabled={uploading}
              >
                <option value="OTRO">Documentación general</option>
                <option value="ACUSE">Acuse de presentación</option>
              </select>
            </label>

            {file ? (
              <div className="portal-upload__file" aria-live="polite">
                <span className="portal-upload__file-icon" aria-hidden="true">
                  <Icon name="file" size={21} />
                </span>
                <span className="portal-upload__file-copy">
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)} · Listo para subir</small>
                </span>
                <Button
                  className="portal-upload__remove"
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={removeFile}
                  disabled={uploading}
                  aria-label={`Quitar ${file.name}`}
                >
                  <Icon name="close" size={18} />
                </Button>
              </div>
            ) : null}

            {error ? (
              <p className="portal-inline-alert portal-inline-alert--error" role="alert">
                <Icon name="alert" size={17} /> {error}
              </p>
            ) : null}
            {done ? (
              <div className="portal-inline-alert portal-inline-alert--success" role="status">
                <Icon name="check" size={17} />
                <span>{done}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => inputRef.current?.click()}
                >
                  Cargar otro
                </Button>
              </div>
            ) : null}

            <div className="portal-page__actions portal-upload__actions">
              <Button type="submit" loading={uploading} disabled={!file}>
                Subir documento
              </Button>
              {file && !uploading ? (
                <Button type="button" variant="ghost" size="row" onClick={removeFile}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>

          <aside className="portal-upload-help" aria-labelledby="upload-help-title">
            <span className="portal-upload-help__icon" aria-hidden="true">
              <Icon name="shield" size={21} />
            </span>
            <h2 id="upload-help-title">Carga protegida</h2>
            <p>
              Al completar la carga, el documento se valida antes de quedar disponible para el
              estudio.
            </p>
            <ol>
              <li>
                <span>1</span> Elegí un archivo
              </li>
              <li>
                <span>2</span> Confirmá la carga
              </li>
              <li>
                <span>3</span> Nosotros lo validamos
              </li>
            </ol>
            {requestedBy ? (
              <Link className="portal-text-link" to="/portal/pendientes">
                Volver a los pedidos
              </Link>
            ) : null}
          </aside>
          </div>
        </>
      )}

      {clientId && capabilities.has("portal.results.read") ? (
        <section className="portal-page__section" aria-labelledby="recent-documents-title">
          <div className="portal-section-bar">
            <div>
              <h2 id="recent-documents-title">Cargas recientes</h2>
              <p>Seguimiento de los últimos archivos enviados a tu estudio.</p>
            </div>
          </div>
          {documents.isLoading ? (
            <PortalLoading label="Cargando tus documentos…" />
          ) : documents.isError ? (
            <EmptyState
              size="compact"
              title="No pudimos cargar tus documentos"
              description="La carga sigue disponible aunque el historial no se muestre ahora."
              action={<PortalRetryButton onRetry={() => void documents.refetch()} />}
            />
          ) : (documents.data ?? []).length === 0 ? (
            <EmptyState
              size="compact"
              title="Todavía no cargaste documentos"
              description="Elegí un archivo arriba para enviarlo al estudio."
            />
          ) : (
            <>
              {documents.data?.[0] ? (
                <div className="portal-last-published">
                  <Icon name="file" size={17} />
                  <span>
                    <strong>Última carga:</strong> {documents.data[0].fileVersions?.[0]?.originalName ?? "Documento sin nombre"} · {formatPortalDate(documents.data[0].createdAt)}
                  </span>
                </div>
              ) : null}
              <Table<Document>
              className="portal-data-table portal-data-table--documents"
              rows={(documents.data ?? []).slice(0, 8)}
              rowKey={(document) => document.id}
              columns={[
                {
                  key: "file",
                  header: "Archivo",
                  render: (document) => (
                    <div className="portal-table-primary">
                      <strong>{document.fileVersions?.[0]?.originalName ?? "Documento sin nombre"}</strong>
                      <span>{document.category ?? "Documentación recibida"}</span>
                    </div>
                  ),
                },
                {
                  key: "date",
                  header: "Enviado",
                  render: (document) => formatPortalDate(document.createdAt),
                },
                {
                  key: "status",
                  header: "Estado",
                  render: (document) => <StatusBadge status={document.status} />,
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (document) =>
                    canPreview(document) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={preview.isPending}
                        disabled={preview.isPending}
                        title="Ver o descargar el archivo enviado"
                        onClick={() => preview.mutate(document.id)}
                      >
                        <Icon name="download" size={15} /> Ver
                      </Button>
                    ) : (
                      <span className="portal-text-muted" title="Se habilita cuando el documento esté validado">
                        En validación
                      </span>
                    ),
                },
              ]}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
