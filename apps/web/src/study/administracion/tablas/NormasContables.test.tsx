// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import { contextoDemo, mockApiDemo, renderizarAdministracion } from "../pruebas/entornoDemo";

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

/** Abre la pestaña de normas contables. */
const abrirNormas = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: /Normas contables/ }));

describe("Normas contables: tabla y cajón (caracterización K5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra norma, estado y acciones por fila", async () => {
    renderizarAdministracion();
    await abrirNormas();
    const tabla = await screen.findByRole("table", { name: "Normas contables" });

    expect(
      within(tabla)
        .getAllByRole("columnheader")
        .map((celda) => celda.textContent),
    ).toEqual(["Norma", "Estado", "Acción"]);
    expect(within(tabla).getByText("Norma Demo Alfa")).toBeTruthy();
    expect(within(tabla).getByText("Activo")).toBeTruthy();
    expect(within(tabla).getByText("Inactivo")).toBeTruthy();
    expect(within(tabla).getAllByRole("button", { name: "Editar" })).toHaveLength(2);
    expect(within(tabla).getByRole("button", { name: "Desactivar" })).toBeTruthy();
    expect(within(tabla).getByRole("button", { name: "Reactivar" })).toBeTruthy();
  });

  it("desactivar pide confirmación con su texto y envía isActive false", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "n1", name: "Norma Demo Alfa", isActive: false } as never);
    renderizarAdministracion();
    await abrirNormas();

    fireEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText('¿Desactivar la norma contable "Norma Demo Alfa"?')).toBeTruthy();
    expect(
      within(dialogo).getByText(
        "Deja de ofrecerse en la ficha de clientes. Los clientes que ya la tienen asignada conservan su valor.",
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/accounting-standards/n1", { isActive: false }),
    );
  });

  it("reactivar pide confirmación con su texto y envía isActive true", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "n2", name: "Norma Demo Beta", isActive: true } as never);
    renderizarAdministracion();
    await abrirNormas();

    fireEvent.click(await screen.findByRole("button", { name: "Reactivar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText('¿Reactivar la norma contable "Norma Demo Beta"?')).toBeTruthy();
    expect(
      within(dialogo).getByText("Vuelve a aparecer como opción en la ficha de clientes."),
    ).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Reactivar" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/accounting-standards/n2", { isActive: true }),
    );
  });

  it("editar cambia el nombre y envía solo el nombre", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "n1", name: "Norma Demo Alfa 2", isActive: true } as never);
    renderizarAdministracion();
    await abrirNormas();

    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0] as HTMLElement);
    const cajon = await screen.findByRole("dialog", { name: "Editar norma contable" });
    fireEvent.change(within(cajon).getByLabelText("Nombre de la norma"), {
      target: { value: "Norma Demo Alfa 2" },
    });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/accounting-standards/n1", {
        name: "Norma Demo Alfa 2",
      }),
    );
  });

  it("busca por nombre y muestra el vacío de búsqueda", async () => {
    renderizarAdministracion();
    await abrirNormas();
    await screen.findByText("Norma Demo Alfa");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });
    expect(screen.queryByText("Norma Demo Alfa")).toBeNull();
    expect(screen.getByText("Norma Demo Beta")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Ninguna norma coincide con la búsqueda")).toBeTruthy();
    expect(screen.getByText("Probá con otro nombre.")).toBeTruthy();
  });

  it("sin normas muestra el vacío de alta", async () => {
    mockApiDemo({ normas: [] });
    renderizarAdministracion();
    await abrirNormas();

    expect(await screen.findByText("Todavía no hay normas contables")).toBeTruthy();
    expect(
      screen.getByText(
        "Creá las normas que usa el estudio para poder seleccionarlas en la ficha de clientes.",
      ),
    ).toBeTruthy();
  });

  it("si la consulta falla muestra su texto y Reintentar, sin fingir vacío", async () => {
    mockApiDemo({ normas: new Error("Normas no disponibles") });
    renderizarAdministracion();
    await abrirNormas();

    expect(await screen.findByText("No se pudieron cargar las normas contables")).toBeTruthy();
    expect(
      screen.getByText("No asumimos que no haya normas mientras la consulta está fallando."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("sin firm.manage la tabla queda vacía y no consulta las normas", async () => {
    contexto.current = contextoDemo(["firm.users.manage", "client.read"]);
    renderizarAdministracion();
    await abrirNormas();

    expect(await screen.findByText("Todavía no hay normas contables")).toBeTruthy();
    // vigente: cambia con D-F6-4 (defecto 7d-10: sin firm.manage la tabla se ve vacía)
    expect(api.get).not.toHaveBeenCalledWith("/firms/firm-a/accounting-standards");
  });
});
