// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Cajón «Declaración jurada» del Legajo (5b-4a) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import { uploadPresentacionDocument, waitForReceiptReady } from "../filingReceipt";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  periodoIibbDemo,
  rutasDemo,
} from "./datosDemoLegajo";
import { cambiarValor } from "../../test/elegirOpcion";

const ctx = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
vi.mock("../../context/ClientContext", () => ({ useClientContext: () => ctx.current }));
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
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    postWithHeaders: vi.fn(),
  };
  return { ...actual, api: api as unknown as typeof actual.api };
});
vi.mock("../filingReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../filingReceipt")>()),
  uploadPresentacionDocument: vi.fn(),
  waitForReceiptReady: vi.fn(),
}));

const BASE = `/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}`;
const PATCH = `${BASE}/tax-obligations/obligacion-demo/filings/presentacion-demo/declaration`;
const DJ = "11111111-1111-4111-8111-111111111111";
const IMPUESTO = "22222222-2222-4222-8222-222222222222";
const JURISDICCION = "33333333-3333-4333-8333-333333333333";
const PERMISOS = [
  "client.read",
  "tax.settlements.calculate",
  "tax.vouchers.prepare",
  "tax.vouchers.read",
  "tax.payments.record",
  "tax.filings.record",
];
const SIN_DJ = PERMISOS.filter((permiso) => permiso !== "tax.filings.record");
const DOC_DJ = {
  id: DJ,
  category: "DECLARACION_JURADA",
  status: "READY",
  createdAt: "2026-11-11T00:00:00.000Z",
  fileVersions: [{ originalName: "dj-iva-sintetica.pdf" }],
};
// Posición «Demo» presentada, sin declaración jurada; «cargada» trae los importes ya guardados.
const presentada = {
  obligationId: "obligacion-demo",
  status: "FILED",
  dueDate: "2999-01-01T00:00:00.000Z",
  filedAt: "2026-11-10T00:00:00.000Z",
  filingId: "presentacion-demo",
  hasDeclaration: false,
  regime: {
    id: "regimen-demo",
    name: "Régimen Demo",
    isActive: true,
    taxType: { id: IMPUESTO, name: "IVA", isActive: true },
    jurisdiction: { id: JURISDICCION, name: "Tucumán", isActive: true },
  },
  settlement: { id: "liquidacion-demo", status: "FINALIZED", version: 1, totals: {} },
  accrued: "1500.00",
  paid: "0.00",
  pending: "0.00",
  availableCredit: "0.00",
  interest: "0.00",
  totalPayable: "1500.00",
};
const cargada = {
  ...presentada,
  hasDeclaration: true,
  declarationDocumentId: DJ,
  impuestoDeterminado: "1500.5000",
  saldoFavorTecnico: "200.00",
  saldoLibreDisponibilidad: "0.00",
  totalAPagar: "1300.50",
  declaredAt: "2026-11-12T10:00:00.000Z",
  saldosFavorDetalle: null,
};
const AVISO = {
  code: "TOTAL_A_PAGAR_DISTINTO_DE_PRESENTADO",
  field: "totalAPagar",
  message:
    "totalAPagar: la declaración jurada informa 1300.50 y la presentación registró 1500.00. Revisá cuál es el importe a pagar.",
};

function fijarPermisos(permisos: string[]) {
  ctx.current = {
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
// Documentos: la lista, o «pendiente» / «error» para simular la carga y su fallo.
function preparar(posicion: object, documentos: unknown[] | "pendiente" | "error" = []) {
  const rutas = rutasDemo({ periodos: [periodoIibbDemo], posiciones: [posicion as never] });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (!path.endsWith("/documents")) return rutas(path);
    if (documentos === "pendiente") return new Promise(() => undefined);
    if (documentos === "error")
      return Promise.reject(new ApiError("INTERNAL_ERROR", "Falla simulada", 500));
    return Promise.resolve(documentos);
  }) as never);
}
async function abrirDeclaracion(nombre = "Cargar declaración jurada") {
  fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
  fireEvent.click(await screen.findByRole("button", { name: nombre }));
  return screen.findByRole("dialog", { name: /^Declaración jurada/ });
}
// El pie del cajón (el «Cerrar» del encabezado no se confunde con el de la acción).
const pie = (dialogo: HTMLElement) =>
  within(dialogo.querySelector(".action-drawer__footer") as HTMLElement);
const guardar = (dialogo: HTMLElement) =>
  fireEvent.click(pie(dialogo).getByRole("button", { name: /^Guardar/ }));
function completar(dialogo: HTMLElement, documento: string | null = DJ) {
  const importes: Record<string, string> = {
    "Impuesto determinado": "1500,5",
    "Saldo a favor técnico": "200",
    "Saldo a favor de libre disponibilidad": "0",
    "Total a pagar": "1300,5",
  };
  for (const [etiqueta, valor] of Object.entries(importes)) {
    cambiarValor(within(dialogo).getByLabelText(etiqueta), valor);
  }
  if (documento)
    fireEvent.change(within(dialogo).getByLabelText("Documento de respaldo"), {
      target: { value: documento },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fijarPermisos(PERMISOS);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({
    filing: {},
    warnings: [],
    saldosGenerados: [],
  } as never);
  vi.mocked(uploadPresentacionDocument).mockResolvedValue("dj-nueva-demo");
  vi.mocked(waitForReceiptReady).mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("Legajo · declaración jurada (5b-4a)", () => {
  it("después de la presentación ofrece Cargar, vacío y con su motivo", async () => {
    preparar(presentada);
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    expect(within(dialogo).getByLabelText("Impuesto determinado")).toHaveValue("");
    expect(pie(dialogo).getByRole("button", { name: "Guardar declaración jurada" })).toBeDisabled();
    expect(pie(dialogo).getByText("Indicá el impuesto determinado.")).toBeInTheDocument();
    expect(
      within(dialogo).getByText("Todavía no hay declaraciones juradas subidas para este cliente."),
    ).toBeInTheDocument();
  });

  it("sin presentación con acuse no se ofrece la declaración jurada", async () => {
    preparar({ ...presentada, filedAt: null, filingId: null });
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
    expect(await screen.findByRole("button", { name: "Registrar presentación" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /declaración jurada/i })).toBeNull();
  });

  it("al corregir precarga los importes y el documento vigente", async () => {
    preparar(cargada, [DOC_DJ]);
    renderLegajo();
    const dialogo = await abrirDeclaracion("Corregir declaración jurada");
    expect(within(dialogo).getByLabelText("Impuesto determinado")).toHaveValue("1.500,5");
    expect(within(dialogo).getByLabelText("Total a pagar")).toHaveValue("1.300,5");
    expect(within(dialogo).getByLabelText("Documento de respaldo")).toHaveValue(DJ);
    expect(pie(dialogo).getByRole("button", { name: "Guardar corrección" })).toBeEnabled();
  });

  it.each([
    [
      presentada,
      "Falta la declaración jurada: la carga el Titular, el Administrador o el Revisor.",
    ],
    [cargada, "Declaración jurada cargada · total a pagar"],
  ])("el Preparador ve el estado y los importes, sin botón (caso %#)", async (posicion, texto) => {
    fijarPermisos(SIN_DJ);
    preparar(posicion, [DOC_DJ]);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
    expect(await screen.findByText(new RegExp(texto))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /declaración jurada/i })).toBeNull();
  });

  it("guarda con los importes y el documento elegido, sin saldosFavorDetalle si no hay detalle", async () => {
    preparar(presentada, [DOC_DJ]);
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    completar(dialogo);
    guardar(dialogo);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(PATCH, {
        declarationDocumentId: DJ,
        impuestoDeterminado: "1500.5",
        saldoFavorTecnico: "200",
        saldoLibreDisponibilidad: "0",
        totalAPagar: "1300.5",
      }),
    );
    expect(await screen.findByText("Declaración jurada cargada.")).toBeInTheDocument();
  });

  it("al corregir reenvía el detalle de saldo guardado, sin el régimen vacío", async () => {
    const saldosFavorDetalle = [
      { taxTypeId: IMPUESTO, regimeId: null, jurisdictionId: JURISDICCION, amount: "100.0000" },
    ];
    preparar({ ...cargada, saldosFavorDetalle }, [DOC_DJ]);
    renderLegajo();
    guardar(await abrirDeclaracion("Corregir declaración jurada"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        PATCH,
        expect.objectContaining({
          saldosFavorDetalle: [
            { taxTypeId: IMPUESTO, jurisdictionId: JURISDICCION, amount: "100.0000" },
          ],
        }),
      ),
    );
  });

  it("con diferencias el cajón queda abierto con los avisos, y Cerrar no bloquea", async () => {
    vi.mocked(api.patch).mockResolvedValue({
      filing: {},
      saldosGenerados: [],
      warnings: [AVISO],
    } as never);
    preparar(presentada, [DOC_DJ]);
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    completar(dialogo);
    guardar(dialogo);
    expect(
      await within(dialogo).findByText("Declaración jurada cargada con diferencias"),
    ).toBeInTheDocument();
    expect(within(dialogo).getByText(/Revisá cuál es el importe a pagar/)).toBeInTheDocument();
    fireEvent.click(pie(dialogo).getByRole("button", { name: "Cerrar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /^Declaración jurada/ })).toBeNull(),
    );
  });

  it("un error de la API se muestra dentro del cajón, que sigue abierto", async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError(
        "FILING_NOT_FILED",
        "Falta: presentación con acuse. Registrá la presentación y después cargá la declaración jurada.",
        409,
      ),
    );
    preparar(presentada, [DOC_DJ]);
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    completar(dialogo);
    guardar(dialogo);
    expect(await within(dialogo).findByText(/Falta: presentación con acuse/)).toBeInTheDocument();
  });

  it("mientras cargan los documentos lo muestra y no deja guardar", async () => {
    preparar(presentada, "pendiente");
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    expect(within(dialogo).getByText("Cargando los documentos del cliente…")).toBeInTheDocument();
    completar(dialogo, null);
    expect(
      pie(dialogo).getByText("Esperá a que carguen los documentos del cliente."),
    ).toBeInTheDocument();
  });

  it("si no se pueden leer los documentos lo dice y ofrece Reintentar", async () => {
    preparar(presentada, "error");
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    expect(
      await within(dialogo).findByText("No pudimos cargar los documentos del cliente"),
    ).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin documento elegido sube la declaración con su categoría y espera su validación", async () => {
    preparar(presentada, []);
    renderLegajo();
    const dialogo = await abrirDeclaracion();
    completar(dialogo, null);
    const archivo = new File(["dj"], "dj-iva.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialogo).getByLabelText("Archivo de la declaración jurada"), {
      target: { files: [archivo] },
    });
    expect(pie(dialogo).getByRole("button", { name: "Guardar declaración jurada" })).toBeEnabled();
    // jsdom no toma el archivo simulado como elegido para «required»: el envío va al formulario.
    fireEvent.submit(dialogo.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        PATCH,
        expect.objectContaining({ declarationDocumentId: "dj-nueva-demo" }),
      ),
    );
    expect(uploadPresentacionDocument).toHaveBeenCalledWith(BASE, archivo, "DECLARACION_JURADA");
    expect(waitForReceiptReady).toHaveBeenCalledWith(BASE, "dj-nueva-demo", {
      mensajes: expect.objectContaining({
        fallo: expect.stringContaining("La declaración jurada"),
      }),
    });
  });

  it("tipear 13125 sin separadores da 13.125, no 1,3125 (2 decimales, como el resto de importes)", async () => {
    preparar(presentada, [DOC_DJ]);
    renderLegajo();
    const campo = within(await abrirDeclaracion()).getByLabelText("Impuesto determinado");
    // Tecleo real: el campo agrupa al cuarto dígito y el siguiente carácter llega como «1.3125».
    for (const tecleado of ["1", "13", "131", "1312", "1.3125"]) {
      cambiarValor(campo, tecleado);
    }
    expect(campo).toHaveValue("13.125");
  });
});
