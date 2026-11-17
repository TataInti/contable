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
  fireEvent.change(await screen.findByRole("combobox", { name: /^Fuente/ }), {
    target: { value: "RETENCIONES_IIBB_DEMO" },
  });
  fireEvent.change(screen.getByLabelText(/Archivo CSV, TXT o JSON/), {
    target: { files: [new File([CSV_DEMO], "retenciones-demo.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Importar lote" }));
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
  it("Importar lote queda deshabilitado hasta elegir fuente y archivo", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    expect(await screen.findByRole("button", { name: "Importar lote" })).toBeDisabled();
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
          origin: "ARCA",
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
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    await importarLoteDemo();
    expect(
      await screen.findByText(/El lote tiene 2 de 2 filas con error/),
    ).toBeInTheDocument();
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

  it("explica que la cobertura cuenta solo lotes revisados cuando una fuente requerida tiene cero registros", async () => {
    fijarContexto(PERMISOS_FUENTES);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    expect(await screen.findByText(/La cobertura cuenta solo lotes revisados/)).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Ver filas con error" }));
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
    const abrir = await screen.findByRole("button", { name: "Ver filas con error" });
    abrir.focus();
    expect(abrir).toHaveFocus();
    // Con Enter el navegador entrega un clic al botón enfocado; jsdom no lo convierte solo.
    fireEvent.keyDown(abrir, { key: "Enter", code: "Enter" });
    fireEvent.click(abrir);
    const motivo = await screen.findByText(/El punto de venta no es un número válido\./);
    expect(document.activeElement?.tagName).not.toBe("BODY");
    const detalle = screen.getByRole("group", { name: "Detalle de filas con error" });
    expect(detalle).toContainElement(motivo);
    expect(detalle.contains(document.activeElement)).toBe(true);
  });
});
