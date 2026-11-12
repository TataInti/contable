export type StatusTone = "ok" | "warn" | "danger" | "info" | "muted";

export interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

export interface StatusBadgeMeta {
  label: string;
  tone: StatusTone;
}

const STATUS_BADGE_CONFIG: Readonly<Record<string, StatusBadgeMeta>> = {
  ACTIVE: { label: "Activo", tone: "ok" },
  ACCEPTED: { label: "Aceptado", tone: "ok" },
  APPLIED: { label: "Aplicado", tone: "ok" },
  APPROVED: { label: "Aprobado", tone: "ok" },
  ATTACHED: { label: "Adjuntado", tone: "ok" },
  CLEAN: { label: "Validado", tone: "ok" },
  COMPLETED: { label: "Completado", tone: "ok" },
  EXTRACTED: { label: "Extraído", tone: "ok" },
  FILED: { label: "Presentado", tone: "ok" },
  FINALIZED: { label: "Finalizado", tone: "ok" },
  PAID: { label: "Pagado", tone: "ok" },
  POSTED: { label: "Contabilizado", tone: "ok" },
  PUBLISHED: { label: "Publicado", tone: "ok" },
  READY: { label: "Listo", tone: "ok" },
  REVIEWED: { label: "Revisado", tone: "ok" },
  SUCCEEDED: { label: "Completado", tone: "ok" },

  CLOSING: { label: "En cierre", tone: "warn" },
  CONFLICT: { label: "Con conflicto", tone: "warn" },
  CORRECTED: { label: "Corregido", tone: "warn" },
  INVITED: { label: "Invitación pendiente", tone: "warn" },
  MISSING: { label: "Faltante", tone: "warn" },
  NEEDS_REVIEW: { label: "Requiere revisión", tone: "warn" },
  ONBOARDING: { label: "En configuración", tone: "warn" },
  PENDING: { label: "Pendiente", tone: "warn" },
  QUEUED: { label: "En cola", tone: "warn" },
  RETRYING: { label: "Reintentando", tone: "warn" },
  SOFT_CLOSED: { label: "Cierre provisorio", tone: "warn" },
  VALIDATING: { label: "Validando", tone: "warn" },
  WAITING_CLIENT: { label: "Esperando al cliente", tone: "warn" },

  CANCELED: { label: "Cancelado", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
  DEAD_LETTER: { label: "Requiere intervención", tone: "danger" },
  DISABLED: { label: "Deshabilitado", tone: "danger" },
  EXPIRED: { label: "Vencido", tone: "danger" },
  EXTRACTION_FAILED: { label: "Falló la extracción", tone: "danger" },
  FAILED: { label: "Fallido", tone: "danger" },
  HARD_CLOSED: { label: "Período cerrado", tone: "danger" },
  INFECTED: { label: "Amenaza detectada", tone: "danger" },
  OVERDUE: { label: "Vencido", tone: "danger" },
  REJECTED: { label: "Rechazado", tone: "danger" },
  REVOKED: { label: "Revocado", tone: "danger" },
  SUSPENDED: { label: "Suspendido", tone: "danger" },
  WAIVED: { label: "Eximido", tone: "muted" },

  CALCULATED: { label: "Calculado", tone: "info" },
  GENERATED: { label: "Generado", tone: "info" },
  IN_PROGRESS: { label: "En proceso", tone: "info" },
  IN_REVIEW: { label: "En revisión", tone: "info" },
  OPEN: { label: "Abierto", tone: "info" },
  PROCESSING: { label: "Procesando", tone: "info" },
  READY_FOR_REVIEW: { label: "Listo para revisar", tone: "info" },
  READY_TO_FILE: { label: "Lista para presentar", tone: "info" },
  RUNNING: { label: "En proceso", tone: "info" },
  SENT: { label: "Enviado", tone: "info" },
  UPLOADED: { label: "Subido", tone: "info" },

  ARCHIVED: { label: "Archivado", tone: "muted" },
  CLOSED: { label: "Cerrado", tone: "muted" },
  DRAFT: { label: "Borrador", tone: "muted" },
  INACTIVE: { label: "Inactivo", tone: "muted" },
  NOT_APPLICABLE: { label: "No aplica", tone: "muted" },
  REVERSED: { label: "Revertido", tone: "muted" },
  SUPERSEDED: { label: "Reemplazado", tone: "muted" },
};

function normalizeStatus(status: string | null | undefined): string {
  return (
    status
      ?.trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_") ?? ""
  );
}

function humanizeStatus(status: string): string {
  const readable = status.toLocaleLowerCase("es-AR").replaceAll("_", " ");
  return readable
    ? `${readable.charAt(0).toLocaleUpperCase("es-AR")}${readable.slice(1)}`
    : "Sin estado";
}

export function getStatusBadgeMeta(status: string | null | undefined): StatusBadgeMeta {
  const normalized = normalizeStatus(status);
  return STATUS_BADGE_CONFIG[normalized] ?? { label: humanizeStatus(normalized), tone: "muted" };
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const { label, tone } = getStatusBadgeMeta(normalized);
  const classes = ["status-badge", `status-badge--${tone}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} data-status={normalized || undefined}>
      {label}
    </span>
  );
}
