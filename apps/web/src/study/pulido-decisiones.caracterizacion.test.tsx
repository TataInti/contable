// @vitest-environment jsdom
// Caracterización (corte pulido-decisiones): lo que no cambia y debe seguir igual.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyExpedienteMensual } from "./StudyExpedienteMensual";
import { StudyClientes } from "./StudyClientes";
import {
  CLIENTES_SINTETICOS,
  SESION_AUTENTICADA,
  contextoDePrueba,
  renderConRutas,
  respuestaApi,
} from "./clientes/clientes.testutil";
import {
  CLIENTE_DEMO,
  FIRMA_DEMO,
  PERIODO_ELEGIDO_DEMO,
  legajoDemo,
  rutasDemo,
} from "./legajo/datosDemoLegajo";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const sessionMock = vi.hoisted(() => ({ current: null as unknown as typeof SESION_AUTENTICADA }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
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

function renderLegajo(legajo: unknown, opciones: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation(rutasDemo({ legajos: [legajo], ...opciones }) as never);
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

describe("Caracterización del corte pulido-decisiones (sin cambios de comportamiento)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionMock.current = { ...SESION_AUTENTICADA };
    contexto(TODAS);
  });

  afterEach(() => {
    cleanup();
  });

  it("el pedido de cambios del revisor es el primer bloque del contenido, debajo de la barra", async () => {
    // vigente: cambia con A29
    const { container } = renderLegajo(legajoDemo("CHANGES_REQUESTED"), {
      calculo: [
        {
          settlement: {
            differences: [
              { code: "CHANGES_REQUESTED", message: "Falta el extracto bancario de octubre." },
            ],
          },
        },
      ],
    });
    await waitFor(() => expect(container.querySelector(".workpaper-pedido")).toBeTruthy());
    const aviso = container.querySelector(".workpaper-pedido");
    const barra = container.querySelector(".work-bar");
    expect(aviso?.textContent).toContain("Falta el extracto bancario de octubre.");
    expect(aviso?.previousElementSibling?.classList.contains("workpaper-stage-toolbar")).toBe(true);
    expect(container.querySelector(".work-page__body")?.contains(barra ?? null)).toBe(false);
    expect(barra!.compareDocumentPosition(aviso!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("con cambios solicitados, Recalcular es el único camino para volver a enviar: no aparece Enviar a revisión", async () => {
    renderLegajo(legajoDemo("CHANGES_REQUESTED"));
    expect(await screen.findByRole("button", { name: "Recalcular" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enviar a revisión" })).toBeNull();
  });

  it("con clientes en la cartera, la lista muestra sus filas y no el estado vacío", async () => {
    vi.mocked(api.get).mockImplementation(((path: string) =>
      respuestaApi(path, CLIENTES_SINTETICOS)) as never);
    sessionMock.current = { ...SESION_AUTENTICADA };
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    renderConRutas("/clientes", <StudyClientes />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    expect(screen.queryByText("Todavía no hay clientes")).toBeNull();
  });
});
