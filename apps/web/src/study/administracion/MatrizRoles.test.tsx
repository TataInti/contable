// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { contextoDemo, mockApiDemo, renderizarAdministracion } from "./pruebas/entornoDemo";

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

describe("Matriz de roles y módulos (caracterización K3)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra siete módulos por cinco roles, con «Sí» o «–» y etiqueta accesible", async () => {
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("button", { name: "Roles y módulos" }));

    const matriz = await screen.findByRole("table", { name: "Módulos habilitados por rol" });
    expect(
      within(matriz)
        .getAllByRole("columnheader")
        .map((celda) => celda.textContent),
    ).toEqual(["Módulo", "Tit.", "Adm.", "Prep.", "Rev.", "Aud."]);
    expect(within(matriz).getAllByRole("row")).toHaveLength(8);

    const bandeja = within(matriz)
      .getByRole("rowheader", { name: "Bandeja documental" })
      .closest("tr") as HTMLElement;
    expect(within(bandeja).getByLabelText("Titular: habilitado").textContent).toBe("Sí");
    expect(within(bandeja).getByLabelText("Auditor · sólo lectura: sin acceso").textContent).toBe(
      "\u2013",
    );

    const clientes = within(matriz)
      .getByRole("rowheader", { name: "Clientes" })
      .closest("tr") as HTMLElement;
    expect(within(clientes).getByLabelText("Auditor · sólo lectura: habilitado").textContent).toBe(
      "Sí",
    );
  });

  it("explica en el panel que el acceso depende del rol", async () => {
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("button", { name: "Roles y módulos" }));

    const panel = await screen.findByRole("complementary", { name: "Roles y módulos" });
    expect(
      within(panel).getByText(/El acceso depende del rol; no se asignan permisos por separado\./),
    ).toBeTruthy();
    expect(within(panel).getByRole("table", { name: "Módulos habilitados por rol" })).toBeTruthy();
  });

  it("Esc cierra la matriz de roles", async () => {
    renderizarAdministracion();
    fireEvent.click(await screen.findByRole("button", { name: "Roles y módulos" }));
    await screen.findByRole("complementary", { name: "Roles y módulos" });

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Roles y módulos" })).toBeNull(),
    );
  });
});
