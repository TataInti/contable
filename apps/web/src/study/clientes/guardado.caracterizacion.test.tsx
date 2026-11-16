// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyClientes } from "../StudyClientes";
import {
  CLIENTES_SINTETICOS,
  SESION_AUTENTICADA,
  contextoDePrueba,
  renderConRutas,
  respuestaApi,
  seleccionarCliente,
} from "./clientes.testutil";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

interface MockSession {
  status: "loading" | "authenticated" | "unauthenticated";
  me: null;
  portalContexts: never[];
  error: null;
  refresh: () => Promise<void>;
}

const sessionMock = vi.hoisted(() => ({ current: null as unknown as MockSession }));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
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

const CUIT_ALFA = "20-00000006-0";
const ALFA = "Sintético Alfa S.A.";

// Caracterización K8 (Foco 5.2): guardado parcial de la ficha (D5-8).
// Afirma el comportamiento VIGENTE de origin/main (5cdd0cf), defecto 7d-4; se reemplaza al corregir.

describe("StudyClientes — guardado parcial de la ficha (K8)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    sessionMock.current = SESION_AUTENTICADA;
    vi.mocked(api.get).mockImplementation(((path: string) =>
      respuestaApi(path, CLIENTES_SINTETICOS)) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("si se guarda la identidad y falla la ficha fiscal, lo informa en un solo mensaje y el cajón sigue abierto", async () => {
    vi.mocked(api.patch).mockImplementation(((path: string) =>
      path.endsWith("/profile")
        ? Promise.reject(new Error("Sintético: la ficha fiscal no respondió"))
        : Promise.resolve({ id: "c1", legalName: ALFA, cuit: "20000000060" })) as never);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });
    fireEvent.change(within(cajon).getByLabelText("Nombre comercial"), {
      target: { value: "Sintético Alfa Comercial" },
    });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    expect(
      await within(cajon).findByText(
        "Se guardó la identidad; no se pudo guardar la ficha fiscal. Reintentá.",
      ),
    ).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith(
      "/firms/firm-a/clients/c1",
      expect.objectContaining({ tradeName: "Sintético Alfa Comercial" }),
    );
    expect(screen.getByRole("dialog", { name: "Editar cliente" })).toBeTruthy();
    expect(
      screen.queryByText("No se pudo guardar la ficha. Revisá los datos e intentá nuevamente."),
    ).toBeNull();
    expect(screen.queryByText(/quedó actualizada/)).toBeNull();
  });

  it("si falla la identidad y se guarda la ficha fiscal, lo informa y el cajón sigue abierto", async () => {
    vi.mocked(api.patch).mockImplementation(((path: string) =>
      path.endsWith("/profile")
        ? Promise.resolve({ id: "c1" })
        : Promise.reject(new Error("Sintético: la identidad no respondió"))) as never);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    expect(
      await within(cajon).findByText(
        "Se guardó la ficha fiscal; no se pudo guardar la identidad. Reintentá.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Editar cliente" })).toBeTruthy();
    expect(screen.queryByText(/quedó actualizada/)).toBeNull();
  });

  it("si fallan la identidad y la ficha, no informa un guardado parcial", async () => {
    vi.mocked(api.patch).mockImplementation((() =>
      Promise.reject(new Error("Sintético: sin respuesta"))) as never);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });
    fireEvent.click(within(cajon).getByRole("button", { name: "Guardar cambios" }));

    expect(
      await within(cajon).findByText(
        "No se pudo guardar la identidad. Revisá los datos y los permisos.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Se guardó/)).toBeNull();
  });
});
