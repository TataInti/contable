import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@contable/design-system";
import { api, type Document, type DocumentRequest } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import {
  belongsToDocumentQueue,
  coincideConBusqueda,
  ordenarPorIngresoDescendente,
  type DocumentQueueFilter,
} from "./bandeja/colaDeDocumentos";
import { DensePage, useDensity } from "../ui/Dense";
import "./study.css";
import { CabeceraBandeja, type VistaBandeja } from "./bandeja/CabeceraBandeja";
import { ListaDocumentos } from "./bandeja/ListaDocumentos";
import { CargarDocumento, type CargarDocumentoHandle } from "./bandeja/CargarDocumento";
import { DetalleDocumento } from "./bandeja/DetalleDocumento";

export function StudyBandeja() {
  const [density] = useDensity();
  const { firmId, clientId, capabilities } = useClientContext();
  const [elegidoId, setSelectedId] = useState<string | null>(null);
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

  const rows = documents.data ?? [];
  // Más recientes primero (7b-12): la pantalla ordena por fecha de ingreso y no depende del orden de la API.
  const documentosVisibles = ordenarPorIngresoDescendente(rows).filter(
    (document) => belongsToDocumentQueue(document, documentFilter) && coincideConBusqueda(document, documentSearch),
  );
  // 07-3: sin elección, el panel abre una vez el primer documento «Para revisar» en vez de quedar vacío.
  const primeroParaRevisar = documentosVisibles.find((document) => belongsToDocumentQueue(document, "NEEDS_REVIEW"))?.id;
  const abiertoAutomaticamente = useRef(false);
  useEffect(() => {
    if (abiertoAutomaticamente.current || !primeroParaRevisar) return;
    abiertoAutomaticamente.current = true;
    setSelectedId((actual) => actual ?? primeroParaRevisar);
  }, [primeroParaRevisar]);
  const selectedId = elegidoId;
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
    { id: "REVIEWED", label: "Aprobado", value: cifraDeCola("REVIEWED") },
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
            <DetalleDocumento rows={rows} selectedId={selectedId} setSelectedId={setSelectedId} />
          </div>
        </>
      )}
    </DensePage>
  );
}
