// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyClientes } from "./StudyClientes";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

interface MockSession {
  status: "loading" | "authenticated" | "unauthenticated";
  me: null;
  portalContexts: never[];
  error: null;
  refresh: () => Promise<void>;
}

const sessionMock = vi.hoisted(() => ({ current: null as unknown as MockSession }));

vi.mock("../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
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

const catalogFixture = [
  { id: "j1", code: "AR-T", name: "Provincia de Tucumán", kind: "PROVINCIAL", isActive: true },
  { id: "j2", code: "TUC", name: "Tucumán — Convenio Multilateral", kind: "PROVINCIAL", isActive: true },
];

const standardsFixture = [
  { id: "n1", name: "RTIC", isActive: true },
  { id: "n2", name: "VENCER", isActive: false },
];

function clientFixture(profile: Record<string, unknown>) {
  return {
    id: "client-a",
    legalName: "Alfa Uno S.A.",
    cuit: "20111111112",
    status: "ACTIVE",
    profile,
  };
}

function mockApi(profile: Record<string, unknown>, standards = standardsFixture) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/tax/jurisdictions") return Promise.resolve(catalogFixture);
    if (path.includes("/accounting-standards")) return Promise.resolve(standards);
    if (path.includes("/clients")) return Promise.resolve([clientFixture(profile)]);
    return Promise.resolve(null);
  }) as never);
}

function renderClientes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyClientes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openFirstProfileDrawer() {
  fireEvent.click(await screen.findByText("Editar ficha"));
}

describe("StudyClientes — ficha con catálogos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: "period-a",
      isReady: true,
      capabilities: new Set(["client.read", "client.manage"]),
      hasClientAccess: (id) => id === "client-a",
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
    sessionMock.current = {
      status: "authenticated",
      me: null,
      portalContexts: [],
      error: null,
      refresh: async () => {},
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preselecciona jurisdicciones del catálogo, canonicaliza lo guardado y envía códigos", async () => {
    mockApi({
      functionalCurrency: "USD",
      accountingStandard: null,
      fiscalYearEndMonth: 12,
      vatCondition: null,
      // "AR-T" y su nombre guardado colapsan en un solo código canónico.
      iibbJurisdictions: ["AR-T", "Provincia de Tucumán", "Sin match"],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    const arT = (await screen.findByRole("checkbox", {
      name: /AR-T — Provincia de Tucumán/,
    })) as HTMLInputElement;
    const tuc = screen.getByRole("checkbox", {
      name: /TUC — Tucumán — Convenio Multilateral/,
    }) as HTMLInputElement;
    expect(arT.checked).toBe(true);
    expect(tuc.checked).toBe(false);

    // El valor guardado sin match se avisa al usuario; no desaparece en silencio.
    expect(screen.getByText(/Sin match/)).toBeTruthy();
    expect(screen.getByText(/no están en el catálogo fiscal/)).toBeTruthy();

    fireEvent.click(tuc);
    fireEvent.click(screen.getByText("Guardar ficha"));
    await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/profile",
      expect.objectContaining({
        functionalCurrency: "USD",
        iibbJurisdictions: ["AR-T", "TUC"],
      }),
    );
  });

  it("muestra la moneda guardada fuera de catálogo y bloquea el guardado hasta reelegir", async () => {
    mockApi({
      functionalCurrency: "EUR",
      accountingStandard: null,
      fiscalYearEndMonth: 12,
      vatCondition: null,
      iibbJurisdictions: [],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    const select = (await screen.findByLabelText("Moneda funcional", {
      selector: "select",
      exact: false,
    })) as HTMLSelectElement;
    expect(select.value).toBe("EUR");
    expect(screen.getByRole("option", { name: /EUR — fuera de catálogo/ })).toBeTruthy();
    expect(screen.getByText(/no está respaldada por el sistema/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar ficha" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
  });

  it("muestra solo opciones del catálogo cuando no hay datos legacy", async () => {
    mockApi({
      functionalCurrency: "ARS",
      accountingStandard: null,
      fiscalYearEndMonth: 12,
      vatCondition: null,
      iibbJurisdictions: ["TUC"],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    expect(screen.queryByText(/no están en el catálogo fiscal/)).toBeNull();
    expect(screen.getByRole("option", { name: "ARS" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "USD" })).toBeTruthy();
    const tuc = screen.getByRole("checkbox", {
      name: /TUC — Tucumán — Convenio Multilateral/,
    }) as HTMLInputElement;
    expect(tuc.checked).toBe(true);
  });
});

describe("StudyClientes — norma contable del catálogo del estudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: "period-a",
      isReady: true,
      capabilities: new Set(["client.read", "client.manage"]),
      hasClientAccess: (id) => id === "client-a",
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
    sessionMock.current = {
      status: "authenticated",
      me: null,
      portalContexts: [],
      error: null,
      refresh: async () => {},
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reemplaza el texto libre por un selector alimentado por el catálogo", async () => {
    mockApi({
      functionalCurrency: "ARS",
      accountingStandard: null,
      fiscalYearEndMonth: 12,
      vatCondition: null,
      iibbJurisdictions: [],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    const select = (await screen.findByLabelText("Norma contable", {
      selector: "select",
      exact: false,
    })) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Norma contable" })).toBeNull();
    // Sólo las normas activas del estudio aparecen como opciones normales;
    // la desactivada no se ofrece, pero tampoco desaparece si estaba guardada.
    expect(screen.getByRole("option", { name: "RTIC" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sin definir" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "VENCER" })).toBeNull();
  });

  it("conserva la norma guardada desactivada y permite guardarla sin pérdida", async () => {
    mockApi({
      functionalCurrency: "ARS",
      accountingStandard: "VENCER",
      fiscalYearEndMonth: 12,
      vatCondition: null,
      iibbJurisdictions: [],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    const select = (await screen.findByLabelText("Norma contable", {
      selector: "select",
      exact: false,
    })) as HTMLSelectElement;
    expect(select.value).toBe("VENCER");
    expect(screen.getByRole("option", { name: "VENCER — desactivada en el catálogo" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar ficha" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Guardar ficha"));
    await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/profile",
      expect.objectContaining({ accountingStandard: "VENCER" }),
    );
  });

  it("muestra el valor legacy fuera de catálogo y bloquea el guardado hasta reelegir", async () => {
    mockApi({
      functionalCurrency: "ARS",
      accountingStandard: "Texto legacy sin catálogo",
      fiscalYearEndMonth: 12,
      vatCondition: null,
      iibbJurisdictions: [],
      province: null,
      activity: null,
      legalForm: null,
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    const select = (await screen.findByLabelText("Norma contable", {
      selector: "select",
      exact: false,
    })) as HTMLSelectElement;
    expect(select.value).toBe("Texto legacy sin catálogo");
    expect(screen.getByRole("option", { name: /Texto legacy sin catálogo — fuera de catálogo/ })).toBeTruthy();
    expect(screen.getByText(/no está en el catálogo del estudio/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar ficha" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
  });
});
