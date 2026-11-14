import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";
import "./ActionDrawer.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  size?: "default" | "wide";
  initialFocus?: "content" | "close";
}

export function ActionDrawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "Cerrar panel",
  size = "default",
  initialFocus = "content",
}: ActionDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const preferredFocus =
        initialFocus === "close"
          ? panelRef.current?.querySelector<HTMLElement>(".action-drawer__close")
          : null;
      const content = panelRef.current?.querySelector<HTMLElement>(".action-drawer__content");
      const firstFocusable = content?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (preferredFocus ?? firstFocusable ?? panelRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isOpen, initialFocus]);

  if (!isOpen) return null;

  return (
    <div className="action-drawer" aria-live="polite">
      <Button
        className="action-drawer__scrim"
        type="button"
        variant="ghost"
        iconOnly
        aria-label={closeLabel}
        onClick={onClose}
      >
        <span aria-hidden="true" />
      </Button>
      <aside
        ref={panelRef}
        className={`action-drawer__panel action-drawer__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="action-drawer__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="action-drawer__close"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
            Cerrar
          </Button>
        </header>
        <div className="action-drawer__content">{children}</div>
        {footer ? <footer className="action-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}
