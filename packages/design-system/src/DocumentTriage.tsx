import { useId, type ReactNode } from "react";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import "./DocumentTriage.css";

/** Triage de un documento (C14): cola angosta plegable, visor, datos extraídos y barra de decisión. */
export interface DocumentTriageProps {
  /** Nombre accesible de la cola, por ejemplo «Documentos por revisar». */
  queueLabel: string;
  /** Lista de documentos (vista de cola). Es un contexto angosto, no la superficie de decisión. */
  queue: ReactNode;
  /** Si la cola está desplegada. Plegada, el documento usa todo el ancho. */
  queueOpen: boolean;
  onQueueToggle: () => void;
  /** `DocumentViewer`: el documento con su página y zoom. */
  viewer: ReactNode;
  /** `DocumentFields`: datos extraídos editables con confianza por campo. */
  fields: ReactNode;
  /** `DecisionBar`: decisiones sobre el documento y «Siguiente». */
  decision: ReactNode;
  className?: string;
}

/**
 * Pantalla de triage: un documento por vez. La cola se pliega para dar ancho al documento; los
 * datos extraídos quedan junto al visor y la barra de decisión cierra la tarea.
 */
export function DocumentTriage({
  queueLabel,
  queue,
  queueOpen,
  onQueueToggle,
  viewer,
  fields,
  decision,
  className,
}: DocumentTriageProps) {
  const queueId = useId();
  return (
    <div
      className={className ? `document-triage ${className}` : "document-triage"}
      data-queue-open={queueOpen}
    >
      <div className="document-triage__cola">
        <button
          type="button"
          className="document-triage__plegar"
          aria-expanded={queueOpen}
          aria-controls={queueId}
          onClick={onQueueToggle}
        >
          {queueOpen ? "Ocultar cola" : "Mostrar cola"}
        </button>
        <aside
          id={queueId}
          className="document-triage__queue"
          aria-label={queueLabel}
          hidden={!queueOpen}
        >
          {queue}
        </aside>
      </div>
      <div className="document-triage__trabajo">
        <div className="document-triage__cuerpo">
          {viewer}
          <div className="document-triage__datos">
            {fields}
            <div className="document-triage__decision">{decision}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface DocumentViewerProps {
  /** Nombre del archivo, por ejemplo «Factura C 0001-00000007.pdf». */
  title: string;
  /** Página y zoom ya formateados, por ejemplo «Página 1 de 2» y «100 %». */
  pageLabel?: string;
  zoomLabel?: string;
  /** Vista previa del documento (la pantalla entrega la imagen o el PDF incrustado). */
  children: ReactNode;
}

/** Visor del documento: encabezado con nombre, página y zoom, y el contenido del archivo. */
export function DocumentViewer({ title, pageLabel, zoomLabel, children }: DocumentViewerProps) {
  const tituloId = useId();
  return (
    <section className="document-viewer" aria-labelledby={tituloId}>
      <header className="document-viewer__cabecera">
        <h3 id={tituloId} className="document-viewer__titulo">
          {title}
        </h3>
        {pageLabel || zoomLabel ? (
          <p className="document-viewer__posicion">
            {[pageLabel, zoomLabel].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </header>
      <div className="document-viewer__hoja">{children}</div>
    </section>
  );
}

/** Confianza de la extracción por campo: se lee en texto, no solo en color. */
export type FieldConfidence = "alta" | "media" | "baja";

export interface DocumentField {
  id: string;
  label: string;
  value: string;
  confidence: FieldConfidence;
}

export interface DocumentFieldsProps {
  fields: readonly DocumentField[];
  /** Recibe el campo y su nuevo valor. La pantalla guarda o valida. */
  onChange: (id: string, value: string) => void;
  /** Nombre accesible de la sección. */
  label?: string;
}

const TEXTO_CONFIANZA: Record<FieldConfidence, string> = {
  alta: "Confianza alta",
  media: "Confianza media: revisá el dato",
  baja: "Confianza baja: revisá el dato antes de aprobar",
};

/** Datos extraídos editables. Cada campo informa su confianza junto al valor. */
export function DocumentFields({
  fields,
  onChange,
  label = "Datos extraídos",
}: DocumentFieldsProps) {
  return (
    <section className="document-fields" aria-label={label}>
      {fields.map((campo) => (
        <div
          key={campo.id}
          className={`document-fields__campo document-fields__campo--${campo.confidence}`}
          data-confidence={campo.confidence}
        >
          <Field
            id={`doc-field-${campo.id}`}
            label={campo.label}
            value={campo.value}
            hint={TEXTO_CONFIANZA[campo.confidence]}
            onChange={(evento) => onChange(campo.id, evento.target.value)}
          />
        </div>
      ))}
    </section>
  );
}

export interface DecisionBarProps {
  /** Nombre accesible de la barra. */
  label: string;
  /** Acciones secundarias: Corregir, Rechazar, Mover a… (la pantalla arma el selector). */
  secondary?: ReactNode;
  /** Acción principal de la decisión. Como máximo una. */
  primary?: ReactNode;
  /** Motivo visible cuando la acción principal está deshabilitada (P4). */
  hint?: string | null;
  /** Avance al siguiente documento. */
  next?: ReactNode;
}

/**
 * Barra de decisión del documento: acciones secundarias a la izquierda; a la derecha, la acción
 * principal con su motivo y el avance «Siguiente».
 */
export function DecisionBar({ label, secondary, primary, hint, next }: DecisionBarProps) {
  return (
    <div className="decision-bar" role="group" aria-label={label}>
      <div className="decision-bar__secundarias">{secondary}</div>
      <div className="decision-bar__principal">
        {hint ? (
          <p className="decision-bar__motivo" role="note">
            {hint}
          </p>
        ) : null}
        {primary}
        {next}
      </div>
    </div>
  );
}

/** Botón de avance estándar para la barra: «Siguiente». */
export function NextDocumentButton({
  onNext,
  disabled = false,
}: {
  onNext: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="secondary" size="row" onClick={onNext} disabled={disabled}>
      Siguiente
    </Button>
  );
}
