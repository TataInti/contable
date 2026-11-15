// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import {
  contextoDemo,
  miembrosDemo,
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

/** Abre el detalle del usuario desde la fila de la revisora Demo. */
async function abrirDetalleRevisora() {
  fireEvent.click(await screen.findByText("Revisora Demo"));
  return screen.findByRole("complementary", { name: "Detalle del usuario" });
}

describe("Detalle del usuario (caracterización K3)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ miembros: miembrosDemo });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra el acceso del usuario y la matriz con el rol resaltado", async () => {
    renderizarAdministracion();
    const detalle = await abrirDetalleRevisora();

    expect(within(detalle).getByText("revisora@example.com")).toBeTruthy();
    expect(within(detalle).getByText("Revisor")).toBeTruthy();
    expect(within(detalle).getByText("Activo")).toBeTruthy();
    const matriz = within(detalle).getByRole("table", { name: "Módulos habilitados por rol" });
    expect(matriz.querySelectorAll(".is-hi")).toHaveLength(8);
    expect(within(matriz).getByRole("columnheader", { name: "Rev." }).classList.contains("is-hi")).toBe(
      true,
    );
  });

  it("ofrece Editar desde el detalle y abre el cajón de identidad", async () => {
    renderizarAdministracion();
    const detalle = await abrirDetalleRevisora();

    fireEvent.click(within(detalle).getByRole("button", { name: "Editar a Revisora Demo" }));
    expect(await screen.findByRole("dialog", { name: "Editar usuario" })).toBeTruthy();
  });

  it("Esc cierra el detalle del usuario", async () => {
    renderizarAdministracion();
    await abrirDetalleRevisora();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Detalle del usuario" })).toBeNull(),
    );
  });
});
