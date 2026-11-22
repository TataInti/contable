// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { contextoDemo, miembrosDemo, mockApiDemo, renderizarAdministracion } from "./pruebas/entornoDemo";
import { cambiarValor } from "../../test/elegirOpcion";

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

const ENLACE_INVITACION = `${window.location.origin}/aceptar-invitacion#token=tok-demo-123`;
const ENLACE_RECUPERACION = `${window.location.origin}/recuperar-acceso#token=rec-demo-456`;

/** Envía una invitación al portal y deja abierto el aviso con el enlace. */
async function invitarAlPortal() {
  vi.mocked(api.post).mockResolvedValue({
    invitationToken: "tok-demo-123",
    email: "invitado@example.com",
    expiresAt: "2099-01-15T12:00:00.000Z",
  } as never);
  fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Invitar al portal/ }));
  fireEvent.change(await screen.findByLabelText("Correo"), {
    target: { value: "invitado@example.com" },
  });
  cambiarValor(screen.getByLabelText("Rol"), "READONLY");
  fireEvent.click(screen.getByRole("button", { name: /Enviar invitación/ }));
  await screen.findByLabelText("Enlace de invitación");
}

/** Genera un enlace de recuperación para la revisora Demo y deja abierto el aviso. */
async function generarRecuperacion(sesionesCerradas: number) {
  vi.mocked(api.post).mockResolvedValue({
    recoveryId: "rec-demo-1",
    expiresAt: "2099-01-15T12:00:00.000Z",
    sessionsRevoked: sesionesCerradas,
    recoveryToken: "rec-demo-456",
  } as never);
  const fila = await screen.findByRole("row", { name: /Revisora Demo/ });
  fireEvent.click(fila);
  const panel = await screen.findByRole("complementary", { name: "Detalle del usuario" });
  fireEvent.click(within(panel).getByRole("button", { name: "Recuperar acceso de Revisora Demo" }));
  const dialogo = await screen.findByRole("alertdialog", {
    name: "¿Generar enlace de recuperación para Revisora Demo?",
  });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Generar enlace" }));
  await screen.findByLabelText("Enlace de recuperación de acceso");
}

describe("Invitación al portal y recuperación de acceso (caracterización K9)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ miembros: miembrosDemo });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("invitación: envía correo y rol, y muestra el enlace con el token en el fragmento una sola vez", async () => {
    renderizarAdministracion();
    await invitarAlPortal();

    expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/portal-invitations", {
      email: "invitado@example.com",
      role: "READONLY",
    });
    expect(
      screen.getByText("Enlace generado. Copialo ahora; el token no se vuelve a mostrar."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Enlace de invitación")).toHaveProperty("value", ENLACE_INVITACION);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByLabelText("Enlace de invitación")).toBeNull();
  });

  it("invitación: copia el enlace al portapapeles y avisa", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderizarAdministracion();
    await invitarAlPortal();

    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENLACE_INVITACION));
    expect(await screen.findByText("El enlace de invitación se copió al portapapeles.")).toBeTruthy();
  });

  it("recuperación: confirma, genera el enlace y muestra las sesiones cerradas", async () => {
    renderizarAdministracion();
    await generarRecuperacion(2);

    expect(api.post).toHaveBeenCalledWith("/firms/firm-a/members/u2/access-recovery", {});
    expect(screen.getByLabelText("Enlace de recuperación de acceso")).toHaveProperty(
      "value",
      ENLACE_RECUPERACION,
    );
    expect(screen.getByText(/Se cerraron 2 sesión\(es\) activa\(s\) del usuario\./)).toBeTruthy();
    expect(screen.getByText(/vence el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./)).toBeTruthy();
  });

  it("recuperación: sin sesiones abiertas lo dice, copia el enlace y «Cerrar» lo retira", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderizarAdministracion();
    await generarRecuperacion(0);

    expect(screen.getByText(/El usuario no tenía sesiones activas abiertas\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENLACE_RECUPERACION));
    expect(await screen.findByText("El enlace de recuperación se copió al portapapeles.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByLabelText("Enlace de recuperación de acceso")).toBeNull();
  });

  it("recuperación: cancelar el diálogo no genera ningún enlace", async () => {
    renderizarAdministracion();
    const fila = await screen.findByRole("row", { name: /Revisora Demo/ });
    fireEvent.click(fila);
    const panel = await screen.findByRole("complementary", { name: "Detalle del usuario" });
    fireEvent.click(within(panel).getByRole("button", { name: "Recuperar acceso de Revisora Demo" }));
    const dialogo = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Enlace de recuperación de acceso")).toBeNull();
  });

  it("revocación de invitación: cancelar el diálogo no envía nada", async () => {
    mockApiDemo({
      miembros: miembrosDemo,
      invitaciones: [
        {
          id: "i1",
          emailNormalized: "pendiente@example.com",
          role: "COLLABORATOR",
          expiresAt: "2099-01-15T12:00:00.000Z",
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    });
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Revocar invitación para pendiente@example.com" }),
    );
    const dialogo = await screen.findByRole("alertdialog", {
      name: "¿Revocar la invitación para pendiente@example.com?",
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
  });
});
