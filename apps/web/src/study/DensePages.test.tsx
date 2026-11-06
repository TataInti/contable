// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyAdministracionPlataforma } from "./StudyAdministracionPlataforma";
import { StudyBandeja } from "./StudyBandeja";
import { StudyContabilidad } from "./StudyContabilidad";
import { StudyExpedienteMensual } from "./StudyExpedienteMensual";
import { StudyLiquidaciones } from "./StudyLiquidaciones";
import { StudyRentabilidad } from "./StudyRentabilidad";
import { StudyReportes } from "./StudyReportes";
import { StudyResumenCliente } from "./StudyResumenCliente";
import { StudyTrabajo } from "./StudyTrabajo";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: { firms: [{ firmId: "firm-a", firmName: "Estudio Demo" }] },
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
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

const flagsFixture = [
  { id: "f1", code: "DOCUMENTS", enabled: true },
  { id: "f2", code: "TAX", enabled: false },
  { id: "f3", code: "REPORTING", enabled: true },
];

function renderPage(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Páginas con el marco denso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: "period-a",
      isReady: true,
      capabilities: new Set(["client.read", "platform.modules.manage"]),
      hasClientAccess: () => true,
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path.includes("/feature-flags")) return Promise.resolve(flagsFixture);
      return Promise.resolve([]);
    }) as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["Trabajo", <StudyTrabajo key="t" />],
    ["Bandeja documental", <StudyBandeja key="b" />],
    ["Liquidaciones", <StudyLiquidaciones key="l" />],
    ["Rentabilidad", <StudyRentabilidad key="r" />],
    ["Reportes y análisis", <StudyReportes key="re" />],
    ["Contabilidad", <StudyContabilidad key="c" />],
    ["Expediente mensual", <StudyExpedienteMensual key="e" />],
  ])("%s mantiene su título y la estructura densa", async (title, element) => {
    renderPage(element);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".dense-page")).not.toBeNull());
    expect(document.querySelector(".dense-head")).not.toBeNull();
  });

  it("Resumen del cliente no se rompe sin datos consolidados", async () => {
    renderPage(<StudyResumenCliente />);
    await waitFor(() => expect(document.body.textContent?.length).toBeGreaterThan(0));
  });

  it("Módulos de estudios filtra por estado y búsqueda", async () => {
    renderPage(<StudyAdministracionPlataforma />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Bandeja documental")).toBeTruthy();
    expect(within(table).getByText("Módulo fiscal")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "off" } });
    expect(within(screen.getByRole("table")).queryByText("Bandeja documental")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("Módulo fiscal")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Buscar módulos/), { target: { value: "reportes" } });
    expect(within(screen.getByRole("table")).getByText("Reportes")).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("Módulo fiscal")).toBeNull();
  });
});
