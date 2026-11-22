import { useEffect, useRef, useState } from "react";
import { ActionDrawer, Button } from "@contable/design-system";
import { useClientContext } from "../../../context/ClientContext";
import { WorkpaperSourceReviewAction } from "../../WorkpaperSourceReviewAction";
import { formatearFechaHora } from "../../../lib/formatoFechas";
import { WorkpaperActionError } from "../WorkpaperActionError";
import { estadoDeLote, ladoDeLibroIva, LoteConFilasObservadas, type ResultadoImportacionLote } from "../loteFuente";
import { DetalleFilasLote } from "../DetalleFilasLote";
import { avisoDeFuenteEquivocada, FUENTE_DE_TXT_DGR, tipoDeTxtDgrTucuman } from "../txtDgrTucuman";
import type { WorkpaperSource } from "../tipos";
import type { UseMutationResult } from "@tanstack/react-query";
import "./PanelGestionarFuente.css";

const NOMBRES_TIPO_DGR = {
  PERCEPCION: "percepciones sufridas",
  RETENCION: "retenciones sufridas",
  RECAUDACION: "recaudaciones bancarias",
} as const;

type Vista = "archivos" | "errores" | "cargar" | "historial" | "ayuda";

export function PanelGestionarFuente({
  source,
  isOpen,
  onClose,
  onAbrirLibroIva,
  sourceFile,
  setSourceFile,
  sourceUploadMutation,
  sources,
  canEdit,
  currentUserId,
  allowSelfReview,
  canReview,
  canEditSources,
  reviewSourceMutation,
  editReason,
  onCambiarFuente,
}: {
  source: WorkpaperSource | null;
  isOpen: boolean;
  onClose: () => void;
  onAbrirLibroIva: (lado: "SALE" | "PURCHASE") => void;
  sourceFile: File | null;
  setSourceFile: (file: File | null) => void;
  sourceUploadMutation: UseMutationResult<ResultadoImportacionLote, Error, void>;
  sources: WorkpaperSource[];
  canEdit: boolean;
  currentUserId: string | null;
  allowSelfReview: boolean;
  canReview: boolean;
  canEditSources: boolean;
  reviewSourceMutation: UseMutationResult<unknown, Error, string>;
  editReason: string | null;
  onCambiarFuente: (sourceCode: string) => void;
}) {
  const { firmId, clientId } = useClientContext();
  const [vista, setVista] = useState<Vista>("archivos");
  const [reconocimiento, setReconocimiento] = useState("");
  const [avisoFuente, setAvisoFuente] = useState<string | null>(null);
  const [loteId, setLoteId] = useState<string | null>(null);
  const detalleTituloRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setVista("archivos");
    setLoteId(null);
    setSourceFile(null);
    sourceUploadMutation.reset();
  }, [isOpen, source?.code]);

  useEffect(() => {
    if (vista === "errores") detalleTituloRef.current?.focus();
  }, [vista]);

  useEffect(() => {
    const error = sourceUploadMutation.error;
    if (!(error instanceof LoteConFilasObservadas)) return;
    setLoteId(error.batchId);
    setVista("errores");
  }, [sourceUploadMutation.error]);

  useEffect(() => {
    let activo = true;
    async function reconocer() {
      if (!source || !sourceFile) {
        setReconocimiento("");
        setAvisoFuente(null);
        return;
      }
      const tipo = tipoDeTxtDgrTucuman(sourceFile.name);
      if (!tipo) {
        setReconocimiento("");
        setAvisoFuente(null);
        return;
      }
      const destino = sources.find((item) => item.origin === "DGR_RPI_TUC");
      const deOtraFuente = avisoDeFuenteEquivocada(sourceFile.name, source, sources);
      const texto = await sourceFile.text();
      if (!activo) return;
      setReconocimiento(`Es un archivo de ${NOMBRES_TIPO_DGR[tipo]}. ¿Cargarlo en ${destino?.label ?? "Ingresos Brutos Tucumán"}?`);
      setAvisoFuente(deOtraFuente);
      if (texto.length === 0) setAvisoFuente("El archivo está vacío. Elegí un archivo con datos.");
    }
    void reconocer();
    return () => { activo = false; };
  }, [source, sourceFile, sources]);

  if (!source) return null;
  const lado = ladoDeLibroIva(source.code);
  const cargarArchivo = () => {
    if (lado) {
      onClose();
      onAbrirLibroIva(lado);
      return;
    }
    setVista("cargar");
  };
  const aceptarArchivo = (file: File | null) => {
    setSourceFile(file);
    sourceUploadMutation.reset();
  };
  const nombreEstado = source.batches.some((batch) => batch.errorRows > 0)
    ? "Hay archivos con errores. Corregí las filas indicadas y volvé a cargar el archivo para que cuente en el cálculo."
    : source.present
      ? "La fuente está cargada y cuenta para el cálculo."
      : source.required
        ? "Todavía falta cargar un archivo para que esta fuente cuente en el cálculo."
        : "Esta fuente es opcional. Cargá un archivo cuando corresponda.";
  const archivoEquivocado = avisoFuente !== null;
  const tipoReconocido = sourceFile ? tipoDeTxtDgrTucuman(sourceFile.name) : null;
  const fuenteCorrecta = tipoReconocido
    ? sources.find((item) => item.code === FUENTE_DE_TXT_DGR[tipoReconocido])
    : null;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Gestionar fuente"
      description={source.label}
      size="default"
      footer={(
        <>
          <Button variant="text" onClick={() => setVista("historial")}>Historial</Button>
          <Button variant="text" onClick={() => setVista("ayuda")}>Cómo se obtiene este archivo</Button>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </>
      )}
    >
      {vista === "archivos" ? (
        <section aria-label="Archivos">
          <h3>Archivos</h3>
          <p>{nombreEstado}</p>
          {canEdit ? <Button variant="primary" onClick={cargarArchivo}>Cargar archivo</Button> : null}
          {!canEdit && editReason ? <p role="status">{editReason}</p> : null}
          {source.batches.length === 0 ? <p>No hay archivos cargados.</p> : null}
          <ul className="workpaper-source-file-list">
            {source.batches.map((batch) => (
              <li key={batch.id}>
                <strong>{batch.fileName ?? "Archivo sin nombre"}</strong>{" "}
                <span>{estadoDeLote(batch).label ?? (batch.reviewStatus === "REVIEWED" ? "Revisado" : batch.errorRows ? "Con errores" : batch.batchStatus === "VALIDATED" ? "Pendiente de revisión" : "Cargado")}</span>
                {batch.errorRows > 0 ? (
                  <Button variant="text" onClick={() => { setLoteId(batch.importBatchId); setVista("errores"); }}>
                    Ver errores
                  </Button>
                ) : null}
                <WorkpaperSourceReviewAction
                  batch={batch}
                  currentUserId={currentUserId}
                  allowSelfReview={allowSelfReview}
                  canEditSources={canEditSources}
                  canReview={canReview}
                  pending={reviewSourceMutation.isPending}
                  error={reviewSourceMutation.variables === batch.id ? reviewSourceMutation.error : null}
                  onReview={(sourceLinkId) => reviewSourceMutation.mutate(sourceLinkId)}
                />
              </li>
            ))}
          </ul>
          <WorkpaperActionError error={sourceUploadMutation.error} />
          {sourceUploadMutation.data?.avisos.map((aviso) => <p role="status" key={aviso}>{aviso}</p>)}
        </section>
      ) : null}
      {vista === "errores" ? (
        <section aria-label="Errores del archivo">
          <Button variant="text" onClick={() => setVista("archivos")}>← Archivos</Button>
          <h3 ref={detalleTituloRef} tabIndex={-1}>Errores del archivo</h3>
          <WorkpaperActionError error={sourceUploadMutation.error} />
          {firmId && clientId && loteId ? <DetalleFilasLote firmId={firmId} clientId={clientId} batchId={loteId} /> : null}
          {canEdit ? <Button variant="secondary" onClick={cargarArchivo}>Cargar otro archivo</Button> : null}
        </section>
      ) : null}
      {vista === "cargar" ? (
        <section aria-label="Cargar archivo">
          <Button variant="text" onClick={() => setVista("archivos")}>← Archivos</Button>
          <h3>Cargar archivo</h3>
          {lado ? (
            <p>El libro de IVA se importa desde el archivo de ARCA.</p>
          ) : (
            <>
              <label
                className="workpaper-source-file-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); aceptarArchivo(event.dataTransfer.files[0] ?? null); }}
              >
                <span>Elegir archivo</span>
                <input type="file" accept=".csv,.txt,.json,text/csv,text/plain,application/json" onChange={(event) => aceptarArchivo(event.target.files?.[0] ?? null)} />
              </label>
              <p>Arrastrá un archivo hasta acá o elegilo.</p>
              {sourceFile ? <p>{sourceFile.name}</p> : null}
              {reconocimiento ? <p role="status">{reconocimiento}</p> : null}
              {avisoFuente ? <p role="alert">{avisoFuente}</p> : null}
              {archivoEquivocado && fuenteCorrecta ? (
                <Button variant="secondary" onClick={() => onCambiarFuente(fuenteCorrecta.code)}>
                  Cambiar a {fuenteCorrecta.label}
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  variant="primary"
                  disabled={!sourceFile || archivoEquivocado || sourceUploadMutation.isPending}
                  onClick={() => { setVista("archivos"); sourceUploadMutation.mutate(); }}
                >
                  {sourceUploadMutation.isPending ? "Procesando…" : "Importar archivo"}
                </Button>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {vista === "historial" ? (
        <section aria-label="Historial">
          <Button variant="text" onClick={() => setVista("archivos")}>← Archivos</Button>
          <h3>Historial</h3>
          {source.batches.length ? source.batches.map((batch) => <p key={batch.id}>{formatearFechaHora(batch.createdAt)} · {batch.fileName ?? "Archivo sin nombre"} · {batch.errorRows ? "con errores" : batch.reviewStatus === "REVIEWED" ? "revisado" : "cargado"}</p>) : <p>Todavía no hay actividad registrada.</p>}
        </section>
      ) : null}
      {vista === "ayuda" ? (
        <section aria-label="Cómo se obtiene este archivo">
          <Button variant="text" onClick={() => setVista("archivos")}>← Archivos</Button>
          <h3>Cómo se obtiene este archivo</h3>
          {lado ? (
            <p>En ARCA, abrí Mis Comprobantes y elegí el período. Descargá el libro de ventas o compras en Excel.</p>
          ) : (
            <>
              <p>En la DGR de Tucumán, abrí Mis Recaudaciones e ingresá el período.</p>
              <p>Elegí percepciones, retenciones o recaudaciones bancarias y descargá el TXT.</p>
            </>
          )}
        </section>
      ) : null}
    </ActionDrawer>
  );
}
