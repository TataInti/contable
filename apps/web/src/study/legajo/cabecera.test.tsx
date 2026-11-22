// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// Caracterización de la cabecera del Legajo (K3) con datos sintéticos «Demo».
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@contable/design-system";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyExpedienteMensual } from "../StudyExpedienteMensual";
import { CLIENTE_DEMO, FIRMA_DEMO, PERIODO_ELEGIDO_DEMO, rutasDemo } from "./datosDemoLegajo";

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
  vi.mocked(api.get).mockImplementation(rutasDemo() as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("Legajo · cabecera (K3)", () => {
  it("Gestionar explica que no se puede cargar sin tax.vouchers.prepare", async () => {
    fijarContexto(["client.read", "tax.settlements.calculate"]);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Ventas del período" }));
    expect(await screen.findByText("Tu rol no puede importar libros IVA.")).toBeInTheDocument();
  });

  it("Gestionar conserva la carga de libros IVA con tax.vouchers.prepare", async () => {
    fijarContexto(["client.read", "tax.vouchers.prepare"]);
    renderLegajo();
    fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar Ventas del período" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cargar archivo" }));
    expect(await screen.findByRole("dialog", { name: "Importar libros IVA" })).toBeInTheDocument();
  });

  /** Espera a que la barra tenga el período elegido, para que los ítems del menú reflejen el período. */
  async function esperarPeriodo() {
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Período fiscal" }) as HTMLSelectElement).value,
      ).toBe(PERIODO_ELEGIDO_DEMO),
    );
  }

  /** Abre «Acciones del período» y devuelve el ítem pedido. */
  function itemDelPeriodo(nombre: RegExp): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: "Acciones del período" }));
    return screen.getByRole("menuitem", { name: nombre });
  }

  it("Nuevo legajo queda deshabilitado sin período fiscal", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [] }) as never);
    fijarContexto(["client.read", "tax.settlements.calculate", "tax.vouchers.read"]);
    renderLegajo();
    expect(await screen.findByText("Configurá un período fiscal")).toBeInTheDocument();
    const item = itemDelPeriodo(/Nuevo legajo/);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText("Configurá un período fiscal para crear el legajo."),
    ).toBeInTheDocument();
  });

  it("Nuevo legajo queda deshabilitado sin tax.settlements.calculate y se habilita con él", async () => {
    fijarContexto(["client.read"]);
    renderLegajo();
    await esperarPeriodo();
    expect(itemDelPeriodo(/Nuevo legajo/).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Tu rol no puede crear legajos.")).toBeInTheDocument();
    cleanup();
    fijarContexto(["client.read", "tax.settlements.calculate"]);
    renderLegajo();
    await esperarPeriodo();
    expect(itemDelPeriodo(/Nuevo legajo/).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("Exportar libros no se dibuja sin tax.vouchers.read", async () => {
    fijarContexto(["client.read", "tax.settlements.calculate"]);
    renderLegajo();
    await esperarPeriodo();
    fireEvent.click(screen.getByRole("button", { name: "Acciones del período" }));
    expect(screen.queryByRole("menuitem", { name: /Exportar libros/ })).toBeNull();
  });

  it("Exportar libros se habilita con tax.vouchers.read y período", async () => {
    fijarContexto(["client.read", "tax.vouchers.read"]);
    renderLegajo();
    await esperarPeriodo();
    expect(itemDelPeriodo(/Exportar libros/).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("Exportar libros queda deshabilitado sin período fiscal", async () => {
    vi.mocked(api.get).mockImplementation(rutasDemo({ periodos: [] }) as never);
    fijarContexto(["client.read", "tax.vouchers.read"]);
    renderLegajo();
    expect(await screen.findByText("Configurá un período fiscal")).toBeInTheDocument();
    const item = itemDelPeriodo(/Exportar libros/);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText("Elegí un período fiscal para exportar sus libros."),
    ).toBeInTheDocument();
  });
});
