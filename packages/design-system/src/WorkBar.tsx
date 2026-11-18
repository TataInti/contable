import { useEffect, useRef, type ReactNode } from "react";
import "./WorkBar.css";

export interface WorkBarProps {
  /** Nombre accesible de la región, por ejemplo «Legajo: período, revisión, etapas y acciones». */
  label: string;
  /** Renglón 1, a la izquierda: contexto (desplegables y estado). */
  context: ReactNode;
  /** Renglón 1, a la derecha: la acción de la pantalla. Como máximo una primaria. */
  action?: ReactNode;
  /** Renglón de avisos, a la izquierda: una nota. El renglón aparece solo con nota o motivo. */
  note?: ReactNode;
  /** Renglón de avisos, a la derecha: el motivo de la acción deshabilitada, bajo el botón (P4). */
  reason?: ReactNode;
  /** Renglón 2, a la izquierda: navegación de secciones (pestañas, con contador opcional). */
  sections?: ReactNode;
  /** Renglón 2, a la derecha: acciones de la sección activa. */
  sectionActions?: ReactNode;
  className?: string;
}

const MAX_PRIMARY_ACTIONS = 1;

/** Hay algo que mostrar: no es nulo, indefinido, booleano ni texto vacío. */
function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/**
 * Barra de trabajo (P5): renglón de contexto y acción, renglón de avisos opcional y renglón de
 * secciones opcional. Es genérica: recibe los controles ya resueltos por la pantalla y no tiene
 * lógica de dominio. Se usa dentro de WorkPage.
 */
export function WorkBar({
  label,
  context,
  action,
  note,
  reason,
  sections,
  sectionActions,
  className,
}: WorkBarProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const primarias = ref.current?.querySelectorAll(".ds-button--primary").length ?? 0;
    if (primarias > MAX_PRIMARY_ACTIONS) {
      console.warn(
        `WorkBar «${label}»: hay ${primarias} acciones primarias; como máximo ${MAX_PRIMARY_ACTIONS} por pantalla.`,
      );
    }
  });

  const hayAvisos = hasContent(note) || hasContent(reason);
  const haySecciones = hasContent(sections) || hasContent(sectionActions);

  return (
    <section
      ref={ref}
      className={className ? `work-bar ${className}` : "work-bar"}
      aria-label={label}
    >
      <div className="work-bar__row work-bar__row--contexto" data-renglon="contexto">
        <div className="work-bar__inicio">{context}</div>
        {hasContent(action) ? <div className="work-bar__fin">{action}</div> : null}
      </div>
      {hayAvisos ? (
        <div className="work-bar__avisos" data-renglon="avisos">
          {hasContent(note) ? <div className="work-bar__nota">{note}</div> : null}
          {hasContent(reason) ? <div className="work-bar__motivo">{reason}</div> : null}
        </div>
      ) : null}
      {haySecciones ? (
        <div className="work-bar__row work-bar__row--secciones" data-renglon="secciones">
          {hasContent(sections) ? <div className="work-bar__inicio">{sections}</div> : null}
          {hasContent(sectionActions) ? (
            <div className="work-bar__fin">{sectionActions}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
