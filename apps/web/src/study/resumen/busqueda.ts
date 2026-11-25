import type { ClientSummary } from "../../lib/api";
import { formatearFecha, formatearMes, formatearRango } from "../../lib/formatoFechas";
import { MONTH_LABELS, displayValue, etiquetaPeriodo } from "./etiquetas";

export type SummarySectionId =
  | "overview"
  | "accounting-periods"
  | "tax-periods"
  | "obligations"
  | "base-config"
  | "tax-profile"
  | "registrations"
  | "activities"
  | "catalogs";

export type SummarySectionDefinition = {
  id: SummarySectionId;
  group: "Datos generales" | "Contable" | "Fiscal" | "Configuración fiscal" | "Configuración";
  label: string;
};

export type SummarySearchResult = {
  sectionId: SummarySectionId;
  sectionLabel: string;
  title: string;
  detail: string;
};

export function normalizeSearchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR");
}

export function matchesSearch(term: string, ...values: unknown[]) {
  return values.some((value) => normalizeSearchValue(value).includes(term));
}

export function buildSearchResults(summary: ClientSummary, search: string): SummarySearchResult[] {
  const term = normalizeSearchValue(search.trim());
  if (!term) return [];

  const results: SummarySearchResult[] = [];
  const addResult = (result: SummarySearchResult) => {
    results.push(result);
  };
  const addSectionHit = (sectionId: SummarySectionId, sectionLabel: string) => {
    if (normalizeSearchValue(sectionLabel).includes(term)) {
      addResult({ sectionId, sectionLabel, title: sectionLabel, detail: "Abrir sección" });
    }
  };

  addSectionHit("overview", "Datos generales");
  if (matchesSearch(term, summary.client.legalName, summary.client.tradeName, summary.client.cuit)) {
    addResult({
      sectionId: "overview",
      sectionLabel: "Datos generales",
      title: summary.client.legalName,
      detail: `CUIT ${summary.client.cuit}`,
    });
  }

  addSectionHit("accounting-periods", "Períodos contables");
  for (const year of summary.accounting.fiscalYears) {
    if (matchesSearch(term, year.label, year.status, formatearFecha(year.startDate), formatearFecha(year.endDate))) {
      addResult({
        sectionId: "accounting-periods",
        sectionLabel: "Períodos contables",
        title: year.label,
        detail: `${formatearRango(year.startDate, year.endDate)} · ${year.status}`,
      });
    }
    for (const period of year.periods) {
      if (matchesSearch(term, formatearMes(period.startDate), formatearRango(period.startDate, period.endDate), period.status, period.ordinal)) {
        addResult({
          sectionId: "accounting-periods",
          sectionLabel: "Períodos contables",
          title: formatearMes(period.startDate),
          detail: `${year.label} · ${formatearRango(period.startDate, period.endDate)} · ${period.status}`,
        });
      }
    }
  }

  for (const period of summary.fiscal.periods) {
    if (matchesSearch(term, period.taxType.name, period.taxType.code, period.label, formatearRango(period.startDate, period.endDate))) {
      addResult({
        sectionId: "obligations",
        sectionLabel: "Obligaciones",
        title: `${period.taxType.name} · ${etiquetaPeriodo(period.label)}`,
        detail: `${period.taxType.code} · ${formatearRango(period.startDate, period.endDate)}`,
      });
    }
  }

  addSectionHit("obligations", "Obligaciones");
  for (const obligation of summary.fiscal.obligations) {
    if (matchesSearch(term, obligation.regime.name, obligation.regime.taxType.name, obligation.regime.jurisdiction.name, obligation.period.label, formatearFecha(obligation.dueDate), obligation.status)) {
      addResult({
        sectionId: "obligations",
        sectionLabel: "Obligaciones",
        title: `${obligation.regime.name} · ${etiquetaPeriodo(obligation.period.label)}`,
        detail: `Vence ${formatearFecha(obligation.dueDate)} · ${obligation.status}`,
      });
    }
  }

  addSectionHit("base-config", "Ficha contable");
  const profile = summary.client.profile;
  if (profile && matchesSearch(term, profile.functionalCurrency, MONTH_LABELS[profile.fiscalYearEndMonth - 1], profile.vatCondition, profile.legalForm, profile.province, profile.activity, profile.accountingStandard, profile.iibbJurisdictions.join(" "), formatearFecha(profile.serviceStartDate))) {
    addResult({
      sectionId: "base-config",
      sectionLabel: "Ficha contable",
      title: "Configuración contable",
      detail: `${displayValue(profile.activity)} · ${displayValue(profile.province)}`,
    });
  }

  addSectionHit("tax-profile", "Perfil fiscal");
  for (const profileVersion of summary.fiscal.profiles) {
    if (matchesSearch(term, profileVersion.legalName, profileVersion.cuit, profileVersion.personType, profileVersion.nationalCondition, profileVersion.version, formatearFecha(profileVersion.validFrom), profileVersion.fiscalAddress, profileVersion.monotributoCategory, profileVersion.status)) {
      addResult({
        sectionId: "tax-profile",
        sectionLabel: "Perfil fiscal",
        title: profileVersion.legalName,
        detail: `v${profileVersion.version} · CUIT ${profileVersion.cuit} · ${profileVersion.status}`,
      });
    }
  }

  addSectionHit("registrations", "Regímenes adheridos");
  for (const registration of summary.fiscal.registrations) {
    if (matchesSearch(term, registration.regime.name, registration.regime.taxType.name, registration.regime.jurisdiction.name, formatearFecha(registration.validFrom), formatearFecha(registration.validTo), registration.status)) {
      addResult({
        sectionId: "registrations",
        sectionLabel: "Regímenes adheridos",
        title: registration.regime.name,
        detail: `${registration.regime.taxType.name} · ${registration.regime.jurisdiction.name} · ${registration.status}`,
      });
    }
  }

  addSectionHit("activities", "Actividades registradas");
  for (const activity of summary.fiscal.activities) {
    if (matchesSearch(term, activity.activity.name, activity.activity.code, activity.activity.jurisdiction.name, formatearFecha(activity.validFrom), formatearFecha(activity.validTo), activity.isPrimary ? "principal" : "secundaria")) {
      addResult({
        sectionId: "activities",
        sectionLabel: "Actividades registradas",
        title: activity.activity.name,
        detail: `${activity.activity.code} · ${activity.isPrimary ? "Principal" : "Secundaria"}`,
      });
    }
  }

  addSectionHit("catalogs", "Catálogos");
  if (matchesSearch(term, "Plan de cuentas", countsLabel(summary.counts.accounts), "Contrapartes", summary.counts.counterparties, "Centros de costo activos", summary.counts.costCenters)) {
    addResult({
      sectionId: "catalogs",
      sectionLabel: "Catálogos",
      title: "Catálogos del cliente",
      detail: `${summary.counts.accounts} cuentas · ${summary.counts.counterparties} contrapartes · ${summary.counts.costCenters} centros de costo`,
    });
  }

  return results;
}

function countsLabel(value: number) {
  return String(value);
}
