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
  periodoIibbDemo,
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

// Las posiciones con sus botones están en la etapa Cálculo.
async function abrirCalculo() {
  fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
}

async function abrirPago() {
  fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
  return screen.findByRole("dialog", { name: /^Registrar pago/ });
}

async function abrirPresentacion() {
  fireEvent.click(await screen.findByRole("button", { name: "Registrar presentación" }));
  return screen.findByRole("dialog", { name: /^Registrar presentación/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockImplementation(
    rutasDemo({ periodos: [periodoIibbDemo], posiciones: [posicionDemo] }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · registrar pago (K7)", () => {
  it("el importe viene precargado con el total a pagar, no con el devengado", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    expect(within(dialogo).getByLabelText("Importe")).toHaveValue("1.650,00");
  });

  it("envía settlementId y el total a pagar, y no envía referencia si no se carga", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));
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
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    fireEvent.change(within(dialogo).getByLabelText("Referencia"), {
      target: { value: "Transferencia Demo 001" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `${BASE}/tax-obligations/${OBLIGACION}/payments`,
        expect.objectContaining({ reference: "Transferencia Demo 001" }),
      ),
    );
  });

  it("Registrar pago queda deshabilitado sin importe", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    fireEvent.change(within(dialogo).getByLabelText("Importe"), { target: { value: "" } });
    expect(within(dialogo).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  it("un error de la acción se muestra dentro del cajón, que sigue abierto", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("El pago supera el total a pagar."));
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "El pago supera el total a pagar.",
    );
    expect(screen.getByRole("dialog", { name: /^Registrar pago/ })).toBeInTheDocument();
  });

  it("sin tax.payments.record no se ofrece Registrar pago y sí Registrar presentación", async () => {
    fijarContexto(PERMISOS_COMPLETOS.filter((permiso) => permiso !== "tax.payments.record"));
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByRole("button", { name: "Registrar presentación" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
  });
});

describe("Legajo · registrar presentación (K7)", () => {
  it("el importe viene precargado con el devengado y la fecha es la de hoy", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    expect(within(dialogo).getByLabelText("Importe presentado")).toHaveValue("1.500,00");
    expect(within(dialogo).getByLabelText("Fecha de presentación")).toHaveValue(hoy());
  });

  it("el acuse es obligatorio: Registrar presentación queda deshabilitado sin archivo ni acuse", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText("Acuse de presentación"), {
      target: { value: "doc-a" },
    });
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeEnabled();
  });

  it("Registrar presentación también se habilita con un archivo de acuse elegido", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    fireEvent.change(within(dialogo).getByLabelText("Archivo del acuse"), {
      target: {
        files: [new File(["constancia Demo"], "constancia-demo.pdf", { type: "application/pdf" })],
      },
    });
    expect(within(dialogo).getByRole("button", { name: "Registrar presentación" })).toBeEnabled();
  });

  it("envía el devengado, la fecha y el acuse elegido, sin identificador externo si no se carga", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    fireEvent.change(within(dialogo).getByLabelText("Acuse de presentación"), {
      target: { value: "doc-a" },
    });
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

  it("incluye el identificador externo cuando se carga", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    fireEvent.change(within(dialogo).getByLabelText("Identificador externo"), {
      target: { value: "ARCA-DEMO-0001" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Acuse de presentación"), {
      target: { value: "doc-a" },
    });
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
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    fireEvent.change(within(dialogo).getByLabelText("Acuse de presentación"), {
      target: { value: "doc-a" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    expect(await screen.findByText("Presentación registrada con su acuse.")).toBeInTheDocument();
  });

  it("un error de la acción se muestra dentro del cajón, que sigue abierto", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error("La liquidación cambió. Actualizá el legajo."),
    );
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    fireEvent.change(within(dialogo).getByLabelText("Acuse de presentación"), {
      target: { value: "doc-a" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar presentación" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "La liquidación cambió. Actualizá el legajo.",
    );
    expect(screen.getByRole("dialog", { name: /^Registrar presentación/ })).toBeInTheDocument();
  });

  it("sin tax.filings.record no se ofrece Registrar presentación y sí Registrar pago", async () => {
    fijarContexto(PERMISOS_COMPLETOS.filter((permiso) => permiso !== "tax.filings.record"));
    renderLegajo();
    await abrirCalculo();
    expect(await screen.findByRole("button", { name: "Registrar pago" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Registrar presentación" })).toBeNull();
  });
});

describe("Legajo · pago y presentación, accesibilidad mínima (Foco 2.2b)", () => {
  it("el cajón de pago tiene una sola acción primaria y explica por qué Registrar pago está deshabilitado", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPago();
    expect(dialogo.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    fireEvent.change(within(dialogo).getByLabelText("Importe"), { target: { value: "" } });
    expect(within(dialogo).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
    expect(within(dialogo).getByText("Indicá el importe del pago.")).toBeInTheDocument();
  });

  it("el cajón de presentación tiene una sola acción primaria y explica que falta el acuse", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const dialogo = await abrirPresentacion();
    expect(dialogo.querySelectorAll(".ds-button--primary")).toHaveLength(1);
    expect(within(dialogo).getByText("Adjuntá el acuse de presentación.")).toBeInTheDocument();
  });

  it("al cerrar el cajón de pago, el foco vuelve al botón que lo abrió", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const origen = await screen.findByRole("button", { name: "Registrar pago" });
    origen.focus();
    fireEvent.click(origen);
    const dialogo = await screen.findByRole("dialog", { name: /^Registrar pago/ });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(origen));
  });

  it("al cerrar el cajón de presentación, el foco vuelve al botón que lo abrió", async () => {
    fijarContexto(PERMISOS_COMPLETOS);
    renderLegajo();
    await abrirCalculo();
    const origen = await screen.findByRole("button", { name: "Registrar presentación" });
    origen.focus();
    fireEvent.click(origen);
    const dialogo = await screen.findByRole("dialog", { name: /^Registrar presentación/ });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(origen));
  });
});
