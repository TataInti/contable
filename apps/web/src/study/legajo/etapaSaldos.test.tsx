// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la etapa Saldos del Legajo (K9) con datos sintéticos «Demo».
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
  rutasDemo,
  saldoDemo,
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

const PERMISOS_SALDOS = ["client.read", "tax.settlements.calculate"];

// Segundo saldo «Demo»: sin referencia ni documento, cargado a mano por «Persona Demo».
const saldoCargaManualDemo = {
  ...saldoDemo,
  id: "lot-b",
  reference: null,
  evidenceDocumentId: null,
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

function renderLegajo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/?etapa=saldos"]}>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", PERIODO_ELEGIDO_DEMO);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockImplementation(
    rutasDemo({ saldos: [saldoDemo, saldoCargaManualDemo] }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · etapa Saldos (K9)", () => {
  it("muestra «Sin aplicaciones» y «Sin cambios» en los saldos sin movimientos ni historial", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    expect((await screen.findAllByText("Sin aplicaciones")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Sin cambios")).length).toBeGreaterThan(0);
  });

  it("muestra «Carga manual · nombre» cuando el saldo no tiene referencia ni documento", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    expect(await screen.findByText("Carga manual · Persona Demo")).toBeInTheDocument();
  });

  it("Editar abre el panel Editar saldo", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0]!);
    expect(await screen.findByRole("dialog", { name: "Editar saldo" })).toBeInTheDocument();
  });

  it("Cargar saldo inicial abre el panel de carga", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    fireEvent.click(await screen.findByRole("button", { name: "Cargar saldo inicial" }));
    expect(await screen.findByRole("dialog", { name: "Cargar saldo inicial" })).toBeInTheDocument();
  });

  // Un error al leer los saldos muestra Reintentar; la etapa no lo presenta como vacío.
  it("un error al leer los saldos se muestra con Reintentar, no como vacío", async () => {
    const rutas = rutasDemo({ saldos: [saldoDemo, saldoCargaManualDemo] });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/tax-credit-ledger")
        ? Promise.reject(new Error("Fallo Demo"))
        : rutas(path)) as never);
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

describe("Legajo · etapa Saldos: respaldo de cierre con identificador corto (Foco 2.7b)", () => {
  it("el identificador del cierre se muestra corto y el completo queda en title", async () => {
    fijarContexto(PERMISOS_SALDOS);
    const referencia = "Cierre 01a1de63-eb18-4c2a-9d3e-6f7a8b9c0d1e · versión 2";
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ saldos: [{ ...saldoDemo, reference: referencia }] }) as never,
    );
    renderLegajo();
    const respaldo = await screen.findByText("Cierre 01a1de63 · versión 2");
    expect(respaldo).toHaveAttribute("title", referencia);
  });
});

const saldoDelMesAnterior = {
  ...saldoDemo,
  id: "lot-prev",
  periodId: "period-sep",
  period: {
    id: "period-sep",
    label: null,
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-09-30T00:00:00.000Z",
  },
  taxType: { id: "tax-type-a", code: "IIBB", name: "Ingresos Brutos" },
  origin: "CIERRE" as const,
  verificationStatus: "VERIFIED",
  carryForward: true,
  originalAmount: "1234.0000",
  available: "1234.0000",
  reference: "Cierre 01a1de63-eb18-4c2a-9d3e-6f7a8b9c0d1e · versión 1",
};

/** Mes anterior: su legajo responde solo para el rango de septiembre; el resto, como en rutasDemo. */
function conMesAnterior(estado: string | null, saldos: unknown[]) {
  const rutas = rutasDemo({ saldos: saldos as never });
  return ((path: string) =>
    path.includes("from=2026-09-01")
      ? Promise.resolve(estado ? [legajoDemo(estado)] : [])
      : rutas(path)) as never;
}

describe("Legajo · etapa Saldos (3E): arrastre, mes anterior y cambios con motivo", () => {
  it("dice de dónde viene el saldo arrastrado y que se aplica solo al calcular", async () => {
    fijarContexto(PERMISOS_SALDOS);
    vi.mocked(api.get).mockImplementation(conMesAnterior("FINALIZED", [saldoDelMesAnterior, saldoDemo]));
    renderLegajo();
    expect(
      await screen.findByText(
        /Viene del cierre de septiembre de 2026, Ingresos Brutos: .*1\.234,00; se aplica solo al calcular/,
      ),
    ).toBeInTheDocument();
  });

  it("con el mes anterior sin cerrar lo dice en una frase y no ofrece copiar el saldo", async () => {
    fijarContexto(PERMISOS_SALDOS);
    vi.mocked(api.get).mockImplementation(conMesAnterior(null, [saldoDemo]));
    renderLegajo();
    expect(
      await screen.findByText("El mes anterior no está cerrado: cargá el saldo a mano o cerralo primero."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar/i })).toBeNull();
  });

  it("con el mes anterior cerrado y sin saldo arrastrado lo dice", async () => {
    fijarContexto(PERMISOS_SALDOS);
    vi.mocked(api.get).mockImplementation(conMesAnterior("FINALIZED", [saldoDemo]));
    renderLegajo();
    expect(await screen.findByText("Sin saldo a favor del mes anterior.")).toBeInTheDocument();
  });

  it("un mes finalizado no deja cambiar saldos y dice cómo hacerlo", async () => {
    fijarContexto(PERMISOS_SALDOS);
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ saldos: [saldoDemo], legajos: [legajoDemo("FINALIZED")] }) as never,
    );
    renderLegajo();
    expect(
      await screen.findByText("Este mes está finalizado: para cambiar un saldo, rectificá la liquidación."),
    ).toBeInTheDocument();
    const editar = await screen.findAllByRole("button", { name: "Editar" });
    expect(editar.every((boton) => boton.hasAttribute("disabled"))).toBe(true);
  });

  it("sin permiso de cálculo no aparece Editar", async () => {
    fijarContexto(["client.read"]);
    renderLegajo();
    expect(await screen.findByText("Carga manual · Persona Demo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("la columna del historial se llama Historial", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    expect(await screen.findByText("Historial")).toBeInTheDocument();
  });

  it("la columna Monto vigente muestra el monto con sus correcciones, y el original queda aparte", async () => {
    fijarContexto(PERMISOS_SALDOS);
    vi.mocked(api.get).mockImplementation(
      rutasDemo({ saldos: [{ ...saldoDemo, originalAmount: "1000.00", importeVigente: "1500.00" }] }) as never,
    );
    renderLegajo();
    expect(await screen.findByText("Monto vigente")).toBeInTheDocument();
    expect(await screen.findByText(/1\.500,00/)).toBeInTheDocument();
  });

  it("cambiar solo la referencia no pide motivo ni registra una corrección", async () => {
    fijarContexto(PERMISOS_SALDOS);
    renderLegajo();
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0]!);
    const dialogo = await screen.findByRole("dialog", { name: "Editar saldo" });
    fireEvent.change(within(dialogo).getByLabelText("Referencia"), {
      target: { value: "Referencia Demo" },
    });
    expect(within(dialogo).queryByLabelText("Motivo del cambio de importe")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/firms/${FIRMA_DEMO}/clients/${CLIENTE_DEMO}/tax-credit-ledger/lot-a`, {
        reference: "Referencia Demo",
        evidenceDocumentId: null,
      }),
    );
    expect(api.post).not.toHaveBeenCalled();
  });
});
