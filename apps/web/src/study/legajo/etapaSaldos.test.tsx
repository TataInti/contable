// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la etapa Saldos del Legajo (K9) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        <MemoryRouter>
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
