import type { ReactNode } from "react";
import { Button } from "@contable/design-system";

interface PortalPageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PortalPageHeader({ eyebrow, title, description, actions }: PortalPageHeaderProps) {
  return (
    <header className="portal-page__header">
      <div className="portal-page__heading">
        {eyebrow ? <p className="portal-page__eyebrow">{eyebrow}</p> : null}
        <h1 className="portal-page__title">{title}</h1>
        <p className="portal-page__subtitle">{description}</p>
      </div>
      {actions ? <div className="portal-page__header-actions">{actions}</div> : null}
    </header>
  );
}

export function PortalLoading({ label }: { label: string }) {
  return (
    <div className="portal-loading" role="status" aria-live="polite">
      <span className="portal-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Acción consistente para los estados recuperables del portal.  Mantiene el
 * siguiente paso junto al error sin convertir cada pantalla en un formulario
 * distinto.
 */
export function PortalRetryButton({
  onRetry,
  label = "Reintentar",
}: {
  onRetry: () => void;
  label?: string;
}) {
  return (
    <Button type="button" variant="secondary" onClick={onRetry}>
      {label}
    </Button>
  );
}

export function formatPortalDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat(
    "es-AR",
    options ?? { day: "2-digit", month: "short", year: "numeric" },
  ).format(date);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

export function formatPortalMoney(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}
