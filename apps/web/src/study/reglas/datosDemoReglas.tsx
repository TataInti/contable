// Datos sintéticos «Demo» para las pruebas de caracterización de Reglas fiscales (Foco 3.1b).
// Son ficticios: los nombres llevan el prefijo «Demo» y los CUIT y las matrículas son inventados.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CatalogEconomicActivity, TaxEngineOption, TaxRuleKindOption } from "@contable/contracts";
import { ToastProvider } from "@contable/design-system";
import { vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import { StudyReglasFiscales } from "../StudyReglasFiscales";
import type {
  Credential,
  RuleJurisdictionOption,
  RulePack,
  RulePackDetail,
  RuleRegimeOption,
  RuleRow,
  RuleVersion,
} from "./tipos";

export const demoEngines: TaxEngineOption[] = [
  {
    id: "engine-demo-current",
    engineKey: "demo-vat-ri",
    engineVersion: "demo-vat-ri-v2",
    familyId: "family-demo-vat",
    familyKey: "VAT_RI",
    label: "Demo · IVA RI vigente",
  },
  {
    id: "engine-demo-legacy",
    engineKey: "demo-vat-ri-legacy",
    engineVersion: "demo-vat-ri-v1",
    familyId: "family-demo-vat",
    familyKey: "VAT_RI",
    label: "Demo · IVA RI anterior",
  },
];

export const demoActivities: CatalogEconomicActivity[] = [
  {
    id: "act-1",
    code: "DEMO-A1",
    name: "Demo · Actividad A",
    jurisdictionId: "jur-1",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
  {
    id: "act-2",
    code: "DEMO-B2",
    name: "Demo · Actividad B",
    jurisdictionId: "jur-1",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
  {
    id: "act-oculta",
    code: "DEMO-OLD",
    name: "Demo · Actividad oculta",
    jurisdictionId: "jur-1",
    source: null,
    validFrom: "2020-01-01",
    validTo: null,
    isActive: false,
  },
];

export const demoJurisdictions: RuleJurisdictionOption[] = [
  { id: "jur-1", code: "DEMO-AR", name: "Demo Nación", isActive: true },
  { id: "jur-2", code: "DEMO-BA", name: "Demo Buenos Aires", isActive: true },
];

export const demoKinds: TaxRuleKindOption[] = [
  { id: "kind-activity", key: "RATE", label: "Alícuota por actividad", subject: "ACTIVITY" },
];

export const demoRegimes: RuleRegimeOption[] = [
  {
    id: "regime-1",
    code: "DEMO-RI",
    name: "Demo Responsable Inscripto",
    taxType: { name: "IVA" },
    jurisdiction: { name: "Demo Nación" },
  },
];

export const demoCredentials: Credential[] = [
  { id: "cred-1", registrationNumber: "DEMO-MAT-001", jurisdiction: { name: "Demo CABA" } },
];

export function makeDemoRule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    concept: "Demo · Operaciones generales",
    kindId: "kind-activity",
    activityId: "act-1",
    categoryCode: null,
    isDefault: false,
    activityCode: "DEMO-A1",
    jurisdictionId: null,
    rate: "21",
    minAmount: null,
    validFrom: "2026-01-01",
    validTo: null,
    ...overrides,
  };
}

export function makeDemoVersion(overrides: Partial<RuleVersion> = {}): RuleVersion {
  return {
    id: "version-1",
    version: 1,
    status: "DRAFT",
    origin: "UI",
    createdByFirmId: "firm-a",
    validFrom: "2026-01-01",
    validTo: null,
    engineVersion: "demo-vat-ri-v2",
    rulesHash: "demo-hash",
    rateRules: [makeDemoRule()],
    dueDateRules: [],
    sources: [],
    ...overrides,
  };
}

export function makeDemoDetail(): RulePackDetail {
  return {
    id: "pack-1",
    code: "DEMO-IVA-RI",
    name: "Demo · IVA Responsable Inscripto",
    status: "DRAFT",
    origin: "UI",
    createdByFirmId: "firm-a",
    regime: {
      id: "regime-1",
      code: "DEMO-RI",
      name: "Demo Responsable Inscripto",
      calcFamilyId: "family-demo-vat",
      isActive: true,
      taxType: { name: "IVA", code: "IVA", isActive: true },
      jurisdiction: { id: "jur-1", name: "Demo Nación", code: "DEMO-AR", isActive: true },
      authority: { id: "auth-1", name: "Demo ARCA", isActive: true },
    },
    versions: [makeDemoVersion()],
  };
}

export function demoPackList(detail: RulePackDetail): RulePack[] {
  return [
    {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      status: detail.status,
      origin: detail.origin,
      createdByFirmId: detail.createdByFirmId,
      regime: {
        id: detail.regime.id,
        name: detail.regime.name,
        code: detail.regime.code,
        calcFamilyId: detail.regime.calcFamilyId,
        isActive: true,
        taxType: { name: "IVA", code: "IVA", isActive: true },
        jurisdiction: { name: detail.regime.jurisdiction.name, isActive: true },
      },
      versions: detail.versions,
    },
  ];
}

type DemoRoute = () => Promise<unknown>;

// Responde las consultas GET de la pantalla. Las rutas de `extra` reemplazan las predeterminadas;
// una ruta no prevista devuelve una lista vacía, como en la prueba existente de la pantalla.
export function mockDemoApi(detail: RulePackDetail, extra: Record<string, DemoRoute> = {}) {
  const routes: Record<string, DemoRoute> = {
    "/tax/rule-packs": () => Promise.resolve(demoPackList(detail)),
    [`/tax/rule-packs/${detail.id}`]: () => Promise.resolve(detail),
    [`/tax/regimes/${detail.regime.id}/engines`]: () =>
      detail.regime.calcFamilyId
        ? Promise.resolve(demoEngines)
        : Promise.reject(new ApiError("REGIME_FAMILY_REQUIRED", "Elegí la familia de cálculo del régimen", 422)),
    [`/tax/regimes/${detail.regime.id}/rule-kinds`]: () => Promise.resolve(demoKinds),
    "/tax/activities?includeInactive=true": () => Promise.resolve(demoActivities),
    "/tax/jurisdictions?includeInactive=true": () => Promise.resolve(demoJurisdictions),
    "/tax/regimes": () => Promise.resolve([]),
    "/tax/credentials": () => Promise.resolve([]),
    ...extra,
  };
  vi.mocked(api.get).mockImplementation(((path: string) => (routes[path] ?? (() => Promise.resolve([])))()) as never);
}

export function demoContext(capabilities: string[] = ["tax.rules.read", "tax.rules.propose"]): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(capabilities),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

export function renderDemoReglas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StudyReglasFiscales />
      </ToastProvider>
    </QueryClientProvider>,
  );
}
