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

// Caracterización K7 (Foco 5.2): semántica G02 y G03 de la banda y del espacio de trabajo.
// Afirma el comportamiento VIGENTE de origin/main (5cdd0cf), defecto 7d-7; se reemplaza al corregir.

describe("StudyClientes — semántica de la banda y del espacio de trabajo (K7)", () => {
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

  it("«Ficha incompleta» expone aria-pressed y alterna; «Activos» es de lectura y no es un botón", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    const banda = screen.getByRole("group", { name: "Resumen de la cartera" });

    expect(within(banda).queryByRole("button", { name: /Activos/ })).toBeNull();
    const incompleta = within(banda).getByRole("button", { name: /Ficha incompleta/ });
    expect(incompleta.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(incompleta);
    expect(incompleta.getAttribute("aria-pressed")).toBe("true");
  });

  it("el espacio de trabajo es una región con nombre accesible", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    const espacio = document.getElementById("clients-panel");

    expect(espacio?.getAttribute("role")).toBe("region");
    expect(espacio?.getAttribute("aria-label")).toBe("Cartera de clientes y detalle");
    expect(document.querySelector(".ds-notice--page")).toBeNull();
  });
});
