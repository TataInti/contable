// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la etapa Clasificación e imputación del Legajo (K11) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
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

const LEGAJO = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/monthly-tax-workpapers/wp-a`;
const PERMISOS_CLASIFICAR = ["client.read", "tax.vouchers.prepare"];

// Comprobante «Demo» con CUIT ficticio: compras con letra A y ventas con letra B.
function comprobante(
  id: string,
  direction: "PURCHASE" | "SALE",
  number: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    voucherId: `voucher-${id}`,
    direction,
    counterpartyCuit: direction === "PURCHASE" ? "20999999999" : "20888888887",
    documentKind: "INVOICE",
    categoryCode: null,
    activityCode: null,
    rateBuckets: [],
    status: "PENDING",
    origin: null,
    voucher: {
      type: "FACTURA",
      letter: direction === "PURCHASE" ? "A" : "B",
      pointOfSale: 1,
      number,
      issuedOn: "2026-10-10",
      total: "1000",
    },
    ...overrides,
  };
}

// Cuatro comprobantes: dos compras (una sin rubro y otra ya clasificada) y dos ventas.
const comprobantesDemo = [
  comprobante("compra-a", "PURCHASE", 1),
  comprobante("compra-b", "PURCHASE", 2, {
    status: "CLASSIFIED",
    categoryCode: "TRANSPORTE",
    activityCode: "REST",
    origin: "MANUAL",
  }),
  comprobante("venta-a", "SALE", 3),
  // Código guardado que ya no está vigente: la etapa lo conserva como opción.
  comprobante("venta-b", "SALE", 4, { activityCode: "VIEJA" }),
];

const clasificacionesDemo = {
  total: 4,
  classified: 1,
  pending: 3,
  ready: false,
  items: comprobantesDemo,
};

// Certificado de retención «Demo» sin jurisdicción imputada.
const imputacionDemo = {
  id: "allocation-a",
  sourceCode: "DGR_IIBB_TUC",
  sourceType: "WITHHOLDING",
  amount: "100",
  status: "ALLOCATED",
  allocatedJurisdiction: null,
  certificate: {
    cuitAgent: "20123456789",
    certificateNumber: "CERT-1",
    creditKind: "WITHHOLDING",
    issuedOn: "2026-10-10",
    sourceAmount: "100",
  },
  obligation: {
    regime: {
      name: "IIBB Tucumán",
      isActive: true,
      taxType: { name: "Ingresos Brutos", isActive: true },
      jurisdiction: { name: "Tucumán", isActive: true },
    },
    period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
  },
};

const imputacionesDemo = {
  total: 1,
  allocated: 0,
  pending: 1,
  ready: false,
  items: [imputacionDemo],
};

const actividadesDemo = [
  { validTo: null, activity: { code: "REST", name: "Restaurante" } },
  { validTo: "2025-12-31", activity: { code: "VIEJA", name: "Actividad vencida" } },
];

const jurisdiccionesDemo = [
  { id: "jur-tuc", code: "TUC", name: "Tucumán", isActive: true },
  { id: "jur-cba", code: "CBA", name: "Córdoba", isActive: true },
];

function fijarContexto(permisos: string[]) {
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(permisos),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function renderLegajo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Abre la etapa Clasificación del legajo vigente.
async function abrirClasificacion() {
  fireEvent.click(await screen.findByRole("tab", { name: /Clasificación/ }));
}

// Fila de la tabla de clasificación o de imputación que contiene el texto.
function filaCon(texto: string | RegExp): HTMLElement {
  const fila = screen.getByText(texto).closest("tr");
  if (!fila) throw new Error(`No hay fila que contenga «${String(texto)}»`);
  return fila;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockImplementation(
    rutasDemo({
      clasificaciones: clasificacionesDemo,
      imputaciones: imputacionesDemo,
      actividades: actividadesDemo,
      jurisdicciones: jurisdiccionesDemo,
    }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · etapa Clasificación e imputación (K11)", () => {
  it("guardar una compra sin rubro muestra «Seleccioná el rubro de la compra» junto a su fila y no envía el PATCH", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon("A · 0001-00000001");
    fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    expect(await within(fila).findByText("Seleccioná el rubro de la compra")).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("guardar una venta sin actividad muestra «Indicá la actividad fiscal de la venta» junto a su fila", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon("B · 0001-00000003");
    fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    expect(
      await within(fila).findByText("Indicá la actividad fiscal de la venta"),
    ).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("guardar una compra envía el rubro, la actividad y guarda el perfil del proveedor", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon("A · 0001-00000001");
    fireEvent.change(within(fila).getByRole("combobox", { name: "Rubro del proveedor" }), {
      target: { value: "SUPER" },
    });
    fireEvent.change(within(fila).getByRole("combobox", { name: "Actividad" }), {
      target: { value: "REST" },
    });
    fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${LEGAJO}/classifications/compra-a`, {
        categoryCode: "SUPER",
        activityCode: "REST",
        saveSupplierProfile: true,
      }),
    );
  });

  it("guardar una venta envía solo la actividad fiscal", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon("B · 0001-00000003");
    fireEvent.change(within(fila).getByRole("combobox", { name: "Actividad" }), {
      target: { value: "REST" },
    });
    fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${LEGAJO}/classifications/venta-a`, {
        activityCode: "REST",
      }),
    );
  });

  it("ofrece solo las actividades vigentes y conserva el código guardado que ya no está vigente", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const actividad = within(filaCon("B · 0001-00000004")).getByRole("combobox", {
      name: "Actividad",
    });
    expect(
      within(actividad).getByRole("option", { name: "REST · Restaurante" }),
    ).toBeInTheDocument();
    expect(within(actividad).getByRole("option", { name: "VIEJA" })).toBeInTheDocument();
    expect(
      within(actividad).queryByRole("option", { name: "VIEJA · Actividad vencida" }),
    ).toBeNull();
  });

  it("reimputar sin jurisdicción muestra «Seleccioná una jurisdicción para la imputación» junto a su fila", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon(/CERT-1/);
    fireEvent.click(within(fila).getByRole("button", { name: "Reimputar" }));
    expect(
      await within(fila).findByText("Seleccioná una jurisdicción para la imputación"),
    ).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("reimputar envía el código de la jurisdicción elegida", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const fila = filaCon(/CERT-1/);
    fireEvent.change(
      within(fila).getByRole("combobox", { name: "Jurisdicción de la imputación" }),
      { target: { value: "CBA" } },
    );
    fireEvent.click(within(fila).getByRole("button", { name: "Reimputar" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${LEGAJO}/allocations/allocation-a`, {
        jurisdiction: "CBA",
      }),
    );
  });

  // Un fallo al leer la clasificación muestra Reintentar (antes se veía como «0 Clasificados»).
  it("un fallo al leer la clasificación se muestra con Reintentar, no como «0 Clasificados»", async () => {
    const rutas = rutasDemo({
      clasificaciones: clasificacionesDemo,
      imputaciones: imputacionesDemo,
      actividades: actividadesDemo,
      jurisdicciones: jurisdiccionesDemo,
    });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/classifications")
        ? Promise.reject(new Error("Fallo Demo"))
        : rutas(path)) as never);
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    expect(await screen.findByText("Clasificados")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
  it("la carga de la clasificación y de las imputaciones se anuncia con role=status y la etapa tiene una sola acción primaria", async () => {
    const rutas = rutasDemo({ actividades: actividadesDemo, jurisdicciones: jurisdiccionesDemo });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/classifications") || path.endsWith("/allocations")
        ? new Promise(() => {})
        : rutas(path)) as never);
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    const carga = await screen.findByText("Clasificando comprobantes respaldados…");
    expect(carga.closest("[role='status']")).not.toBeNull();
    expect(
      screen.getByText("Imputando certificados revisados…").closest("[role='status']"),
    ).not.toBeNull();
    expect(document.querySelectorAll(".workpaper-card .ds-button--primary")).toHaveLength(1);
  });
});
