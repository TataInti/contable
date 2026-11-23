import { useId, useState, type FormEvent } from "react";
import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";
import "./ObjectActivity.css";

/** Entrada de la actividad de un objeto: un cambio registrado o un comentario de una persona. */
export interface ObjectActivityEntry {
  id: string;
  kind: "historial" | "comentario";
  /** Fecha y hora ya formateadas por la pantalla, por ejemplo «21/11/2026 10:42». */
  at: string;
  /** Autor del comentario. Los registros de historial no lo llevan. */
  author?: string;
  text: string;
}

/** Texto del acceso desde la barra: «Comentarios · N». */
export function comentariosLabel(count: number): string {
  return `Comentarios · ${count}`;
}

export interface ObjectActivityProps {
  /** Nombre accesible de la región, por ejemplo «Actividad del control» o «Comentarios». */
  label?: string;
  entries: readonly ObjectActivityEntry[];
  /** Si se entrega, se muestra el redactor de comentarios. Recibe el texto sin espacios de los extremos. */
  onSubmitComment?: (text: string) => void;
  /** Mientras la pantalla guarda un comentario, el redactor queda bloqueado (evita envíos duplicados). */
  busy?: boolean;
}

/**
 * Actividad de un objeto (control, comprobante, lote, documento, mes o cliente): historial y
 * comentarios en orden cronológico, con el redactor debajo. Va dentro de su panel o página; no
 * aparece como bloque fijo de una etapa.
 */
export function ObjectActivity({
  label = "Actividad",
  entries,
  onSubmitComment,
  busy = false,
}: ObjectActivityProps) {
  const [borrador, setBorrador] = useState("");
  const campoId = useId();
  const ayudaId = useId();
  const textoListo = borrador.trim().length > 0;

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!onSubmitComment || !textoListo || busy) return;
    onSubmitComment(borrador.trim());
    setBorrador("");
  };

  return (
    <section className="object-activity" aria-label={label}>
      {entries.length === 0 ? (
        <EmptyState
          size="inline"
          kind="no-data"
          title="Sin actividad todavía"
          className="object-activity__vacio"
        />
      ) : (
        <ol className="object-activity__lista" aria-label="Historial y comentarios">
          {entries.map((entrada) => (
            <li
              key={entrada.id}
              className={`object-activity__entrada object-activity__entrada--${entrada.kind}`}
              data-kind={entrada.kind}
            >
              <p className="object-activity__cabecera">
                <span className="object-activity__tipo">
                  {entrada.kind === "comentario" ? "Comentario" : "Historial"}
                </span>
                {entrada.author ? (
                  <span className="object-activity__autor">{entrada.author}</span>
                ) : null}
                <time className="object-activity__hora">{entrada.at}</time>
              </p>
              <p className="object-activity__texto">{entrada.text}</p>
            </li>
          ))}
        </ol>
      )}

      {onSubmitComment ? (
        <form className="object-activity__redactor" onSubmit={enviar}>
          <label className="object-activity__etiqueta" htmlFor={campoId}>
            Escribí un comentario
          </label>
          <textarea
            id={campoId}
            className="object-activity__campo"
            rows={3}
            value={borrador}
            disabled={busy}
            aria-describedby={textoListo ? undefined : ayudaId}
            onChange={(evento) => setBorrador(evento.target.value)}
          />
          <div className="object-activity__acciones">
            {textoListo ? null : (
              <p className="object-activity__ayuda" id={ayudaId}>
                Escribí el texto para comentar.
              </p>
            )}
            <Button
              type="submit"
              variant="secondary"
              size="row"
              disabled={!textoListo || busy}
              loading={busy}
              loadingLabel="Enviando"
            >
              Comentar
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export interface ObjectActivityTriggerProps {
  count: number;
  onOpen: () => void;
}

/** Acceso desde la barra de trabajo a la actividad del mes o del objeto: «Comentarios · N». */
export function ObjectActivityTrigger({ count, onOpen }: ObjectActivityTriggerProps) {
  return (
    <Button type="button" variant="secondary" size="row" onClick={onOpen}>
      {comentariosLabel(count)}
    </Button>
  );
}
