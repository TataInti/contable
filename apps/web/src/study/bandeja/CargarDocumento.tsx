import { useImperativeHandle, useState, type Ref } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, useNotify } from "@contable/design-system";
import { useNavigate } from "react-router-dom";
import { ApiError, api, uploadToSignedUrl, type DocumentRequest } from "../../lib/api";
import { useClientContext } from "../../context/ClientContext";
import { ActionDrawer } from "../../ui/ActionDrawer";
import { fileSize, validateFile } from "./utilidades";

interface UploadSession {
  sessionId: string;
  presignedUrl: string;
  objectKey: string;
}
interface UploadComplete {
  documentId: string;
  status: string;
}

export interface CargarDocumentoHandle {
  /** La cabecera limpia el error de subida al alternar el cajón, como hacía la pantalla. */
  limpiarError: () => void;
}

type PendingRequestItem = DocumentRequest["items"][number] & { requestTitle: string };

interface CargarDocumentoProps {
  ref?: Ref<CargarDocumentoHandle>;
  isOpen: boolean;
  base: string | null;
  capabilities: ReadonlySet<string>;
  pendingRequestItems: PendingRequestItem[];
  requestsLoading: boolean;
  requestsError: boolean;
  onRetryRequests: () => void;
  onClose: () => void;
  onUploaded: (documentId: string) => void;
}

export function CargarDocumento({
  ref,
  isOpen,
  base,
  capabilities,
  pendingRequestItems,
  requestsLoading,
  requestsError,
  onRetryRequests,
  onClose,
  onUploaded,
}: CargarDocumentoProps) {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const [uploadRequestItemId, setUploadRequestItemId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useImperativeHandle(ref, () => ({ limpiarError: () => setUploadError(null) }), []);

  const chooseFile = (selected: File | null) => {
    const error = validateFile(selected);
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
      notify.success("Documento recibido. Ya ingresó al circuito de validación y procesamiento.");
      setFile(null);
      onUploaded(document.documentId);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["document-requests", firmId, clientId] }),
      ]);
    },
    onError: (error) =>
      setUploadError(error instanceof ApiError ? error.message : "No se pudo subir el documento."),
  });

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setFile(null);
        setUploadError(null);
      }}
      title="Nuevo documento"
      description="El archivo pasa por validación, antivirus y extracción antes de estar disponible."
      size="wide"
    >
      <p className="secure-note upload-panel__secure-note">Carga segura</p>
      {requestsLoading ? (
        <div className="query-state query-state--compact" role="status">
          <span className="loading-copy">Buscando pedidos abiertos…</span>
        </div>
      ) : requestsError ? (
        <EmptyState
          size="compact"
          title="No se pudieron cargar los pedidos"
          description="Reintentá antes de asociar un documento a la evidencia solicitada."
          action={
            <Button size="sm" variant="secondary" onClick={() => onRetryRequests()}>
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
              <strong>{file ? file.name : "Arrastrá un archivo o elegilo desde tu equipo"}</strong>
              <small>{file ? fileSize(file.size) : "PDF, JPG, PNG o WebP · máximo 25 MB"}</small>
            </span>
            <span className="upload-dropzone__action">Elegir archivo</span>
          </label>
          {uploadError ? (
            <p className="form-error" role="alert">
              {uploadError}
            </p>
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
                onClose();
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
  );
}
