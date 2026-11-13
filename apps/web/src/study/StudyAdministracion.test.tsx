/// <reference types="node" />
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const profileFixture = {
  legalName: "Estudio Ejemplo SRL",
  displayName: "Estudio Ejemplo",
  taxId: "30123456789",
  timezone: "America/Argentina/Buenos_Aires",
};
const clientsFixture = [
  { id: "client-a", legalName: "Cliente Alfa", cuit: "30111111119", status: "ACTIVE" },
  { id: "client-b", legalName: "Cliente Beta", cuit: "30222222229", status: "ACTIVE" },
];
const assignmentFixture = {
  id: "assignment-a",
  userId: "u2",
  clientId: "client-a",
  capabilities: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  assignedBy: "u1",
};
const portalMembershipFixture = {
  id: "portal-a",
  userId: "portal-user-a",
  role: "READONLY",
  status: "ACTIVE",
  acceptedAt: "2026-11-01T00:00:00.000Z",
  revokedAt: null,
  user: { name: "Cliente Portal", emailNormalized: "portal@example.com" },
};

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

function mockApi(
  standards = standardsFixture,
  members: unknown[] = [],
  portalMemberships: unknown[] = [],
) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.includes("/settings/self-review")) return Promise.resolve({ allowSelfReview: false });
    if (path.includes("/accounting-standards")) return Promise.resolve(standards);
    if (path.endsWith("/profile")) return Promise.resolve(profileFixture);
    if (path === "/firms/firm-a/clients") return Promise.resolve(clientsFixture);
    if (path.includes("/assignments")) return Promise.resolve([assignmentFixture]);
    if (path.includes("/portal-invitations")) return Promise.resolve([]);
    if (path.includes("/portal-memberships")) return Promise.resolve(portalMemberships);
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

  it("permite al Titular activar autorrevisión desde la configuración del estudio", async () => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set([
        "firm.manage",
        "firm.users.manage",
        "firm.self_review.manage",
        "client.read",
      ]),
    };
    vi.mocked(api.patch).mockResolvedValue({ allowSelfReview: true } as never);
    renderAdministracion();

    const toggle = (await screen.findByRole("checkbox", {
      name: "Permitir autorrevisión de fuentes y expedientes",
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/settings/self-review", {
        allowSelfReview: true,
      }),
    );
    expect(await screen.findByText("Activada")).toBeTruthy();
    expect(screen.getByText(/reduce el control interno de cuatro ojos/)).toBeTruthy();
  });

  it("presenta la opción al Administrador como lectura y reserva el cambio al Titular", async () => {
    renderAdministracion();

    const toggle = (await screen.findByRole("checkbox", {
      name: "Permitir autorrevisión de fuentes y expedientes",
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText("Solo el Titular puede cambiar esta opción.")).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
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
    expect(screen.getByText("4 de 7")).toBeTruthy();
    expect(screen.getAllByText("7 de 7").length).toBe(2);
    expect(screen.getByText("Suspendido")).toBeTruthy();

    const strip = screen.getByRole("group", { name: "Resumen de accesos" });
    expect(within(strip).getByText("Titulares")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "revisor" } });
    expect(screen.queryByText("Owner A")).toBeNull();
    expect(screen.getByText("Revisor Demo")).toBeTruthy();
  });

  it("usa controles de rol de 32 px y acciones en variante row", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    await screen.findByText("Owner A");
    const page = document.querySelector(".administration-users") as HTMLElement;
    const roleSelects = page.querySelectorAll(".dense-select--inline");
    expect(roleSelects).toHaveLength(3);

    const rowActions = page.querySelectorAll<HTMLButtonElement>(".dense-row-actions .ds-button");
    expect(rowActions.length).toBeGreaterThan(0);
    expect(Array.from(rowActions).every((action) => action.tagName === "BUTTON")).toBe(true);
    expect(Array.from(rowActions).every((action) => action.classList.contains("ds-button--row"))).toBe(true);
    expect(page.querySelectorAll(".dense-fp__bars")).toHaveLength(0);

    const studyStyles = readFileSync(resolve(process.cwd(), "src/study/study.css"), "utf8");
    const tokens = readFileSync(resolve(process.cwd(), "../../packages/design-system/src/tokens.css"), "utf8");
    expect(studyStyles).toMatch(/\.administration-users \.dense-select--inline\s*\{[^}]*height:\s*var\(--ds-control-height-sm\);[^}]*min-height:\s*var\(--ds-control-height-sm\);[^}]*font-size:\s*var\(--ds-text-sm\);/);
    expect(studyStyles).not.toMatch(/\.administration-users \.dense-row-actions \.ds-button\s*\{[^}]*min-height:\s*var\(--ds-touch-target\);/);
    expect(studyStyles).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*\.administration-users \.dense-select--inline\s*\{[^}]*height:\s*var\(--ds-touch-target\);/s);
    expect(tokens).toMatch(/--ds-control-height-sm:\s*32px;/);
    expect(tokens).toMatch(/--ds-touch-target:\s*44px;/);
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

  it("guarda el rol apenas se elige y sin pedir confirmación", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockResolvedValue({});
    renderAdministracion();

    fireEvent.change(await screen.findByLabelText("Rol de Revisor Demo"), {
      target: { value: "ADMIN" },
    });

    await waitFor(() =>
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith("/firms/firm-a/members/u2", { role: "ADMIN" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("edita el nombre y el correo de un usuario del estudio", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockResolvedValue({});
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: "Editar a Revisor Demo" }));
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Revisor Nuevo" } });
    fireEvent.change(screen.getByLabelText("Correo"), {
      target: { value: "revisor.nuevo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/users/u2", {
        name: "Revisor Nuevo",
        email: "revisor.nuevo@example.com",
      }),
    );
    expect(await screen.findByText("Los datos del usuario quedaron actualizados.")).toBeTruthy();
  });

  it("explica en español cuando el correo ya pertenece a otra cuenta", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockRejectedValue(
      Object.assign(new Error("conflict"), { code: "USER_EMAIL_CONFLICT" }),
    );
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: "Editar a Revisor Demo" }));
    fireEvent.change(await screen.findByLabelText("Correo"), {
      target: { value: "ocupado@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Ese correo ya está asociado a otra cuenta.",
    );
  });

  it("muestra el mensaje claro de protección del último titular o administrador", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockRejectedValue(
      Object.assign(new Error("last admin"), { code: "LAST_ADMIN_REQUIRED" }),
    );
    renderAdministracion();

    fireEvent.change(await screen.findByLabelText("Rol de Owner A"), {
      target: { value: "PREPARER" },
    });

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "El estudio debe conservar al menos un titular o administrador activo.",
    );
  });

  it("suspende usuarios internos con una acción directa", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderAdministracion();

    const row = await screen.findByRole("row", { name: /Revisor Demo/ });
    fireEvent.click(within(row).getByRole("button", { name: "Suspender" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/members/u2/suspend", {}),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reactiva usuarios internos con una acción directa", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderAdministracion();

    const row = await screen.findByRole("row", { name: /Auditora Suspendida/ });
    fireEvent.click(within(row).getByRole("button", { name: "Reactivar" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/members/u3/reactivate", {}),
    );
  });

  it("cambia el rol de un acceso del portal desde Editar", async () => {
    mockApi(standardsFixture, [], [portalMembershipFixture]);
    vi.mocked(api.patch).mockResolvedValue(portalMembershipFixture as never);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar acceso de Cliente Portal" }));
    fireEvent.change(await screen.findByLabelText("Rol del portal"), {
      target: { value: "COLLABORATOR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/portal-memberships/portal-a",
        { role: "COLLABORATOR" },
      ),
    );
  });

  it("suspende y reactiva accesos del portal sin confirmación", async () => {
    mockApi(standardsFixture, [], [portalMembershipFixture]);
    vi.mocked(api.patch).mockResolvedValue(portalMembershipFixture as never);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Suspender" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/portal-memberships/portal-a",
        { status: "SUSPENDED" },
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("envía la reactivación del acceso del portal", async () => {
    mockApi(standardsFixture, [], [{ ...portalMembershipFixture, status: "SUSPENDED" }]);
    vi.mocked(api.patch).mockResolvedValue(portalMembershipFixture as never);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reactivar" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/portal-memberships/portal-a",
        { status: "ACTIVE" },
      ),
    );
  });

  it("asigna un cliente de la lista real a un usuario", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.post).mockResolvedValue(assignmentFixture as never);
    renderAdministracion();

    fireEvent.click(
      await screen.findByRole("button", { name: "Administrar clientes de Revisor Demo" }),
    );
    const clientSelect = await screen.findByLabelText("Cliente");
    expect(within(clientSelect).getByRole("option", { name: "Cliente Beta" })).toBeTruthy();
    fireEvent.change(clientSelect, { target: { value: "client-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar cliente" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-b/assignments", {
        userId: "u2",
        clientId: "client-b",
      }),
    );
  });

  it("quita una asignación de cliente de un usuario", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.del).mockResolvedValue({} as never);
    renderAdministracion();

    fireEvent.click(
      await screen.findByRole("button", { name: "Administrar clientes de Revisor Demo" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Quitar" }));

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/assignments/u2",
      ),
    );
  });

  it("edita y guarda explícitamente los cuatro datos del estudio", async () => {
    mockApi();
    vi.mocked(api.patch).mockResolvedValue({
      ...profileFixture,
      legalName: "Estudio Actualizado SRL",
      displayName: "Estudio Actualizado",
      taxId: "30987654321",
      timezone: "America/Argentina/Cordoba",
    } as never);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));
    expect(await screen.findByText(/Estudio Ejemplo SRL/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos" }));
    fireEvent.change(await screen.findByLabelText("Razón social"), {
      target: { value: "Estudio Actualizado SRL" },
    });
    fireEvent.change(screen.getByLabelText("Nombre del estudio"), {
      target: { value: "Estudio Actualizado" },
    });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "30987654321" } });
    fireEvent.change(screen.getByLabelText("Zona horaria"), {
      target: { value: "America/Argentina/Cordoba" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/profile", {
        legalName: "Estudio Actualizado SRL",
        displayName: "Estudio Actualizado",
        taxId: "30987654321",
        timezone: "America/Argentina/Cordoba",
      }),
    );
    expect(await screen.findByText(/Estudio Actualizado SRL/)).toBeTruthy();
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
