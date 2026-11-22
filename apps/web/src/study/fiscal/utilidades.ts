import { formatearRango } from "../../lib/formatoFechas";
import type { useConfirmAction } from "../../ui/ConfirmAction";

export type FiscalStep = "perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones";
export type FiscalTab = "resumen" | "regimenes" | "actividades" | "periodos";

/** Pestaña donde vive cada paso de la configuración. */
export const STEP_TAB: Record<FiscalStep, FiscalTab> = {
  perfil: "resumen",
  inscripcion: "regimenes",
  actividades: "actividades",
  periodos: "periodos",
  obligaciones: "periodos",
};
export type ProfileForm = {
  legalName: string;
  cuit: string;
  fiscalAddress: string;
  /** Vacío = «Elegí…» (sin propuesta): el perfil no se guarda hasta elegirlo. */
  personType: "FISICA" | "JURIDICA" | "";
  nationalCondition: keyof typeof CONDITION_LABELS | "";
  validFrom: string;
};

export interface TaxRegime { id: string; code: string; name: string; isActive: boolean }
export interface EconomicActivity { id: string; code: string; name: string; isActive: boolean; jurisdictionId?: string }
export interface TaxType { id: string; code: string; name: string; isActive: boolean }
export interface TaxpayerProfileVersion {
  id: string;
  version: number;
  validFrom?: string;
  legalName: string;
  cuit: string;
  personType: "FISICA" | "JURIDICA";
  nationalCondition: keyof typeof CONDITION_LABELS;
  fiscalAddress: string | null;
  status: "DRAFT" | "IN_REVIEW" | "ACTIVE" | "SUPERSEDED";
}
export interface TaxPeriod {
  id: string;
  taxTypeId: string;
  startDate: string;
  endDate: string;
  label: string | null;
  taxType: { id: string; code: string; name: string; isActive: boolean };
}
export interface TaxObligation {
  id: string;
  status: string;
  dueDate: string | null;
  regime: { id: string; code: string; name: string; isActive: boolean; taxType: { name: string; isActive: boolean }; jurisdiction: { name: string; isActive: boolean } };
  period: { id: string; label: string | null; startDate: string; endDate: string };
}
export interface TaxRegistration {
  id: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  registrationNumber: string | null;
  regime: { id: string; code: string; name: string; isActive: boolean; taxType: { id: string; name: string; isActive: boolean }; jurisdiction: { name: string; isActive: boolean }; jurisdictionId?: string };
}
export interface ClientActivityLink {
  id: string;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
  /** Cambio de actividad registrado (brief 4L): rige desde validFrom. Sin cambio, la actividad vale desde siempre. */
  isChange?: boolean;
  changeReason?: string | null;
  activity: { id?: string; code: string; name: string; isActive: boolean; jurisdictionId?: string; jurisdiction: { name: string; isActive: boolean } };
}

export const today = new Date().toISOString().slice(0, 10);
/** Mes anterior al actual (AAAA-MM): es el que se liquida normalmente. */
export function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}
export const CONDITION_LABELS = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No Responsable",
} as const;

/** Etiqueta del período sin repetir el impuesto, que la tabla ya muestra en su columna. */
export function periodName(period: TaxPeriod) {
  const label = periodDisplayLabel(period);
  for (const prefix of [period.taxType.code, period.taxType.name]) {
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[·:—–-]\\s*`, "i");
    if (pattern.test(label)) return label.replace(pattern, "");
  }
  return label;
}

export function periodDisplayLabel(period: Pick<TaxPeriod, "label" | "startDate" | "endDate">) {
  const range = formatearRango(period.startDate, period.endDate);
  return period.label && !/\d{6,}/.test(period.label) ? period.label : range;
}

export const FISCAL_STEPS: Array<{ key: FiscalStep; label: string }> = [
  { key: "perfil", label: "Perfil fiscal" },
  { key: "inscripcion", label: "Inscripción" },
  { key: "actividades", label: "Actividades" },
  { key: "periodos", label: "Períodos" },
  { key: "obligaciones", label: "Obligaciones" },
];

export type ConfirmApi = ReturnType<typeof useConfirmAction>;
export type Mutacion = { isPending: boolean; error: Error | null; mutate: () => void };
export type MutacionConValor = { isPending: boolean; error: Error | null; mutate: (valor: string) => void };
export type PeriodoForm = { taxTypeId: string; startDate: string; endDate: string; label: string };
export type ObligacionForm = { regimeId: string; periodId: string; dueDate: string };
