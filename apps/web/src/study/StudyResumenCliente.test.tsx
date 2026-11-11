// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      postWithHeaders: vi.fn(),
    } as unknown as typeof actual.api,
  };
});

function summaryFixture(fiscalAddress: string | null): ClientSummary {
  return {
    client: {
      id: "client-a",
      legalName: "Alfa Uno S.A.",
      tradeName: null,
      cuit: "20111111112",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      profile: null,
      onboarding: null,
    },
    accounting: { fiscalYears: [] },
    fiscal: {
      profiles: [
        {
          id: "profile-v1",
          version: 1,
          legalName: "Alfa Uno S.A.",
          cuit: "20111111112",
          personType: "JURIDICA",
          nationalCondition: "RESPONSABLE_INSCRIPTO",
          fiscalAddress,
          fiscalYearEndMonth: 12,
          monotributoCategory: null,
          validFrom: "2026-01-01",
          validTo: null,
          status: "ACTIVE",
          source: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      registrations: [],
      activities: [],
      periods: [],
      obligations: [],
    },
    counts: { accounts: 0, counterparties: 0, costCenters: 0 },
  };
}

function renderSummary(contacts: ClientContact[], fiscalAddress: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/summary")) return Promise.resolve(summaryFixture(fiscalAddress));
    if (path.endsWith("/contacts")) return Promise.resolve(contacts);
    return Promise.resolve([]);
  }) as never);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StudyResumenCliente />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
    renderSummary(contacts, "Av. Rivadavia 123");

    expect(await screen.findByRole("heading", { level: 1, name: "Resumen del cliente" })).toBeTruthy();
    const ficha = openAccountingFacts();
    await waitFor(() => expect(within(ficha).getByText("Ana Contacto")).toBeTruthy());
    expect(within(ficha).getByText(/ana@example\.com/)).toBeTruthy();
    expect(within(ficha).getByText(/381-555-0101/)).toBeTruthy();
    expect(within(ficha).getByText("Av. Rivadavia 123")).toBeTruthy();
    expect(within(ficha).queryByText("Otra persona")).toBeNull();
    expect(api.get).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/contacts");
  });

  it("muestra No cargado y enlaces de carga cuando la lista de contactos y el domicilio están vacíos", async () => {
    renderSummary([], null);

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
      null,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Resumen del cliente" })).toBeTruthy();
    const ficha = openAccountingFacts();
    await waitFor(() => expect(within(ficha).getByText("Domicilio fiscal")).toBeTruthy());
    expect(within(ficha).queryByText("Contacto principal")).toBeNull();
    expect(within(ficha).queryByText("Dato Privado")).toBeNull();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path.endsWith("/contacts"))).toBe(false);
  });
});
