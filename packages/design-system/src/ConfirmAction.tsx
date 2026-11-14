import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.js";
import "./ConfirmAction.css";

export interface ConfirmActionProps {
  /** Controla si el diálogo está abierto. */
  open: boolean;
  title: string;
  description?: string;
  /** Texto del botón de confirmación. Ej: "Dar de baja". */
  confirmLabel: string;
  /** Variante del botón de confirmación según la severidad de la acción. */
  tone?: "default" | "danger";
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación in-app para acciones reversibles/irreversibles.
 * Reemplaza a window.confirm nativo para mantener el tono del producto.
 */
export function ConfirmAction({
  open,
  title,
  description,
  confirmLabel,
  tone = "default",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmActionProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setWasOpen(false);
      return;
    }
    if (wasOpen) return;
    setWasOpen(true);
    const previousActive = document.activeElement as HTMLElement | null;
    const confirmButton = dialogRef.current?.querySelector<HTMLElement>(".confirm-action__actions .ds-button:last-child");
    confirmButton?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousActive?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-action" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-action__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        aria-describedby={description ? "confirm-action-description" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-action__header">
          <h2 id="confirm-action-title" className="confirm-action__title">{title}</h2>
        </header>
        {description ? (
          <div className="confirm-action__content">
            <p id="confirm-action-description" className="confirm-action__description">{description}</p>
          </div>
        ) : null}
        <footer className="confirm-action__actions">
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger-solid" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** Solicitud de confirmación genérica: describe la acción pendiente. */
export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
}

/** Hook mínimo para manejar una confirmación a la vez por página. */
export function useConfirmAction() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    request,
    ask: setRequest,
    close: () => setRequest(null),
  };
}

/**
 * Diálogo ligado a useConfirmAction. Renderiza null cuando no hay solicitud pendiente.
 * Uso: const confirm = useConfirmAction(); ... <ConfirmDialog confirm={confirm} />
 */
export function ConfirmDialog({
  confirm,
  cancelLabel = "Cancelar",
}: {
  confirm: ReturnType<typeof useConfirmAction>;
  cancelLabel?: string;
}) {
  const request = confirm.request;
  return (
    <ConfirmAction
      open={request !== null}
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      confirmLabel={request?.confirmLabel ?? "Confirmar"}
      tone={request?.tone ?? "default"}
      cancelLabel={cancelLabel}
      onConfirm={() => {
        const action = confirm.request;
        confirm.close();
        action?.onConfirm();
      }}
      onCancel={confirm.close}
    />
  );
}
