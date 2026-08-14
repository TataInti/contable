import { useRef, useState } from "react";
import { Button, EmptyState } from "@contable/design-system";
import { api, ApiError, uploadToSignedUrl } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { formatFileSize, PortalPageHeader } from "./PortalUI";
import "./portal.css";

interface UploadSession {
  sessionId: string;
  presignedUrl: string;
  objectKey: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function PortalUpload() {
  const { clientId, capabilities } = useClientContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // G0-05: READONLY no puede subir documentos (PLAN §4.2).
  if (!capabilities.has("document.upload")) {
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
        { expectedMime: file.type || undefined },
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
      setDone("Documento subido correctamente. Ya lo estamos validando.");
      setFile(null);
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
        <div className="portal-upload-layout">
          <form className="portal-upload" onSubmit={onSubmit}>
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

            {file ? (
              <div className="portal-upload__file" aria-live="polite">
                <span className="portal-upload__file-icon" aria-hidden="true">
                  <Icon name="file" size={21} />
                </span>
                <span className="portal-upload__file-copy">
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)} · Listo para subir</small>
                </span>
                <button
                  className="portal-upload__remove"
                  type="button"
                  onClick={removeFile}
                  disabled={uploading}
                  aria-label={`Quitar ${file.name}`}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="portal-inline-alert portal-inline-alert--error" role="alert">
                <Icon name="alert" size={17} /> {error}
              </p>
            ) : null}
            {done ? (
              <p className="portal-inline-alert portal-inline-alert--success" role="status">
                <Icon name="check" size={17} /> {done}
              </p>
            ) : null}

            <div className="portal-page__actions portal-upload__actions">
              <Button type="submit" loading={uploading} disabled={!file}>
                Subir documento
              </Button>
              {file && !uploading ? (
                <button className="portal-upload__cancel" type="button" onClick={removeFile}>
                  Cancelar
                </button>
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
          </aside>
        </div>
      )}
    </div>
  );
}
