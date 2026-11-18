// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Pruebas de flujo con la red simulada (Barra 2c): el cliente real («api») corre sobre un fetch
// simulado con datos sintéticos «Demo». Carga del legajo y de una etapa, y un 500 con «Reintentar».
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
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

const NOMBRE_BARRA = "Legajo: período, revisión, etapas y acciones";
let fallos500Saldos = 0;
let rutasLeidas: string[] = [];

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => cuerpo,
  } as unknown as Response;
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
  rutasLeidas = [];
  fallos500Saldos = 0;
  sessionStorage.clear();
  sessionStorage.setItem(
    `contable:${FIRMA_DEMO}:${CLIENTE_DEMO}:selected-tax-period`,
    PERIODO_ELEGIDO_DEMO,
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  contextMock.current = {
    firmId: FIRMA_DEMO,
    clientId: CLIENTE_DEMO,
    periodId: PERIODO_ELEGIDO_DEMO,
    isReady: true,
    capabilities: new Set(["client.read", "tax.settlements.calculate", "tax.vouchers.read"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  const lecturas = rutasDemo({ legajos: [legajoDemo("DRAFT")] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const ruta = url.replace(/^\/api\/v1/, "");
      rutasLeidas.push(ruta);
      if (ruta.endsWith("/tax-credit-ledger") && fallos500Saldos > 0) {
        fallos500Saldos -= 1;
        return respuesta(500, {
          error: { code: "INTERNAL", message: "Error simulado de la consulta de saldos." },
        });
      }
      return respuesta(200, { data: await lecturas(ruta) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("Legajo · flujos con la red simulada a través del cliente real (Barra 2c)", () => {
  it("la carga del legajo y de la etapa Saldos llega por el cliente real y muestra la barra y la tabla", async () => {
    renderLegajo();
    const barra = await screen.findByRole("region", { name: NOMBRE_BARRA });
    expect(await within(barra).findByRole("button", { name: "Revisión 1" })).toBeTruthy();
    expect(await screen.findByText("SALDO A FAVOR")).toBeTruthy();
    expect(rutasLeidas.some((ruta) => ruta.includes("/monthly-tax-workpapers?from="))).toBe(true);
    expect(rutasLeidas.some((ruta) => ruta.endsWith("/tax-credit-ledger"))).toBe(true);
  });

  it("un error 500 al leer Saldos se dice en la etapa con «Reintentar», que vuelve a consultar y muestra los saldos", async () => {
    fallos500Saldos = 1;
    renderLegajo();
    expect(await screen.findByText("No se pudieron leer los saldos")).toBeTruthy();
    const lecturasAntes = rutasLeidas.filter((ruta) => ruta.endsWith("/tax-credit-ledger")).length;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("SALDO A FAVOR")).toBeTruthy();
    expect(
      rutasLeidas.filter((ruta) => ruta.endsWith("/tax-credit-ledger")).length,
    ).toBeGreaterThan(lecturasAntes);
  });
});
