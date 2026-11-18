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

// Dos revisiones del mismo período. La API devuelve primero la más alta (workpaper-service.ts:656).
const revisionVigente = { ...legajoDemo("DRAFT"), id: "wp-b", revision: 2 };
const revisionAnterior = { ...legajoDemo("FINALIZED"), id: "wp-a", revision: 1 };

/** Abre el menú «Revisión» de la barra y elige la revisión pedida. */
function elegirRevision(numero: number) {
  fireEvent.click(screen.getByRole("button", { name: /^Revisión \d+$/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(`^Revisión ${numero}`) }));
}

function renderPage() {
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
    capabilities: new Set([
      "client.read",
      "tax.settlements.calculate",
      "tax.settlements.submit_review",
      "tax.settlements.review",
      "tax.settlements.finalize",
      "tax.settlements.rectify",
    ]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  vi.mocked(api.get).mockImplementation(
    rutasDemo({ legajos: [revisionVigente, revisionAnterior] }) as never,
  );
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · dos revisiones del mismo período (K16)", () => {
  // Defecto de D6a: hoy cada tarjeta dibuja etapas y comparte una sola etapa activa.
  // Estas pruebas fijan el estado actual con it.fails; el corte las pasa a aserción.
  it("la revisión anterior se abre en solo lectura: sus seis etapas y ninguna acción que escriba", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    const barra = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    elegirRevision(1);
    expect(
      await screen.findByText("Revisión 1 en solo lectura: fue reemplazada por la revisión 2."),
    ).toBeTruthy();
    expect(within(barra).getAllByRole("tab")).toHaveLength(6);
    expect(within(barra).queryByRole("button", { name: "Crear rectificativa" })).toBeNull();
  });

  it("la etapa elegida se conserva al pasar a la revisión anterior, en solo lectura", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    const barra = screen.getByRole("region", {
      name: "Legajo: período, revisión, etapas y acciones",
    });
    fireEvent.click(within(barra).getByRole("tab", { name: "Fuentes" }));
    elegirRevision(1);
    expect(within(barra).getByRole("tab", { name: "Fuentes" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("la revisión anterior muestra su estado y la que la reemplaza", async () => {
    // vigente: cambia con A29
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });
    elegirRevision(1);
    expect(
      await screen.findByText("Revisión 1 · Finalizado · reemplazada por la revisión 2"),
    ).toBeTruthy();
  });

  it("las etapas leen la revisión vigente y no la anterior", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Saldos" });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("/monthly-tax-workpapers/wp-b/coverage"),
      ),
    );
    expect(api.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/monthly-tax-workpapers/wp-a/coverage"),
    );
  });
});
