// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import { CLIENTE_DEMO, FIRMA_DEMO, PERIODO_ELEGIDO_DEMO, rutasDemo } from "./datosDemoLegajo";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyExpedienteMensual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function llamadas(fragmento: string) {
  return vi.mocked(api.get).mock.calls.filter(([path]) => String(path).includes(fragmento)).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(["client.read", "tax.settlements.calculate"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.get).mockImplementation(rutasDemo() as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · lista de legajos y tarjeta (K8)", () => {
  it("anuncia con role status la carga de los legajos", async () => {
    const rutas = rutasDemo();
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.includes("/monthly-tax-workpapers?") ? new Promise(() => {}) : rutas(path)) as never);
    renderPage();

    const texto = await screen.findByText("Cargando legajos…");
    expect(texto.closest("[role='status']")).not.toBeNull();
  });

  it("muestra el error de la lista de legajos", async () => {
    const rutas = rutasDemo();
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.includes("/monthly-tax-workpapers?")
        ? Promise.reject(new Error("Falla de red"))
        : rutas(path)) as never);
    renderPage();

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No se pudieron cargar los legajos");
  });

  it("sin período no consulta legajos y pide elegir uno", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [] }) as never);
    renderPage();

    expect(await screen.findByText("Configurá un período fiscal")).toBeTruthy();
    expect(llamadas("monthly-tax-workpapers?")).toBe(0);
  });

  it("sin legajos ofrece Nuevo legajo y envía el alta del período", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ legajos: [] }) as never);
    renderPage();

    // vigente: cambia con A29 (antes: «Sin legajos para este período»)
    expect(await screen.findByText("Creá el legajo para reunir las fuentes, clasificar y calcular la liquidación del período.")).toBeTruthy();
    expect(screen.queryByText("Sin legajos para este período")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo legajo" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/monthly-tax-workpapers$/), {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      }),
    );
  });

  it("muestra la barra con período, estado y etapas, y la etapa activa en el contenido", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    const barra = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    expect(barra.querySelector('[data-status="COLLECTING_INPUTS"]')).not.toBeNull(); // vigente: cambia con A29
    const pestanas = within(barra).getAllByRole("tab");
    expect(pestanas).toHaveLength(6);
    expect(within(barra).getByRole("tab", { name: "Saldos" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(pestanas[0]!.getAttribute("aria-controls")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inicio del proceso" })).toBeNull();
    fireEvent.click(within(barra).getByRole("tab", { name: "Fuentes" }));
    expect(within(barra).getByRole("tab", { name: "Fuentes" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
