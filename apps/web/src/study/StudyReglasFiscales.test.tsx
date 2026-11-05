// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyReglasFiscales } from "./StudyReglasFiscales";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

const activeActivities = [
  {
    id: "act-1",
    code: "CM03-02",
    name: "Comercio mayorista",
    jurisdictionId: "jur-ar",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
  {
    id: "act-2",
    code: "SERV4",
    name: "Servicios profesionales",
    jurisdictionId: "jur-ba",
    source: null,
    validFrom: "2026-01-01",
    validTo: null,
    isActive: true,
  },
];

function makeDetail(activityCode: string | null) {
  return {
    id: "pack-1",
    code: "IVA-RI-ARCA",
    name: "IVA Responsable Inscripto",
    regime: {
      id: "regime-1",
      code: "RI",
      name: "Responsable Inscripto",
      taxType: { name: "IVA" },
      jurisdiction: { id: "jur-ar", name: "Nación", code: "AR" },
      authority: { id: "auth-1", name: "ARCA" },
    },
    versions: [
      {
        id: "version-1",
        version: 1,
        status: "DRAFT",
        validFrom: "2026-01-01",
        validTo: null,
        engineVersion: "ar-vat-ri-v2.1.0",
        rulesHash: "abc",
        rateRules: [
          {
            id: "rule-1",
            concept: "Operaciones generales",
            activityCode,
            jurisdictionId: null,
            rate: "21",
            minAmount: null,
            validFrom: "2026-01-01",
            validTo: null,
          },
        ],
        dueDateRules: [],
        sources: [],
      },
    ],
  };
}

function packList(detail: ReturnType<typeof makeDetail>) {
  return [
    {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      regime: {
        name: detail.regime.name,
        code: detail.regime.code,
        taxType: { name: "IVA" },
        jurisdiction: { name: detail.regime.jurisdiction.name },
      },
      versions: detail.versions,
    },
  ];
}

function mockApi(detail: ReturnType<typeof makeDetail>) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/tax/rule-packs") return Promise.resolve(packList(detail));
    if (path === "/tax/rule-packs/pack-1") return Promise.resolve(detail);
    if (path === "/tax/activities") return Promise.resolve([...activeActivities]);
    if (path === "/tax/regimes") return Promise.resolve([]);
    return Promise.resolve([]);
  }) as never);
}

function context(): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(["tax.rules.read", "tax.rules.propose"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderReglas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StudyReglasFiscales />
    </QueryClientProvider>,
  );
}

describe("StudyReglasFiscales — selector de actividad del catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = context();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ofrece las actividades activas del catálogo y guarda el código elegido", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "General" })).toBeTruthy();
    expect(
      within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" }),
    ).toBeTruthy();
    expect(select.value).toBe("");

    fireEvent.change(select, { target: { value: "CM03-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/tax/rule-versions/version-1/rate-rules", {
        rules: [
          expect.objectContaining({
            concept: "Operaciones generales",
            rate: "21",
            activityCode: "CM03-02",
            validFrom: "2026-01-01",
          }),
        ],
      }),
    );
  });

  it("filtra las opciones por la jurisdicción del paquete", async () => {
    mockApi(makeDetail(null));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    // El paquete es de jur-ar: SERV4 (jur-ba) no debe ofrecerse.
    expect(
      within(select).getByRole("option", { name: "CM03-02 · Comercio mayorista" }),
    ).toBeTruthy();
    expect(
      within(select).queryByRole("option", { name: "SERV4 · Servicios profesionales" }),
    ).toBeNull();
  });

  it("conserva como opción un código histórico hoy desactivado", async () => {
    mockApi(makeDetail("CM03-OLD"));
    renderReglas();

    const select = (await screen.findByLabelText("Actividad rule-1")) as HTMLSelectElement;
    expect(select.value).toBe("CM03-OLD");
    expect(within(select).getByRole("option", { name: /código histórico/ })).toBeTruthy();
  });
});