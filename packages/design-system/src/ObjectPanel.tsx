import { useEffect, useRef, type ReactNode } from "react";
import { ActionDrawer, ActionDrawerFooter } from "./ActionDrawer.js";
import "./ObjectPanel.css";

/** Tipos de objeto que abren un panel lateral desde una fila (control, comprobante, lote, documento). */
export type ObjectPanelKind = "control" | "comprobante" | "lote" | "documento";

/** Nombre del parámetro de consulta que hace compartible el panel abierto: `?panel=control-42`. */
export const OBJECT_PANEL_PARAM = "panel";

const OBJECT_PANEL_KINDS: readonly ObjectPanelKind[] = [
  "control",
  "comprobante",
  "lote",
  "documento",
];

/** Valor del parámetro: tipo y id unidos por guion (`control-42`). */
export function objectPanelValue(kind: ObjectPanelKind, id: string): string {
  return `${kind}-${id}`;
}

/** Lee el valor del parámetro; devuelve null si no corresponde a un tipo conocido o no tiene id. */
export function parseObjectPanelValue(
  value: string | null | undefined,
): { kind: ObjectPanelKind; id: string } | null {
  if (!value) return null;
  const kind = OBJECT_PANEL_KINDS.find((candidate) => value.startsWith(`${candidate}-`));
  if (!kind) return null;
  const id = value.slice(kind.length + 1);
  return id ? { kind, id } : null;
}

/**
 * Devuelve la ruta con el panel indicado. Conserva el resto de la consulta y el fragmento.
 * La ruta es relativa a la aplicación: el resultado no incluye origen.
 */
export function withObjectPanel(href: string, kind: ObjectPanelKind, id: string): string {
  const url = new URL(href, "http://contable.local");
  url.searchParams.set(OBJECT_PANEL_PARAM, objectPanelValue(kind, id));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Devuelve la ruta sin el parámetro del panel: al cerrar, la URL vuelve a la de la lista. */
export function withoutObjectPanel(href: string): string {
  const url = new URL(href, "http://contable.local");
  url.searchParams.delete(OBJECT_PANEL_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface ObjectPanelProps {
  /** Tipo del objeto mostrado. Se expone como `data-object-kind` para las pruebas y la app. */
  kind: ObjectPanelKind;
  isOpen: boolean;
  onClose: () => void;
  /** Título del objeto, por ejemplo «Control: Facturas C». */
  title: string;
  description?: string;
  children: ReactNode;
  /** Acción primaria del pie (un botón). Sin ella, el pie no se muestra y el cierre queda en el encabezado. */
  primaryAction?: ReactNode;
  /** Motivo visible mientras la acción primaria está deshabilitada (P4). */
  primaryHint?: string | null;
  cancelLabel?: string;
  /**
   * Elemento que abrió el panel (por ejemplo, la fila de la cola). Al cerrar, recibe el foco.
   * Si no se entrega, se usa el elemento activo al abrir, como en ActionDrawer.
   */
  returnFocusTo?: HTMLElement | null;
}

/**
 * Panel de detalle de un objeto (control, comprobante, lote o documento). Se apoya en ActionDrawer:
 * Escape y «Cerrar» cierran, el foco se contiene y vuelve a `returnFocusTo`, y el pie fijo lleva
 * una sola acción primaria. La URL compartible la arma la pantalla con `withObjectPanel`.
 */
export function ObjectPanel({
  kind,
  isOpen,
  onClose,
  title,
  description,
  children,
  primaryAction,
  primaryHint,
  cancelLabel = "Cancelar",
  returnFocusTo,
}: ObjectPanelProps) {
  const wasOpen = useRef(false);
  const returnRef = useRef<HTMLElement | null | undefined>(returnFocusTo);
  returnRef.current = returnFocusTo;

  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Se ejecuta después de la restauración de ActionDrawer: el origen explícito gana.
    returnRef.current?.focus();
  }, [isOpen]);

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      {...(description ? { description } : {})}
      {...(primaryAction
        ? {
            footer: (
              <ActionDrawerFooter
                primary={primaryAction}
                hint={primaryHint ?? null}
                onCancel={onClose}
                cancelLabel={cancelLabel}
              />
            ),
          }
        : {})}
    >
      <div className="object-panel" data-object-kind={kind}>
        {children}
      </div>
    </ActionDrawer>
  );
}
