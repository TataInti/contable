// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api, type ClientContact, type ClientSummary } from "../lib/api";
import { StudyResumenCliente } from "./StudyResumenCliente";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

function summaryFixture(
  accountingStatus = "CLOSED",
  fiscalAddress: string | null = "Tucumán",
  includeAccountingProfile = true,
): ClientSummary {
  const profile = {
    functionalCurrency: "ARS",
    accountingStandard: "RTIC",
    fiscalYearEndMonth: 12,
    vatCondition: "RESPONSABLE_INSCRIPTO",
    iibbJurisdictions: ["AR"],
    province: "Tucumán",
    activity: "Comercio",
    legalForm: "S.A.",
    serviceStartDate: null,
    updatedAt: "2026-11-09T00:00:00.000Z",
  };
  const taxType = { id: "tax-1", code: "IVA", name: "IVA", isActive: true };
  const jurisdiction = { id: "jur-1", code: "AR", name: "Argentina", isActive: true };
  const regime = {
    id: "regime-1",
    code: "REG-1",
    name: "Régimen general",
    isActive: true,
    taxType,
    jurisdiction,
  };
  const date = "2026-11-01T00:00:00.000Z";

  return {
    client: {
      id: "client-a",
      legalName: "Alfa Uno S.A.",
      tradeName: "Alfa",
      cuit: "20111111112",
      status: "ONBOARDING",
      createdAt: date,
      updatedAt: "2026-11-09T00:00:00.000Z",
      profile: includeAccountingProfile ? profile : null,
      onboarding: { completed: false, updatedAt: date },
    },
    accounting: {
      fiscalYears: [
        {
          id: "year-1",
          label: "2026",
          startDate: date,
          endDate: "2027-10-31T00:00:00.000Z",
          status: accountingStatus,
          periods: [],
        },
      ],
    },
    fiscal: {
      profiles: [
        {
          id: "profile-1",
          version: 1,
          legalName: "Alfa Uno S.A.",
          cuit: "20111111112",
          personType: "JURIDICA",
          nationalCondition: "RESPONSABLE_INSCRIPTO",
          fiscalAddress,
          fiscalYearEndMonth: 12,
          monotributoCategory: null,
          validFrom: date,
          validTo: null,
          status: "ACTIVE",
          source: null,
          createdAt: date,
        },
      ],
      registrations: [
        {
          id: "registration-1",
          status: "ACTIVE",
          validFrom: date,
          validTo: null,
          registrationNumber: null,
          profile: { id: "profile-1", version: 1 },
          regime,
        },
      ],
      activities: [
        {
          id: "activity-1",
          isPrimary: true,
          validFrom: date,
          validTo: null,
          profile: { version: 1 },
          activity: {
            id: "activity-catalog-1",
            code: "COMERCIO",
            name: "Comercio minorista",
            isActive: true,
            jurisdiction: { code: "AR", name: "Argentina", isActive: true },
          },
        },
      ],
      periods: [
        {
          id: "period-1",
          startDate: date,
          endDate: "2026-11-30T00:00:00.000Z",
          label: "Noviembre 2026",
          taxType,
        },
      ],
      obligations: [
        {
          id: "obligation-1",
          status: "PENDING",
          dueDate: "2026-12-20T00:00:00.000Z",
          profile: { version: 1 },
          regime,
          period: {
            id: "period-1",
            label: "Noviembre 2026",
            startDate: date,
            endDate: "2026-11-30T00:00:00.000Z",
          },
        },
      ],
    },
    counts: { accounts: 1, counterparties: 2, costCenters: 3 },
  };
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

function renderSummary(
  summary = summaryFixture(),
  contacts: ClientContact[] = [],
  canManageContacts = false,
) {
  contextMock.current = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: null,
    isReady: true,
    capabilities: new Set(canManageContacts ? ["client.read", "client.manage"] : ["client.read"]),
    hasClientAccess: (id) => id === "client-a",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/summary")) return Promise.resolve(summary);
    if (path.endsWith("/contacts")) return Promise.resolve(contacts);
    return Promise.resolve([]);
  }) as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/resumen-cliente"]}>
        <StudyResumenCliente />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudyResumenCliente — composición del resumen", () => {
  it("muestra una sola fecha de actualización, métricas alineadas y accesos fiscales agrupados", async () => {
    renderSummary();

    const overview = await screen.findByRole("region", { name: "Resumen" });
    expect(within(overview).getByRole("heading", { name: "Resumen", level: 2 })).toBeTruthy();
    expect(within(overview).queryByRole("heading", { name: "Estado del cliente" })).toBeNull();
    expect(screen.getByText("En configuración")).toBeTruthy();
    expect(screen.getAllByText(/Actualizado/)).toHaveLength(1);
    expect(within(overview).getByText("1 vigente")).toBeTruthy();
    expect(within(overview).getByText("Obligación materializada")).toBeTruthy();
    expect(screen.queryByText("1 obligaciones")).toBeNull();
    expect(within(overview).queryByText("Ejercicios contables")).toBeNull();

    const quickLinks = overview.querySelector(".client-summary__overview-links ul") as HTMLUListElement;
    expect(Array.from(quickLinks.querySelectorAll("button"), (button) => button.textContent?.trim())).toEqual([
      "Cargar período",
      "Materializar obligaciones",
      "Nueva versión del perfil",
    ]);
    expect(quickLinks.querySelectorAll("small")).toHaveLength(0);

    const navigation = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
    const fiscalGroupTitle = within(navigation).getByText("Configuración fiscal", { selector: "p" });
    const fiscalGroup = fiscalGroupTitle.parentElement as HTMLElement;
    expect(within(fiscalGroup).getByRole("button", { name: "Perfil fiscal" })).toBeTruthy();
    expect(within(fiscalGroup).getByRole("button", { name: "Regímenes adheridos" })).toBeTruthy();
    expect(within(fiscalGroup).getByRole("button", { name: "Actividades registradas" })).toBeTruthy();
    expect(fiscalGroup.querySelectorAll("button")).toHaveLength(3);
    expect(fiscalGroup.querySelectorAll("small")).toHaveLength(0);
  });

  it("muestra ejercicios contables únicamente cuando hay uno abierto", async () => {
    renderSummary(summaryFixture("OPEN"));

    const overview = await screen.findByRole("region", { name: "Resumen" });
    expect(within(overview).getByText("Ejercicio contable")).toBeTruthy();
  });

  it("enlaza los accesos rápidos a pantallas operativas existentes", async () => {
    renderSummary();
    await screen.findByRole("region", { name: "Resumen" });

    fireEvent.click(screen.getByRole("button", { name: "Cargar período" }));
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/expediente-mensual"));

    fireEvent.click(screen.getByRole("button", { name: "Materializar obligaciones" }));
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/configuracion-fiscal"));

    fireEvent.click(screen.getByRole("button", { name: "Nueva versión del perfil" }));
    await waitFor(() => expect(screen.getByTestId("current-path").textContent).toBe("/configuracion-fiscal"));
  });
});

function openAccountingFacts() {
  const index = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
  fireEvent.click(within(index).getByRole("button", { name: /Ficha contable/ }));
  return screen.getByRole("region", { name: "Ficha contable" });
}

describe("StudyResumenCliente — datos de contacto y domicilio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: null,
      isReady: true,
      capabilities: new Set(["client.read", "client.manage"]),
      hasClientAccess: () => true,
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renderiza el contacto principal y el domicilio fiscal en la Ficha contable", async () => {
    const contacts: ClientContact[] = [
      {
        id: "contact-secondary",
        name: "Otra persona",
        function: null,
        email: "otra@example.com",
        phone: "111",
        isPrimary: false,
        isActive: true,
      },
      {
        id: "contact-primary",
        name: "Ana Contacto",
        function: "Administración",
        email: "ana@example.com",
        phone: "381-555-0101",
        isPrimary: true,
        isActive: true,
      },
    ];
    renderSummary(summaryFixture("CLOSED", "Av. Rivadavia 123", false), contacts, true);

    expect(await screen.findByRole("heading", { level: 1, name: "Resumen del cliente" })).toBeTruthy();
    const ficha = openAccountingFacts();
    await waitFor(() => expect(within(ficha).getByText("Ana Contacto")).toBeTruthy());
    expect(within(ficha).getByText(/ana@example\.com/)).toBeTruthy();
    expect(within(ficha).getByText(/381-555-0101/)).toBeTruthy();
    expect(within(ficha).getByText("Av. Rivadavia 123")).toBeTruthy();
    expect(within(ficha).queryByText("Otra persona")).toBeNull();
    expect(api.get).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/contacts");

    const navigation = screen.getByRole("navigation", { name: "Secciones internas del cliente" });
    fireEvent.click(within(navigation).getByRole("button", { name: "Perfil fiscal" }));
    expect(
      within(screen.getByRole("region", { name: "Perfil del contribuyente" })).queryByText("Av. Rivadavia 123"),
    ).toBeNull();
  });

  it("muestra No cargado y enlaces de carga cuando la lista de contactos y el domicilio están vacíos", async () => {
    renderSummary(summaryFixture("CLOSED", null, false), [], true);

    expect(await screen.findByRole("heading", { level: 1, name: "Resumen del cliente" })).toBeTruthy();
    const ficha = openAccountingFacts();
    await waitFor(() => expect(within(ficha).getAllByText("No cargado").length).toBeGreaterThanOrEqual(3));
    expect(within(ficha).getByRole("link", { name: "Cargar en Contactos" })).toBeTruthy();
    expect(within(ficha).getByRole("link", { name: "Cargar en Onboarding fiscal" })).toBeTruthy();
  });

  it("no consulta ni expone contactos para quien no tiene client.manage", async () => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(["client.read"]),
    };
    renderSummary(
      summaryFixture("CLOSED", null, false),
      [
        {
          id: "private-contact",
          name: "Dato Privado",
          function: null,
          email: "privado@example.com",
          phone: "999",
          isPrimary: true,
          isActive: true,
        },
      ],
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Resumen del cliente" })).toBeTruthy();
    const ficha = openAccountingFacts();
    await waitFor(() => expect(within(ficha).getByText("Domicilio fiscal")).toBeTruthy());
    expect(within(ficha).queryByText("Contacto principal")).toBeNull();
    expect(within(ficha).queryByText("Dato Privado")).toBeNull();
    expect(
      vi.mocked(api.get).mock.calls.some(([path]: Parameters<typeof api.get>) => path.endsWith("/contacts")),
    ).toBe(false);
  });
});
