import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ARGENTINA_PROVINCES,
  BACKED_CURRENCIES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  matchAccountingStandards,
  matchIibbJurisdictions,
  type CatalogJurisdiction,
  type ClientEconomicActivityOption,
} from "@contable/contracts";
import type { AccountingStandardCatalogEntry, ClientProfileForm, ClientWithProfile } from "./tipos";

interface UseCatalogosFichaParams {
  jurisdictionCatalog: UseQueryResult<(CatalogJurisdiction & { isActive: boolean })[], Error>;
  clientActivityCatalog: UseQueryResult<ClientEconomicActivityOption[], Error>;
  accountingStandardsCatalog: UseQueryResult<AccountingStandardCatalogEntry[], Error>;
  editingClient: ClientWithProfile | null;
  profileForm: ClientProfileForm;
  setProfileForm: (valor: ClientProfileForm) => void;
}

/** Catálogos derivados de la ficha: selección, valores fuera de catálogo y bloqueos. */
export function useCatalogosFicha({
  jurisdictionCatalog,
  clientActivityCatalog,
  accountingStandardsCatalog,
  editingClient,
  profileForm,
  setProfileForm,
}: UseCatalogosFichaParams) {
  // Catálogo y matching derivados: mientras el usuario no toca los checkboxes,
  // la selección viene de lo guardado + catálogo (preserva datos existentes).
  const catalogData = jurisdictionCatalog.data;
  const activityEntries = clientActivityCatalog.data ?? [];
  const activeActivityEntries = activityEntries.filter((entry) => entry.isActive !== false);
  const allActivityValues = new Set(activityEntries.map(clientEconomicActivityValue));
  const activeActivityValues = new Set(activeActivityEntries.map(clientEconomicActivityValue));
  const jurisdictionMatch = useMemo(
    () =>
      matchIibbJurisdictions(
        catalogData ?? [],
        editingClient?.profile?.iibbJurisdictions ?? [],
      ),
    [catalogData, editingClient],
  );
  const selectedJurisdictions = profileForm.iibbJurisdictions ?? jurisdictionMatch.canonical;
  const outOfCatalogJurisdictions = jurisdictionMatch.unknown;
  const toggleJurisdiction = (code: string, checked: boolean) => {
    setProfileForm({
      ...profileForm,
      iibbJurisdictions: checked
        ? [...new Set([...selectedJurisdictions, code])]
        : selectedJurisdictions.filter((value) => value !== code),
    });
  };
  const currencyNotBacked = !(BACKED_CURRENCIES as readonly string[]).includes(
    profileForm.functionalCurrency,
  );
  // Norma contable: selección contra el catálogo del estudio (sin texto libre).
  // El valor guardado siempre está en el selector: si quedó desactivado se
  // muestra marcado como tal; si no existe en el catálogo se muestra como
  // "fuera de catálogo" y el guardado queda bloqueado hasta reelegir — nunca
  // se elimina en silencio.
  const standardCatalog = accountingStandardsCatalog.data ?? [];
  const selectedStandard = profileForm.accountingStandard.trim();
  const selectedStandardMatch = useMemo(
    () => matchAccountingStandards(standardCatalog, selectedStandard ? [selectedStandard] : []),
    [standardCatalog, selectedStandard],
  );
  const standardValue = selectedStandardMatch.canonical[0] ?? selectedStandard;
  const selectedStandardEntry = standardCatalog.find((entry) => entry.name === standardValue);
  const standardCatalogUnavailable = accountingStandardsCatalog.isError;
  const standardCatalogLoading = accountingStandardsCatalog.isLoading;
  const standardCatalogEmpty = accountingStandardsCatalog.isSuccess && standardCatalog.length === 0;
  const reintentarNormas = () => void accountingStandardsCatalog.refetch();
  const standardUnknown =
    !accountingStandardsCatalog.isLoading &&
    !standardCatalogUnavailable &&
    selectedStandard !== "" &&
    !selectedStandardEntry;
  const vatConditionIsLegacy =
    profileForm.vatCondition !== "" &&
    !(CLIENT_VAT_CONDITIONS as readonly string[]).includes(profileForm.vatCondition);
  const provinceIsLegacy =
    profileForm.province !== "" &&
    !(ARGENTINA_PROVINCES as readonly string[]).includes(profileForm.province);
  const legalFormIsLegacy =
    profileForm.legalForm !== "" &&
    !(CLIENT_LEGAL_FORMS as readonly string[]).includes(profileForm.legalForm);
  const activityIsLegacy = profileForm.activity !== "" && !allActivityValues.has(profileForm.activity);
  const activityIsInactive =
    profileForm.activity !== "" &&
    allActivityValues.has(profileForm.activity) &&
    !activeActivityValues.has(profileForm.activity);
  return {
    catalogData,
    activityEntries,
    activeActivityEntries,
    allActivityValues,
    activeActivityValues,
    jurisdictionMatch,
    selectedJurisdictions,
    outOfCatalogJurisdictions,
    toggleJurisdiction,
    currencyNotBacked,
    standardCatalog,
    selectedStandard,
    selectedStandardMatch,
    standardValue,
    selectedStandardEntry,
    standardCatalogUnavailable,
    standardCatalogLoading,
    standardCatalogEmpty,
    reintentarNormas,
    standardUnknown,
    vatConditionIsLegacy,
    provinceIsLegacy,
    legalFormIsLegacy,
    activityIsLegacy,
    activityIsInactive,
  };
}

export type CatalogosFicha = ReturnType<typeof useCatalogosFicha>;
