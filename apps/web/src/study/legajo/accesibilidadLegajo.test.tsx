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
  "tax.vouchers.prepare",
  "tax.vouchers.review",
  "tax.payments.record",
  "tax.filings.record",
];

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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(TODAS),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · accesibilidad mínima (Foco 2.3a)", () => {
  it("la pantalla tiene un solo h1", async () => {
    renderLegajos([legajoDemo("CALCULATED")]);
    await screen.findByRole("region", { name: "Legajo: período, revisión, etapas y acciones" }); // vigente: cambia con A29
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("la tarjeta muestra como máximo una acción primaria", async () => {
    const { container } = renderLegajos([legajoDemo("CALCULATED")]);
      await screen.findByRole("button", { name: "Enviar a revisión" });
    await screen.findByRole("region", { name: "Legajo: período, revisión, etapas y acciones" }); // vigente: cambia con A29
    expect(container.querySelectorAll(".work-bar .ds-button--primary")).toHaveLength(
      1,
    );
  });

  it("el tablist tiene una sola pestaña seleccionada", async () => {
    renderLegajos([legajoDemo("COLLECTING_INPUTS")]);
    const pestanas = await screen.findAllByRole("tab");
    expect(pestanas.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("al cancelar Finalizar, el foco vuelve al botón de origen", async () => {
    renderLegajos([legajoDemo("REVIEWED")]);
    const origen = await screen.findByRole("button", { name: "Finalizar" });
    origen.focus();
    fireEvent.click(origen);
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(origen));
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/finalize"));
  });

  it("Escape cierra la confirmación aunque la pantalla se actualice con ella abierta", async () => {
    renderLegajos([legajoDemo("REVIEWED")]);
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/finalize"));
  });
});
