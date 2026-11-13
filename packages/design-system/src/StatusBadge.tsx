export type StatusTone = "ok" | "warn" | "danger" | "info" | "muted";
export type StatusBadgeVariant = "plain" | "pill";

export interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
  label?: string;
  variant?: StatusBadgeVariant;
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
  CONFIGURED: { label: "Configurada", tone: "ok" },
  EXTRACTED: { label: "Extraído", tone: "ok" },
  FILED: { label: "Presentado", tone: "ok" },
  PAID: { label: "Pagado", tone: "ok" },
  POSTED: { label: "Contabilizado", tone: "ok" },
  PUBLISHED: { label: "Publicado", tone: "ok" },
  READY: { label: "Listo", tone: "ok" },
  RESOLVED: { label: "Resuelto", tone: "ok" },
  REVIEWED: { label: "Revisado", tone: "ok" },
  SUCCEEDED: { label: "Completado", tone: "ok" },
  COMMITTED: { label: "Incorporado", tone: "ok" },
  DONE: { label: "Hecho", tone: "ok" },
  VALID: { label: "Válido", tone: "ok" },
  VALIDATED: { label: "Validado", tone: "ok" },
  VERIFIED: { label: "Verificado", tone: "ok" },

  CHANGES_REQUESTED: { label: "Cambios solicitados", tone: "warn" },
  CLOSING: { label: "En cierre", tone: "warn" },
  CONFLICT: { label: "Con conflicto", tone: "warn" },
  CORRECTED: { label: "Corregido", tone: "warn" },
  INVITED: { label: "Invitación pendiente", tone: "warn" },
  MISSING: { label: "Faltante", tone: "warn" },
  NEEDS_REVIEW: { label: "Requiere revisión", tone: "warn" },
  ONBOARDING: { label: "En configuración", tone: "warn" },
  PARTIALLY_PAID: { label: "Pago parcial", tone: "warn" },
  PENDING: { label: "Pendiente", tone: "warn" },
  QUEUED: { label: "En cola", tone: "warn" },
  RETRYING: { label: "Reintentando", tone: "warn" },
  SOFT_CLOSED: { label: "Cierre provisorio", tone: "warn" },
  VALIDATING: { label: "Validando", tone: "warn" },
  WAITING_INPUTS: { label: "Esperando datos", tone: "warn" },
  WAITING_CLIENT: { label: "Esperando al cliente", tone: "warn" },
  WARNING: { label: "Aviso", tone: "warn" },
  COLLECTING_INPUTS: { label: "Reuniendo datos", tone: "warn" },
  DUPLICATE: { label: "Duplicado", tone: "warn" },
  PENDING_REVIEW: { label: "Pendiente de revisión", tone: "warn" },
  PENDING_VERIFICATION: { label: "Pendiente de verificación", tone: "warn" },

  BLOCKING: { label: "Bloqueante", tone: "danger" },
  DEAD_LETTER: { label: "Requiere intervención", tone: "danger" },
  ERROR: { label: "Con error", tone: "danger" },
  EXPIRED: { label: "Vencido", tone: "danger" },
  EXTRACTION_FAILED: { label: "Falló la extracción", tone: "danger" },
  FAILED: { label: "Fallido", tone: "danger" },
  INFECTED: { label: "Amenaza detectada", tone: "danger" },
  OVERDUE: { label: "Vencido", tone: "danger" },
  REJECTED: { label: "Rechazado", tone: "danger" },
  REVOKED: { label: "Revocado", tone: "danger" },
  SUSPENDED: { label: "Suspendido", tone: "danger" },
  WAIVED: { label: "Eximido", tone: "muted" },

  CALCULATED: { label: "Calculado", tone: "info" },
  CALCULATING: { label: "Calculando", tone: "info" },
  GENERATED: { label: "Generado", tone: "info" },
  INFO: { label: "Informativo", tone: "info" },
  IN_PROGRESS: { label: "En proceso", tone: "info" },
  IN_REVIEW: { label: "En revisión", tone: "info" },
  OPEN: { label: "Abierto", tone: "info" },
  PROCESSING: { label: "Procesando", tone: "info" },
  READY_FOR_REVIEW: { label: "Listo para revisar", tone: "info" },
  READY_TO_CALCULATE: { label: "Listo para calcular", tone: "info" },
  READY_TO_FILE: { label: "Lista para presentar", tone: "info" },
  RUNNING: { label: "En proceso", tone: "info" },
  SENT: { label: "Enviado", tone: "info" },
  UPLOADED: { label: "Subido", tone: "info" },

  ARCHIVED: { label: "Archivado", tone: "muted" },
  CANCELED: { label: "Cancelado", tone: "muted" },
  CANCELLED: { label: "Cancelado", tone: "muted" },
  CLOSED: { label: "Cerrado", tone: "muted" },
  DISABLED: { label: "Deshabilitado", tone: "muted" },
  DRAFT: { label: "Borrador", tone: "muted" },
  FINALIZED: { label: "Finalizado", tone: "muted" },
  HARD_CLOSED: { label: "Período cerrado", tone: "muted" },
  INACTIVE: { label: "Inactivo", tone: "muted" },
  NOT_APPLICABLE: { label: "No aplica", tone: "muted" },
  REVERSED: { label: "Revertido", tone: "muted" },
  RETIRED: { label: "Retirado", tone: "muted" },
  SKIPPED: { label: "Omitido", tone: "muted" },
  VOIDED: { label: "Anulado", tone: "muted" },
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

export function StatusBadge({
  status,
  className,
  label: labelOverride,
  variant = "plain",
}: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const { label: configuredLabel, tone } = getStatusBadgeMeta(normalized);
  const label = labelOverride ?? configuredLabel;
  const classes = [
    "status-badge",
    `status-badge--${tone}`,
    "status-badge--with-dot",
    `status-badge--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} data-status={normalized || undefined}>
      <span className="status-badge__dot" aria-hidden="true" />
      <span className="status-badge__label">{label}</span>
    </span>
  );
}
