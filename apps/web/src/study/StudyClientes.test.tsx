// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api, type ClientContact } from "../lib/api";
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
    if (path === "/tax/jurisdictions" || path === "/tax/jurisdictions?includeInactive=true") return Promise.resolve(catalogFixture);
    if (path.includes("/client-profile-catalogs/activities")) return Promise.resolve(activitiesFixture);
    if (path.includes("/accounting-standards")) return Promise.resolve(standards);
    if (path.endsWith("/contacts")) return Promise.resolve([]);
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
      <ToastProvider>
      <MemoryRouter>
        <StudyClientes />
        <LocationProbe />
      </MemoryRouter>
      </ToastProvider>
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
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
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

    const detail = await selectClient();
    fireEvent.click(within(detail).getByText("Más acciones"));
    expect(within(detail).queryByRole("button", { name: "Eliminar" })).toBeNull();
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

    const detail = await selectClient();
    fireEvent.click(within(detail).getByText("Más acciones"));
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
    fireEvent.click(screen.getByText("Guardar cambios"));
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
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Guardar cambios"));
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
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(screen.getByText("Guardar cambios"));

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
    fireEvent.click(screen.getByText("Guardar cambios"));

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
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("registra el correo opcional como contacto principal después de crear el cliente", async () => {
    mockApi({});
    vi.mocked(api.post).mockImplementation(((path: string) =>
      Promise.resolve(path.endsWith("/contacts") ? { id: "contact-new" } : { id: "client-new" })) as never);
    renderClientes();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));

    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Alta libre S.A." } });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    const emailInput = screen.getByLabelText("Correo de contacto") as HTMLInputElement;
    expect(emailInput.type).toBe("email");
    fireEvent.change(emailInput, { target: { value: "correo-inválido" } });
    expect(emailInput.validity.typeMismatch).toBe(true);
    fireEvent.change(emailInput, { target: { value: "contacto@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, "/firms/firm-a/clients", expect.objectContaining({
      legalName: "Alta libre S.A.",
      cuit: "20111111112",
    }));
    expect(api.post).toHaveBeenNthCalledWith(2, "/firms/firm-a/clients/client-new/contacts", {
      name: "Alta libre S.A.",
      email: "contacto@example.com",
      isPrimary: true,
    });
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/configuracion-fiscal"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mantiene el cliente si falla el POST de contacto y reintenta sin duplicarlo", async () => {
    mockApi({});
    const savedContact: ClientContact = {
      id: "contact-created-before-timeout",
      name: "Alta libre S.A.",
      function: null,
      email: "contacto@example.com",
      phone: null,
      isPrimary: true,
      isActive: true,
    };
    const fallbackGet = vi.mocked(api.get).getMockImplementation();
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path.endsWith("/contacts")) return Promise.resolve([savedContact]);
      return fallbackGet ? fallbackGet(path) : Promise.resolve([]);
    }) as never);
    vi.mocked(api.post).mockImplementation(((path: string) => {
      if (path.endsWith("/contacts")) return Promise.reject(new Error("La respuesta se perdió"));
      return Promise.resolve({ id: "client-new" });
    }) as never);
    renderClientes();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Alta libre S.A." } });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    fireEvent.change(screen.getByLabelText("Correo de contacto"), { target: { value: "contacto@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Cliente creado. El correo no se pudo registrar; podés agregarlo desde Contactos.")).toBeTruthy();
    expect(screen.getByTestId("current-path").textContent).toBe("/");
    expect(api.post).toHaveBeenCalledTimes(2);

    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/configuracion-fiscal"));
    expect(api.get).toHaveBeenCalledWith("/firms/firm-a/clients/client-new/contacts");
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path.endsWith("/contacts"))).toHaveLength(1);
  });
});

describe("StudyClientes — cartera densa", () => {
  let contactRows: ClientContact[] = [];
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
    contactRows = [];
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
      if (path === "/tax/jurisdictions" || path === "/tax/jurisdictions?includeInactive=true") return Promise.resolve(catalogFixture);
      if (path.includes("/client-profile-catalogs/activities")) return Promise.resolve(activitiesFixture);
      if (path.includes("/accounting-standards")) return Promise.resolve(standardsFixture);
      if (path.endsWith("/contacts")) return Promise.resolve(contactRows);
      if (path.includes("/clients")) {
        return Promise.resolve([
          { ...clientFixture(completeProfile), id: "c1", legalName: "Alfa Uno S.A.", cuit: "20111111112" },
          {
            ...clientFixture({}),
            id: "c2",
            legalName: "Beta Dos S.R.L.",
            tradeName: "Beta Comercial",
            cuit: "30222222223",
          },
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

  it("fija Abrir, define anchos y mantiene Completar visible sobre el pie", async () => {
    renderClientes();
    const table = await screen.findByRole("table", { name: "Cartera de clientes" });
    const actionHeader = table.querySelector(
      "thead th.client-list__action-column",
    ) as HTMLTableCellElement | null;
    const profileHeader = table.querySelector(
      "thead th.client-list__profile-column",
    ) as HTMLTableCellElement | null;
    const statusHeader = table.querySelector(
      "thead th.client-list__status-column",
    ) as HTMLTableCellElement | null;

    expect(actionHeader).not.toBeNull();
    expect(actionHeader?.style.position).toBe("sticky");
    expect(actionHeader?.style.right).toBe("0px");
    expect(actionHeader?.style.width).toBe("9%");
    expect(profileHeader?.style.width).toBe("8%");
    expect(statusHeader?.style.width).toBe("17%");
    const actionCells = table.querySelectorAll("tbody td.client-list__action-column");
    expect(actionCells).toHaveLength(3);
    expect((actionCells[0] as HTMLTableCellElement).style.position).toBe("sticky");
    expect((actionCells[0] as HTMLTableCellElement).style.right).toBe("0px");
    expect(
      within(actionCells[0] as HTMLTableCellElement).getByRole("button", {
        name: "Abrir ficha de Alfa Uno S.A.",
      }),
    ).toBeTruthy();

    const betaButton = within(table).getByRole("button", { name: "Beta Dos S.R.L." });
    expect(betaButton.getAttribute("title")).toBe("Beta Dos S.R.L. — Beta Comercial");
    expect(within(betaButton).getByText("Beta Dos S.R.L.").tagName).toBe("STRONG");
    expect(within(betaButton).getByText("Beta Comercial").tagName).toBe("SMALL");

    fireEvent.click(within(table).getByText("30-22222222-3"));
    const detail = await screen.findByRole("complementary", {
      name: "Detalle de Beta Dos S.R.L.",
    });
    const alert = detail.querySelector(
      ".dense-inspector__banner .ds-notice",
    ) as HTMLElement | null;
    expect(alert).not.toBeNull();
    expect(alert?.parentElement?.classList.contains("dense-inspector__banner")).toBe(true);
    expect(detail.querySelector(".dense-inspector__body")?.contains(alert)).toBe(false);
    expect(detail.querySelector(".dense-inspector__foot")?.contains(alert)).toBe(false);

    fireEvent.click(within(alert as HTMLElement).getByRole("button", { name: "Completar" }));
    expect(await screen.findByRole("button", { name: "Guardar cambios" })).toBeTruthy();
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
    expect(within(detail).getByRole("button", { name: "Abrir" })).toBeTruthy();
    expect(detail.querySelector("#client-contacts-c2")).not.toBeNull();
    fireEvent.click(within(detail).getByText("Más acciones"));
    fireEvent.click(within(detail).getByRole("button", { name: "Contactos" }));

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Detalle de Beta Dos S.R.L." })).toBeNull(),
    );
  });

  it("edita la identidad desde la ficha con los valores actuales y guarda el PATCH", async () => {
    const updated = {
      id: "c1",
      legalName: "Alfa Actualizada S.A.",
      tradeName: "Alfa Comercial",
      cuit: "20333333334",
      status: "ACTIVE",
    };
    vi.mocked(api.patch).mockResolvedValue(updated as never);
    renderClientes();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("20-11111111-2"));
    const detail = await screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });
    fireEvent.click(within(detail).getByRole("button", { name: "Editar" }));

    const editDrawer = await screen.findByRole("dialog", { name: "Editar cliente" });
    expect(within(editDrawer).getByRole("heading", { name: "Identidad" })).toBeTruthy();
    expect(within(editDrawer).getByRole("heading", { name: "Datos fiscales" })).toBeTruthy();
    expect(within(detail).getAllByRole("button", { name: "Editar" })).toHaveLength(1);
    expect((screen.getByLabelText("Razón social") as HTMLInputElement).value).toBe("Alfa Uno S.A.");
    expect((screen.getByLabelText("Nombre comercial") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("CUIT") as HTMLInputElement).value).toBe("20111111112");
    expect(within(editDrawer).queryByLabelText("Estado")).toBeNull();

    fireEvent.change(screen.getByLabelText("Razón social"), {
      target: { value: "Alfa Actualizada S.A." },
    });
    fireEvent.change(screen.getByLabelText("Nombre comercial"), {
      target: { value: "Alfa Comercial" },
    });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20333333334" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/clients/c1", {
        legalName: "Alfa Actualizada S.A.",
        tradeName: "Alfa Comercial",
        cuit: "20333333334",
      }),
    );
  });

  it("cambia el estado desde una acción independiente y guarda sin confirmación nueva", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "c1", legalName: "Alfa Uno S.A." } as never);
    renderClientes();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("20-11111111-2"));
    const detail = await screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });
    fireEvent.click(within(detail).getByText("Más acciones"));
    fireEvent.click(within(detail).getByRole("button", { name: "Cambiar estado" }));

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "INACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar estado" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/clients/c1", { status: "INACTIVE" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("muestra el conflicto de CUIT junto al campo de identidad", async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError("CLIENT_CUIT_CONFLICT", "Ya existe un cliente con ese CUIT en este estudio.", 409),
    );
    renderClientes();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("20-11111111-2"));
    const detail = await screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });
    fireEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Ya existe un cliente con ese CUIT en este estudio.")).toBeTruthy();
    expect(screen.getByLabelText("CUIT").getAttribute("aria-invalid")).toBe("true");
  });

  it("permite alta, edición, cambio de principal y ocultar/mostrar contactos", async () => {
    vi.mocked(api.post).mockImplementation(((path: string, payload: unknown) => {
      expect(path).toBe("/firms/firm-a/clients/c1/contacts");
      const fields = payload as Omit<ClientContact, "id" | "isActive">;
      if (fields.isPrimary) {
        contactRows = contactRows.map((contact) => ({ ...contact, isPrimary: false }));
      }
      const created: ClientContact = {
        id: `contact-${contactRows.length + 1}`,
        ...fields,
        isActive: true,
      };
      contactRows = [...contactRows, created];
      return Promise.resolve(created);
    }) as never);
    vi.mocked(api.patch).mockImplementation(((path: string, payload: unknown) => {
      const contactId = path.split("/").at(-1);
      const changes = payload as Partial<ClientContact>;
      if (changes.isPrimary) {
        contactRows = contactRows.map((contact) =>
          contact.id === contactId ? contact : { ...contact, isPrimary: false },
        );
      }
      contactRows = contactRows.map((contact) =>
        contact.id === contactId ? { ...contact, ...changes } : contact,
      );
      const updated = contactRows.find((contact) => contact.id === contactId);
      if (!updated) return Promise.reject(new Error("Contacto inexistente en el mock"));
      return Promise.resolve(updated);
    }) as never);

    renderClientes();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("20-11111111-2"));
    const detail = await screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });

    fireEvent.click(within(detail).getByRole("button", { name: "Nuevo contacto" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Contacto Uno" } });
    fireEvent.change(screen.getByLabelText("Función"), { target: { value: "Administración" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "uno@example.com" } });
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "+54 11 1234-5678" } });
    fireEvent.click(screen.getByLabelText("Contacto principal"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar contacto" }));
    await screen.findByText("Contacto Uno");

    fireEvent.click(within(detail).getByRole("button", { name: "Nuevo contacto" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Contacto Dos" } });
    fireEvent.click(screen.getByLabelText("Contacto principal"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar contacto" }));
    await screen.findByText("Contacto Dos");
    expect(within(detail).getAllByText("Principal")).toHaveLength(1);

    fireEvent.click(within(detail).getByRole("button", { name: "Editar contacto de Contacto Uno" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Contacto Uno Editado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar contacto" }));
    await screen.findByText("Contacto Uno Editado");

    fireEvent.click(within(detail).getByRole("button", { name: "Ocultar contacto de Contacto Uno Editado" }));
    await within(detail).findByRole("button", { name: "Mostrar contacto de Contacto Uno Editado" });
    fireEvent.click(within(detail).getByRole("button", { name: "Mostrar contacto de Contacto Uno Editado" }));
    await within(detail).findByRole("button", { name: "Ocultar contacto de Contacto Uno Editado" });

    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.patch).toHaveBeenCalledTimes(3);
  });

  it("oculta las acciones de edición a quien no tiene client.manage", async () => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(["client.read"]),
    };
    renderClientes();
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByText("20-11111111-2"));
    const detail = await screen.findByRole("complementary", { name: "Detalle de Alfa Uno S.A." });
    expect(within(detail).queryByRole("button", { name: "Editar" })).toBeNull();
    fireEvent.click(within(detail).getByText("Más acciones"));
    expect(within(detail).queryByRole("button", { name: "Cambiar estado" })).toBeNull();
  });

  it("abre el resumen del cliente desde la acción de la fila", async () => {
    const setClientId = vi.fn();
    contextMock.current = { ...contextMock.current, setClientId };
    renderClientes();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir ficha de Beta Dos S.R.L." }));
    expect(setClientId).toHaveBeenCalledWith("c2");
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/resumen-cliente"));
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

  it("alinea el alta en dos columnas y explica los campos que faltan junto al CTA", async () => {
    renderClientes();
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));

    const drawer = await screen.findByRole("dialog", { name: "Alta de cliente" });
    const form = drawer.querySelector("#client-create-form") as HTMLFormElement;
    expect(form.classList.contains("study-inline-form--client")).toBe(true);
    expect(form.classList.contains("client-create-form")).toBe(true);
    expect(form.querySelectorAll(".ds-field")).toHaveLength(8);

    const createButton = within(drawer).getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(createButton.getAttribute("aria-describedby")).toBe("client-create-hint");
    expect(within(drawer).getByText("Falta completar 2 campos: razón social y CUIT.")).toBeTruthy();
    expect(drawer.querySelector(".action-drawer__footer")?.querySelectorAll("button.ds-button--primary")).toHaveLength(1);
    expect(within(drawer).getByRole("button", { name: "Cancelar" }).closest(".action-drawer__footer")).toBeTruthy();
  });
});
