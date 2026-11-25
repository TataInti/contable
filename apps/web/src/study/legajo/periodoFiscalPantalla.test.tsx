// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import { abrirListado, elegirOpcion, valorElegido } from "../../test/elegirOpcion";
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

    await screen.findByRole("combobox", { name: "Período fiscal" });
    await waitFor(() => expect(valorElegido("Período fiscal")).toBe("period-a"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-a");
  });

  it("conserva la elección guardada en la sesión", async () => {
    sessionStorage.setItem(CLAVE, "period-iva-sep");
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoSeptiembreDemo] }) as never,
    );
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    await waitFor(() => expect(valorElegido("Período fiscal")).toBe("period-iva-sep"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-iva-sep");
  });

  it("un período guardado de otro impuesto del mismo mes elige la entrada de ese mes", async () => {
    sessionStorage.setItem(CLAVE, "period-iva");
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoIvaDemo] }) as never,
    );
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    await waitFor(() => expect(valorElegido("Período fiscal")).toBe("period-a"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-a");
    const opciones = within(abrirListado("Período fiscal")).getAllByRole("option");
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(["Seleccioná un mes…", "Octubre de 2026"]);
  });

  it("guarda el cambio de período y consulta el legajo de ese período", async () => {
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ periodos: [periodoIibbDemo, periodoSeptiembreDemo] }) as never,
    );
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    elegirOpcion("Período fiscal", /Septiembre de 2026/);

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
          { ...periodoSeptiembreDemo, taxType: { name: "IVA", isActive: false } },
        ],
      }) as never,
    );
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    const opciones = within(abrirListado("Período fiscal"));
    expect(opciones.getByRole("option", { name: "Octubre de 2026" })).toBeTruthy();
    expect(opciones.queryByRole("option", { name: /Septiembre/ })).toBeNull();
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
    expect(screen.getByText("Sin períodos fiscales")).toBeTruthy(); // vigente: cambia con A29
    expect(llamadas("monthly-tax-workpapers?")).toBe(0);
  });
});

describe("Legajo · «Abrir <mes>» (09-2, 18-5)", () => {
  const permisosConEscritura = () => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(["client.read", "tax.settlements.calculate", "tax.profile.write"]),
    } as unknown as ClientContextValue;
  };
  const periodoNoviembre = { ...periodoIibbDemo, id: "period-nov", startDate: "2026-11-01", endDate: "2026-11-30", label: "Noviembre 2026" };
  const resultadoApertura = { month: "2026-11", label: "Noviembre 2026", regimes: 2, periodsCreated: 2, obligationsCreated: 2, calendarNotices: [] };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ofrece abrir el mes siguiente al último; al elegirlo crea período y obligaciones y lo deja elegido", async () => {
    permisosConEscritura();
    let abierto = false;
    const rutas = rutasDemo({ periodos: [periodoIibbDemo] });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/tax-periods") ? Promise.resolve(abierto ? [periodoNoviembre, periodoIibbDemo] : [periodoIibbDemo]) : rutas(path)) as never);
    vi.mocked(api.post).mockImplementation((async () => {
      abierto = true;
      return resultadoApertura;
    }) as never);
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    const opciones = within(abrirListado("Período fiscal")).getAllByRole("option");
    expect(opciones.map((opcion) => opcion.textContent)).toEqual([
      "Seleccioná un mes…",
      "Octubre de 2026",
      "Abrir noviembre de 2026",
    ]);
    elegirOpcion("Período fiscal", "Abrir noviembre de 2026");

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/tax-periods/open-month`,
        { month: "2026-11" },
      ),
    );
    await waitFor(() => expect(valorElegido("Período fiscal")).toBe("period-nov"));
    expect(sessionStorage.getItem(CLAVE)).toBe("period-nov");
  });

  it("sin permiso de escritura fiscal no ofrece abrir el mes", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [periodoIibbDemo] }) as never);
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    const opciones = within(abrirListado("Período fiscal")).getAllByRole("option");
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(["Seleccioná un mes…", "Octubre de 2026"]);
  });

  it("con el mes actual ya abierto no hay nada para abrir", async () => {
    permisosConEscritura();
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [periodoNoviembre] }) as never);
    renderPage();

    await screen.findByRole("combobox", { name: "Período fiscal" });
    const opciones = within(abrirListado("Período fiscal")).getAllByRole("option");
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(["Seleccioná un mes…", "Noviembre de 2026"]);
  });

  it("un cliente sin períodos ofrece «Abrir octubre de 2026» (el mes anterior) en el cuerpo", async () => {
    permisosConEscritura();
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [] }) as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Abrir octubre de 2026" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/tax-periods/open-month`,
        { month: "2026-10" },
      ),
    );
    expect(screen.getByRole("button", { name: "Abrir configuración fiscal" })).toBeTruthy();
  });
});
