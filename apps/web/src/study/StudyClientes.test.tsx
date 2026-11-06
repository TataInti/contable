// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
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

const activitiesFixture = [
  { id: "a1", code: "COMERCIO", name: "Comercio", isActive: true },
  { id: "a2", code: "SERVICIOS", name: "Servicios", isActive: true },
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
    if (path.endsWith("/deletion-preview")) {
      return Promise.resolve({
        entity: { id: "client-a", kind: "CLIENT", label: "Alfa Uno S.A." },
        confirmation: { expected: "Alfa Uno S.A.", label: "Escribí la razón social exacta para confirmar" },
        totals: { rows: 2 },
        groups: [{ key: "fiscal", label: "Datos fiscales", count: 2 }],
        items: [{ key: "documents", label: "Documentos", count: 2 }],
        blockers: [],
        canDelete: true,
        notes: ["La auditoría se conserva."],
      });
    }
    if (path === "/tax/jurisdictions") return Promise.resolve(catalogFixture);
    if (path.includes("/client-profile-catalogs/activities")) return Promise.resolve(activitiesFixture);
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
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

async function selectClient() {
  const table = await screen.findByRole("table");
  fireEvent.click(within(table).getByText("20-11111111-2"));
  return screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });
}

async function openFirstProfileDrawer() {
  await selectClient();
  fireEvent.click(await screen.findByRole("button", { name: "Editar ficha" }));
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

  it("oculta el borrado definitivo a los roles distintos del Titular", async () => {
    mockApi({});
    renderClientes();

    await selectClient();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
    expect(api.del).not.toHaveBeenCalled();
  });

  it("permite al Titular confirmar la eliminación del cliente con su razón social", async () => {
    const setClientId = vi.fn();
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(["client.read", "client.manage", "data.delete"]),
      setClientId,
    };
    mockApi({});
    vi.mocked(api.del).mockResolvedValue({});
    renderClientes();

    await selectClient();
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    const input = await screen.findByRole("textbox", {
      name: "Escribí la razón social exacta para confirmar",
    });
    fireEvent.change(input, { target: { value: "Alfa Uno S.A." } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar definitivamente" }));

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith("/firms/firm-a/clients/client-a", {
        confirmation: "Alfa Uno S.A.",
      }),
    );
    expect(setClientId).toHaveBeenCalledWith(null);
    expect(await screen.findByText("El cliente y sus registros dependientes se eliminaron.")).toBeTruthy();
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
    expect(within(screen.getByRole("dialog")).getByText(/Sin match/)).toBeTruthy();
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

  it("usa los cuatro campos categóricos como selectores en la ficha operativa", async () => {
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

    const vat = await screen.findByLabelText("Condición frente al IVA", { selector: "select" });
    const province = screen.getByLabelText("Provincia", { selector: "select" });
    const activity = screen.getByLabelText("Actividad principal", { selector: "select" });
    const legalForm = screen.getByLabelText("Forma jurídica", { selector: "select" });
    fireEvent.change(vat, { target: { value: "RESPONSABLE_INSCRIPTO" } });
    fireEvent.change(province, { target: { value: "Tucumán" } });
    fireEvent.change(activity, { target: { value: "COMERCIO — Comercio" } });
    fireEvent.change(legalForm, { target: { value: "Sociedad anónima (SA)" } });
    fireEvent.click(screen.getByText("Guardar ficha"));

    await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/profile",
      expect.objectContaining({
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      }),
    );
    expect(screen.queryByRole("textbox", { name: "Actividad principal" })).toBeNull();
  });

  it("mantiene visibles y envía sin cambios los cuatro valores históricos", async () => {
    mockApi({
      functionalCurrency: "ARS",
      accountingStandard: null,
      fiscalYearEndMonth: 12,
      vatCondition: "Responsable inscripto",
      iibbJurisdictions: [],
      province: "Provincia de Tucumán",
      activity: "Servicios",
      legalForm: "SRL",
      serviceStartDate: null,
    });
    renderClientes();
    await openFirstProfileDrawer();

    expect(screen.getByRole("option", { name: /Responsable inscripto — valor histórico/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Provincia de Tucumán — valor histórico/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Servicios — valor histórico/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /SRL — valor histórico/ })).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar ficha"));

    await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/profile",
      expect.objectContaining({
        vatCondition: "Responsable inscripto",
        province: "Provincia de Tucumán",
        activity: "Servicios",
        legalForm: "SRL",
      }),
    );
  });

  it("presenta los cuatro campos categóricos como dropdowns también durante el alta", async () => {
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
    vi.mocked(api.post).mockImplementation((async () => ({ id: "client-new" })) as never);
    renderClientes();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));

    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Alta libre S.A." } });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    fireEvent.change(screen.getByLabelText("Condición frente al IVA", { selector: "select" }), {
      target: { value: "RESPONSABLE_INSCRIPTO" },
    });
    fireEvent.change(screen.getByLabelText("Provincia", { selector: "select" }), {
      target: { value: "Tucumán" },
    });
    await screen.findByRole("option", { name: "COMERCIO — Comercio" });
    fireEvent.change(screen.getByLabelText(/Actividad principal/, { selector: "select" }), {
      target: { value: "COMERCIO — Comercio" },
    });
    fireEvent.change(screen.getByLabelText("Forma jurídica", { selector: "select" }), {
      target: { value: "Sociedad anónima (SA)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      "/firms/firm-a/clients",
      expect.objectContaining({
        legalName: "Alta libre S.A.",
        cuit: "20111111112",
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      }),
    );
  });
});

describe("StudyClientes — cartera densa", () => {
  const completeProfile = {
    functionalCurrency: "ARS",
    accountingStandard: "RTIC",
    fiscalYearEndMonth: 6,
    vatCondition: "RESPONSABLE_INSCRIPTO",
    iibbJurisdictions: [],
    province: "Tucumán",
    activity: "Comercio",
    legalForm: "S.A.",
    serviceStartDate: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: null,
      periodId: null,
      isReady: true,
      capabilities: new Set(["client.read", "client.manage"]),
      hasClientAccess: () => true,
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
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path === "/tax/jurisdictions") return Promise.resolve(catalogFixture);
      if (path.includes("/client-profile-catalogs/activities")) return Promise.resolve(activitiesFixture);
      if (path.includes("/accounting-standards")) return Promise.resolve(standardsFixture);
      if (path.includes("/clients")) {
        return Promise.resolve([
          { ...clientFixture(completeProfile), id: "c1", legalName: "Alfa Uno S.A.", cuit: "20111111112" },
          { ...clientFixture({}), id: "c2", legalName: "Beta Dos S.R.L.", cuit: "30222222223" },
          {
            ...clientFixture(completeProfile),
            id: "c3",
            legalName: "Gamma Tres S.A.",
            cuit: "30333333334",
            status: "INACTIVE",
          },
        ]);
      }
      return Promise.resolve(null);
    }) as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra la franja de métricas y filtra por ficha incompleta", async () => {
    renderClientes();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Alfa Uno S.A.")).toBeTruthy();
    expect(within(table).getByText("Beta Dos S.R.L.")).toBeTruthy();

    const stats = screen.getByRole("group", { name: "Resumen de la cartera" });
    expect(within(stats).getByText("Ficha incompleta")).toBeTruthy();
    fireEvent.click(within(stats).getByRole("button", { name: /Ficha incompleta/ }));

    expect(within(screen.getByRole("table")).queryByText("Alfa Uno S.A.")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("Beta Dos S.R.L.")).toBeTruthy();
  });

  it("filtra por estado y por condición de IVA", async () => {
    renderClientes();
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "INACTIVE" } });
    expect(within(screen.getByRole("table")).getByText("Gamma Tres S.A.")).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("Alfa Uno S.A.")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por condición IVA"), {
      target: { value: "RESPONSABLE_INSCRIPTO" },
    });
    expect(within(screen.getByRole("table")).queryByText("Beta Dos S.R.L.")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("Alfa Uno S.A.")).toBeTruthy();
  });

  it("abre el detalle con las faltas de la ficha y lo cierra con Esc", async () => {
    renderClientes();
    fireEvent.click(within(await screen.findByRole("table")).getByText("30-22222222-3"));

    const detail = await screen.findByRole("complementary", { name: "Detalle de Beta Dos S.R.L." });
    expect(within(detail).getByText(/Ficha incompleta: falta condición IVA/)).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Abrir trabajo" })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Detalle de Beta Dos S.R.L." })).toBeNull(),
    );
  });

  it("abre el espacio de trabajo desde la fila sin seleccionar el cliente", async () => {
    const setClientId = vi.fn();
    contextMock.current = { ...contextMock.current, setClientId };
    renderClientes();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir trabajo de Beta Dos S.R.L." }));
    expect(setClientId).toHaveBeenCalledWith("c2");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("muestra la razón social como botón accesible y abre el espacio de trabajo", async () => {
    const setClientId = vi.fn();
    contextMock.current = { ...contextMock.current, setClientId };
    renderClientes();

    fireEvent.click(await screen.findByRole("button", { name: /^Beta Dos S\.R\.L\.$/ }));

    expect(setClientId).toHaveBeenCalledWith("c2");
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/trabajo"));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
