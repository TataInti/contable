// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import {
  PENDIENTE,
  contextoDemo,
  miembrosDemo,
  mockApiDemo,
  renderizarAdministracion,
} from "../pruebas/entornoDemo";
import { cambiarValor } from "../../../test/elegirOpcion";

const contexto = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../../context/ClientContext", () => ({
  useClientContext: () => contexto.current,
}));

vi.mock("../../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
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

/** Cuántas veces se pidió la lista de miembros del estudio. */
const llamadasAMiembros = () =>
  vi.mocked(api.get).mock.calls.filter(([ruta]) => String(ruta).endsWith("/members")).length;

describe("Usuarios internos: tabla (caracterización K2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ miembros: miembrosDemo });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("filtra por nombre o correo, por rol y por estado", async () => {
    renderizarAdministracion();
    await screen.findByText("Titular Demo");
    const buscar = screen.getByRole("searchbox");

    cambiarValor(buscar, "titular");
    expect(screen.getByText("Titular Demo")).toBeTruthy();
    expect(screen.queryByText("Revisora Demo")).toBeNull();

    cambiarValor(buscar, "auditor@example.com");
    expect(screen.getByText("Auditor Demo")).toBeTruthy();
    expect(screen.queryByText("Titular Demo")).toBeNull();

    cambiarValor(buscar, "");
    cambiarValor(screen.getByLabelText("Filtrar por rol"), "REVIEWER");
    expect(screen.getByText("Revisora Demo")).toBeTruthy();
    expect(screen.queryByText("Auditor Demo")).toBeNull();

    cambiarValor(screen.getByLabelText("Filtrar por rol"), "");
    cambiarValor(screen.getByLabelText("Filtrar por estado"), "SUSPENDED");
    expect(screen.getByText("Auditor Demo")).toBeTruthy();
    expect(screen.queryByText("Revisora Demo")).toBeNull();
  });

  it("usa el estado de la cuenta cuando difiere del de la membresía", async () => {
    mockApiDemo({
      miembros: [
        {
          id: "m4",
          userId: "u4",
          role: "PREPARER",
          status: "ACTIVE",
          acceptedAt: null,
          user: { name: "Preparadora Demo", emailNormalized: "preparadora@example.com", status: "SUSPENDED" },
        },
        {
          id: "m5",
          userId: "u5",
          role: "PREPARER",
          status: "SUSPENDED",
          acceptedAt: null,
          user: { name: "Preparador Demo", emailNormalized: "preparador@example.com", status: "ACTIVE" },
        },
      ],
    });
    renderizarAdministracion();

    const suspendida = await screen.findByRole("row", { name: /Preparadora Demo/ });
    expect(within(suspendida).getByText("Suspendido")).toBeTruthy();
    const activa = screen.getByRole("row", { name: /Preparador Demo/ });
    expect(within(activa).getByText("Activo")).toBeTruthy();
  });

  it("abre el panel completo desde Editar y mantiene allí las acciones", async () => {
    renderizarAdministracion();

    const revisora = await screen.findByRole("row", { name: /Revisora Demo/ });
    fireEvent.click(within(revisora).getByRole("button", { name: "Editar a Revisora Demo" }));
    const panelRevisora = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(within(panelRevisora).getByRole("heading", { name: "Revisora Demo" })).toBeTruthy();
    expect(
      within(panelRevisora).getByRole("button", { name: "Administrar clientes de Revisora Demo" }),
    ).toBeTruthy();
    expect(within(panelRevisora).getByRole("button", { name: "Suspender a Revisora Demo" })).toBeTruthy();
    expect(
      within(panelRevisora).getByRole("button", { name: "Recuperar acceso de Revisora Demo" }),
    ).toBeTruthy();
    expect(within(panelRevisora).queryByRole("button", { name: /Reactivar/ })).toBeNull();
    expect(within(revisora).queryByLabelText("Más acciones de Revisora Demo")).toBeNull();

    const auditor = screen.getByRole("row", { name: /Auditor Demo/ });
    fireEvent.click(auditor);
    const panelAuditor = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(
      within(panelAuditor).getByRole("button", { name: "Reactivar acceso de Auditor Demo" }),
    ).toBeTruthy();
    expect(within(panelAuditor).queryByRole("button", { name: /Suspender a/ })).toBeNull();
    expect(within(panelAuditor).queryByRole("button", { name: /Recuperar acceso/ })).toBeNull();
  });

  it("la fila y el botón Editar abren el mismo panel lateral", async () => {
    renderizarAdministracion();
    const revisora = await screen.findByRole("row", { name: /Revisora Demo/ });

    fireEvent.click(revisora);
    let panel = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(within(panel).getByRole("heading", { name: "Revisora Demo" })).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Cerrar detalle" }));
    fireEvent.click(within(revisora).getByRole("button", { name: "Editar a Revisora Demo" }));
    panel = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    expect(within(panel).getByRole("heading", { name: "Revisora Demo" })).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "Administrar clientes de Revisora Demo" }),
    ).toBeTruthy();
  });

  it("expone nombres accesibles, anchos de columna y la fila suspendida atenuada", async () => {
    renderizarAdministracion();
    await screen.findByText("Revisora Demo");

    const tabla = screen.getByRole("table", { name: "Usuarios internos" });
    expect((within(tabla).getByRole("columnheader", { name: "Rol" }) as HTMLElement).style.width).toBe(
      "190px",
    );
    expect(
      (within(tabla).getByRole("columnheader", { name: "Estado" }) as HTMLElement).style.width,
    ).toBe("120px");
    expect(
      (within(tabla).getByRole("columnheader", { name: "Acciones" }) as HTMLElement).style.width,
    ).toBe("180px");
    expect(screen.getByRole("combobox", { name: "Rol de Revisora Demo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Editar a Revisora Demo" })).toBeTruthy();
    expect(screen.queryByLabelText("Más acciones de Revisora Demo")).toBeNull();
    expect(screen.getByRole("row", { name: /Auditor Demo/ }).className).toContain("dense-row--muted");
    expect(
      screen.getByText("El estudio debe conservar al menos un titular o administrador activo."),
    ).toBeTruthy();
  });

  it("muestra el vacío sin usuarios con el alta como siguiente paso", async () => {
    mockApiDemo({ miembros: [] });
    renderizarAdministracion();
    expect(await screen.findByText("Todavía no hay usuarios internos")).toBeTruthy();
    expect(
      screen.getByText("Creá la primera cuenta del estudio para asignarle un rol."),
    ).toBeTruthy();
  });

  it("muestra el vacío de filtros cuando ningún usuario coincide", async () => {
    renderizarAdministracion();
    await screen.findByText("Titular Demo");
    cambiarValor(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("Ningún usuario coincide con los filtros")).toBeTruthy();
    expect(screen.getByText("Probá con otro nombre o correo, o quitá filtros.")).toBeTruthy();
  });

  it("muestra la carga mientras responde la consulta de usuarios", async () => {
    mockApiDemo({ miembros: PENDIENTE });
    renderizarAdministracion();
    expect(await screen.findByText("Cargando usuarios internos…")).toBeTruthy();
  });

  it("no finge vacío si la consulta falla y permite reintentar", async () => {
    mockApiDemo({ miembros: new Error("Sin conexión con el servidor") });
    renderizarAdministracion();
    expect(await screen.findByText("No se pudieron cargar los usuarios")).toBeTruthy();
    expect(
      screen.getByText("No asumimos que no haya usuarios mientras la consulta está fallando."),
    ).toBeTruthy();

    const antes = llamadasAMiembros();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasAMiembros()).toBeGreaterThan(antes));
  });
});
