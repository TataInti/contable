// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la etapa Fuentes del Legajo (K10) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  CUIT_CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  fuenteRetencionesDemo,
  fuentesDemo,
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

const BASE = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}`;
const PERMISOS_FUENTES = ["client.read", "tax.vouchers.prepare"];
// CSV ficticio «Demo» con separador «;» y encabezado.
// Línea sintética de percepción de la DGR (ancho fijo de 108).
const LINEA_PERCEPCION_DEMO =
  "30555555551" + "AGENTE DEMO SINTETICO".padEnd(50) + "01/10/2026" + "11 C 0001" + "1234567" + " ".repeat(11) + "1500.55P11";
const CSV_DEMO = "fecha;comprobante;importe\n2026-10-03;RET-0001;1500\n2026-10-04;RET-0002;2300\n";

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

function renderLegajo(initialEntry = "/expediente-mensual") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Respuestas del lote: la importación crea el lote y la validación informa las filas observadas.
function responderLote(filasObservadas: number) {
  vi.mocked(api.post).mockImplementation(((path: string) => {
    if (path.endsWith("/import-batches")) {
      return Promise.resolve({ id: "batch-demo", status: "UPLOADED", errorRows: 0 });
    }
    if (path.endsWith("/validate")) {
      return Promise.resolve({ totals: { errorRows: filasObservadas } });
    }
    return Promise.resolve({});
  }) as never);
}

function llamadasA(sufijo: string) {
  return vi.mocked(api.post).mock.calls.filter(([path]) => String(path).endsWith(sufijo));
}

// Abre la etapa Fuentes, elige la fuente de retenciones y el CSV, y pulsa Importar lote.
async function importarLoteDemo() {
  fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar Retenciones IIBB Demo" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cargar archivo" }));
  fireEvent.change(screen.getByLabelText(/Elegir archivo/), {
    target: { files: [new File([CSV_DEMO], "retenciones-demo.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importar archivo" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockImplementation(
    rutasDemo({ fuentes: [...fuentesDemo, fuenteRetencionesDemo] }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · etapa Fuentes (K10)", () => {
  it("muestra una fila por fuente sin códigos internos y señala qué falta para calcular", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo("/expediente-mensual?etapa=fuentes");
    expect(await screen.findByText((_, element) => Boolean(element?.classList.contains("workpaper-source-readiness")))).toHaveTextContent(/Para calcular falta:.*Ventas del período, Compras del período/);
    expect(screen.getByRole("button", { name: "Gestionar Ventas del período" })).toBeInTheDocument();
    expect(screen.queryByText("ARCA_IVA_SALES")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("abre Gestionar en Archivos y permite ver errores de una fuente que no es IVA", async () => {
    const loteObservado = { ...loteVentasConErrores, fileName: "percepciones-demo.csv" };
    responderLoteConErrores(() => [
      { id: "fila-per", position: 2, status: "ERROR", errors: ["DATE_INVALID"], raw: { fecha: "mal" } },
    ]);
    vi.mocked(api.get).mockImplementation(((path: string) => {
      const idLote = /\/import-batches\/([^/]+)\/rows$/.exec(path)?.[1];
      if (idLote) return Promise.resolve([{ id: "fila-per", position: 2, status: "ERROR", errors: ["DATE_INVALID"], raw: { fecha: "mal" } }]);
      return rutasDemo({ fuentes: [fuenteRetencionesDemo, { ...fuenteRetencionesDemo, code: "RETENCIONES_IIBB_DEMO_2", label: "Otras retenciones Demo", batches: [loteObservado] }] })(path);
    }) as never);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo("/expediente-mensual?etapa=fuentes");
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Otras retenciones Demo" }));
    expect(await screen.findByRole("dialog", { name: "Gestionar fuente" })).toBeInTheDocument();
    expect(screen.getByText("Archivos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver errores" }));
    expect(await screen.findByText(/La fecha no es válida/)).toBeInTheDocument();
  });

  it("reconoce un TXT de percepciones y avisa si corresponde a otra fuente", async () => {
    const fuentes = [
      fuenteRetencionesDemo,
      { ...fuenteRetencionesDemo, code: "IIBB_RPI_TUC", label: "Ingresos Brutos Tucumán", origin: "DGR_RPI_TUC" },
    ];
    vi.mocked(api.get).mockImplementation(rutasDemo({ fuentes }) as never);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo("/expediente-mensual?etapa=fuentes");
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Retenciones IIBB Demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cargar archivo" }));
    fireEvent.change(screen.getByLabelText(/Elegir archivo/), {
      target: { files: [new File([LINEA_PERCEPCION_DEMO], "per20999999998_F611_011020260900.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText(/Es un archivo de percepciones sufridas/)).toBeInTheDocument();
    expect(screen.getByText(/va en la fuente «Ingresos Brutos Tucumán»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a Ingresos Brutos Tucumán" }));
    expect(screen.getByRole("dialog", { name: "Gestionar fuente" })).toHaveTextContent("Ingresos Brutos Tucumán");
  });

  it("abre Fuentes desde ?etapa=fuentes", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo("/expediente-mensual?etapa=fuentes");
    expect(await screen.findByRole("tab", { name: /Fuentes/ })).toHaveAttribute("aria-selected", "true");
  });

  it("abre otras etapas por su nombre normalizado en la URL", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo("/expediente-mensual?etapa=clasificacion");
    expect(await screen.findByRole("tab", { name: /Clasificación/ })).toHaveAttribute("aria-selected", "true");
  });

  it("Gestionar abre Archivos y ofrece la carga dentro del cajón", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Retenciones IIBB Demo" }));
    expect(await screen.findByRole("dialog", { name: "Gestionar fuente" })).toBeInTheDocument();
    expect(screen.getByText("Archivos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeEnabled();
  });

  it("envía el lote con fileHash en formato sha256:, workpaperId y sourceCode", async () => {
    responderLote(0);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    await importarLoteDemo();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/import-batches`,
        expect.objectContaining({
          origin: "CSV",
          taxTypeId: "tax-type-a",
          periodId: "period-a",
          adapterVersion: "RET_V1",
          fileName: "retenciones-demo.csv",
          fileHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          workpaperId: "wp-a",
          sourceCode: "RETENCIONES_IIBB_DEMO",
        }),
      ),
    );
  });

  it("lee el CSV con separador «;» y encabezado, y envía cada fila a validar", async () => {
    responderLote(0);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    await importarLoteDemo();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/import-batches/batch-demo/validate`, {
        rows: [
          { fecha: "2026-10-03", comprobante: "RET-0001", importe: "1500" },
          { fecha: "2026-10-04", comprobante: "RET-0002", importe: "2300" },
        ],
      }),
    );
  });

  it("con filas observadas no confirma el lote y dice cuántas son", async () => {
    responderLote(2);
    const rutas = rutasDemo({ fuentes: [...fuentesDemo, fuenteRetencionesDemo] });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/import-batches/batch-demo/rows")
        ? Promise.resolve([{ id: "fila-error-demo", position: 1, status: "ERROR", errors: ["DATE_INVALID"], raw: { fecha: "31/02/2026" } }])
        : rutas(path)) as never);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    await importarLoteDemo();
    expect(await screen.findByText(/La fecha no es válida/)).toBeInTheDocument();
    expect(screen.getByText(/\{"fecha":"31\/02\/2026"\}/)).toBeInTheDocument();
    expect(llamadasA("/commit")).toHaveLength(0);
  });

  it("sin filas observadas confirma el lote con el CUIT del cliente", async () => {
    responderLote(0);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    await importarLoteDemo();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/import-batches/batch-demo/commit`, {
        clientCuit: CUIT_CLIENTE_DEMO,
      }),
    );
  });

  it("muestra en la pantalla de estado las fuentes obligatorias que faltan", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    expect(await screen.findByText(/Para calcular falta:/)).toBeInTheDocument();
  });

  it("un TXT de la DGR en otra fuente no se importa y nombra la fuente correcta", async () => {
    const fuenteIibbTucuman = {
      ...fuenteRetencionesDemo,
      code: "IIBB_RPI_TUC",
      label: "Retenciones y percepciones IIBB Tucumán",
      origin: "DGR_RPI_TUC",
    };
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ fuentes: [...fuentesDemo, fuenteRetencionesDemo, fuenteIibbTucuman] }) as never,
    );
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Retenciones IIBB Demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cargar archivo" }));
    fireEvent.change(screen.getByLabelText(/Elegir archivo/), {
      target: { files: [new File(["x"], "per20111111112_F611_221120261015.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/va en la fuente/);
    expect(
      await screen.findByText(
        /va en la fuente «Retenciones y percepciones IIBB Tucumán», no en «Retenciones IIBB Demo»/,
      ),
    ).toBeInTheDocument();
    expect(llamadasA("/import-batches")).toHaveLength(0);
  });

  it("un TXT de la DGR de otro CUIT se rechaza con el CUIT del archivo y el del cliente", async () => {
    const fuenteIibbTucuman = { ...fuenteRetencionesDemo, code: "IIBB_RPI_TUC", label: "IIBB Tucumán", origin: "DGR_RPI_TUC" };
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ fuentes: [...fuentesDemo, fuenteIibbTucuman] }) as never,
    );
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Retenciones y percepciones IIBB Tucumán" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cargar archivo" }));
    fireEvent.change(screen.getByLabelText(/Elegir archivo/), {
      target: { files: [new File([LINEA_PERCEPCION_DEMO], "per20111111112_F611_221120261015.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Importar archivo" }));
    expect(
      await screen.findByText(
        "Este archivo es del CUIT 20-11111111-2, no del cliente (CUIT 20-99999999-8).",
      ),
    ).toBeInTheDocument();
    expect(llamadasA("/import-batches")).toHaveLength(0);
  });
});

describe("Legajo · etapa Fuentes: un solo anuncio por carga (Foco 2.7b)", () => {
  it("la carga inicial de la cobertura se anuncia una sola vez y el botón no dice «Actualizando…»", async () => {
    fijarContexto(PERMISOS_FUENTES);
    const rutas = rutasDemo({ fuentes: [...fuentesDemo, fuenteRetencionesDemo] });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/coverage") ? new Promise(() => {}) : rutas(path)) as never);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    expect(await screen.findByText("Verificando cobertura…")).toBeInTheDocument();
    const anuncios = screen
      .getAllByRole("status")
      .filter((nodo) => nodo.textContent?.includes("Verificando cobertura"));
    expect(anuncios).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Actualizando…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeDisabled();
  });
});

// A27-1d: lote de libro IVA con filas con error en la lista de fuentes. En la cobertura, `id` es el del
// vínculo con el legajo; el lote importado es `importBatchId`, y /rows se pide con ese.
const ID_VINCULO_LOTE = "vinculo-lote-ventas";
const ID_LOTE_IMPORTADO = "lote-importado-ventas";
const loteVentasConErrores = {
  id: ID_VINCULO_LOTE,
  importBatchId: ID_LOTE_IMPORTADO,
  fileName: "libro-ventas-con-errores-demo.csv",
  batchStatus: "VALIDATED",
  reviewStatus: "PENDING",
  totalRows: 3,
  validRows: 1,
  errorRows: 2,
  snapshotHash: null,
  reviewedAt: null,
  reviewedByUserId: null,
  createdByUserId: "user-demo",
  createdAt: "2026-11-01T00:00:00.000Z",
};
const filasDelLoteVentas = [
  { id: "fila-1", position: 0, status: "VALID", errors: [], raw: null },
  {
    id: "fila-2",
    position: 5,
    status: "ERROR",
    errors: ["POS_INVALID"],
    raw: { Tipo: "6 - Factura B", "Número Desde": 880101 },
  },
  {
    id: "fila-3",
    position: 6,
    status: "ERROR",
    errors: ["DATE_INVALID"],
    raw: { Tipo: "6 - Factura B", "Número Desde": 880102 },
  },
];

// Lecturas de la pantalla con el lote observado en la fuente de ventas. /rows responde 200 con las filas
// que `filasDe` devuelve para el id pedido: lista vacía si el id no es el de un lote, como el endpoint real.
function responderLoteConErrores(filasDe: (idLote: string) => unknown[]) {
  const lecturas = rutasDemo({
    fuentes: [{ ...fuentesDemo[0], batches: [loteVentasConErrores] }, fuentesDemo[1]],
  });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    const idLote = /\/import-batches\/([^/]+)\/rows$/.exec(path)?.[1];
    return idLote === undefined ? lecturas(path) : Promise.resolve(filasDe(idLote));
  }) as never);
}

function rutasDeLotesPedidas() {
  return vi
    .mocked(api.get)
    .mock.calls.map(([ruta]) => String(ruta))
    .filter((ruta) => ruta.includes("/import-batches/"));
}

describe("Legajo · etapa Fuentes: «Ver filas con error» de un lote de libro IVA (A27-1d)", () => {
  it("pide las filas con el id del lote importado, nunca con el del vínculo, y muestra sus motivos (D1)", async () => {
    responderLoteConErrores((idLote) => (idLote === ID_LOTE_IMPORTADO ? filasDelLoteVentas : []));
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Ventas del período" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver errores" }));
    await waitFor(() => expect(rutasDeLotesPedidas()).not.toHaveLength(0));
    expect(rutasDeLotesPedidas()).toEqual([`${BASE}/import-batches/${ID_LOTE_IMPORTADO}/rows`]);
    expect(rutasDeLotesPedidas().some((ruta) => ruta.includes(ID_VINCULO_LOTE))).toBe(false);
    expect(
      await screen.findByText(/El punto de venta no es un número válido\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/La fecha no es válida\./)).toBeInTheDocument();
  });

  it("al abrir el detalle con el teclado, el foco pasa al detalle y no cae en <body> (D2)", async () => {
    responderLoteConErrores(() => filasDelLoteVentas);
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Ventas del período" }));
    const abrir = await screen.findByRole("button", { name: "Ver errores" });
    abrir.focus();
    expect(abrir).toHaveFocus();
    // Con Enter el navegador entrega un clic al botón enfocado; jsdom no lo convierte solo.
    fireEvent.keyDown(abrir, { key: "Enter", code: "Enter" });
    fireEvent.click(abrir);
    const motivo = await screen.findByText(/El punto de venta no es un número válido\./);
    expect(document.activeElement?.tagName).not.toBe("BODY");
    const detalle = screen.getByRole("dialog", { name: "Gestionar fuente" });
    expect(detalle).toContainElement(motivo);
    expect(detalle.contains(document.activeElement)).toBe(true);
  });
});
