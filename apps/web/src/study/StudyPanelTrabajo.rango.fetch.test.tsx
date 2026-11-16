// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxPanelResponse, TaxPanelRow } from "@contable/contracts";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyPanelTrabajo } from "./StudyPanelTrabajo";

// Hallazgo 58. Estas pruebas mockean solo `fetch`: pasan por el cliente de consultas real.
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
const MENSAJE = "La fecha hasta tiene que ser igual o posterior a la fecha desde";

const FILA: TaxPanelRow = {
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

function cuerpo(datos: TaxPanelRow[]): TaxPanelResponse {
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

function json(status: number, cuerpoJson: unknown): Response {
  return new Response(JSON.stringify(cuerpoJson), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

const pedidos: string[] = [];

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
      return json(200, cuerpo([FILA]));
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

describe("Panel de trabajo: rango de vencimiento inválido (hallazgo 58)", () => {
  it("con «hasta» anterior a «desde» no se pide a la API: la tabla sigue y el mensaje queda junto a las fechas", async () => {
    renderPanel();
    await tablaPanel();
    const hasta = screen.getByLabelText("Vencimiento hasta");
    fireEvent.change(hasta, { target: { value: "2026-10-01" } });
    const mensaje = await screen.findByText(MENSAJE);
    expect(pedidos.some((ruta) => ruta.includes("dueTo=2026-10-01"))).toBe(false);
    expect(screen.getByText("Cliente Demo 1 S.R.L.")).toBeTruthy();
    for (const campo of [screen.getByLabelText("Vencimiento desde"), hasta]) {
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(campo.getAttribute("aria-describedby")?.split(" ")).toContain(mensaje.id);
    }
  });

  it("al corregir la fecha vuelve a pedir a la API con el rango corregido", async () => {
    renderPanel();
    await tablaPanel();
    const hasta = screen.getByLabelText("Vencimiento hasta");
    fireEvent.change(hasta, { target: { value: "2026-10-01" } });
    await screen.findByText(MENSAJE);
    fireEvent.change(hasta, { target: { value: "2026-11-30" } });
    await waitFor(() =>
      expect(pedidos.some((ruta) => ruta.includes("dueTo=2026-11-30"))).toBe(true),
    );
    expect(screen.queryByText(MENSAJE)).toBeNull();
    expect(await screen.findByText("Cliente Demo 1 S.R.L.")).toBeTruthy();
  });

  it("con el rango invertido en la URL no se pide ese rango y el mensaje aparece junto a las fechas", async () => {
    renderPanel("/panel-trabajo?desde=2026-12-31&hasta=2026-01-01");
    await tablaPanel();
    expect(await screen.findByText(MENSAJE)).toBeTruthy();
    expect(pedidos.some((ruta) => ruta.includes("dueFrom=2026-12-31&dueTo=2026-01-01"))).toBe(
      false,
    );
  });
});
