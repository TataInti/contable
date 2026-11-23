import { Children, createContext, useContext, type ReactNode } from "react";
import { Button } from "./Button.js";
import { StatusBadge } from "./StatusBadge.js";
import "./WorkQueue.css";

/** Densidad de la cola: 48 px en la portada y compacta dentro de un panel (32 px). */
export type WorkQueueDensity = "queue" | "compact";

const DensidadCola = createContext<WorkQueueDensity>("queue");

export interface WorkQueueProps {
  /** Nombre accesible de la lista, por ejemplo «Controles bloqueantes». */
  label: string;
  density?: WorkQueueDensity;
  /** Filas `WorkQueueRow`. Una fila por decisión. */
  children: ReactNode;
  /** Se muestra cuando no hay filas (por ejemplo, un `EmptyState`). Una cola vacía es un resultado, no un error. */
  empty?: ReactNode;
}

/**
 * Cola de trabajo: lista de decisiones pendientes. Muestra lo que requiere decisión, no el
 * historial; lo resuelto vive en la actividad del objeto.
 */
export function WorkQueue({ label, density = "queue", children, empty }: WorkQueueProps) {
  const hayFilas = Children.toArray(children).length > 0;
  return (
    <DensidadCola.Provider value={density}>
      {hayFilas ? (
        <ul
          className={`work-queue work-queue--${density}`}
          aria-label={label}
          data-density={density}
        >
          {children}
        </ul>
      ) : (
        <div className="work-queue work-queue--vacia" data-density={density}>
          {empty ?? null}
        </div>
      )}
    </DensidadCola.Provider>
  );
}

export interface WorkQueueRowProps {
  /** Clave estable de la fila (el id del objeto). */
  id: string;
  /** Objeto sobre el que se decide, por ejemplo «Facturas C» o «Comprobante 0001-00000007». */
  title: string;
  /** La decisión que se pide, en una línea: «Aceptar con motivo o excluir del cálculo». */
  decision: string;
  /** Contexto corto: cliente, período o responsable. */
  subtitle?: string;
  /** Clave de StatusBadge (por ejemplo, `BLOCKING`). */
  status?: string;
  /** Fecha ya formateada, por ejemplo «20/11/2026». */
  date?: string;
  /** Importe ya formateado, por ejemplo «$ 1.250,00». Va alineado a la derecha. */
  amount?: string;
  /** Abre el objeto (panel o página). El nombre accesible incluye el título. */
  onOpen: () => void;
  /** Rótulo contextual de la acción; por defecto «Abrir». */
  actionLabel?: string;
}

/** Fila de cola: una decisión, su estado y su importe o fecha, con la acción de abrir. */
export function WorkQueueRow({
  id,
  title,
  decision,
  subtitle,
  status,
  date,
  amount,
  onOpen,
  actionLabel = "Abrir",
}: WorkQueueRowProps) {
  const density = useContext(DensidadCola);
  return (
    <li className={`work-queue-row work-queue-row--${density}`} data-row-key={id} data-has-date={date ? "true" : "false"}>
      <div className="work-queue-row__principal">
        <p className="work-queue-row__titulo">{title}</p>
        <p className="work-queue-row__decision">{decision}</p>
        {subtitle ? <p className="work-queue-row__contexto">{subtitle}</p> : null}
      </div>
      <div className="work-queue-row__estado">
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {date ? <div className="work-queue-row__fecha">{date}</div> : null}
      <div className="work-queue-row__importe">{amount ?? ""}</div>
      <div className="work-queue-row__accion">
        <Button
          type="button"
          variant="secondary"
          size="row"
          onClick={onOpen}
          aria-label={`${actionLabel} ${title}`}
        >
          {actionLabel}
        </Button>
      </div>
    </li>
  );
}
