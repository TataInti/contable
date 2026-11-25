// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización del pago y de la presentación del Legajo (K7) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
  periodoIibbDemo,
  rutasDemo,
} from "./datosDemoLegajo";
import { cambiarValor } from "../../test/elegirOpcion";

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
const OBLIGACION = "obligacion-demo";
const LIQUIDACION = "liquidacion-demo";

// Posición ficticia «Demo»: devengado 1.500, intereses 150 y total a pagar 1.650.
const posicionDemo = {
  obligationId: OBLIGACION,
  status: "READY_TO_FILE",
  dueDate: "2026-11-20T00:00:00.000Z",
  filedAt: null,
  regime: {
    id: "regimen-demo",
    name: "Régimen Demo",
    isActive: true,
    taxType: { id: "tax-type-a", name: "Ingresos Brutos", isActive: true },
    jurisdiction: { id: "jur-tuc", name: "Tucumán", isActive: true },
  },
  settlement: { id: LIQUIDACION, status: "FINALIZED", version: 1, totals: {} },
  accrued: "1500.00",
  paid: "0.00",
  pending: "1650.00",
  availableCredit: "0.00",
  interest: "150.00",
  totalPayable: "1650.00",
};

// Misma posición con la presentación ya registrada: habilita el pago en el cajón.
const posicionPresentada = {
  ...posicionDemo,
  filedAt: "2026-11-10T00:00:00.000Z",
  filingId: "presentacion-demo",
  hasDeclaration: false,
};

const PERMISOS_COMPLETOS = [
  "client.read",
  "tax.settlements.calculate",
  "tax.vouchers.prepare",
  "tax.vouchers.read",
  "tax.payments.record",
  "tax.filings.record",
];

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// Las acciones de presentación, declaración jurada y pago están en el Cierre, en un cajón por impuesto.
async function abrirCierre() {
  fireEvent.click(await screen.findByRole("tab", { name: /^Cierre/ }));
}

async function abrirCajon(nombre: RegExp = /^(Completar|Ver o corregir) Ingresos Brutos/) {
  await abrirCierre();
  fireEvent.click(await screen.findByRole("button", { name: nombre }));
  return screen.findByRole("dialog", { name: /^Ingresos Brutos/ });
}

function preparar(posicion: object = posicionDemo) {
  vi.mocked(api.get).mockImplementation(
    rutasDemo({
      legajos: [legajoDemo("FINALIZED")],
      periodos: [periodoIibbDemo],
      posiciones: [posicion as never],
    }) as never,
  );
}

const pagoDe = (dialogo: HTMLElement) => within(dialogo).getByRole("region", { name: "Pago" });
const presentacionDe = (dialogo: HTMLElement) =>
  within(dialogo).getByRole("region", { name: "Presentación (acuse)" });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  preparar();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · registrar pago (K7)", () => {
  it("el importe viene precargado con el total a pagar, no con el devengado", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(pagoDe(dialogo)).getByLabelText("Importe")).toHaveValue("1.650,00");
  });

  it("envía settlementId y el total a pagar, y no envía referencia si no se carga", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    fireEvent.click(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-obligations/${OBLIGACION}/payments`, {
        settlementId: LIQUIDACION,
        paidAt: hoy(),
        amount: "1650.00",
        method: "TRANSFERENCIA",
      }),
    );
    const cuerpo = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(cuerpo).not.toHaveProperty("reference");
  });

  it("envía la referencia cuando se carga", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Referencia (opcional)"), "Transferencia Demo 001");
    fireEvent.click(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/tax-obligations/${OBLIGACION}/payments`,
        expect.objectContaining({ reference: "Transferencia Demo 001" }),
      ),
    );
  });

  it("Registrar pago queda deshabilitado sin importe", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Importe"), "");
    expect(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  it("un error de la acción se muestra dentro del cajón, que sigue abierto", async () => {
    preparar(posicionPresentada);
    vi.mocked(api.post).mockRejectedValueOnce(new Error("El pago supera el total a pagar."));
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    fireEvent.click(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "El pago supera el total a pagar.",
    );
    expect(screen.getByRole("dialog", { name: /^Ingresos Brutos/ })).toBeInTheDocument();
  });

  it("sin tax.payments.record el cajón no ofrece Registrar pago y sí la presentación", async () => {
    fijarContexto(PERMISOS_COMPLETOS.filter((permiso) => permiso !== "tax.payments.record"));
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(dialogo).getByLabelText("Archivo del acuse")).toBeEnabled();
    expect(within(dialogo).getByText("Tu perfil no tiene permiso para registrar el pago.")).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Registrar pago" })).toBeNull();
  });

  it("antes de la presentación el pago explica qué falta", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(
      within(pagoDe(dialogo)).getByText("Falta registrar la presentación para poder registrar el pago."),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Registrar pago" })).toBeNull();
  });

  it("con el pago hecho el cajón lo informa y no ofrece pagar de nuevo", async () => {
    preparar({ ...posicionPresentada, paid: "1650.00", pending: "0.00", totalPayable: "0.00" });
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(pagoDe(dialogo)).getByText(/Pagado/)).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Registrar pago" })).toBeNull();
  });
});

describe("Legajo · registrar presentación (K7)", () => {
  it("el importe viene precargado con el cálculo y la fecha es la de hoy", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(dialogo).getByLabelText("Importe presentado")).toHaveValue("1.500,00");
    expect(within(dialogo).getByLabelText("Fecha de presentación")).toHaveValue(hoy());
  });

  it("el importe viene del total a ingresar del cálculo y marca cuando se cambia", async () => {
    preparar({
      ...posicionDemo,
      settlement: { ...posicionDemo.settlement, totals: { TOTAL_A_INGRESAR_IIBB: "1234.50" } },
    });
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    const campo = within(dialogo).getByLabelText("Importe presentado");
    expect(campo).toHaveValue("1.234,50");
    expect(within(dialogo).queryByText(/Difiere del cálculo/)).toBeNull();
    cambiarValor(campo, "1000");
    expect(within(presentacionDe(dialogo)).getByText(/Difiere del cálculo: .*1\.234,50/)).toBeInTheDocument();
  });

  it("el acuse es obligatorio: Registrar presentación queda deshabilitado sin archivo ni acuse", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeDisabled();
    cambiarValor(within(dialogo).getByLabelText("Acuse de presentación"), "doc-a");
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeEnabled();
  });

  it("Registrar presentación también se habilita con un archivo de acuse elegido", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    fireEvent.change(within(dialogo).getByLabelText("Archivo del acuse"), {
      target: {
        files: [new File(["constancia Demo"], "constancia-demo.pdf", { type: "application/pdf" })],
      },
    });
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeEnabled();
  });

  it("envía el importe del cálculo, la fecha y el acuse elegido, sin número de presentación si no se carga", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Acuse de presentación"), "doc-a");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/tax-obligations/${OBLIGACION}/filings`, {
        settlementId: LIQUIDACION,
        filedAt: hoy(),
        amountFiled: "1500.00",
        evidenceDocumentId: "doc-a",
      }),
    );
  });

  it("incluye el número de presentación cuando se carga", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Número de presentación (opcional)"), "ARCA-DEMO-0001");
    cambiarValor(within(dialogo).getByLabelText("Acuse de presentación"), "doc-a");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/tax-obligations/${OBLIGACION}/filings`,
        expect.objectContaining({ externalId: "ARCA-DEMO-0001", evidenceDocumentId: "doc-a" }),
      ),
    );
  });

  it("al registrarla avisa «Presentación registrada con su acuse.»", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Acuse de presentación"), "doc-a");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    expect(await screen.findByText("Presentación registrada con su acuse.")).toBeInTheDocument();
  });

  it("un error de la acción se muestra dentro del cajón, que sigue abierto", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error("La liquidación cambió. Actualizá el legajo."),
    );
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    cambiarValor(within(dialogo).getByLabelText("Acuse de presentación"), "doc-a");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "La liquidación cambió. Actualizá el legajo.",
    );
    expect(screen.getByRole("dialog", { name: /^Ingresos Brutos/ })).toBeInTheDocument();
  });

  it("sin tax.filings.record el cajón no ofrece la presentación y sí el pago", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS.filter((permiso) => permiso !== "tax.filings.record"));
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" })).toBeEnabled();
    expect(within(dialogo).queryByRole("button", { name: "Registrar presentación" })).toBeNull();
  });

  it("un impuesto ya presentado no vuelve a pedir el acuse: lo muestra como hecho", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(presentacionDe(dialogo)).getByText(/Presentada el/)).toBeInTheDocument();
    expect(within(dialogo).queryByLabelText("Archivo del acuse")).toBeNull();
  });

  it("el Cierre muestra el estado de cada impuesto y un solo botón por impuesto", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCierre();
    const estado = await screen.findByRole("list", { name: "Estado de Ingresos Brutos" });
    expect(within(estado).getByText("Hecha")).toBeInTheDocument();
    expect(within(estado).getAllByText("Pendiente")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^(Completar|Ver o corregir) / })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Registrar presentación y acuse" })).toBeNull();
  });
});

describe("Legajo · pago y presentación, accesibilidad mínima (Foco 2.2b)", () => {
  it("el cajón tiene una sola acción primaria y explica que falta el acuse", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(dialogo.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    cambiarValor(within(dialogo).getByLabelText("Importe"), "");
    expect(within(pagoDe(dialogo)).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
    expect(within(dialogo).getByText("Indicá el importe del pago.")).toBeInTheDocument();
  });

  it("sin presentación el cajón tiene una sola acción primaria y explica que falta el acuse", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(dialogo.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    expect(within(dialogo).getByText("Adjuntá el acuse de presentación.")).toBeInTheDocument();
  });

  it("al cerrar el cajón, el foco vuelve al botón que lo abrió", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCierre();
    const origen = await screen.findByRole("button", { name: /^Completar Ingresos Brutos/ });
    origen.focus();
    fireEvent.click(origen);
    const dialogo = await screen.findByRole("dialog", { name: /^Ingresos Brutos/ });
    const pie = dialogo.querySelector<HTMLElement>(".action-drawer__footer");
    fireEvent.click(within(pie!).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(document.activeElement).toBe(origen));
  });
});

describe("Legajo · cajón del impuesto (Foco 2.7b)", () => {
  it("Presentación: Importe y Fecha primero; el acuse y su archivo; el número opcional al final", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    const etiquetas = Array.from(presentacionDe(dialogo).querySelectorAll("label")).map((etiqueta) =>
      etiqueta.textContent?.trim(),
    );
    expect(etiquetas).toEqual([
      "Importe presentado",
      "Fecha de presentación",
      "Acuse de presentación",
      "Archivo del acuse",
      "Número de presentación (opcional)",
    ]);
    const anchoCompleto = Array.from(presentacionDe(dialogo).querySelectorAll(".study-form__full")).map(
      (bloque) => bloque.querySelector("label")?.textContent?.trim(),
    );
    expect(anchoCompleto).toEqual(["Acuse de presentación", "Archivo del acuse"]);
  });

  it("Tres secciones en orden: Presentación, Declaración jurada y Pago", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    const titulos = Array.from(dialogo.querySelectorAll("h3")).map((titulo) => titulo.textContent);
    expect(titulos).toEqual(["Presentación (acuse)", "Declaración jurada", "Pago"]);
  });

  it("Cerrar a la izquierda y la principal a la derecha, con el motivo junto a la principal", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    const pie = dialogo.querySelector<HTMLElement>(".action-drawer__footer");
    expect(pie).not.toBeNull();
    const cerrar = within(pie!).getByRole("button", { name: "Cerrar" });
    const registrar = within(pie!).getByRole("button", { name: "Registrar presentación" });
    expect(
      cerrar.compareDocumentPosition(registrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(registrar).toBeDisabled();
    const motivo = within(pie!).getByRole("note");
    expect(motivo).toHaveTextContent("Adjuntá el acuse de presentación.");
    expect(registrar.closest(".action-drawer__primary")?.contains(motivo)).toBe(true);
  });

  it("Pago: impuesto en la bajada, pendiente a la vista y Referencia (opcional) en la etiqueta", async () => {
    preparar(posicionPresentada);
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    const dialogo = await abrirCajon();
    expect(within(dialogo).getByText(/^Tucumán\./)).toBeInTheDocument();
    expect(within(dialogo).getByText(/^Pendiente: /)).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Referencia (opcional)")).toBeInTheDocument();
    expect(within(dialogo).queryByPlaceholderText("Opcional")).toBeNull();
  });
});
