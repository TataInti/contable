// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxPanelResponse, TaxPanelRow } from "@contable/contracts";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyPanelTrabajo } from "./StudyPanelTrabajo";

// Regresión del corte 4b (corrección): estas pruebas mockean `fetch` y no `api`, así que pasan por el
// cliente real. Si la pantalla recibe solo el arreglo `data` y pierde `meta`, fallan.
// Datos sintéticos rotulados: no son clientes ni obligaciones reales.
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const sessionMock = vi.hoisted(() => ({ me: null as unknown }));

vi.mock("../context/ClientContext", () => ({ useClientContext: () => contextMock.current }));
vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: sessionMock.me,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

const FIRMA = "firm-a";
const USUARIO = "00000000-0000-4000-8000-000000000001";
const OTRO = "00000000-0000-4000-8000-000000000002";
const IMPUESTO = "00000000-0000-4000-8000-0000000000aa";
const PERIODO = "00000000-0000-4000-8000-0000000000bb";

const FILA_BASE: TaxPanelRow = {
  obligationId: "ob-1",
  clientId: "client-a",
  clientName: "Cliente Demo 1 S.R.L.",
  cuit: "20111111112",
  cuitEnding: "2",
  taxTypeId: IMPUESTO,
  taxTypeName: "IVA",
  regimeId: "regimen-demo",
  regimeName: "IVA general",
  jurisdictionId: "jurisdiccion-demo",
  jurisdictionName: "Nacional",
  periodId: PERIODO,
  periodLabel: "10/2026",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  dueDate: "2026-11-20",
  dueDateSource: "CALENDAR",
  calculatedDueDate: null,
  daysUntilDue: 5,
  legajo: null,
  filing: null,
  djState: "SIN_LEGAJO",
  assigneeCount: 1,
  responsables: [{ userId: USUARIO, name: "Ana Demo", isSelf: true }],
};

function fila(parcial: Partial<TaxPanelRow> = {}): TaxPanelRow {
  return { ...FILA_BASE, ...parcial };
}

/** Cuerpo completo de la API: `data` más `meta` (total, paginación, asOf y opciones de los filtros). */
function cuerpo(
  datos: TaxPanelRow[],
  meta: Partial<TaxPanelResponse["meta"]> = {},
): TaxPanelResponse {
  return {
    data: datos,
    meta: {
      total: datos.length,
      limit: 100,
      offset: 0,
      asOf: "2026-11-15",
      groups: null,
      groupsComplete: true,
      options: {
        responsables: [
          { userId: USUARIO, name: "Ana Demo" },
          { userId: OTRO, name: "Beto Demo" },
        ],
        taxTypes: [{ id: IMPUESTO, name: "IVA" }],
        periods: [{ id: PERIODO, label: "10/2026" }],
        grupos: [],
      },
      ...meta,
    },
  };
}

function contexto(): ClientContextValue {
  return {
    firmId: FIRMA,
    clientId: null,
    periodId: null,
    isReady: true,
    capabilities: new Set(["tax.settlements.read"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderPanel(ruta = "/panel-trabajo") {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <StudyPanelTrabajo />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Red simulada: solo `fetch`. Las rutas no simuladas responden 404 para que el fallo se vea.
interface RespuestaSimulada {
  status: number;
  cuerpo: unknown;
}
let respuestaPanel: (url: URL) => RespuestaSimulada = () => ({
  status: 200,
  cuerpo: cuerpo([fila()], { total: 1 }),
});
const pedidos: string[] = [];

function json(status: number, cuerpoJson: unknown): Response {
  return new Response(JSON.stringify(cuerpoJson), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  pedidos.length = 0;
  sessionMock.me = {
    userId: USUARIO,
    firms: [
      { firmId: FIRMA, firmName: "Estudio Demo", role: "PREPARER", capabilities: [], clients: [] },
    ],
  };
  contextMock.current = contexto();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const url = new URL(String(entrada), "http://localhost");
    pedidos.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/portfolio/tax-worklist/obligations")) {
      const simulada = respuestaPanel(url);
      return json(simulada.status, simulada.cuerpo);
    }
    if (url.pathname.endsWith("/fiscal-years")) return json(200, []);
    return json(404, { error: { code: "NOT_FOUND", message: "Ruta no simulada en la prueba" } });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tablaPanel = () => screen.findByRole("table", { name: "Panel de trabajo" });
const valorIndicador = (etiqueta: string) =>
  screen
    .getByText(etiqueta, { selector: ".dense-stat__label" })
    .parentElement?.querySelector(".dense-stat__value")?.textContent;

describe("Panel de trabajo: lectura por la red simulada (corte 4b, corrección)", () => {
  it("la vista inicial pinta las filas, el pie con meta.total y los indicadores", async () => {
    respuestaPanel = () => ({ status: 200, cuerpo: cuerpo([fila()], { total: 2 }) });
    renderPanel();
    await tablaPanel();
    expect(screen.getByText("Cliente Demo 1 S.R.L.")).toBeTruthy();
    expect(screen.getByText("1 de 2 obligaciones")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeTruthy();
    expect(valorIndicador("Sin legajo")).toBe("1");
    expect(screen.getAllByText("sobre las 1 filas cargadas")).toHaveLength(4);
    expect(pedidos.find((ruta) => ruta.includes("/tax-worklist/obligations"))).toContain(
      "responsable=me",
    );
  });

  it("las opciones de Responsable e Impuesto salen de meta.options de la respuesta", async () => {
    renderPanel();
    await tablaPanel();
    const responsable = screen.getByRole("combobox", { name: "Responsable" });
    expect(within(responsable).getByRole("option", { name: "Beto Demo" })).toBeTruthy();
    const impuesto = screen.getByRole("combobox", { name: "Impuesto" });
    expect(within(impuesto).getByRole("option", { name: "IVA" })).toBeTruthy();
  });

  it("«Cargar más» pide la página siguiente por la red y suma sus filas al pie", async () => {
    respuestaPanel = (url) =>
      url.searchParams.get("offset") === "1"
        ? {
            status: 200,
            cuerpo: cuerpo([fila({ obligationId: "ob-2", clientName: "Cliente Demo 2" })], {
              total: 2,
              offset: 1,
            }),
          }
        : { status: 200, cuerpo: cuerpo([fila()], { total: 2 }) };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(
      await screen.findByRole("button", { name: "Abrir cliente Cliente Demo 2" }),
    ).toBeTruthy();
    expect(screen.getByText("2 de 2 obligaciones")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(pedidos.some((ruta) => ruta.includes("offset=1"))).toBe(true);
  });

  it("un 400 por rango inválido muestra el mensaje de la API y deja «no disponible» en los indicadores", async () => {
    respuestaPanel = () => ({
      status: 400,
      cuerpo: {
        error: {
          code: "VALIDATION_ERROR",
          message: "El vencimiento «hasta» es anterior a «desde»",
        },
      },
    });
    renderPanel("/panel-trabajo?desde=2026-12-31&hasta=2026-01-01");
    expect(await screen.findByText("No se pudo cargar el panel de trabajo")).toBeTruthy();
    expect(screen.getByText("El vencimiento «hasta» es anterior a «desde»")).toBeTruthy();
    expect(valorIndicador("Vencidas")).toBe("no disponible");
  });
});
