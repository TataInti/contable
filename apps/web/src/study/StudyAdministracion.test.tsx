// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyAdministracion } from "./StudyAdministracion";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
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

const standardsFixture = [
  { id: "n1", name: "RTIC", isActive: true },
  { id: "n2", name: "VENCER", isActive: false },
];

function mockApi(standards = standardsFixture) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.includes("/accounting-standards")) return Promise.resolve(standards);
    if (path.includes("/portal-invitations")) return Promise.resolve([]);
    if (path.includes("/portal-memberships")) return Promise.resolve([]);
    if (path.includes("/members")) return Promise.resolve([]);
    return Promise.resolve(null);
  }) as never);
}

function renderAdministracion() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyAdministracion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudyAdministracion — catálogo de normas contables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = {
      firmId: "firm-a",
      clientId: "client-a",
      periodId: "period-a",
      isReady: true,
      capabilities: new Set(["firm.manage", "firm.users.manage", "client.read"]),
      hasClientAccess: (id) => id === "client-a",
      setFirmId: vi.fn(),
      setClientId: vi.fn(),
      setPeriodId: vi.fn(),
    };
    mockApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra el catálogo del estudio con su estado, sin valores precargados", async () => {
    renderAdministracion();

    expect((await screen.findAllByText("Normas contables")).length).toBeGreaterThan(0);
    expect(await screen.findByText("RTIC")).toBeTruthy();
    expect(await screen.findByText("VENCER")).toBeTruthy();
    expect(screen.getAllByText("Activo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactivo").length).toBeGreaterThan(0);
  });

  it("da de alta una norma desde Administración", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "n3", name: "NCPP 2019", isActive: true });
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: /Nueva norma/ }));
    const input = await screen.findByLabelText(/Nombre de la norma/);
    fireEvent.change(input, { target: { value: "NCPP 2019" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear norma" }));

    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
    expect(vi.mocked(api.post)).toHaveBeenCalledWith("/firms/firm-a/accounting-standards", {
      name: "NCPP 2019",
    });
  });

  it("desactiva una norma con confirmación explícita, sin borrar el valor", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "n1", name: "RTIC", isActive: false });
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    // La desactivación pide confirmación: el valor deja de ofrecerse en la
    // ficha pero los clientes que ya lo tienen lo conservan. El botón del
    // diálogo es el segundo "Desactivar" en pantalla.
    const confirmButtons = await screen.findAllByRole("button", { name: "Desactivar" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
    expect(vi.mocked(api.patch)).toHaveBeenCalledWith("/firms/firm-a/accounting-standards/n1", {
      isActive: false,
    });
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
