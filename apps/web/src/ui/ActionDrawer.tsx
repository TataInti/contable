import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@contable/design-system";
import { Icon } from "./Icon";
import "./ActionDrawer.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
  closeLabel?: string;
  size?: "default" | "wide";
}

export function ActionDrawer({
  isOpen,
  onClose,
  title,
  description,
  eyebrow = "Acción",
  children,
  closeLabel = "Cerrar panel",
  size = "default",
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
      const content = panelRef.current?.querySelector<HTMLElement>(".action-drawer__content");
      const firstFocusable = content?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panelRef.current)?.focus();
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
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="action-drawer" aria-live="polite">
      <button
        className="action-drawer__scrim"
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
      />
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
            <p className="action-drawer__eyebrow">{eyebrow}</p>
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
      </aside>
    </div>
  );
}
