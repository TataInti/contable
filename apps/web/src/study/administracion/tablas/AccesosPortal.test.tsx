// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import {
  contextoDemo,
  membresiaPortalDemo,
  mockApiDemo,
  renderizarAdministracion,
} from "../pruebas/entornoDemo";

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

const invitacionesDemo = [
  {
    id: "i1",
    emailNormalized: "pendiente@example.com",
    role: "COLLABORATOR",
    expiresAt: "2099-01-15T12:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
  },
  {
    id: "i2",
    emailNormalized: "vencida@example.com",
    role: "READONLY",
    expiresAt: "2000-01-15T12:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
  },
  {
    id: "i3",
    emailNormalized: "revocada@example.com",
    role: "READONLY",
    expiresAt: "2099-01-15T12:00:00.000Z",
    acceptedAt: null,
    revokedAt: "2026-11-10T10:00:00.000Z",
  },
  {
    id: "i4",
    emailNormalized: "aceptada@example.com",
    role: "READONLY",
    expiresAt: "2099-01-15T12:00:00.000Z",
    acceptedAt: "2026-11-02T00:00:00.000Z",
    revokedAt: null,
  },
];

/** Abre la pestaña de accesos del portal. */
const abrirPortal = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: /Accesos del portal/ }));

describe("Accesos del portal: tabla (caracterización K4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ membresias: [membresiaPortalDemo], invitaciones: invitacionesDemo });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mezcla membresías e invitaciones no aceptadas en una tabla, con su estado", async () => {
    renderizarAdministracion();
    await abrirPortal();
    const tabla = await screen.findByRole("table", { name: "Accesos del portal" });

    expect(within(tabla).getAllByRole("row")).toHaveLength(5);
    expect(within(tabla).getByText("Activo")).toBeTruthy();
    expect(within(tabla).getByText("Pendiente")).toBeTruthy();
    expect(within(tabla).getByText("Vencido")).toBeTruthy();
    expect(within(tabla).getByText("Revocado")).toBeTruthy();
    expect(within(tabla).getByText(/^vence \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeTruthy();
    expect(within(tabla).queryByText("aceptada@example.com")).toBeNull();
  });

  it("la fila de invitación no muestra nombre y la revocada va atenuada", async () => {
    renderizarAdministracion();
    await abrirPortal();

    const pendiente = await screen.findByRole("row", { name: /pendiente@example.com/ });
    expect(pendiente.querySelector("strong")).toBeNull();
    expect(screen.getByRole("row", { name: /revocada@example.com/ }).className).toContain(
      "dense-row--muted",
    );
    expect(
      screen.getByRole("row", { name: /cliente@example.com/ }).querySelector("strong")?.textContent,
    ).toBe("Cliente Demo");
  });

  it("revoca una invitación pendiente solo después de confirmar", async () => {
    vi.mocked(api.post).mockResolvedValue({} as never);
    renderizarAdministracion();
    await abrirPortal();

    fireEvent.click(
      await screen.findByRole("button", { name: "Revocar invitación para pendiente@example.com" }),
    );
    const dialogo = await screen.findByRole("alertdialog", {
      name: "¿Revocar la invitación para pendiente@example.com?",
    });
    expect(
      within(dialogo).getByText("El enlace dejará de funcionar y la persona no podrá aceptar la invitación."),
    ).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Revocar invitación" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/portal-invitations/i1/revoke",
      ),
    );
  });

  it("sin cliente elegido ofrece el vacío con salida a Clientes", async () => {
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"], null);
    renderizarAdministracion();
    await abrirPortal();

    expect(await screen.findByText("Seleccioná un cliente")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir a clientes" })).toBeTruthy();
  });

  it("la búsqueda sin coincidencias muestra «Todavía nadie tiene acceso»", async () => {
    renderizarAdministracion();
    await abrirPortal();
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "zzz" } });

    // vigente: cambia con D-F6-12
    expect(screen.getByText("Todavía nadie tiene acceso")).toBeTruthy();
  });
});
