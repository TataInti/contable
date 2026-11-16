// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxPanelResponse, TaxPanelRow } from "@contable/contracts";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyPanelTrabajo } from "./StudyPanelTrabajo";

// Datos sintéticos rotulados: no son clientes ni obligaciones reales.
const apiMock = vi.hoisted(() => ({ get: vi.fn(), getEnvelope: vi.fn() }));
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const sessionMock = vi.hoisted(() => ({ me: null as unknown }));

vi.mock("../lib/api", () => ({ api: apiMock }));
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
const CLIENTE = "Cliente Demo 1 S.R.L.";

const FILA_BASE: TaxPanelRow = {
  obligationId: "ob-1",
  clientId: "client-a",
  clientName: CLIENTE,
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

function respuesta(
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

function contexto(overrides: Partial<ClientContextValue> = {}): ClientContextValue {
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
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="ubicacion">{`${location.pathname}${location.search}`}</div>;
}

function renderPanel(ruta = "/panel-trabajo") {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <StudyPanelTrabajo />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent ?? "";
const rutasPedidas = (): string[] =>
  apiMock.getEnvelope.mock.calls.map((llamada) => String(llamada[0]));
const ultimaRuta = () => rutasPedidas()[rutasPedidas().length - 1] ?? "";
const valorIndicador = (etiqueta: string) =>
  screen
    .getByText(etiqueta, { selector: ".dense-stat__label" })
    .parentElement?.querySelector(".dense-stat__value")?.textContent;
const tablaPanel = () => screen.findByRole("table", { name: "Panel de trabajo" });

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.getEnvelope.mockReset();
  sessionMock.me = {
    userId: USUARIO,
    firms: [
      { firmId: FIRMA, firmName: "Estudio Demo", role: "PREPARER", capabilities: [], clients: [] },
    ],
  };
  contextMock.current = contexto();
  apiMock.getEnvelope.mockResolvedValue(respuesta([fila()]));
});

afterEach(() => cleanup());

describe("Panel de trabajo: pantalla", () => {
  it("abre en «Mis obligaciones», con un solo h1 y sin ventana de fechas explícita", async () => {
    renderPanel();
    await tablaPanel();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Panel de trabajo");
    expect(rutasPedidas()[0]).toContain("responsable=me");
    expect(rutasPedidas()[0]).not.toContain("dueFrom");
    expect(ubicacion()).toBe("/panel-trabajo");
  });

  it("guarda los filtros en la URL y «Quitar filtros» vuelve a la vista inicial", async () => {
    renderPanel();
    await tablaPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Responsable" }), {
      target: { value: "todos" },
    });
    await waitFor(() => expect(ubicacion()).toBe("/panel-trabajo?responsable=todos"));
    expect(ultimaRuta()).not.toContain("responsable=");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    await waitFor(() => expect(ubicacion()).toBe("/panel-trabajo"));
    expect(ultimaRuta()).toContain("responsable=me");
  });

  it("filtra por terminación de CUIT con el selector de dígitos", async () => {
    renderPanel();
    await tablaPanel();
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    await waitFor(() => expect(ubicacion()).toContain("terminacion=1"));
    expect(ultimaRuta()).toContain("terminacion=1");
    expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("muestra la carga mientras llega la respuesta, con los indicadores en «pendiente»", () => {
    apiMock.getEnvelope.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("Cargando el panel de trabajo…")).toBeTruthy();
    expect(valorIndicador("Vencidas")).toBe("pendiente");
  });

  it("muestra el error de la API con «Reintentar» y recupera los datos", async () => {
    apiMock.getEnvelope.mockRejectedValueOnce({
      code: "INTERNAL",
      message: "Falló la lectura del panel",
      status: 500,
    });
    renderPanel();
    expect(await screen.findByText("Falló la lectura del panel")).toBeTruthy();
    expect(valorIndicador("Vencidas")).toBe("no disponible");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await tablaPanel();
  });

  it("ante el tope de 5.000 obligaciones muestra el mensaje de la API y la acción de acotar", async () => {
    apiMock.getEnvelope.mockRejectedValueOnce({
      code: "TAX_PANEL_TOO_MANY_OBLIGATIONS",
      message:
        "Hay más de 5.000 obligaciones con estos filtros: acotá el rango de vencimiento o el responsable",
      status: 422,
    });
    renderPanel();
    expect(await screen.findByText("Hay demasiadas obligaciones para este filtro")).toBeTruthy();
    expect(screen.getByText(/Hay más de 5\.000 obligaciones/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acotar el rango de vencimiento" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("vacío confirmado con salida a la configuración (P1)", async () => {
    apiMock.getEnvelope.mockResolvedValue(respuesta([]));
    renderPanel();
    expect(await screen.findByText("No hay obligaciones para mostrar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configurar obligaciones" }));
    await waitFor(() => expect(ubicacion()).toBe("/configuracion-fiscal"));
  });

  it("sin coincidencias con filtros activos ofrece quitarlos", async () => {
    apiMock.getEnvelope.mockResolvedValue(respuesta([]));
    renderPanel("/panel-trabajo?responsable=todos&estado=DJ_PENDIENTE");
    expect(await screen.findByText("Ninguna obligación coincide con los filtros")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Quitar filtros" }).length).toBeGreaterThan(1);
  });

  it("sin la capacidad muestra «restringido» en los cuatro indicadores y no consulta", async () => {
    contextMock.current = contexto({ capabilities: new Set() });
    renderPanel();
    expect(await screen.findByText("Sin acceso al panel de trabajo")).toBeTruthy();
    expect(apiMock.getEnvelope).not.toHaveBeenCalled();
    expect(screen.getAllByText("restringido")).toHaveLength(4);
  });

  it("cada fila tiene «Abrir cliente» con el nombre completo del cliente", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: `Abrir cliente ${CLIENTE}` })).toBeTruthy();
  });

  it("muestra los nombres que llegan y, sin ninguno visible, la cantidad de responsables", async () => {
    apiMock.getEnvelope.mockResolvedValue(
      respuesta([
        fila({
          obligationId: "a",
          responsables: [
            { userId: USUARIO, name: "Ana Demo", isSelf: true },
            { userId: OTRO, name: null, isSelf: false },
          ],
        }),
        fila({
          obligationId: "b",
          clientName: "Cliente Demo 2",
          responsables: [
            { userId: OTRO, name: null, isSelf: false },
            { userId: "00000000-0000-4000-8000-000000000003", name: null, isSelf: false },
          ],
        }),
      ]),
    );
    renderPanel();
    await tablaPanel();
    expect(screen.getByText("Ana Demo +1")).toBeTruthy();
    expect(screen.getByText("2 responsables")).toBeTruthy();
  });

  it("cuenta vencidas, vencen esta semana, sin legajo y DJ pendientes sobre las filas filtradas", async () => {
    apiMock.getEnvelope.mockResolvedValue(
      respuesta([
        fila({ obligationId: "a", daysUntilDue: -2, djState: "DJ_PENDIENTE" }),
        fila({ obligationId: "b", daysUntilDue: 3, djState: "SIN_LEGAJO" }),
        fila({ obligationId: "c", daysUntilDue: 40, djState: "PRESENTADO" }),
      ]),
    );
    renderPanel();
    await tablaPanel();
    expect(valorIndicador("Vencidas")).toBe("1");
    expect(valorIndicador("Vencen esta semana")).toBe("1");
    expect(valorIndicador("Sin legajo")).toBe("1");
    expect(valorIndicador("DJ pendientes")).toBe("1");
    expect(screen.queryByText("sobre las filas filtradas")).toBeNull();
    expect(screen.queryByText(/^Sobre /)).toBeNull();
  });

  it("«Abrir cliente» con período contable elige el período y va al Legajo", async () => {
    apiMock.get.mockResolvedValue([
      {
        id: "ejercicio-demo",
        label: "2026",
        periods: [
          {
            id: "contable-oct",
            startDate: "2026-10-01",
            endDate: "2026-10-31",
            status: "OPEN",
          },
        ],
      },
    ]);
    const contextoPrueba = contexto();
    contextMock.current = contextoPrueba;
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: `Abrir cliente ${CLIENTE}` }));
    await waitFor(() => expect(ubicacion()).toBe("/expediente-mensual"));
    expect(contextoPrueba.setClientId).toHaveBeenCalledWith("client-a");
    expect(contextoPrueba.setPeriodId).toHaveBeenCalledWith("contable-oct");
  });

  it("«Abrir cliente» sin período contable va al Resumen del cliente", async () => {
    apiMock.get.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: `Abrir cliente ${CLIENTE}` }));
    await waitFor(() => expect(ubicacion()).toBe("/resumen-cliente"));
  });

  it("OWNER sin obligaciones propias abre en «Todo el estudio» con el motivo visible", async () => {
    sessionMock.me = {
      userId: USUARIO,
      firms: [
        { firmId: FIRMA, firmName: "Estudio Demo", role: "OWNER", capabilities: [], clients: [] },
      ],
    };
    apiMock.getEnvelope.mockImplementation(async (ruta: string) =>
      ruta.includes("responsable=me") ? respuesta([]) : respuesta([fila()]),
    );
    renderPanel();
    expect(
      await screen.findByText(
        "No hay obligaciones asignadas a vos en esta vista: ves todo el estudio por tu rol.",
      ),
    ).toBeTruthy();
    expect(ubicacion()).toBe("/panel-trabajo?responsable=todos&motivo=sin-asignaciones");
    expect(ultimaRuta()).not.toContain("responsable=");
  });

  it("«Cargar más» pide la página siguiente y el pie cuenta filas de obligaciones", async () => {
    apiMock.getEnvelope.mockImplementation(async (ruta: string) =>
      ruta.includes("offset=1")
        ? respuesta([fila({ obligationId: "b", clientName: "Cliente Demo 2" })], {
            total: 2,
            offset: 1,
          })
        : respuesta([fila()], { total: 2 }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(
      await screen.findByRole("button", { name: "Abrir cliente Cliente Demo 2" }),
    ).toBeTruthy();
    expect(screen.getByText("2 de 2 obligaciones")).toBeTruthy();
  });

  it("la barra tiene dos filas, cada control queda en su par y el nombre va dentro del control (hallazgos 63 y 81)", async () => {
    renderPanel("/panel-trabajo?estado=DJ_PENDIENTE");
    await tablaPanel();
    const filas = document.querySelectorAll<HTMLElement>(".dense-toolbar .panel-trabajo__fila");
    expect(filas).toHaveLength(2);
    const primera = filas[0] as HTMLElement;
    const segunda = filas[1] as HTMLElement;
    expect(within(primera).getByRole("combobox", { name: "Responsable" })).toBeTruthy();
    expect(within(primera).getByRole("group", { name: "Terminación de CUIT" })).toBeTruthy();
    expect(within(primera).getByRole("combobox", { name: "Impuesto" })).toBeTruthy();
    expect(within(segunda).getByRole("combobox", { name: "Estado" })).toBeTruthy();
    expect(within(segunda).getByRole("combobox", { name: "Período fiscal" })).toBeTruthy();
    expect(within(segunda).getByLabelText("Vencimiento desde")).toBeTruthy();
    expect(within(segunda).getByLabelText("Vencimiento hasta")).toBeTruthy();
    expect(within(segunda).getByRole("button", { name: "Quitar filtros" })).toBeTruthy();
    const estado = screen.getByRole("combobox", { name: "Estado" }) as HTMLSelectElement;
    expect(estado.selectedOptions[0]?.textContent).toBe("Estado: DJ pendiente");
    expect(screen.queryByRole("button", { name: "Quitar el filtro Mis obligaciones" })).toBeNull();
  });

  // vigente: cambia con hallazgo 87
  it("la fila vencida se muestra con el mismo estilo que las demás", async () => {
    apiMock.getEnvelope.mockResolvedValue(
      respuesta([fila({ daysUntilDue: -26, dueDate: "2026-10-20" })]),
    );
    renderPanel();
    await tablaPanel();
    expect(screen.getByText("vencida hace 26 días").className).toBe("dense-dim");
  });
});
