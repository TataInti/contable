export function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

/** Una sola nota cuando quien preparó el legajo también lo revisó o lo finalizó. */
export function selfReviewNote(wp: {
  preparedByUserId?: string | null;
  reviewedByUserId?: string | null;
  finalizedByUserId?: string | null;
}): string | null {
  if (!wp.preparedByUserId) return null;
  const reviewed = wp.reviewedByUserId === wp.preparedByUserId;
  const finalized = wp.finalizedByUserId === wp.preparedByUserId;
  if (reviewed && finalized) return "Legajo revisado y finalizado por la misma persona que lo preparó.";
  if (reviewed) return "Legajo revisado por la misma persona que lo preparó.";
  if (finalized) return "Legajo finalizado por la misma persona que lo preparó.";
  return null;
}

export function formatDate(value: string | null): string {
  if (!value) return "Sin vencimiento";
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
