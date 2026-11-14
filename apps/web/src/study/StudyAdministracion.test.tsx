/// <reference types="node" />
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@contable/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyAdministracion } from "./StudyAdministracion";
import { readStudyStyles } from "./studyStyles.testutil";

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

const openControls = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: "Controles" }));

function renderAdministracion() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
      <MemoryRouter>
        <StudyAdministracion />
      </MemoryRouter>
      </ToastProvider>
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

  it("permite al Titular activar autorrevisión desde Controles", async () => {
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
    expect(screen.queryByRole("checkbox", { name: "Permitir autorrevisión de fuentes y legajos" })).toBeNull();
    await openControls();

    const toggle = (await screen.findByRole("checkbox", {
      name: "Permitir autorrevisión de fuentes y legajos",
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
    const studyStyles = readStudyStyles();
    expect(studyStyles).toMatch(/\.self-review-setting__title\s*\{[^}]*font-size:\s*var\(--ds-text-base\)/);
  });

  it("presenta la opción al Administrador como lectura y reserva el cambio al Titular", async () => {
    renderAdministracion();
    await openControls();

    const toggle = (await screen.findByRole("checkbox", {
      name: "Permitir autorrevisión de fuentes y legajos",
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

    expect(await screen.findByText(/Ingresá nombre y correo/)).toBeTruthy();
    // El submit del drawer queda deshabilitado hasta completar nombre y correo.
    const submit = screen.getByRole("button", { name: "Crear usuario" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("lista usuarios sin repetir el conteo de módulos y filtra por búsqueda", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    expect(await screen.findByText("Owner A")).toBeTruthy();
    expect(screen.getByText("Revisor Demo")).toBeTruthy();
    expect(screen.getByText("Suspendido")).toBeTruthy();

    const strip = screen.getByRole("group", { name: "Resumen de accesos" });
    expect(within(strip).getByText("Suspendidos")).toBeTruthy();
    expect(within(strip).getByText("Invitaciones pendientes")).toBeTruthy();
    expect(within(strip).queryByText("Usuarios internos")).toBeNull();
    expect(within(strip).queryByText("Accesos del portal")).toBeNull();
    expect(screen.getByRole("tab", { name: /Usuarios internos\s*3/ })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Usuarios internos" });
    expect(within(table).queryByText("Módulos")).toBeNull();
    expect(within(table).queryByText(/de 7/)).toBeNull();
    expect(screen.queryByText("3 usuarios")).toBeNull();
    expect((document.querySelector(".administration-users")?.textContent ?? "")).not.toMatch(
      /\bUI\b|fuente de verdad|contexto superior|\bemail\b/i,
    );

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

    const studyStyles = readStudyStyles();
    const tokens = readFileSync(resolve(process.cwd(), "../../packages/design-system/src/tokens.css"), "utf8");
    expect(studyStyles).toMatch(/\.administration-users \.dense-select--inline\s*\{[^}]*height:\s*var\(--ds-control-height-sm\);[^}]*min-height:\s*var\(--ds-control-height-sm\);[^}]*font-size:\s*var\(--ds-text-sm\);/);
    expect(studyStyles).not.toMatch(/\.administration-users \.dense-row-actions \.ds-button\s*\{[^}]*min-height:\s*var\(--ds-touch-target\);/);
    expect(studyStyles).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*\.administration-users \.dense-select--inline\s*\{[^}]*height:\s*var\(--ds-touch-target\);/s);
    expect(tokens).toMatch(/--ds-control-height-sm:\s*32px;/);
    expect(tokens).toMatch(/--ds-touch-target:\s*44px;/);
  });

  it("abre el detalle con la matriz de roles y acciones nombradas por usuario", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    fireEvent.click(await screen.findByText("Revisor Demo"));
    const detail = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(within(detail).getByText("revisor@example.com")).toBeTruthy();
    expect(within(detail).getByRole("table", { name: "Módulos habilitados por rol" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Suspender a Revisor Demo" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Recuperar acceso de Revisor Demo" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Editar a Revisor Demo" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Administrar clientes de Revisor Demo" })).toBeTruthy();
  });

  it("agrupa las acciones secundarias de cada fila en Más acciones con nombres accesibles", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    const row = await screen.findByRole("row", { name: /Revisor Demo/ });
    const table = screen.getByRole("table", { name: "Usuarios internos" });
    const actionsHeader = within(table).getByRole("columnheader", { name: "Acciones" }) as HTMLElement;
    expect(actionsHeader.style.width).toBe("180px");
    expect(within(row).getByRole("button", { name: "Editar a Revisor Demo" })).toBeTruthy();
    fireEvent.click(within(row).getByText("Más acciones"));

    expect(within(row).getByRole("button", { name: "Administrar clientes de Revisor Demo" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Suspender a Revisor Demo" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Recuperar acceso de Revisor Demo" })).toBeTruthy();
  });

  it("guarda el cambio a Titular sin pedir confirmación", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.patch).mockResolvedValue({});
    renderAdministracion();

    fireEvent.change(await screen.findByLabelText("Rol de Revisor Demo"), {
      target: { value: "OWNER" },
    });

    await waitFor(() =>
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith("/firms/firm-a/members/u2", { role: "OWNER" }),
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

  it("muestra errores por campo y deja Guardar cambios y Cancelar en el pie", async () => {
    mockApi(standardsFixture, membersFixture);
    renderAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: "Editar a Revisor Demo" }));
    const name = (await screen.findByLabelText("Nombre")) as HTMLInputElement;
    const email = screen.getByLabelText("Correo") as HTMLInputElement;
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.change(email, { target: { value: "correo-invalido" } });

    const drawer = screen.getByRole("dialog", { name: "Editar usuario" });
    const form = drawer.querySelector<HTMLFormElement>("#member-edit-form");
    const footer = drawer.querySelector<HTMLElement>(".action-drawer__footer");
    expect(form).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(footer?.contains(screen.getByRole("button", { name: "Cancelar" }))).toBe(true);
    const submit = within(footer as HTMLElement).getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(submit.form).toBe(form);
    fireEvent.click(submit);

    expect(await screen.findByText("Ingresá el nombre")).toBeTruthy();
    expect(await screen.findByText("Ingresá un correo válido, por ejemplo nombre@estudio.com")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(api.patch).not.toHaveBeenCalled();

    const studyStyles = readStudyStyles();
    expect(studyStyles).toMatch(/\.administration-users \.administration-user-edit-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(studyStyles).toMatch(/\.administration-users \.dense-inspector__foot \.dense-row-actions\s*\{[^}]*flex-wrap:\s*wrap/);
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
    fireEvent.click(within(row).getByText("Más acciones"));
    fireEvent.click(within(row).getByRole("button", { name: "Suspender a Revisor Demo" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/members/u2/suspend", {}),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("muestra la suspensión del Titular y deja que la API decida", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.post).mockRejectedValue(
      Object.assign(new Error("last admin"), { code: "LAST_ADMIN_REQUIRED" }),
    );
    renderAdministracion();

    const row = await screen.findByRole("row", { name: /Owner A/ });
    fireEvent.click(within(row).getByText("Más acciones"));
    fireEvent.click(within(row).getByRole("button", { name: "Suspender a Owner A" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/members/u1/suspend", {}),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "El estudio debe conservar al menos un titular o administrador activo.",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reactiva usuarios internos con una acción directa", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderAdministracion();

    const row = await screen.findByRole("row", { name: /Auditora Suspendida/ });
    fireEvent.click(within(row).getByText("Más acciones"));
    fireEvent.click(within(row).getByRole("button", { name: "Reactivar acceso de Auditora Suspendida" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Suspender acceso de Cliente Portal" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Reactivar acceso de Cliente Portal" }));

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
    const drawer = await screen.findByRole("dialog", { name: "Clientes de Revisor Demo" });
    expect(within(drawer).getByText(/Los cambios se aplican al momento/)).toBeTruthy();
    const close = within(drawer).getByRole("button", { name: "Cerrar" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    const clientSelect = await within(drawer).findByLabelText("Cliente");
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

  it("quita una asignación con un botón que identifica al cliente y a la persona", async () => {
    mockApi(standardsFixture, membersFixture);
    vi.mocked(api.del).mockResolvedValue({} as never);
    renderAdministracion();

    fireEvent.click(
      await screen.findByRole("button", { name: "Administrar clientes de Revisor Demo" }),
    );
    fireEvent.click(await screen.findByRole("button", {
      name: "Quitar cliente Cliente Alfa de Revisor Demo",
    }));

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
    expect(screen.getByText("Buenos Aires (GMT-3)")).toBeTruthy();
    expect(screen.getByText("Consultá y actualizá los datos de identificación y la zona horaria del estudio.")).toBeTruthy();
    expect(document.querySelectorAll(".administration-profile__facts > div")).toHaveLength(4);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelector(".dense-toolbar")).toBeNull();
    const studyStyles = readStudyStyles();
    expect(studyStyles).toMatch(/\.administration-profile__facts\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos" }));
    fireEvent.change(await screen.findByLabelText("Razón social"), {
      target: { value: "Estudio Actualizado SRL" },
    });
    fireEvent.change(screen.getByLabelText("Nombre del estudio"), {
      target: { value: "Estudio Actualizado" },
    });
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "30987654321" } });
    const timezone = (await screen.findByLabelText("Zona horaria")) as HTMLSelectElement;
    expect(timezone.value).toBe("America/Argentina/Buenos_Aires");
    const buenosAires = timezone.querySelector<HTMLOptionElement>(
      'option[value="America/Argentina/Buenos_Aires"]',
    );
    expect(buenosAires?.textContent).toContain("Buenos Aires (GMT-3)");
    expect(timezone.querySelector('optgroup[label="América"]')).not.toBeNull();
    fireEvent.change(timezone, {
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

    // La línea con correo inválido se marca y no se crea.
    expect(await screen.findByText("Correo inválido o faltante.")).toBeTruthy();
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
