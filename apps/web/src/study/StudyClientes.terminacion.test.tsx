// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyClientes } from "./StudyClientes";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

interface MockSession {
  status: "loading" | "authenticated" | "unauthenticated";
  me: null;
  portalContexts: never[];
  error: null;
  refresh: () => Promise<void>;
}

const sessionMock = vi.hoisted(() => ({ current: null as unknown as MockSession }));

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

// Datos sintéticos rotulados: CUIT válidos de cada terminación y un cliente sin CUIT.
const CLIENTES_SINTETICOS = [
  { id: "c-0", legalName: "Sintético 00", cuit: "20000000060", cuitEnding: "0", status: "ACTIVE", profile: null },
  { id: "c-1", legalName: "Sintético 01", cuit: "20000000001", cuitEnding: "1", status: "ACTIVE", profile: null },
  { id: "c-2", legalName: "Sintético 02", cuit: "20000000052", cuitEnding: "2", status: "ACTIVE", profile: null },
  { id: "c-9a", legalName: "Sintético 09 A", cuit: "20000000079", cuitEnding: "9", status: "ACTIVE", profile: null },
  { id: "c-9b", legalName: "Sintético 09 B", cuit: "20000000079", cuitEnding: "9", status: "ACTIVE", profile: null },
  { id: "c-none", legalName: "Sintético sin CUIT", cuit: "", cuitEnding: null, status: "ONBOARDING", profile: null },
];

function mockApi() {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/clients")) return Promise.resolve(CLIENTES_SINTETICOS);
    return Promise.resolve([]);
  }) as never);
}

function SearchProbe() {
  const { search } = useLocation();
  return <output data-testid="current-search">{search}</output>;
}

function renderClientes(initialEntry = "/clientes") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <StudyClientes />
          <SearchProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function rowKeys(): string[] {
  const table = screen.getByRole("table", { name: "Cartera de clientes" });
  return Array.from(table.querySelectorAll("tbody tr[data-row-key]")).map(
    (row) => row.getAttribute("data-row-key") ?? "",
  );
}

function groupHeaders(): string[] {
  return Array.from(document.querySelectorAll("tr.dense-group-row th")).map(
    (th) => th.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

function currentParams(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("current-search").textContent ?? "");
}

describe("StudyClientes — terminación de CUIT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: "period-a",
      isReady: true,
      capabilities: new Set(["client.read", "client.manage"]),
      hasClientAccess: (id) => id === "client-a",
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
    sessionMock.current = {
      status: "authenticated",
      me: null,
      portalContexts: [],
      error: null,
      refresh: async () => {},
    };
    mockApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("filtra por uno o varios dígitos y deja el filtro en la URL", async () => {
    renderClientes();
    await screen.findByRole("table", { name: "Cartera de clientes" });
    expect(rowKeys()).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "9" }));
    await waitFor(() => expect(rowKeys()).toEqual(["c-9a", "c-9b"]));
    expect(currentParams().get("terminacion")).toBe("9");

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    await waitFor(() => expect(rowKeys()).toEqual(["c-1", "c-9a", "c-9b"]));
    expect(currentParams().get("terminacion")).toBe("1,9");
  });

  it("agrupa por terminación con encabezado y conteo por grupo, y deja «Sin CUIT» al final", async () => {
    renderClientes();
    await screen.findByRole("table", { name: "Cartera de clientes" });

    fireEvent.click(screen.getByRole("button", { name: "Agrupar por terminación" }));

    await waitFor(() => expect(currentParams().get("agrupar")).toBe("terminacion"));
    expect(groupHeaders()).toEqual([
      "Terminación de CUIT 0 1",
      "Terminación de CUIT 1 1",
      "Terminación de CUIT 2 1",
      "Terminación de CUIT 9 2",
      "Sin CUIT 1",
    ]);
    expect(rowKeys()).toEqual(["c-0", "c-1", "c-2", "c-9a", "c-9b", "c-none"]);
  });

  it("muestra «Sin CUIT» en la columna del cliente que no tiene CUIT", async () => {
    renderClientes();
    const table = await screen.findByRole("table", { name: "Cartera de clientes" });

    const row = table.querySelector('tbody tr[data-row-key="c-none"]') as HTMLElement;
    expect(within(row).getByText("Sin CUIT", { selector: ".dense-dim" }).textContent).toBe("Sin CUIT");
  });

  it("muestra el estado vacío con la acción para quitar los filtros", async () => {
    renderClientes("/clientes?terminacion=5");

    await screen.findByText("Ningún cliente coincide");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));

    await waitFor(() => expect(currentParams().get("terminacion")).toBeNull());
    await screen.findByRole("table", { name: "Cartera de clientes" });
    expect(rowKeys()).toHaveLength(6);
  });

  it("aplica desde la URL el filtro y la agrupación al cargar la pantalla", async () => {
    renderClientes("/clientes?terminacion=9&agrupar=terminacion");
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(rowKeys()).toEqual(["c-9a", "c-9b"]);
    expect(groupHeaders()).toEqual(["Terminación de CUIT 9 2"]);
    expect(screen.getByRole("button", { name: "9" }).getAttribute("aria-pressed")).toBe("true");
  });
});
