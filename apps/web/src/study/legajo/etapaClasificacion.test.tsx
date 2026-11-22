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
import { CLIENTE_DEMO, FIRMA_DEMO, legajoDemo, PERIODO_ELEGIDO_DEMO, rutasDemo } from "./datosDemoLegajo";

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
  // 4J: clasificada con una actividad que no está vigente en el período; el cálculo la rechaza.
  comprobante("venta-c", "SALE", 5, {
    status: "CLASSIFIED",
    activityCode: "REST",
    origin: "VOUCHER_LINE",
    activityIssue: {
      kind: "NOT_IN_FORCE",
      message:
        "La actividad REST no rige en octubre 2026. Reclasificá con Actividad REST-NUEVA, vigente desde octubre 2026.",
    },
  }),
];

const clasificacionesDemo = {
  total: 5,
  classified: 1,
  pending: 3,
  activityPending: 1,
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
  it("permite filtrar sin clasificar y seleccionar varios comprobantes", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    expect(screen.getByRole("checkbox", { name: "Seleccionar comprobante A · 0001-00000001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clasificar seleccionados" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filtrar comprobantes" })).toBeInTheDocument();
  });

  it("filtra los comprobantes pendientes", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar comprobantes" }), { target: { value: "PENDING" } });
    expect(screen.getByText("A · 0001-00000001")).toBeInTheDocument();
    expect(screen.queryByText("A · 0001-00000002")).not.toBeInTheDocument();
  });

  it("4L — una venta con actividad que ya no rige queda pendiente con el texto del cálculo y ofrece reclasificar", async () => {
    fijarContexto(PERMISOS_CLASIFICAR);
    renderLegajo();
    await abrirClasificacion();
    expect(
      screen.getByText(
        "La actividad REST no rige en octubre 2026. Reclasificá con Actividad REST-NUEVA, vigente desde octubre 2026.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reclasificar" }).length).toBeGreaterThan(0);
  });

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

  describe("corte 3B: bloque, recordar, excluir y sin crédito", () => {
    const comprobantes3b = [
      comprobante("compra-a", "PURCHASE", 1),
      comprobante("compra-b", "PURCHASE", 2),
      comprobante("compra-bc", "PURCHASE", 5, {
        status: "CLASSIFIED",
        categoryCode: "SUPER",
        origin: "RULE",
        ivaCredit: false,
        voucher: { type: "6", letter: "B", pointOfSale: 1, number: 5, issuedOn: "2026-10-10", total: "500" },
      }),
      comprobante("venta-a", "SALE", 3),
      comprobante("venta-b", "SALE", 4),
      comprobante("venta-auto", "SALE", 6, {
        status: "CLASSIFIED",
        activityCode: "REST",
        origin: "SINGLE_CLIENT_ACTIVITY",
      }),
      comprobante("venta-x", "SALE", 7, {
        status: "PENDING",
        excludedAt: "2026-10-20T12:00:00.000Z",
        excludedReason: "Factura duplicada",
        excludedBy: { id: "user-a", name: "Paula Demo" },
      }),
    ];
    const cobertura3b = {
      total: 7,
      classified: 2,
      pending: 4,
      excluded: 1,
      ready: false,
      items: comprobantes3b,
    };
    const reglasDemo = [
      {
        id: "regla-a",
        direction: "PURCHASE",
        counterpartyCuit: "20999999999",
        categoryCode: "SUPER",
        activityCode: null,
        createdByName: "Paula Demo",
        createdAt: "2026-10-12T12:00:00.000Z",
      },
    ];

    function rutas3b(extra: { reglas?: unknown[]; legajos?: unknown[] } = {}) {
      vi.mocked(api.get).mockImplementation(
        rutasDemo({
          clasificaciones: cobertura3b,
          reglas: extra.reglas ?? reglasDemo,
          imputaciones: imputacionesDemo,
          actividades: actividadesDemo,
          jurisdicciones: jurisdiccionesDemo,
          ...(extra.legajos ? { legajos: extra.legajos } : {}),
        }) as never,
      );
    }
    const marcar = (nombre: string) =>
      fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar comprobante ${nombre}` }));

    it("clasifica en bloque: una actividad para las ventas elegidas en un solo pedido", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      marcar("B · 0001-00000003");
      marcar("B · 0001-00000004");
      fireEvent.change(screen.getByRole("combobox", { name: "Actividad de las ventas seleccionadas" }), {
        target: { value: "REST" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Clasificar seleccionados" }));
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(`${LEGAJO}/classifications/bulk`, {
          classificationIds: ["venta-a", "venta-b"],
          activityCode: "REST",
        }),
      );
    });

    it("«Recordar para este proveedor/cliente» agrega rememberRule al bloque y al guardado individual", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      fireEvent.click(screen.getByRole("checkbox", { name: "Recordar para este proveedor/cliente" }));
      marcar("A · 0001-00000001");
      marcar("A · 0001-00000002");
      fireEvent.change(screen.getByRole("combobox", { name: "Rubro de las compras seleccionadas" }), {
        target: { value: "TRANSPORTE" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Clasificar seleccionados" }));
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(`${LEGAJO}/classifications/bulk`, {
          classificationIds: ["compra-a", "compra-b"],
          categoryCode: "TRANSPORTE",
          rememberRule: true,
        }),
      );

      const fila = filaCon("B · 0001-00000003");
      fireEvent.change(within(fila).getByRole("combobox", { name: "Actividad" }), { target: { value: "REST" } });
      fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(`${LEGAJO}/classifications/venta-a`, {
          activityCode: "REST",
          rememberRule: true,
        }),
      );
    });

    it("el bloque sin elección o con compras y ventas mezcladas muestra la guía y no envía nada", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      fireEvent.click(screen.getByRole("button", { name: "Clasificar seleccionados" }));
      expect(await screen.findByText("Elegí al menos un comprobante sin excluir")).toBeInTheDocument();
      marcar("A · 0001-00000001");
      marcar("B · 0001-00000003");
      fireEvent.click(screen.getByRole("button", { name: "Clasificar seleccionados" }));
      expect(await screen.findByText(/Elegí solo compras o solo ventas/)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it("muestra las marcas «Por regla», «Sin crédito de IVA» y «Excluido» con quién, cuándo y motivo", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      const sinCredito = filaCon("B · 0001-00000005");
      expect(within(sinCredito).getByText("Sin crédito de IVA")).toBeInTheDocument();
      expect(within(sinCredito).getByText("Por regla")).toBeInTheDocument();
      const excluida = filaCon("B · 0001-00000007");
      expect(within(excluida).getByText("Excluido")).toBeInTheDocument();
      expect(within(excluida).getByText(/Paula Demo · .* · Factura duplicada/)).toBeInTheDocument();
      expect(within(excluida).getByText("Fuera del cálculo")).toBeInTheDocument();
    });

    it("con una sola actividad muestra «ventas asignadas a REST automáticamente» y no las cuenta pendientes", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      expect(
        screen.getByText(/1 venta asignada a REST automáticamente/),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox", { name: "Filtrar comprobantes" }), { target: { value: "PENDING" } });
      expect(screen.queryByText("B · 0001-00000006")).not.toBeInTheDocument();
      expect(screen.queryByText("B · 0001-00000007")).not.toBeInTheDocument();
      expect(screen.getByText("B · 0001-00000003")).toBeInTheDocument();
    });

    it("el filtro «Excluidos» muestra solo los excluidos y «Reincluir» los devuelve al cálculo", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      fireEvent.change(screen.getByRole("combobox", { name: "Filtrar comprobantes" }), { target: { value: "EXCLUDED" } });
      expect(screen.getByText("B · 0001-00000007")).toBeInTheDocument();
      expect(screen.queryByText("B · 0001-00000003")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Reincluir el comprobante B · 0001-00000007" }));
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(`${LEGAJO}/classifications/include`, {
          classificationIds: ["venta-x"],
        }),
      );
    });

    it("excluir exige el motivo junto al campo y después envía el motivo con los comprobantes elegidos", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      marcar("B · 0001-00000003");
      marcar("B · 0001-00000004");
      fireEvent.click(screen.getByRole("button", { name: "Excluir seleccionados" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusión" }));
      expect(await screen.findByText("Indicá el motivo de la exclusión")).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Motivo de la exclusión"), { target: { value: "Factura duplicada" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusión" }));
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(`${LEGAJO}/classifications/exclude`, {
          classificationIds: ["venta-a", "venta-b"],
          reason: "Factura duplicada",
        }),
      );
    });

    it("las reglas se ven con quién las creó y se borran desde la misma etapa", async () => {
      rutas3b();
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      expect(await screen.findByText("Reglas recordadas")).toBeInTheDocument();
      const regla = (await screen.findByText("Compras")).closest("tr")!;
      expect(within(regla).getByText("20999999999")).toBeInTheDocument();
      expect(within(regla).getByText("SUPER")).toBeInTheDocument();
      expect(within(regla).getByText(/Paula Demo/)).toBeInTheDocument();
      fireEvent.click(within(regla).getByRole("button", { name: "Borrar la regla de 20999999999" }));
      await waitFor(() => expect(api.del).toHaveBeenCalledWith(`${LEGAJO}/classification-rules/regla-a`));
    });

    it("sin reglas, la etapa guía cómo crearlas", async () => {
      rutas3b({ reglas: [] });
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      expect(
        await screen.findByText(/Todavía no hay reglas\. Marcá «Recordar para este proveedor\/cliente»/),
      ).toBeInTheDocument();
    });

    it("sin el permiso de preparar no hay selección, bloque, exclusión ni borrado de reglas", async () => {
      rutas3b();
      fijarContexto(["client.read"]);
      renderLegajo();
      await abrirClasificacion();
      await screen.findByText("Reglas recordadas");
      expect(screen.queryByRole("button", { name: "Clasificar seleccionados" })).toBeNull();
      expect(screen.queryByRole("checkbox", { name: /Seleccionar comprobante/ })).toBeNull();
      expect(screen.queryByRole("checkbox", { name: "Recordar para este proveedor/cliente" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Borrar la regla/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Reincluir/ })).toBeNull();
    });

    it("mes cerrado: la etapa guía a rectificar y no ofrece cambios; mes calculado: sí se puede clasificar", async () => {
      rutas3b({ legajos: [legajoDemo("FINALIZED")] });
      fijarContexto(PERMISOS_CLASIFICAR);
      renderLegajo();
      await abrirClasificacion();
      expect(await screen.findByText("Para cambiar un mes cerrado, rectificá la liquidación.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Clasificar seleccionados" })).toBeNull();
      cleanup();

      rutas3b({ legajos: [legajoDemo("CALCULATED")] });
      renderLegajo();
      await abrirClasificacion();
      expect(await screen.findByRole("button", { name: "Clasificar seleccionados" })).toBeInTheDocument();
    });
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
    expect(document.querySelectorAll(".work-bar .ds-button--primary")).toHaveLength(1);
  });
});
