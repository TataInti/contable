import { fuentesFaltantes } from "./fuentesFaltantes";
import type { AllocationCoverage, ClassificationCoverage, WorkpaperSource } from "./tipos";

export function calculationDisabledMessage({
  status,
  sources,
  classifications,
  allocations,
  canCalculate,
  isPending,
}: {
  status: string;
  sources: WorkpaperSource[] | undefined;
  classifications: ClassificationCoverage | undefined;
  allocations: AllocationCoverage | undefined;
  canCalculate: boolean;
  isPending: boolean;
}): string {
  if (isPending) return "El cálculo está en curso.";
  if (!canCalculate) return "Tu perfil no tiene permiso para calcular este legajo.";

  const missingSources = fuentesFaltantes(sources ?? []).length > 0;
  const missingClassifications = (classifications?.pending ?? 0) > 0;
  const missingAllocations = (allocations?.pending ?? 0) > 0;
  const reasons = [
    missingSources ? "Faltan fuentes obligatorias revisadas." : null,
    missingClassifications ? "Faltan clasificaciones por completar." : null,
    missingAllocations ? "Faltan retenciones o percepciones por imputar." : null,
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) return reasons.join(" ");
  if (status === "DRAFT") return "Completá y revisá las fuentes obligatorias para iniciar el cálculo.";
  return "Completá y revisá las fuentes, clasificaciones e imputaciones obligatorias.";
}

const CALCULATION_LABELS: Record<string, string> = {
  BASE_PAIS: "Base país",
  BASE_TOTAL: "Base imponible",
  IMPUESTO_POR_JURISDICCION: "Impuesto determinado",
  IMPUESTO_POR_ACTIVIDAD: "Impuesto por actividad",
  IMPUESTO_DETERMINADO: "Impuesto determinado",
  MINIMO_APLICADO: "Mínimo aplicado",
  DEBITO_FISCAL: "Débito fiscal",
  CREDITO_FISCAL: "Crédito fiscal",
  CREDITO_DTO_814: "Crédito Dto. 814",
  RETENCIONES_SUFRIDAS: "Retenciones",
  PERCEPCIONES_SUFRIDAS: "Percepciones",
  SALDO_TECNICO_ANTERIOR: "Saldo técnico anterior",
  SALDO_LIBRE_ANTERIOR: "Saldo libre anterior",
  SALDO_TECNICO_A_INGRESAR: "Saldo técnico determinado",
  CREDITOS_SEGUNDO_PARRAFO: "Créditos 2.º párrafo",
  RETENCIONES: "Retenciones",
  PERCEPCIONES: "Percepciones",
  RECAUDACIONES: "Recaudaciones bancarias",
  OTROS_CREDITOS: "Otros créditos",
  SALDO_ANTERIOR: "Saldo a favor anterior",
  TOTAL_A_INGRESAR: "Total a ingresar",
  SALDO_A_FAVOR: "Saldo a favor",
  SALDO_TECNICO_AFTER: "Saldo técnico a favor",
  SALDO_LIBRE_AFTER: "Saldo libre a favor",
};

export function calculationLabel(concept: string): string | null {
  if (CALCULATION_LABELS[concept]) return CALCULATION_LABELS[concept];
  for (const [prefix, label] of [
    ["SALDO_ANTERIOR_", "Saldo anterior"],
    ["TOTAL_A_INGRESAR_", "A ingresar"],
    ["SALDO_A_FAVOR_", "Saldo a favor"],
  ] as const) {
    if (concept.startsWith(prefix)) {
      return `${label} · ${concept.slice(prefix.length).replaceAll("_", " ")}`;
    }
  }
  return null;
}

export const WORKPAPER_STEPS = [
  {
    title: "Saldos",
    description: "Arrastres, créditos y saldos iniciales antes de calcular.",
  },
  {
    title: "Fuentes",
    description: "Documentación y componentes requeridos para sostener el cálculo.",
  },
  {
    title: "Clasificación",
    description: "Actividades, criterios y configuración que determinan alícuotas.",
  },
  {
    title: "Cálculo",
    description: "Posición fiscal, pagos, presentaciones e intereses del período.",
  },
  {
    title: "Controles",
    description: "Hallazgos, bloqueos y resoluciones antes de cerrar.",
  },
  {
    title: "Cierre",
    description: "Hashes, finalización y arrastre al siguiente período.",
  },
] as const;

export const CLASSIFICATION_ORIGIN_LABELS: Record<string, string> = {
  MANUAL: "Elegida a mano",
  VOUCHER_LINE: "Tomada del archivo importado",
  SUPPLIER_MASTER: "Tomada del proveedor",
  SUPPLIER_PROFILE: "Tomada del proveedor",
  RULE: "Por regla",
  SINGLE_CLIENT_ACTIVITY: "Asignada automáticamente (única actividad)",
  SINGLE_ACTIVITY_PER_LEVEL: "Asignada automáticamente (única actividad del nivel)",
};

export const CONTROL_SEVERITY_LABELS: Record<string, string> = {
  BLOCKING: "Bloquea el cierre",
  WARNING: "Advertencia",
  INFO: "Informativo",
};

export const CONTROL_LABELS: Record<string, string> = {
  SUPERSEDED_OPENING_CREDIT: "Saldos de presentaciones reemplazadas",
  BOOK_RATE_RECONCILIATION: "Diferencias de libro por alícuota",
  PORTAL_IVA_RECONCILIATION: "Conciliación con Portal IVA",
  BANK_CREDIT_RECONCILIATION: "Acreditaciones bancarias vs. facturación",
  CASH_ALLOCATION_RECONCILIATION: "Caja e imputaciones del período",
};

// Qué revisar cuando el control no trae mensaje ni importes.
export const CONTROL_CAUSAS: Record<string, string> = {
  CASH_ALLOCATION_RECONCILIATION: "Hay movimientos de caja o imputaciones fiscales del período sin conciliar.",
};
