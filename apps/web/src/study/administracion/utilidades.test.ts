// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import {
  contextoDemo,
  miembrosDemo,
  mockApiDemo,
  perfilDemo,
  renderizarAdministracion,
} from "./pruebas/entornoDemo";
import { abrirListado, cambiarValor, valorElegido } from "../../test/elegirOpcion";

const contexto = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contexto.current,
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

const CORREO_VALIDO = "revisora@estudio.com";

/** Abre la edición de identidad de la revisora Demo. */
async function abrirEdicionRevisora() {
  const fila = await screen.findByRole("row", { name: /Revisora Demo/ });
  fireEvent.click(within(fila).getByRole("button", { name: "Editar a Revisora Demo" }));
  const panel = await screen.findByRole("complementary", { name: "Detalle del usuario" });
  fireEvent.click(within(panel).getByRole("button", { name: "Editar a Revisora Demo" }));
  return screen.findByRole("dialog", { name: "Editar usuario" });
}

describe("Usuarios y accesos: utilidades (caracterización K1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ miembros: miembrosDemo });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("isValidEmail: rechaza un correo sin dominio completo y guarda uno válido", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    renderizarAdministracion();
    await abrirEdicionRevisora();

    cambiarValor(screen.getByLabelText("Correo"), "revisora@estudio");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(
      await screen.findByText("Ingresá un correo válido, por ejemplo nombre@estudio.com"),
    ).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();

    cambiarValor(screen.getByLabelText("Correo"), CORREO_VALIDO);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/users/u2", {
        name: "Revisora Demo",
        email: CORREO_VALIDO,
      }),
    );
  });

  it("userMutationError: traduce el último titular y el correo ya asociado a otra cuenta", async () => {
    vi.mocked(api.patch)
      .mockRejectedValueOnce(Object.assign(new Error("last admin"), { code: "LAST_ADMIN_REQUIRED" }))
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "USER_EMAIL_CONFLICT" }));
    renderizarAdministracion();
    await abrirEdicionRevisora();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(
      await screen.findByText("El estudio debe conservar al menos un titular o administrador activo."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Ese correo ya está asociado a otra cuenta.")).toBeTruthy();
  });

  it("userMutationError: un error con mensaje muestra ese mensaje", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("Servicio no disponible"));
    renderizarAdministracion();
    await abrirEdicionRevisora();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Servicio no disponible")).toBeTruthy();
  });

  it("userMutationError: sin mensaje ni código usa el texto de respaldo de la acción", async () => {
    vi.mocked(api.patch).mockRejectedValue("falla sin forma de error");
    renderizarAdministracion();
    await abrirEdicionRevisora();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(
      await screen.findByText("No se pudieron actualizar los datos del usuario."),
    ).toBeTruthy();
  });

  it("initials: usa dos iniciales del nombre y «?» cuando la cuenta no tiene nombre", async () => {
    mockApiDemo({
      miembros: [
        ...miembrosDemo,
        {
          id: "m4",
          userId: "u4",
          role: "PREPARER",
          status: "ACTIVE",
          acceptedAt: null,
          user: { name: "Ana Demo Ruiz", emailNormalized: "ana@example.com", status: "ACTIVE" },
        },
        { id: "m5", userId: "u5", role: "PREPARER", status: "ACTIVE", acceptedAt: null, user: null },
      ],
    });
    renderizarAdministracion();
    await screen.findByText("Ana Demo Ruiz");

    const iniciales = Array.from(document.querySelectorAll(".dense-avatar")).map(
      (avatar) => avatar.textContent,
    );
    expect(iniciales.sort()).toEqual(["?", "AD", "AD", "RD", "TD"]);
  });

  it("timeZoneLabel: nombra la zona con su ciudad y su desfasaje horario", async () => {
    mockApiDemo({
      miembros: miembrosDemo,
      perfil: { ...perfilDemo, timezone: "America/Argentina/Cordoba" },
    });
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));
    expect(await screen.findByText("Cordoba (GMT-3)")).toBeTruthy();
  });

  it("groupTimeZones: una zona fuera del catálogo entra en su región y se nombra por su ciudad", async () => {
    mockApiDemo({
      miembros: miembrosDemo,
      perfil: { ...perfilDemo, timezone: "America/Demo_Local" },
    });
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));
    expect(await screen.findByText("Demo Local")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Editar datos" }));
    await screen.findByLabelText("Zona horaria");
    expect(valorElegido("Zona horaria")).toBe("America/Demo_Local");
    const opcion = within(abrirListado("Zona horaria")).getByRole("option", { name: "Demo Local" });
    expect(within(abrirListado("Zona horaria")).getByRole("group", { name: "América" }).contains(opcion)).toBe(true);
    expect(opcion.textContent).toBe("Demo Local");
  });
});
