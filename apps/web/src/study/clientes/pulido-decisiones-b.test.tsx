// @vitest-environment jsdom
// Decisión de Inti (hallazgo 85): el nombre único es «Nuevo cliente»; una sola acción rellena a la vez.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyClientes } from "../StudyClientes";
import {
  SESION_AUTENTICADA,
  contextoDePrueba,
  renderConRutas,
  respuestaApi,
} from "./clientes.testutil";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
const sessionMock = vi.hoisted(() => ({ current: null as unknown as typeof SESION_AUTENTICADA }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

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

/** Un botón es relleno (primario) salvo que lleve una variante secundaria, fantasma, de texto, enlace o peligro. */
function esRelleno(boton: HTMLElement): boolean {
  return (
    boton.className.includes("ds-button--primary") ||
    !/ds-button--(secondary|ghost|text|link|danger)/.test(boton.className)
  );
}

describe("Clientes — «Nuevo cliente» como nombre único (decisión de Inti, 85)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionMock.current = { ...SESION_AUTENTICADA };
    contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
    vi.mocked(api.get).mockImplementation(((path: string) => respuestaApi(path, [])) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("con la cartera vacía, el encabezado y el vacío no muestran dos botones rellenos", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Nuevo cliente" })).toHaveLength(2),
    );
    const botones = screen.getAllByRole("button", { name: "Nuevo cliente" });
    expect(botones.filter(esRelleno)).toHaveLength(1);
  });

  it("el alta se abre con «Nuevo cliente», su cajón tiene ese título y el envío se llama «Guardar cliente»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Nuevo cliente" }))[0]!);
    const cajon = await screen.findByRole("dialog", { name: "Nuevo cliente" });
    expect(within(cajon).getByRole("button", { name: "Guardar cliente" })).toBeTruthy();
    expect(within(cajon).queryByRole("button", { name: "Crear cliente" })).toBeNull();
  });

  it("con clientes en la cartera, el encabezado es el único punto de alta y su botón queda relleno", async () => {
    vi.mocked(api.get).mockImplementation(((path: string) =>
      respuestaApi(path, [
        { id: "c-1", legalName: "Demo Alfa", cuit: "20000000006", status: "ACTIVE" },
      ])) as never);
    renderConRutas("/clientes", <StudyClientes />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const botones = screen.getAllByRole("button", { name: "Nuevo cliente" });
    expect(botones).toHaveLength(1);
    expect(esRelleno(botones[0]!)).toBe(true);
  });
});
