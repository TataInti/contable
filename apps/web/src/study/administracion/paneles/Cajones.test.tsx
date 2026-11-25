// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import {
  contextoDemo,
  membresiaPortalDemo,
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

async function abrirEdicionRevisora() {
  const fila = await screen.findByRole("row", { name: /Revisora Demo/ });
  fireEvent.click(within(fila).getByRole("button", { name: "Editar a Revisora Demo" }));
  return screen.findByRole("dialog", { name: "Editar usuario" });
}

describe("Cajones de alta y edición (caracterización K7)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ miembros: miembrosDemo, membresias: [membresiaPortalDemo] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("alta individual: el envío exige nombre y correo, y crea la cuenta con el cuerpo exacto", async () => {
    vi.mocked(api.post).mockResolvedValue({
      userId: "u9",
      email: "demo.uno@example.com",
      name: "Demo Uno",
      role: "PREPARER",
      temporaryPassword: "tmp-demo-uno",
    } as never);
    renderizarAdministracion();

    fireEvent.click(await screen.findByRole("button", { name: /Nuevo usuario/ }));
    const cajon = await screen.findByRole("dialog", { name: "Crear usuarios del estudio" });
    expect(within(cajon).getByText(/Se genera una contraseña temporal por cuenta/)).toBeTruthy();

    const enviar = within(cajon).getByRole("button", { name: "Crear usuario" }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    expect(within(cajon).getByText("Ingresá nombre y correo para poder crear el usuario.")).toBeTruthy();
    cambiarValor(within(cajon).getByLabelText("Nombre"), "Demo Uno");
    cambiarValor(within(cajon).getByLabelText("Correo"), "demo.uno@example.com");
    expect(enviar.disabled).toBe(false);

    fireEvent.click(enviar);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/users", {
        email: "demo.uno@example.com",
        name: "Demo Uno",
        role: "PREPARER",
      }),
    );
    expect(await within(cajon).findByLabelText("Contraseña temporal")).toHaveProperty(
      "value",
      "tmp-demo-uno",
    );
  });

  it("cancelar el alta cierra el cajón sin llamar a la API", async () => {
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo usuario/ }));
    const cajon = await screen.findByRole("dialog", { name: "Crear usuarios del estudio" });

    fireEvent.click(within(cajon).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Crear usuarios del estudio" })).toBeNull(),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("editar usuario: envía el nombre y el correo sin espacios sobrantes", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    renderizarAdministracion();
    const cajon = await abrirEdicionRevisora();
    expect(within(cajon).getByText("Actualizá el nombre y el correo de la cuenta.")).toBeTruthy();

    cambiarValor(within(cajon).getByLabelText("Nombre"), "  Revisora Nueva  ");
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/users/u2", {
        name: "Revisora Nueva",
        email: "revisora@example.com",
      }),
    );
  });

  it("editar acceso del portal: cambia el rol con su descripción", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar acceso de Cliente Demo" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar acceso" });
    expect(within(cajon).getByText("Cambiar el rol de Cliente Demo.")).toBeTruthy();

    cambiarValor(within(cajon).getByLabelText("Rol del portal"), "COLLABORATOR");
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/portal-memberships/p1",
        { role: "COLLABORATOR" },
      ),
    );
  });

  it("editar datos del estudio: descripción del cajón y Cancelar sin guardar", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar datos del estudio" });
    expect(
      within(cajon).getByText("Actualizá la razón social, el nombre, el CUIT y la zona horaria."),
    ).toBeTruthy();

    fireEvent.click(within(cajon).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Editar datos del estudio" })).toBeNull(),
    );
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("invitar al portal: el envío exige correo y envía correo y rol", async () => {
    vi.mocked(api.post).mockResolvedValue({
      invitationToken: "tok-demo-7",
      email: "invitado@example.com",
      expiresAt: "2099-01-15T12:00:00.000Z",
    } as never);
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Invitar al portal/ }));
    const cajon = await screen.findByRole("dialog", { name: "Invitar al portal" });
    expect(
      within(cajon).getByText(/Vence a los siete días y sólo puede usarse con el correo indicado\./),
    ).toBeTruthy();

    const enviar = within(cajon).getByRole("button", { name: /Enviar invitación/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    cambiarValor(within(cajon).getByLabelText("Correo"), "invitado@example.com");
    expect(enviar.disabled).toBe(false);
    cambiarValor(within(cajon).getByLabelText("Rol"), "READONLY");
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/portal-invitations", {
        email: "invitado@example.com",
        role: "READONLY",
      }),
    );
  });

  it("nueva norma: título, descripción y Crear norma deshabilitado sin nombre", async () => {
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: /Normas contables/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Nueva norma/ }));
    const cajon = await screen.findByRole("dialog", { name: "Nueva norma contable" });
    expect(
      within(cajon).getByText(
        /El nombre es el valor que se muestra y se guarda en la ficha de clientes\./,
      ),
    ).toBeTruthy();

    const crear = within(cajon).getByRole("button", { name: "Crear norma" }) as HTMLButtonElement;
    expect(crear.disabled).toBe(true);
    cambiarValor(within(cajon).getByLabelText("Nombre de la norma"), "Norma Demo Gamma");
    expect(crear.disabled).toBe(false);
  });

  it("editar datos del estudio: envía los cuatro campos del estudio", async () => {
    vi.mocked(api.patch).mockResolvedValue({ legalName: "Estudio Demo Nuevo SRL", displayName: "Estudio Demo", taxId: "30123456789", timezone: "America/Argentina/Buenos_Aires" } as never);
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar datos del estudio" });
    cambiarValor(within(cajon).getByLabelText("Razón social"), "  Estudio Demo Nuevo SRL ");
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/profile", {
        legalName: "Estudio Demo Nuevo SRL",
        displayName: "Estudio Demo",
        taxId: "30123456789",
        timezone: "America/Argentina/Buenos_Aires",
      }),
    );
  });

  it("editar usuario: valida nombre y correo por campo y no guarda", async () => {
    renderizarAdministracion();
    const cajon = await abrirEdicionRevisora();
    cambiarValor(within(cajon).getByLabelText("Nombre"), "   ");
    cambiarValor(within(cajon).getByLabelText("Correo"), "sin-arroba");
    fireEvent.submit(document.getElementById("member-edit-form") as HTMLFormElement);
    expect(await within(cajon).findByText("Ingresá el nombre")).toBeTruthy();
    expect(
      within(cajon).getByText("Ingresá un correo válido, por ejemplo nombre@estudio.com"),
    ).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("nueva norma: el POST lleva solo el nombre, sin espacios sobrantes", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "n3", name: "Norma Demo Gamma", isActive: true } as never);
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: /Normas contables/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Nueva norma/ }));
    const cajon = await screen.findByRole("dialog", { name: "Nueva norma contable" });
    cambiarValor(within(cajon).getByLabelText("Nombre de la norma"), "  Norma Demo Gamma ");
    fireEvent.click(within(cajon).getByRole("button", { name: "Crear norma" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/accounting-standards", {
        name: "Norma Demo Gamma",
      }),
    );
  });
});
