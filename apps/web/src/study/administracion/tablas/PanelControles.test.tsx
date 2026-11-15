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

const CASILLA = "Permitir autorrevisión de fuentes y legajos";
const CON_AUTORREVISION = [
  "firm.manage",
  "firm.users.manage",
  "firm.self_review.manage",
  "client.read",
];

/** Abre la pestaña de controles del estudio. */
const abrirControles = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: "Controles" }));

describe("Controles del estudio: autorrevisión (caracterización K6)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contexto.current = contextoDemo(CON_AUTORREVISION);
    mockApiDemo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("con capacidad refleja el estado guardado y lo cambia con un clic", async () => {
    mockApiDemo({ autorrevision: { allowSelfReview: true } });
    vi.mocked(api.patch).mockResolvedValue({ allowSelfReview: false } as never);
    renderizarAdministracion();
    await abrirControles();

    const casilla = (await screen.findByRole("checkbox", { name: CASILLA })) as HTMLInputElement;
    await waitFor(() => expect(casilla.disabled).toBe(false));
    expect(casilla.checked).toBe(true);
    expect(screen.getByText("Activada")).toBeTruthy();

    fireEvent.click(casilla);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/firms/firm-a/settings/self-review", {
        allowSelfReview: false,
      }),
    );
  });

  it("sin capacidad queda deshabilitada y explica que solo el Titular la cambia", async () => {
    contexto.current = contextoDemo(["firm.manage", "firm.users.manage", "client.read"]);
    mockApiDemo({ autorrevision: { allowSelfReview: true } });
    renderizarAdministracion();
    await abrirControles();

    const casilla = (await screen.findByRole("checkbox", { name: CASILLA })) as HTMLInputElement;
    await waitFor(() => expect(casilla.checked).toBe(true));
    expect(casilla.disabled).toBe(true);
    expect(screen.getByText("Solo el Titular puede cambiar esta opción.")).toBeTruthy();
  });

  it("si la consulta falla muestra la alerta con su mensaje", async () => {
    mockApiDemo({ autorrevision: new Error("Consulta de autorrevisión caída") });
    renderizarAdministracion();
    await abrirControles();

    expect(await screen.findByText("Consulta de autorrevisión caída")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Consulta de autorrevisión caída");
  });

  it("si el cambio falla muestra la alerta con el mensaje de la API", async () => {
    mockApiDemo({ autorrevision: { allowSelfReview: false } });
    vi.mocked(api.patch).mockRejectedValue(new Error("Sin permiso para cambiar la autorrevisión"));
    renderizarAdministracion();
    await abrirControles();

    const casilla = (await screen.findByRole("checkbox", { name: CASILLA })) as HTMLInputElement;
    await waitFor(() => expect(casilla.disabled).toBe(false));
    fireEvent.click(casilla);

    expect(await screen.findByText("Sin permiso para cambiar la autorrevisión")).toBeTruthy();
  });

  it("mientras la consulta corre muestra «Desactivada» y no anuncia carga", async () => {
    mockApiDemo({ autorrevision: PENDIENTE });
    renderizarAdministracion();
    await abrirControles();

    // vigente: cambia con D-F6-10 (defecto 7d-7: Controles muestra «Desactivada» mientras carga)
    expect((await screen.findByText("Desactivada")).textContent).toBe("Desactivada");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
