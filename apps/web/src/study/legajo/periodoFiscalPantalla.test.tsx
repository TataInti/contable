// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  periodoIibbDemo,
  periodoIvaDemo,
  rutasDemo,
} from "./datosDemoLegajo";

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

// Clave de sessionStorage del período elegido (K15).
const CLAVE = `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`;

// Período «Demo» de septiembre: otro intervalo para ver que el legajo vuelve a consultarse.
const periodoSeptiembreDemo = {
  ...periodoIvaDemo,
  id: "period-iva-sep",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  label: "2026-09",
};

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
  sessionStorage.setItem(CLAVE, PERIODO_ELEGIDO_DEMO);
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
});

afterEach(() => {
  cleanup();
});

describe("Legajo · selector de período fiscal (K15)", () => {
  it("elige el primer período activo cuando no hay elección guardada", async () => {
    sessionStorage.clear();
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoIvaDemo] }) as never,
    );
    renderPage();

    const selector = (await screen.findByRole("combobox", {
      name: "Período fiscal",
    })) as HTMLSelectElement;
    await waitFor(() => expect(selector.value).toBe("period-a"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-a");
  });

  it("conserva la elección guardada en la sesión", async () => {
    sessionStorage.setItem(CLAVE, "period-iva");
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoIvaDemo] }) as never,
    );
    renderPage();

    const selector = (await screen.findByRole("combobox", {
      name: "Período fiscal",
    })) as HTMLSelectElement;
    await waitFor(() => expect(selector.value).toBe("period-iva"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-iva");
  });

  it("guarda el cambio de período y consulta el legajo de ese período", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoSeptiembreDemo] }) as never,
    );
    renderPage();

    const selector = await screen.findByRole("combobox", { name: "Período fiscal" });
    fireEvent.change(selector, { target: { value: "period-iva-sep" } });

    await waitFor(() => expect(sessionStorage.getItem(CLAVE)).toBe("period-iva-sep"));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers?from=2026-09-01&to=2026-09-30"),
      ),
    );
  });

  it("oculta los impuestos inactivos", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({
        periodos: [
          periodoIibbDemo,
          { ...periodoIvaDemo, taxType: { name: "IVA", isActive: false } },
        ],
      }) as never,
    );
    renderPage();

    const selector = await screen.findByRole("combobox", { name: "Período fiscal" });
    expect(within(selector).getByRole("option", { name: /Ingresos Brutos/ })).toBeTruthy();
    expect(within(selector).queryByRole("option", { name: /IVA/ })).toBeNull();
  });

  it("ofrece Reintentar cuando fallan los períodos fiscales", async () => {
    const rutas = rutasDemo();
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/tax-periods")
        ? Promise.reject(new Error("Sin respuesta"))
        : rutas(path)) as never);
    renderPage();

    expect(await screen.findByText("No se pudieron cargar los períodos fiscales")).toBeTruthy();
    const antes = llamadas("/tax-periods");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadas("/tax-periods")).toBeGreaterThan(antes));
  });

  it("sin períodos activos pide configurar uno y no consulta legajos", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [] }) as never);
    renderPage();

    expect(await screen.findByText("Configurá un período fiscal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir configuración fiscal" })).toBeTruthy();
    expect(screen.getByText("Elegí un período fiscal")).toBeTruthy();
    expect(llamadas("monthly-tax-workpapers?")).toBe(0);
  });
});
