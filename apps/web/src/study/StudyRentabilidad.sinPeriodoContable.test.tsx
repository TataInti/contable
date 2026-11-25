// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyRentabilidad } from "./StudyRentabilidad";
import { valorElegido, abrirListado } from "../test/elegirOpcion";

// A27 D27-2 (a). Rentabilidad sin período contable: el cliente no tiene AccountingPeriod, así que la
// barra no trae período y la pantalla resuelve el suyo con sus obligaciones fiscales. `fetch` simulado;
// datos sintéticos «Demo».
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
vi.mock("../context/ClientContext", () => ({ useClientContext: () => contextMock.current }));

const FIRMA = "firm-demo";
const CLIENTE = "client-demo";

const OCTUBRE = {
  id: "00000000-0000-4000-8000-0000000000bb",
  label: "10/2026",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-31T00:00:00.000Z",
};
const NOVIEMBRE = {
  id: "00000000-0000-4000-8000-0000000000bc",
  label: "11/2026",
  startDate: "2026-11-01T00:00:00.000Z",
  endDate: "2026-11-30T00:00:00.000Z",
};

const obligacion = (periodo: typeof OCTUBRE) => ({
  id: `ob-${periodo.label}`,
  regimeId: "regimen-demo",
  periodId: periodo.id,
  status: "PENDING",
  period: periodo,
  regime: { id: "regimen-demo", name: "IVA general", taxType: { id: "imp", name: "IVA" } },
});

const CAJA_COMPLETA = {
  estado: "COMPLETO",
  cifra: "350.00",
  periodo: { id: OCTUBRE.id, etiqueta: "10/2026" },
  desglose: {
    ventasConIva: "1000.00",
    comprasConIva: "400.00",
    impuestos: [
      {
        impuesto: "IVA",
        periodo: "10/2026",
        regimen: "IVA_GENERAL",
        presentacionId: "00000000-0000-4000-8000-0000000000d1",
        totalAPagar: "250.00",
        deduccion: "250.00",
      },
    ],
    totalImpuestos: "250.00",
  },
  faltantes: [],
  comprobantes: { ventas: 12, compras: 7 },
};

let obligaciones: unknown[];
let pedidos: string[];

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function contexto(overrides: Partial<ClientContextValue> = {}): ClientContextValue {
  return {
    firmId: FIRMA,
    clientId: CLIENTE,
    periodId: null,
    isReady: true,
    capabilities: new Set(["profitability.read", "tax.settlements.read"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
    ...overrides,
  } as ClientContextValue;
}

function renderizarRentabilidad() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/rentabilidad"]}>
        <StudyRentabilidad />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pedidos = [];
  obligaciones = [obligacion(OCTUBRE), obligacion(NOVIEMBRE)];
  contextMock.current = contexto();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const url = new URL(String(entrada), "http://localhost");
    pedidos.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/tax-obligations")) return json(200, { data: obligaciones, meta: {} });
    if (url.pathname.endsWith("/profitability/caja-fiscal")) {
      return json(200, { data: CAJA_COMPLETA, meta: {} });
    }
    if (url.pathname.endsWith("/profitability")) return json(200, { data: [], meta: {} });
    return json(404, { error: { code: "NOT_FOUND", message: "Ruta no simulada" } });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Rentabilidad sin período contable (A27 D27-2 a)", () => {
  it("lista los períodos fiscales en su selector y muestra el saldo de caja fiscal", async () => {
    renderizarRentabilidad();

    await screen.findByRole("combobox", {
      name: "Seleccionar período de rentabilidad",
    });
    expect(valorElegido("Seleccionar período de rentabilidad")).toBe(OCTUBRE.id);
    expect(within(abrirListado("Seleccionar período de rentabilidad")).getAllByRole("option").map((opcion) => opcion.textContent)).toEqual([
      "octubre de 2026",
      "noviembre de 2026",
    ]);

    const caja = await screen.findByRole("region", { name: "Saldo fiscal del mes" });
    await within(caja).findByText("Completo");
    expect(pedidos).toContain(
      `/api/v1/firms/${FIRMA}/clients/${CLIENTE}/profitability/caja-fiscal?periodId=${OCTUBRE.id}`,
    );
    expect(screen.queryByText("Elegí un período")).toBeNull();
    expect(screen.queryByText("Sin período fiscal para calcular")).toBeNull();
  });

  it("sin obligaciones fiscales muestra su estado vacío y no ofrece selector ni saldo", async () => {
    obligaciones = [];
    contextMock.current = contexto({
      capabilities: new Set(["profitability.read", "tax.profile.write"]),
    });
    renderizarRentabilidad();

    expect(await screen.findByText("Sin período fiscal para calcular")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configurar período fiscal" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Seleccionar período de rentabilidad" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Saldo fiscal del mes" })).toBeNull();
  });
});
