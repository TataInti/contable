// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const membersFixture = [
  {
    id: "m1",
    userId: "u1",
    role: "OWNER",
    status: "ACTIVE",
    acceptedAt: null,
    user: { name: "Owner A", emailNormalized: "owner.a@example.com", status: "ACTIVE" },
  },
  {
    id: "m2",
    userId: "u2",
    role: "REVIEWER",
    status: "ACTIVE",
    acceptedAt: null,
    user: { name: "Revisor Demo", emailNormalized: "revisor@example.com", status: "ACTIVE" },
  },
  {
    id: "m3",
    userId: "u3",
    role: "AUDITOR_READONLY",
    status: "SUSPENDED",
    acceptedAt: null,
    user: { name: "Auditora Suspendida", emailNormalized: "auditora@example.com", status: "SUSPENDED" },
  },
];

function mockApi(standards = standardsFixture, members: unknown[] = []) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.includes("/accounting-standards")) return Promise.resolve(standards);
    if (path.includes("/portal-invitations")) return Promise.resolve([]);
    if (path.includes("/portal-memberships")) return Promise.resolve([]);
    if (path.includes("/members")) return Promise.resolve(members);
    return Promise.resolve(null);
  }) as never);
}

const openStandards = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: /Normas contables/ }));

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

    await openStandards();
    expect(await screen.findByText("RTIC")).toBeTruthy();
    expect(await screen.findByText("VENCER")).toBeTruthy();
    expect(screen.getAllByText("Activo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactivo").length).toBeGreaterThan(0);
  });

  it("da de alta una norma desde Administración", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "n3", name: "NCPP 2019", isActive: true });
    renderAdministracion();

    await openStandards();
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

    await openStandards();
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

  it("expone un único CTA de alta individual y explica el submit deshabilitado", async () => {
    renderAdministracion();

    // Un solo CTA "Nuevo usuario"; el panel de alta no duplica la acción de abrirlo.
    expect(await screen.findAllByRole("button", { name: /Nuevo usuario/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo usuario/ }));

    expect(await screen.findByText(/Ingresá nombre y email/)).toBeTruthy();
    // El submit del drawer queda deshabilitado hasta completar nombre y email.
    const submit = screen.getByRole("button", { name: "Crear usuario" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("lista a los usuarios con su rol, huella de módulos y estado, y filtra por búsqueda", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    expect(await screen.findByText("Owner A")).toBeTruthy();
    expect(screen.getByText("Revisor Demo")).toBeTruthy();
    // El auditor sólo abre 4 de los 7 módulos internos.
    expect(screen.getByText("4/7")).toBeTruthy();
    expect(screen.getAllByText("7/7").length).toBe(2);
    expect(screen.getByText("Suspendido")).toBeTruthy();

    const strip = screen.getByRole("group", { name: "Resumen de accesos" });
    expect(within(strip).getByText("Titulares")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "revisor" } });
    expect(screen.queryByText("Owner A")).toBeNull();
    expect(screen.getByText("Revisor Demo")).toBeTruthy();
  });

  it("abre el detalle con la matriz de roles y las acciones del usuario", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    fireEvent.click(await screen.findByText("Revisor Demo"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(within(detail).getByText("revisor@example.com")).toBeTruthy();
    expect(within(detail).getByRole("table", { name: "Módulos habilitados por rol" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Suspender" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Recuperar acceso" })).toBeTruthy();
  });

  it("pide confirmación antes de cambiar el rol de un usuario", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockResolvedValue({});
    renderAdministracion();

    fireEvent.change(await screen.findByLabelText("Rol de Revisor Demo"), {
      target: { value: "ADMIN" },
    });
    expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar rol" }));

    await waitFor(() =>
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith("/firms/firm-a/members/u2", { role: "ADMIN" }),
    );
  });

  it("da de alta usuarios en lote, una cuenta por vez, y muestra las contraseñas temporales", async () => {
    vi.mocked(api.post).mockImplementation(((_path: string, body: Record<string, string>) =>
      Promise.resolve({
        userId: `user-${body.email}`,
        email: body.email,
        name: body.name,
        role: body.role,
        temporaryPassword: `tmp-${body.name}`,
      })) as never);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: "Alta en lote" }));
    fireEvent.change(await screen.findByLabelText(/Una persona por línea/), {
      target: {
        value: "Lucía Fernández, lucia@estudio.com, Revisor\nMartín Acosta, martin@estudio\nPaula Sosa, paula@estudio.com",
      },
    });

    // La línea con email inválido se marca y no se crea.
    expect(await screen.findByText("Email inválido o faltante.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Crear 2 usuarios/ }));

    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(1, "/firms/firm-a/users", {
      email: "lucia@estudio.com",
      name: "Lucía Fernández",
      role: "REVIEWER",
    });
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(2, "/firms/firm-a/users", {
      email: "paula@estudio.com",
      name: "Paula Sosa",
      role: "PREPARER",
    });
    expect(await screen.findByText("tmp-Lucía Fernández")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeTruthy();
  });
});
