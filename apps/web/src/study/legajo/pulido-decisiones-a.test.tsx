// @vitest-environment jsdom
// Decisiones de Inti del 16-nov (hallazgo 48): no se envía a revisión con controles bloqueantes abiertos.
// Hallazgo 49a (decidido por Ciro): el botón de cálculo se llama «Calcular liquidación».
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
  rutasDemo,
} from "./datosDemoLegajo";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const sesionMock = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: sesionMock.userId ? { userId: sesionMock.userId } : null,
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
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.payments.record",
  "tax.filings.record",
];

function contexto(capacidades: string[]) {
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(capacidades),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
}

function renderLegajo(legajo: unknown) {
  vi.mocked(api.get).mockImplementation(rutasDemo({ legajos: [legajo] }) as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyExpedienteMensual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function controlBloqueante(codigo: string, estado: "OPEN" | "WAIVED" | "RESOLVED" = "OPEN") {
  return {
    id: `control-${codigo}`,
    code: codigo,
    label: `Control ${codigo}`,
    severity: "BLOCKING",
    status: estado,
    message: `Control ${codigo} sin resolver.`,
  };
}

describe("Legajo — enviar a revisión con controles bloqueantes (decisión de Inti, 48)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sesionMock.userId = null;
    contexto(TODAS);
  });

  afterEach(() => {
    cleanup();
  });

  it("con controles bloqueantes abiertos, Enviar a revisión queda deshabilitado y dice cuántos quedan", async () => {
    renderLegajo({
      ...legajoDemo("CALCULATED"),
      controls: [controlBloqueante("A"), controlBloqueante("B")],
    } as never);
    const boton = (await screen.findByRole("button", {
      name: "Enviar a revisión",
    })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(
      screen.getByText("Resolvé o eximí los controles que bloquean: quedan 2 abiertos."),
    ).toBeTruthy();
  });

  it("el botón deshabilitado no envía el legajo a revisión", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    renderLegajo({ ...legajoDemo("CALCULATED"), controls: [controlBloqueante("A")] } as never);
    const boton = (await screen.findByRole("button", {
      name: "Enviar a revisión",
    })) as HTMLButtonElement;
    fireEvent.click(boton);
    // La mutación de react-query corre en un microtick: se espera antes de afirmar que no hubo envío.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(api.post)).not.toHaveBeenCalledWith(expect.stringContaining("/submit-review"));
  });

  it("sin controles bloqueantes abiertos, Enviar a revisión queda habilitado y llama a submit-review", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    renderLegajo({
      ...legajoDemo("CALCULATED"),
      controls: [controlBloqueante("A", "WAIVED")],
    } as never);
    const boton = (await screen.findByRole("button", {
      name: "Enviar a revisión",
    })) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(expect.stringContaining("/submit-review")),
    );
  });
});

describe("Legajo — botón de cálculo «Calcular liquidación» (decisión de Ciro, 49a)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sesionMock.userId = null;
    contexto(TODAS);
  });

  afterEach(() => {
    cleanup();
  });

  it("en etapa de saldos, el botón de cálculo se llama «Calcular liquidación» y su motivo sigue debajo", async () => {
    renderLegajo(legajoDemo("COLLECTING_INPUTS"));
    expect(await screen.findByRole("button", { name: "Calcular liquidación" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Calcular" })).toBeNull();
  });
});
