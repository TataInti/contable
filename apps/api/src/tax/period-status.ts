/**
 * Estado del período de una obligación (corte 5a, c0b §5.1 y §5.3). Es la única
 * función que dice si un período está en curso, si el legajo finalizado espera la
 * presentación con acuse o la declaración jurada (DJ), o si está Completo.
 *
 * Es pura: recibe hechos ya cargados y no toca la base. Es informativa y no bloquea
 * ninguna acción (D3): registrar un pago, editar un comprobante o calcular la
 * liquidación siguiente siguen permitidos con la DJ pendiente. El Panel de trabajo
 * todavía no la usa; la conecta el corte 5b.
 */

export const PERIOD_STATUS_LABELS = {
  EN_CURSO: "En curso",
  LEGAJO_FINALIZADO_DJ_PENDIENTE: "Legajo finalizado · DJ pendiente",
  COMPLETO: "Completo",
} as const;

/** Lo que falta para estar Completo: el acuse de la presentación y la DJ. */
export type PeriodMissingItem = "ACUSE" | "DJ";

export interface PeriodStatusFacts {
  /** Estado del legajo mensual del período (MonthlyTaxWorkpaper.status), o null si no hay legajo. */
  workpaperStatus: string | null;
  /** Estado de la liquidación vigente del período (la no SUPERSEDED), o null si no hay. */
  settlementStatus: string | null;
  /** Presentación FILED de la liquidación vigente, o null si no hay. */
  filing: { hasAcuse: boolean; hasDeclaration: boolean } | null;
}

export type PeriodStatus =
  | {
      code: "EN_CURSO";
      label: typeof PERIOD_STATUS_LABELS.EN_CURSO;
      missing: [];
      missingText: null;
    }
  | {
      code: "LEGAJO_FINALIZADO_DJ_PENDIENTE";
      label: typeof PERIOD_STATUS_LABELS.LEGAJO_FINALIZADO_DJ_PENDIENTE;
      missing: PeriodMissingItem[];
      missingText: string;
    }
  | {
      code: "COMPLETO";
      label: typeof PERIOD_STATUS_LABELS.COMPLETO;
      missing: [];
      missingText: null;
    };

/**
 * Texto de lo que falta (P1 y P2). Las tres frases son las de c0b §5.1.
 * La liquidación vigente manda: si existe, el período está finalizado cuando ella
 * está FINALIZED; si no hay liquidación vigente, cuenta el legajo. Una rectificativa
 * (liquidación nueva en DRAFT o SUPERSEDED) vuelve a «En curso» hasta que se finaliza
 * y se presenta de nuevo.
 */
export function derivePeriodStatus(facts: PeriodStatusFacts): PeriodStatus {
  const finalizado =
    facts.settlementStatus !== null
      ? facts.settlementStatus === "FINALIZED"
      : facts.workpaperStatus === "FINALIZED";
  if (!finalizado) {
    return {
      code: "EN_CURSO",
      label: PERIOD_STATUS_LABELS.EN_CURSO,
      missing: [],
      missingText: null,
    };
  }

  const missing: PeriodMissingItem[] = [];
  if (!facts.filing?.hasAcuse) missing.push("ACUSE");
  if (faltaDeclaracion(facts.filing)) missing.push("DJ");

  if (missing.length === 0) {
    return {
      code: "COMPLETO",
      label: PERIOD_STATUS_LABELS.COMPLETO,
      missing: [],
      missingText: null,
    };
  }
  return {
    code: "LEGAJO_FINALIZADO_DJ_PENDIENTE",
    label: PERIOD_STATUS_LABELS.LEGAJO_FINALIZADO_DJ_PENDIENTE,
    missing,
    missingText: missingText(missing),
  };
}

/**
 * Regla única de «falta la DJ» (corte 8a): la comparten el estado del período y la caja fiscal.
 * Falta cuando no hay presentación o la presentación no tiene declaración jurada cargada.
 */
export function faltaDeclaracion(filing: PeriodStatusFacts["filing"]): boolean {
  return !filing?.hasDeclaration;
}

function missingText(missing: PeriodMissingItem[]): string {
  if (missing.length === 2) return "Faltan: acuse y declaración jurada";
  return missing[0] === "ACUSE" ? "Falta: presentación con acuse" : "Falta: declaración jurada";
}
