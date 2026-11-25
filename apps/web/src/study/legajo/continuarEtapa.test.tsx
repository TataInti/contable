// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Legajo: abre en la primera etapa con pendientes y «Continuar: <paso>» al pie y en la barra
// (09-5, 09-6, 12-7). Datos sintéticos «Demo».
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

const TODAS = [
  "client.read",
  "tax.settlements.calculate",
  "tax.settlements.submit_review",
  "tax.settlements.review",
  "tax.settlements.finalize",
  "tax.settlements.rectify",
  "tax.vouchers.read",
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.payments.record",
  "tax.filings.record",
];


function fijarContexto(permisos: string[] = TODAS) {
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
  } as unknown as ClientContextValue;
}

function renderLegajo(ruta = "/") {
  const lecturas = rutasDemo({});
  vi.mocked(api.get).mockImplementation(lecturas as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[ruta]}>
          <StudyExpedienteMensual />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}


beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
  fijarContexto();
});

afterEach(() => {
  cleanup();
});

function etapaActiva(): string {
  return screen.getByRole("tab", { selected: true }).textContent ?? "";
}

describe("Legajo · «Continuar» y etapa inicial", () => {
  it("abre en la primera etapa con pendientes y no en Saldos", async () => {
    renderLegajo();
    await waitFor(() => expect(etapaActiva()).toMatch(/^Fuentes/));
  });

  it("respeta la etapa de la dirección aunque haya pendientes antes", async () => {
    renderLegajo("/?etapa=saldos");
    await screen.findByRole("tab", { name: /Saldos/ });
    await waitFor(() => expect(etapaActiva()).toMatch(/^Saldos/));
    expect(await screen.findAllByRole("button", { name: "Continuar: Fuentes" })).toHaveLength(2);
  });

  it("«Continuar» está arriba (acciones de la etapa) y al pie, y pasa a la etapa siguiente", async () => {
    renderLegajo("/?etapa=fuentes");
    const botones = await screen.findAllByRole("button", { name: "Continuar: Clasificación" });
    expect(botones).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Acciones de la etapa" })).getByRole("button", { name: "Continuar: Clasificación" })).toBeInTheDocument();
    fireEvent.click(botones[1]!);
    await waitFor(() => expect(etapaActiva()).toMatch(/^Clasificación/));
    expect(await screen.findAllByRole("button", { name: "Continuar: Cálculo" })).toHaveLength(2);
  });

  it("el Cierre es el último paso y no ofrece «Continuar»", async () => {
    renderLegajo("/?etapa=cierre");
    await waitFor(() => expect(etapaActiva()).toMatch(/^Cierre/));
    expect(screen.queryByRole("button", { name: /^Continuar:/ })).not.toBeInTheDocument();
  });
});
