import { useImperativeHandle, useState, type Ref } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Notice, useNotify, SearchSelect } from "@contable/design-system";
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
  /** Ítem que se preselecciona al abrir la carga desde un pedido (o el único pendiente). */
  itemInicial?: string;
  /** Si se indica, la carga sin pedidos pendientes ofrece «Crear pedido» en vez de «Ir a pedidos». */
  onCrearPedido?: () => void;
  /** Si se indica, cada subida muestra un aviso con el enlace «Ver en Bandeja». */
  onVerEnBandeja?: () => void;
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
  itemInicial,
  onCrearPedido,
  onVerEnBandeja,
}: CargarDocumentoProps) {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const [uploadRequestItemId, setUploadRequestItemId] = useState(itemInicial ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bookFileSelected, setBookFileSelected] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [subidaRecibida, setSubidaRecibida] = useState(false);

  useImperativeHandle(ref, () => ({ limpiarError: () => setUploadError(null) }), []);

  const chooseFile = (selected: File | null) => {
    setSubidaRecibida(false);
    const extension = selected?.name.toLocaleLowerCase("es-AR").split(".").pop();
    if (selected && ["xlsx", "xls", "csv", "txt"].includes(extension ?? "")) {
      setBookFileSelected(true);
      setUploadError(null);
      setFile(null);
      return;
    }
    setBookFileSelected(false);
    if (selected && extension === "pdf" && selected.size > 25 * 1024 * 1024) {
      setFile(null);
      setUploadError(
        `Este PDF pesa ${fileSize(selected.size)} y el máximo es 25 MB. Si es un libro de ARCA, bajalo en Excel e importalo en el Legajo.`,
      );
      return;
    }
    const error = validateFile(selected);
    setUploadError(error);
    setFile(error ? null : selected);
  };

  const subirArchivo = async (archivo: File, requestItemId: string) => {
    const session = await api.post<UploadSession>(`${base}/document-upload-sessions`, {
      expectedMime: archivo.type || undefined,
      requestItemId,
    });
    await uploadToSignedUrl(session.presignedUrl, archivo);
    const digest = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return api.post<UploadComplete>(
      `${base}/document-upload-sessions/${session.sessionId}/complete`,
      {
        originalName: archivo.name,
        mimeType: archivo.type || "application/octet-stream",
        sizeBytes: archivo.size,
        sha256,
        objectKey: session.objectKey,
      },
    );
  };

  // Con permiso para pedir documentación, subir sin elegir ítem crea un pedido interno con el nombre
  // del archivo, lo envía y lo cierra al subir (D7). Sin ese permiso se exige elegir un ítem pendiente.
  const puedeSinPedido = capabilities.has("request.manage");

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !base) throw new Error("Falta seleccionar un archivo");
      if (!uploadRequestItemId && !puedeSinPedido) {
        throw new Error("Elegí el pedido al que corresponde el archivo");
      }
      let requestItemId = uploadRequestItemId;
      let autoRequestId: string | null = null;
      if (!requestItemId) {
        const titulo = file.name.slice(0, 200);
        const pedido = await api.post<DocumentRequest>(`${base}/document-requests`, {
          title: titulo,
          items: [{ description: file.name.slice(0, 500), required: true }],
        });
        const item = pedido.items[0];
        if (!item) throw new Error("No se pudo crear el pedido interno.");
        await api.post(`${base}/document-requests/${pedido.id}/send`);
        autoRequestId = pedido.id;
        requestItemId = item.id;
      }
      let subido: UploadComplete;
      try {
        subido = await subirArchivo(file, requestItemId);
      } catch (error) {
        // Si la subida falla, el pedido interno recién creado no queda huérfano.
        if (autoRequestId) {
          await api
            .post(`${base}/document-requests/${autoRequestId}/cancel`)
            .catch(() => undefined);
        }
        throw error;
      }
      if (autoRequestId) {
        // El estudio no se pide a sí mismo: el ítem se acepta al subir y el pedido queda completado.
        await api
          .post(`${base}/document-requests/${autoRequestId}/items/${requestItemId}/accept`)
          .catch(() => undefined);
      }
      return subido;
    },
    onSuccess: (document) => {
      notify.success("Documento recibido. Ya ingresó al circuito de validación y procesamiento.");
      setFile(null);
      // El ítem recibido deja de estar pendiente: el selector vuelve a vacío para el próximo archivo.
      setUploadRequestItemId("");
      setSubidaRecibida(true);
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
        setBookFileSelected(false);
        setUploadError(null);
        setSubidaRecibida(false);
      }}
      title="Subir documento"
      description="El archivo pasa por validación, antivirus y extracción antes de estar disponible."
      size="wide"
      initialFocus="close"
    >
      <p className="secure-note upload-panel__secure-note">Carga segura</p>
      {subidaRecibida && onVerEnBandeja ? (
        <Notice
          tone="success"
          action={
            <Button size="sm" variant="secondary" onClick={onVerEnBandeja}>
              Ver en Bandeja
            </Button>
          }
        >
          Documento recibido. Podés cargar otro archivo o revisarlo en la Bandeja.
        </Notice>
      ) : null}
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
      ) : pendingRequestItems.length === 0 && !puedeSinPedido ? (
        <EmptyState
          size="compact"
          title={
            subidaRecibida ? "No quedan ítems pendientes" : "Primero creá un pedido documental"
          }
          description={
            subidaRecibida
              ? "Cada carga queda vinculada a un ítem solicitado. Creá otro pedido para cargar más documentos."
              : "Cada carga queda vinculada a un ítem solicitado para preservar la trazabilidad."
          }
          action={
            capabilities.has("request.manage") ? (
              onCrearPedido ? (
                <Button size="sm" onClick={onCrearPedido}>
                  Crear pedido
                </Button>
              ) : (
                <Button size="sm" onClick={() => navigate("/trabajo")}>
                  Ir a pedidos
                </Button>
              )
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
          {pendingRequestItems.length > 0 ? (
            <div className="ds-field">
              <span className="ds-field__label">Corresponde a</span>
              <SearchSelect
                id="upload-request-item"
                label="Corresponde a"
                hideLabel
                value={uploadRequestItemId}
                onChange={(value) => setUploadRequestItemId(value)}
                required={!puedeSinPedido}
                placeholder={
                  puedeSinPedido
                    ? "Sin pedido: se crea uno con el nombre del archivo"
                    : "Elegí el ítem solicitado"
                }
                options={pendingRequestItems.map((item) => ({
                  value: item.id,
                  label: `${item.requestTitle} · ${item.description}`,
                }))}
              />
            </div>
          ) : null}
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
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.txt,application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <span>
              <strong>{file ? file.name : "Arrastrá un archivo o elegilo desde tu equipo"}</strong>
              <small>
                {file
                  ? fileSize(file.size)
                  : "PDF o foto: los lee la IA · Excel, CSV o TXT de ARCA y la DGR: van al Legajo"}
              </small>
            </span>
            <span className="upload-dropzone__action">Elegir archivo</span>
          </label>
          {bookFileSelected ? (
            <div role="status">
              <p>Elegí el archivo de nuevo en Importar libro.</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate("/expediente-mensual?etapa=fuentes")}
              >
                Ir a Importar en el Legajo
              </Button>
            </div>
          ) : null}
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
              disabled={!file || (!uploadRequestItemId && !puedeSinPedido)}
            >
              Subir y procesar
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onClose();
                setFile(null);
                setBookFileSelected(false);
                setUploadError(null);
                setSubidaRecibida(false);
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
