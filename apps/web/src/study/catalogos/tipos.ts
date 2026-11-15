import type { EconomicActivityCodeChange } from "@contable/contracts";
import type { FiscalJurisdiction, FiscalTaxType } from "../../lib/api";

export type JurisdictionOption = FiscalJurisdiction;
export type TaxTypeOption = FiscalTaxType;

export interface TaxAuthorityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  jurisdiction: JurisdictionOption;
}

export interface TaxRegimeRow {
  id: string;
  code: string;
  name: string;
  calcFamilyId?: string | null;
  moduleId?: string | null;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  authority: TaxAuthorityRow;
  jurisdiction: JurisdictionOption;
  taxType: TaxTypeOption;
}

export interface TaxRegimeModuleOption {
  id: string;
  key: string;
  label: string;
  flagCode: string | null;
  isActive: boolean;
}

export interface AuthorityForm {
  code: string;
  name: string;
  jurisdictionId: string;
}

export interface RegimeForm {
  code: string;
  name: string;
  taxTypeId: string;
  calcFamilyId: string;
  moduleId: string;
  jurisdictionId: string;
  authorityId: string;
}

export interface JurisdictionForm {
  code: string;
  name: string;
  kind: JurisdictionOption["kind"];
  parentId: string;
}

export interface TaxTypeForm {
  code: string;
  name: string;
  defaultFamilyId: string;
}

export interface CatalogActivityRow {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  source: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  origin?: "REFERENCE" | "UI";
  createdByFirmId?: string | null;
  activeClientLinks?: number;
  codeChange?: EconomicActivityCodeChange | null;
}

export interface ActivityForm {
  code: string;
  name: string;
  jurisdictionId: string;
  source: string;
  validFrom: string;
  validTo: string;
}

export interface CatalogUsage {
  entityId: string;
  used: boolean;
  count: number;
  places: Array<{ label: string; count: number }>;
}

export type CatalogTab = "jurisdictions" | "taxTypes" | "authorities" | "regimes" | "activities";
export type MasterDrawer = "jurisdiction-create" | "jurisdiction-edit" | "tax-type-create" | "tax-type-edit";
export type CatalogDrawer = "authority-create" | "authority-edit" | "regime-create" | "regime-edit";
