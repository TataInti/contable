import type { TaxEngineOption } from "@contable/contracts";
import type { RuleRow } from "./tipos";

export const today = new Date().toISOString().slice(0, 10);

export function validateRuleVersionDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "La fecha debe tener formato AAAA-MM-DD y un año entre 1900 y 2100.";
  }
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2100) return "El año debe estar entre 1900 y 2100.";
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Ingresá una fecha válida.";
  }
  return null;
}

export function shortDate(value: string | null) {
  // Las vigencias son fechas calendario guardadas en UTC: se formatean en UTC
  // para no mostrar el día anterior en husos como el de Argentina (UTC-3).
  return value ? new Date(value).toLocaleDateString("es-AR", { timeZone: "UTC" }) : "Sin vencimiento";
}

export function sameRuleRows(draftRows: RuleRow[], savedRows: RuleRow[]): boolean {
  if (draftRows.length !== savedRows.length) return false;
  const savedById = new Map(savedRows.map((row) => [row.id, row]));
  return draftRows.every((row) => {
    const saved = savedById.get(row.id);
    return Boolean(
      saved &&
      row.concept === saved.concept &&
      row.kindId === saved.kindId &&
      row.activityId === saved.activityId &&
      row.categoryCode === saved.categoryCode &&
      Boolean(row.isDefault) === Boolean(saved.isDefault) &&
      row.activityCode === saved.activityCode &&
      row.jurisdictionId === saved.jurisdictionId &&
      row.rate === saved.rate &&
      row.minAmount === saved.minAmount &&
      row.validFrom.slice(0, 10) === saved.validFrom.slice(0, 10) &&
      (row.validTo?.slice(0, 10) ?? null) === (saved.validTo?.slice(0, 10) ?? null),
    );
  });
}

/** Motor de la versión de origen: el que trae la versión o, si no lo trae, el del catálogo con la misma engineVersion. */
export function motorDeOrigen(
  version: { engineId?: string | null; engineVersion: string } | undefined,
  engines: TaxEngineOption[] | undefined,
): string | null {
  if (!version) return null;
  if (version.engineId) return version.engineId;
  const coincidencias =
    engines?.filter((engine) => engine.engineVersion === version.engineVersion) ?? [];
  const [unico] = coincidencias;
  return coincidencias.length === 1 && unico ? unico.id : null;
}
