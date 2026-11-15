import { ApiError } from "../../lib/api";
import { formatearRango } from "../../lib/formatoFechas";
import type { ActivityForm, JurisdictionForm, JurisdictionOption, TaxTypeForm } from "./tipos";

const today = new Date().toISOString().slice(0, 10);

export const emptyActivityForm: ActivityForm = {
  code: "",
  name: "",
  jurisdictionId: "",
  source: "",
  validFrom: today,
  validTo: "",
};

export const emptyJurisdictionForm: JurisdictionForm = {
  code: "",
  name: "",
  kind: "NATIONAL",
  parentId: "",
};

export const emptyTaxTypeForm: TaxTypeForm = { code: "", name: "", defaultFamilyId: "" };

export function validityLabel(validFrom: string, validTo: string | null) {
  return formatearRango(validFrom, validTo);
}

export const jurisdictionKindLabel: Record<JurisdictionOption["kind"], string> = {
  NATIONAL: "Nación",
  PROVINCIAL: "Provincia",
  MUNICIPAL: "Municipio",
};

export function isOwnedUiRecord(
  row: { origin?: string; createdByFirmId?: string | null },
  firmId: string,
): boolean {
  return row.origin === "UI" && row.createdByFirmId === firmId;
}

export function apiFieldIssue(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const details = error.details?.details;
  if (!Array.isArray(details)) return undefined;
  const issue = details.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const path = (candidate as { path?: unknown }).path;
    return Array.isArray(path) && path.some((part) => part === field);
  }) as { message?: unknown } | undefined;
  return typeof issue?.message === "string" ? issue.message : undefined;
}

const CATALOG_CODE_CONFLICT = "CATALOG_CODE_CONFLICT";

export function codeConflict(error: unknown): string | undefined {
  return error instanceof ApiError && error.code === CATALOG_CODE_CONFLICT ? error.message : undefined;
}

export function suggestedCode(current: string, usedCodes: string[], maxLength = 40): string {
  const normalized = new Set(usedCodes.map((code) => code.toLocaleUpperCase("es-AR")));
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${current.slice(0, maxLength - tail.length)}${tail}`;
    if (!normalized.has(candidate.toLocaleUpperCase("es-AR"))) return candidate;
  }
  return current.slice(0, maxLength);
}

export function selectionOptions<T extends { id: string; isActive: boolean }>(rows: T[], selectedId?: string) {
  const activeRows = rows.filter((row) => row.isActive);
  const selectedHidden = rows.find((row) => row.id === selectedId && !row.isActive);
  return selectedHidden ? [...activeRows, selectedHidden] : activeRows;
}
