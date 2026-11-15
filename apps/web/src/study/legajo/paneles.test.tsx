// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de los paneles del Legajo (K4 a K6) con datos sintéticos «Demo».
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

const BASE = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}`;

// Análisis ficticio «Demo» de un libro de ventas: una alícuota.
const analisisDemo = {
  direction: "SALE",
  sheetName: "Demo ventas",
  totals: {
    importeTotal: "121000",
    netoGravado: "100000",
    iva: "21000",
    noGravado: "0",
    exento: "0",
  },
  rates: [{ rate: "21", label: "Alícuota Demo 21 %", net: "100000", tax: "21000", count: 2 }],
  taxes: [],
  detailRows: 2,
  validRows: 2,
  errorRows: 0,
  rows: [],
};

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

const PERMISOS_COMPLETOS = [
  "client.read",
  "tax.settlements.calculate",
  "tax.vouchers.prepare",
  "tax.vouchers.read",
  "tax.payments.record",
  "tax.filings.record",
];

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

// «Importar libro» vive en la fila ARCA IVA de Fuentes: se abre esa pestaña y se usa la fila de ventas.
async function abrirLibrosIva() {
  fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
  await esperarCoberturaDemo();
  fireEvent.click((await screen.findAllByRole("button", { name: "Importar libro" }))[0]!);
  return screen.findByRole("dialog", { name: "Importar libros IVA" });
}

// La cobertura (fuentes) llega después de la lista de legajos y el botón Importar depende de ella.
async function esperarCoberturaDemo() {
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Estado del legajo", hidden: true }),
    ).toHaveTextContent(/Componentes\s*0/),
  );
}

function seccionLibro(dialogo: HTMLElement, titulo: "Ventas" | "Compras"): HTMLElement {
  return within(dialogo).getByRole("heading", { name: titulo }).closest("section") as HTMLElement;
}

async function abrirSaldoInicial() {
  fireEvent.click(await screen.findByRole("button", { name: "Cargar saldo inicial" }));
  return screen.findByRole("dialog", { name: "Cargar saldo inicial" });
}

async function abrirEditarSaldo() {
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
  return screen.findByRole("dialog", { name: "Editar saldo" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockImplementation(rutasDemo() as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · libros IVA (K4)", () => {
  it("Importar queda deshabilitado hasta analizar el libro de ventas", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirLibrosIva();
    const ventas = seccionLibro(dialogo, "Ventas");
    expect(within(ventas).getByRole("button", { name: "Analizar alícuotas" })).toBeDisabled();
    expect(within(ventas).getByRole("button", { name: "Importar" })).toBeDisabled();
  });

  // Sin legajo del período no hay fila ARCA IVA: «Importar libro» no aparece y la lista ofrece crear el legajo (P1).
  it("sin legajo del período no se ofrece Importar libro y la pantalla ofrece Crear legajo", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ legajos: [] }) as never);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    expect(await screen.findByRole("button", { name: "Crear legajo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importar libro" })).toBeNull();
  });

  it("analiza el libro de ventas, lo importa y avisa el resultado", async () => {
    vi.mocked(api.post).mockImplementation(((path: string) => {
      if (path.endsWith("/sifere/analyze")) return Promise.resolve(analisisDemo);
      if (path.endsWith("/sifere/import")) {
        return Promise.resolve({
          analysis: analisisDemo,
          batch: { id: "batch-a", status: "COMMITTED", committed: 2, duplicates: 0 },
        });
      }
      return Promise.resolve({});
    }) as never);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirLibrosIva();
    const ventas = seccionLibro(dialogo, "Ventas");
    const archivo = new File(["ventas demo"], "libro-ventas-demo.xlsx");
    fireEvent.change(ventas.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [archivo] },
    });
    fireEvent.click(within(ventas).getByRole("button", { name: "Analizar alícuotas" }));
    await waitFor(() =>
      expect(within(ventas).getByRole("button", { name: "Importar" })).toBeEnabled(),
    );
    expect(api.post).toHaveBeenCalledWith(`${BASE}/sifere/analyze`, {
      direction: "SALE",
      base64: expect.any(String),
    });
    await esperarCoberturaDemo();
    fireEvent.click(within(ventas).getByRole("button", { name: "Importar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/sifere/import`,
        expect.objectContaining({
          direction: "SALE",
          fileName: "libro-ventas-demo.xlsx",
          taxTypeId: "tax-type-iva",
          periodId: "period-iva",
          clientCuit: "20999999998",
          workpaperId: "wp-a",
        }),
      ),
    );
    expect(
      await screen.findByText(/Se importaron 2 comprobante\(s\) de ventas \(Demo ventas\)/),
    ).toBeInTheDocument();
  });

  it("muestra el error de importar junto al lado que falló", async () => {
    vi.mocked(api.post).mockImplementation(((path: string) =>
      path.endsWith("/sifere/analyze")
        ? Promise.resolve(analisisDemo)
        : Promise.reject(new Error("El libro no tiene columnas de IVA."))) as never);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirLibrosIva();
    const ventas = seccionLibro(dialogo, "Ventas");
    fireEvent.change(ventas.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["ventas demo"], "libro-ventas-demo.xlsx")] },
    });
    fireEvent.click(within(ventas).getByRole("button", { name: "Analizar alícuotas" }));
    await waitFor(() =>
      expect(within(ventas).getByRole("button", { name: "Importar" })).toBeEnabled(),
    );
    await esperarCoberturaDemo();
    fireEvent.click(within(ventas).getByRole("button", { name: "Importar" }));
    expect(await within(ventas).findByRole("alert")).toHaveTextContent(
      "El libro no tiene columnas de IVA.",
    );
    expect(within(seccionLibro(dialogo, "Compras")).queryByRole("alert")).toBeNull();
  });
});

describe("Legajo · cargar saldo inicial (K5)", () => {
  it("Registrar saldo queda deshabilitado sin impuesto, período o importe", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirSaldoInicial();
    expect(within(dialogo).getByRole("button", { name: "Registrar saldo" })).toBeDisabled();
  });

  it("envía el saldo de IVA con naturaleza libre y sin régimen ni documento", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirSaldoInicial();
    fireEvent.change(within(dialogo).getByLabelText("Impuesto"), {
      target: { value: "tax-type-iva" },
    });
    expect(within(dialogo).getByLabelText("Naturaleza")).toHaveValue("IVA_LIBRE");
    fireEvent.change(within(dialogo).getByLabelText("Período fiscal"), {
      target: { value: "period-iva" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Importe"), { target: { value: "1500" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar saldo" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-credit-ledger/opening`, {
        taxTypeId: "tax-type-iva",
        periodId: "period-iva",
        kind: "IVA_LIBRE",
        amount: "1500",
      }),
    );
  });

  it("agrega régimen, jurisdicción y documento solo cuando se eligen", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirSaldoInicial();
    fireEvent.change(within(dialogo).getByLabelText("Impuesto"), {
      target: { value: "tax-type-a" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Período fiscal"), {
      target: { value: "period-a" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Régimen"), {
      target: { value: "regime-a" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Importe"), { target: { value: "250" } });
    fireEvent.change(within(dialogo).getByLabelText("Documento de respaldo"), {
      target: { value: "doc-b" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar saldo" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-credit-ledger/opening`, {
        taxTypeId: "tax-type-a",
        regimeId: "regime-a",
        jurisdictionId: "jur-tuc",
        periodId: "period-a",
        kind: "SALDO_A_FAVOR",
        amount: "250",
        evidenceDocumentId: "doc-b",
      }),
    );
  });
});

describe("Legajo · editar saldo (K6)", () => {
  it("envía sin monto original cuando queda vacío, con referencia y documento en null", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirEditarSaldo();
    fireEvent.change(within(dialogo).getByLabelText("Monto original"), {
      target: { value: "" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Referencia"), { target: { value: "" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/tax-credit-ledger/lot-a`, {
        reference: null,
        evidenceDocumentId: null,
      }),
    );
  });

  it("envía el monto original y la referencia cuando se cargan", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirEditarSaldo();
    fireEvent.change(within(dialogo).getByLabelText("Monto original"), {
      target: { value: "1200" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Referencia"), {
      target: { value: "Ajuste Demo" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/tax-credit-ledger/lot-a`, {
        reference: "Ajuste Demo",
        evidenceDocumentId: null,
        originalAmount: "1200",
      }),
    );
  });
});

describe("Legajo · accesibilidad mínima de cabecera y paneles", () => {
  it("la pantalla tiene un solo h1", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await screen.findByRole("button", { name: "Cargar saldo inicial" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("el cajón de libros IVA muestra como máximo una acción primaria", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirLibrosIva();
    expect(dialogo.querySelectorAll(".ds-button--primary").length).toBeLessThanOrEqual(1);
  });

  it("el cajón de saldo inicial muestra como máximo una acción primaria", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirSaldoInicial();
    expect(dialogo.querySelectorAll(".ds-button--primary").length).toBeLessThanOrEqual(1);
  });

  it("el cajón de editar saldo muestra como máximo una acción primaria", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirEditarSaldo();
    expect(dialogo.querySelectorAll(".ds-button--primary").length).toBeLessThanOrEqual(1);
  });

  it("al cerrar el cajón, el foco vuelve al botón que lo abrió", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const origen = await screen.findByRole("button", { name: "Cargar saldo inicial" });
    origen.focus();
    fireEvent.click(origen);
    const dialogo = await screen.findByRole("dialog", { name: "Cargar saldo inicial" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(origen));
  });
});

describe("Legajo · pie del cajón de saldo inicial (Foco 2.7a)", () => {
  it("«Cancelar» queda a la izquierda de «Registrar saldo», en el pie fijo y fuera del contenido", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirSaldoInicial();
    const pie = dialogo.querySelector<HTMLElement>(".action-drawer__footer");
    expect(pie).not.toBeNull();
    const cancelar = within(pie!).getByRole("button", { name: "Cancelar" });
    const registrar = within(pie!).getByRole("button", { name: "Registrar saldo" });
    expect(
      cancelar.compareDocumentPosition(registrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dialogo.querySelector(".action-drawer__content")?.contains(registrar)).toBe(false);
  });
});
