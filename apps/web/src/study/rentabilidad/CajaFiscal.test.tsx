// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { StudyRentabilidad } from "../StudyRentabilidad";
import { CajaFiscal } from "./CajaFiscal";

// Corte 8b. `fetch` simulado, así que pasa por el cliente API real. Datos sintéticos «Demo».
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
vi.mock("../../context/ClientContext", () => ({ useClientContext: () => contextMock.current }));

const FIRMA = "firm-demo";
const CLIENTE = "client-demo";
const PERIODO = "00000000-0000-4000-8000-0000000000bb";
const PERIODO_CONTABLE = "00000000-0000-4000-8000-0000000000cc";
const RANGO = {
  id: PERIODO,
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-31T00:00:00.000Z",
};

const DJ_IVA = {
  impuesto: "IVA",
  periodo: "10/2026",
  regimen: "IVA_GENERAL",
  presentacionId: "00000000-0000-4000-8000-0000000000d1",
  totalAPagar: "250.00",
  deduccion: "250.00",
};
const COMPLETO = {
  estado: "COMPLETO",
  cifra: "350.00",
  periodo: { id: PERIODO, etiqueta: "10/2026" },
  desglose: {
    ventasConIva: "1000.00",
    comprasConIva: "400.00",
    impuestos: [DJ_IVA],
    totalImpuestos: "250.00",
  },
  faltantes: [],
  comprobantes: { ventas: 12, compras: 7 },
};
const PARCIAL = {
  ...COMPLETO,
  estado: "PARCIAL",
  cifra: null,
  faltantes: [{ impuesto: "IIBB", periodo: "10/2026", regimen: "CONVENIO_MULTILATERAL" }],
};
const SIN_DATOS = {
  ...COMPLETO,
  estado: "SIN_DATOS",
  cifra: null,
  desglose: null,
  comprobantes: { ventas: 0, compras: 0 },
};

const ANIO_CONTABLE = {
  id: "anio-2026",
  label: "2026",
  periods: [{ ...RANGO, id: PERIODO_CONTABLE, status: "OPEN" }],
};
const OBLIGACION = {
  id: "ob-1",
  regimeId: "regimen-demo",
  periodId: PERIODO,
  status: "PENDING",
  period: { ...RANGO, label: "10/2026" },
  regime: { id: "regimen-demo", name: "IVA general", taxType: { id: "imp", name: "IVA" } },
};

type Respuesta = { status: number; cuerpo: unknown } | "pendiente";
let respuesta: () => Respuesta;
let pedidos: string[];

const ok = (data: unknown): Respuesta => ({ status: 200, cuerpo: { data, meta: {} } });
const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function contexto(capacidades = ["profitability.read", "tax.settlements.read"]) {
  return {
    firmId: FIRMA,
    clientId: CLIENTE,
    periodId: PERIODO,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as ClientContextValue;
}

function Ubicacion() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

function renderizarCaja() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/rentabilidad"]}>
        <CajaFiscal periodo={RANGO} />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function seccionCon(texto: string) {
  const seccion = await screen.findByRole("region", { name: "Saldo fiscal del mes" });
  await within(seccion).findByText(texto);
  return seccion;
}

// Intl separa con espacio no separable y el texto del DOM se normaliza: comparamos igual.
const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })
    .format(n)
    .replace(/\s/g, " ");
const textoDe = (el: Element | null | undefined) => el?.textContent?.replace(/\s/g, " ");

beforeEach(() => {
  pedidos = [];
  contextMock.current = contexto();
  respuesta = () => ok(COMPLETO);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => {
    const url = new URL(String(entrada), "http://localhost");
    pedidos.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/profitability/caja-fiscal")) {
      const r = respuesta();
      return r === "pendiente" ? new Promise<Response>(() => undefined) : json(r.status, r.cuerpo);
    }
    if (url.pathname.endsWith("/fiscal-years")) return json(200, { data: [ANIO_CONTABLE] });
    if (url.pathname.endsWith("/tax-obligations")) return json(200, { data: [OBLIGACION] });
    if (url.pathname.endsWith("/profitability")) return json(200, { data: [] });
    return json(404, { error: { code: "NOT_FOUND", message: "Ruta no simulada" } });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Saldo fiscal del mes en Rentabilidad (corte 8b)", () => {
  it("COMPLETO: cifra, desglose y sin enlace al Legajo", async () => {
    renderizarCaja();
    const seccion = await seccionCon("Completo");

    expect(textoDe(seccion.querySelector(".caja-fiscal__cifra"))).toBe(pesos(350));
    const tabla = within(seccion).getByRole("table", { name: "Desglose del saldo fiscal" });
    expect(within(tabla).getByText("Ventas con IVA")).toBeTruthy();
    expect(within(tabla).getByText("IVA · octubre de 2026")).toBeTruthy();
    expect(within(tabla).getByText(pesos(1000))).toBeTruthy();
    expect(within(tabla).getByText(pesos(400))).toBeTruthy();
    expect(within(tabla).getAllByText(pesos(250))).toHaveLength(2);
    expect(within(seccion).queryByRole("button", { name: "Abrir el Legajo" })).toBeNull();
    expect(pedidos).toContain(
      `/api/v1/firms/${FIRMA}/clients/${CLIENTE}/profitability/caja-fiscal?periodId=${PERIODO}`,
    );
  });

  it("PARCIAL: sin cifra, faltantes y enlace al Legajo del período contable", async () => {
    respuesta = () => ok(PARCIAL);
    renderizarCaja();
    const seccion = await seccionCon("Parcial");

    expect(seccion.querySelector(".caja-fiscal__cifra")).toBeNull();
    expect(within(seccion).getByText("Falta cargar 1 declaración jurada")).toBeTruthy();
    expect(within(seccion).getByText("Ingresos Brutos Convenio Multilateral · octubre de 2026")).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: "Abrir el Legajo" }));
    await waitFor(() => expect(screen.getByTestId("ruta").textContent).toBe("/expediente-mensual"));
    expect(contextMock.current.setClientId).toHaveBeenCalledWith(CLIENTE);
    expect(contextMock.current.setPeriodId).toHaveBeenCalledWith(PERIODO_CONTABLE);
  });

  it("PARCIAL sin permiso del Legajo: lista lo que falta y no ofrece el enlace", async () => {
    contextMock.current = contexto(["profitability.read"]);
    respuesta = () => ok(PARCIAL);
    renderizarCaja();
    const seccion = await seccionCon("Parcial");

    expect(within(seccion).getByText("Ingresos Brutos Convenio Multilateral · octubre de 2026")).toBeTruthy();
    expect(within(seccion).queryByRole("button", { name: "Abrir el Legajo" })).toBeNull();
  });

  it("SIN_DATOS: muestra el motivo y no cifra ni tabla", async () => {
    respuesta = () => ok(SIN_DATOS);
    renderizarCaja();
    const seccion = await seccionCon("Sin datos para calcular el saldo fiscal");

    expect(
      within(seccion).getByText(/No hay comprobantes aprobados de ventas ni de compras/),
    ).toBeTruthy();
    expect(seccion.querySelector(".caja-fiscal__cifra")).toBeNull();
    expect(within(seccion).queryByRole("table")).toBeNull();
  });

  it("cargando: anuncia el cálculo y no muestra resultados", async () => {
    respuesta = () => "pendiente";
    renderizarCaja();
    const estado = await screen.findByRole("status");

    expect(estado.textContent).toContain("Calculando el saldo fiscal…");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("error 422 de tipo de cambio: muestra el motivo de la API y no reintenta solo", async () => {
    respuesta = () => ({
      status: 422,
      cuerpo: {
        error: {
          code: "TIPO_DE_CAMBIO_REQUERIDO",
          message: "Hay 1 comprobante(s) en moneda extranjera sin tipo de cambio.",
        },
      },
    });
    renderizarCaja();
    const seccion = await seccionCon("No se pudo calcular el saldo fiscal");

    expect(
      within(seccion).getByText(/Hay 1 comprobante\(s\) en moneda extranjera sin tipo de cambio/),
    ).toBeTruthy();
    expect(within(seccion).getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(pedidos.filter((p) => p.includes("/profitability/caja-fiscal"))).toHaveLength(1);
  });

  it("error de servidor: «Reintentar» vuelve a pedir y muestra la cifra", async () => {
    let intento = 0;
    respuesta = () => {
      intento += 1;
      return intento === 1
        ? { status: 500, cuerpo: { error: { code: "INTERNAL" } } }
        : ok(COMPLETO);
    };
    renderizarCaja();
    const seccion = await seccionCon("El servidor no está disponible en este momento");
    fireEvent.click(within(seccion).getByRole("button", { name: "Reintentar" }));

    await seccionCon("Completo");
    expect(textoDe(seccion.querySelector(".caja-fiscal__cifra"))).toBe(pesos(350));
  });

  it("Rentabilidad: el bloque va debajo del resultado gerencial", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/rentabilidad"]}>
          <StudyRentabilidad />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const seccion = await screen.findByRole("region", { name: "Saldo fiscal del mes" });
    const grilla = document.querySelector(".profitability-grid");

    expect(grilla).not.toBeNull();
    const posicion = grilla?.compareDocumentPosition(seccion) ?? 0;
    expect(posicion & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
