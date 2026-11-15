// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../../context/ClientContext";
import { api } from "../../../lib/api";
import {
  PENDIENTE,
  contextoDemo,
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

/** Abre la pestaña de datos del estudio. */
const abrirDatos = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: "Datos del estudio" }));

/** Cuántas veces se pidió el perfil del estudio. */
const llamadasAlPerfil = () =>
  vi.mocked(api.get).mock.calls.filter(([ruta]) => String(ruta).endsWith("/profile")).length;

describe("Datos del estudio: panel (caracterización K6)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra los cuatro datos del estudio y «—» cuando falta alguno", async () => {
    mockApiDemo({
      perfil: {
        legalName: "Estudio Demo SRL",
        displayName: "",
        taxId: null,
        timezone: "America/Argentina/Cordoba",
      },
    });
    renderizarAdministracion();
    await abrirDatos();
    await screen.findByText("Estudio Demo SRL");

    const datos = Array.from(document.querySelectorAll(".administration-profile__facts dd")).map(
      (dato) => dato.textContent,
    );
    expect(datos).toEqual(["Estudio Demo SRL", "—", "—", "Cordoba (GMT-3)"]);
  });

  it("muestra la carga mientras responde el perfil", async () => {
    mockApiDemo({ perfil: PENDIENTE });
    renderizarAdministracion();
    await abrirDatos();
    expect(await screen.findByText("Cargando datos del estudio…")).toBeTruthy();
  });

  it("si la consulta falla muestra su texto y permite reintentar", async () => {
    mockApiDemo({ perfil: new Error("Perfil no disponible") });
    renderizarAdministracion();
    await abrirDatos();

    expect(await screen.findByText("No se pudieron cargar los datos del estudio")).toBeTruthy();
    expect(
      screen.getByText("No asumimos que falten datos mientras la consulta está fallando."),
    ).toBeTruthy();

    const antes = llamadasAlPerfil();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(llamadasAlPerfil()).toBeGreaterThan(antes));
  });

  it("sin datos devueltos ofrece el vacío con Reintentar", async () => {
    mockApiDemo({ perfil: null });
    renderizarAdministracion();
    await abrirDatos();

    expect(await screen.findByText("Datos del estudio no disponibles")).toBeTruthy();
    expect(screen.getByText("Reintentá para consultar la información del estudio.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("guardar con el CUIT vacío envía null y los cuatro campos", async () => {
    vi.mocked(api.patch).mockResolvedValue({ legalName: "Estudio Demo SRL", displayName: "Estudio Demo", taxId: null, timezone: "America/Argentina/Buenos_Aires" } as never);
    renderizarAdministracion();
    await abrirDatos();

    fireEvent.click(await screen.findByRole("button", { name: "Editar datos" }));
    fireEvent.change(await screen.findByLabelText("CUIT"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/profile", {
        legalName: "Estudio Demo SRL",
        displayName: "Estudio Demo",
        taxId: null,
        timezone: "America/Argentina/Buenos_Aires",
      }),
    );
  });
});
