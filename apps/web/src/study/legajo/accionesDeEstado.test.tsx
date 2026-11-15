// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const AUTORREVISION =
  "Para revisar o finalizar este legajo, el Titular puede habilitar la autorrevisión en Configuración del estudio.";

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

function renderLegajos(legajos: unknown[]) {
  vi.mocked(api.get).mockImplementation(rutasDemo({ legajos }) as never);
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

async function accionesDeLaTarjeta(container: HTMLElement) {
  await screen.findByRole("heading", { level: 2, name: /Revisión 1/ });
  return container.querySelector(".workpaper-card__actions") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  sesionMock.userId = null;
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · acciones de estado de la tarjeta (K14)", () => {
  const estados: Array<[string, string[]]> = [
    ["DRAFT", ["Calcular"]],
    ["COLLECTING_INPUTS", ["Calcular"]],
    ["READY_TO_CALCULATE", ["Calcular"]],
    ["CHANGES_REQUESTED", ["Recalcular"]],
    ["CALCULATED", ["Enviar a revisión"]],
    ["IN_REVIEW", ["Aprobar revisión", "Solicitar cambios"]],
    ["REVIEWED", ["Finalizar"]],
    ["FINALIZED", ["Crear rectificativa"]],
  ];

  it.each(estados)("en %s muestra solo las acciones de su etapa", async (estado, esperadas) => {
    contexto(TODAS);
    const { container } = renderLegajos([legajoDemo(estado)]);
    const acciones = await accionesDeLaTarjeta(container);

    await waitFor(() =>
      expect(
        within(acciones)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(esperadas),
    );
  });

  it("sin tax.settlements.review no dibuja las acciones de revisión", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.review"));
    const { container } = renderLegajos([legajoDemo("IN_REVIEW")]);
    const acciones = await accionesDeLaTarjeta(container);

    expect(within(acciones).queryAllByRole("button")).toHaveLength(0);
  });

  it("sin tax.settlements.finalize deja Finalizar deshabilitado", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.finalize"));
    renderLegajos([legajoDemo("REVIEWED")]);

    const boton = (await screen.findByRole("button", { name: "Finalizar" })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("sin tax.settlements.calculate explica junto a Calcular por qué no se puede", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.calculate"));
    const { container } = renderLegajos([legajoDemo("DRAFT")]);
    const acciones = await accionesDeLaTarjeta(container);

    const boton = within(acciones).getByRole("button", { name: "Calcular" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(
      within(acciones).getByText("Tu perfil no tiene permiso para calcular este legajo."),
    ).toBeTruthy();
  });

  it("sin tax.settlements.rectify no ofrece Crear rectificativa", async () => {
    contexto(TODAS.filter((c) => c !== "tax.settlements.rectify"));
    const { container } = renderLegajos([legajoDemo("FINALIZED")]);
    const acciones = await accionesDeLaTarjeta(container);

    expect(within(acciones).queryByRole("button", { name: "Crear rectificativa" })).toBeNull();
  });

  it("la autorrevisión bloquea Aprobar revisión y muestra su texto", async () => {
    contexto(TODAS);
    sesionMock.userId = "user-a";
    renderLegajos([{ ...legajoDemo("IN_REVIEW"), preparedByUserId: "user-a" }]);

    const boton = (await screen.findByRole("button", {
      name: "Aprobar revisión",
    })) as HTMLButtonElement;
    await waitFor(() => expect(boton.disabled).toBe(true));
    expect(await screen.findByText(AUTORREVISION)).toBeTruthy();
  });

  it("la autorrevisión bloquea Finalizar y nombra quién revisó", async () => {
    contexto(TODAS);
    sesionMock.userId = "user-a";
    renderLegajos([
      { ...legajoDemo("REVIEWED"), preparedByUserId: "user-a", reviewedByUserId: "user-a" },
    ]);

    expect(
      await screen.findByText("Legajo revisado por la misma persona que lo preparó."),
    ).toBeTruthy();
    const boton = screen.getByRole("button", { name: "Finalizar" }) as HTMLButtonElement;
    await waitFor(() => expect(boton.disabled).toBe(true));
    expect(await screen.findByText(AUTORREVISION)).toBeTruthy();
  });

  it("Enviar a revisión llama a submit-review", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("CALCULATED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Enviar a revisión" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/submit-review"),
      ),
    );
  });

  it("Aprobar revisión envía approved true", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("IN_REVIEW")]);

    fireEvent.click(await screen.findByRole("button", { name: "Aprobar revisión" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/review"),
        { approved: true },
      ),
    );
  });

  it("Solicitar cambios envía approved false", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("IN_REVIEW")]);

    fireEvent.click(await screen.findByRole("button", { name: "Solicitar cambios" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/review"),
        { approved: false },
      ),
    );
  });

  it("Finalizar llama a finalize", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("REVIEWED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Finalizar" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/finalize"),
      ),
    );
  });

  it("Crear rectificativa llama a rectify", async () => {
    contexto(TODAS);
    renderLegajos([legajoDemo("FINALIZED")]);

    fireEvent.click(await screen.findByRole("button", { name: "Crear rectificativa" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-a/rectify"),
      ),
    );
  });
});
