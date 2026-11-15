// Forma de los datos de Reglas fiscales que devuelve la API (sin lógica).
export type RuleStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "ACTIVE" | "RETIRED";

export interface RuleRow {
  id: string;
  concept: string;
  kindId?: string | null;
  activityId?: string | null;
  categoryCode?: string | null;
  isDefault?: boolean;
  activityCode: string | null;
  jurisdictionId: string | null;
  rate: string | null;
  minAmount: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface RuleVersion {
  id: string;
  version: number;
  status: RuleStatus;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  validFrom: string;
  validTo: string | null;
  engineId?: string | null;
  engineVersion: string;
  rulesHash: string;
  rateRules: RuleRow[];
  dueDateRules: Array<{
    id: string;
    frequency: string | null;
    dueDay: number;
    cuitEnding: string | null;
    validFrom: string;
    validTo: string | null;
  }>;
  sources: Array<{ id: string; title: string; reference: string | null; consultedAt: string }>;
}

export interface RulePack {
  id: string;
  code: string;
  name: string;
  status: RuleStatus;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  regime: {
    id: string;
    name: string;
    code: string;
    calcFamilyId?: string | null;
    isActive: boolean;
    taxType: { name: string; code: string; isActive: boolean };
    jurisdiction: { name: string; code?: string; isActive: boolean };
  };
  versions: RuleVersion[];
}

export interface RulePackDetail extends RulePack {
  regime: RulePack["regime"] & {
    jurisdiction: { id: string; name: string; code: string };
    authority: { id: string; name: string; isActive: boolean };
  };
}

export interface RuleRegimeOption {
  id: string;
  code: string;
  name: string;
  taxType: { name: string };
  jurisdiction: { name: string };
}

export interface Credential {
  id: string;
  registrationNumber: string;
  jurisdiction: { name: string };
}

export interface RuleJurisdictionOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
