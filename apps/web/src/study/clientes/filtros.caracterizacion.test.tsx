// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyClientes } from "../StudyClientes";
import {
  CLIENTES_SINTETICOS,
  SESION_AUTENTICADA,
  contextoDePrueba,
  filasClave,
  parametrosUrl,
  renderConRutas,
  respuestaApi,
} from "./clientes.testutil";
import { cambiarValor } from "../../test/elegirOpcion";

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

function cifraFiltro(etiqueta: RegExp) {
  return within(screen.getByRole("group", { name: "Resumen de la cartera" })).getByRole("button", {
    name: etiqueta,
  });
}

describe("StudyClientes — filtros de la cartera (K1)", () => {
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

  it("lee el filtro de terminación de la URL: admite varios dígitos e ignora repetidos e inválidos", async () => {
    renderConRutas("/clientes?terminacion=9,1,9,x,10", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(filasClave()).toEqual(["c2", "c4"]);
    expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "9" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "0" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("un filtro de terminación sin dígitos válidos no filtra la cartera", async () => {
    renderConRutas("/clientes?terminacion=x,10", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(filasClave()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
  });

  it("el filtro de terminación excluye a los clientes sin CUIT", async () => {
    renderConRutas("/clientes?terminacion=0,2,7", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(filasClave()).toEqual(["c1", "c3", "c5"]);
  });

  it("la búsqueda encuentra por razón social, nombre de fantasía y dígitos del CUIT, ignorando guiones", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    const buscar = screen.getByPlaceholderText("Buscar por nombre o CUIT…");

    cambiarValor(buscar, "BETA COM");
    await waitFor(() => expect(filasClave()).toEqual(["c2"]));

    cambiarValor(buscar, "20-00000005-2");
    await waitFor(() => expect(filasClave()).toEqual(["c3"]));

    cambiarValor(buscar, "zzz");
    await screen.findByText("Ningún cliente coincide");
  });

  it("combina terminación, estado, IVA, ficha incompleta y búsqueda", async () => {
    renderConRutas("/clientes?terminacion=0,1,2,9", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    expect(filasClave()).toEqual(["c1", "c2", "c3", "c4"]);

    cambiarValor(screen.getByLabelText("Filtrar por estado"), "ACTIVE");
    expect(filasClave()).toEqual(["c1", "c2", "c4"]);

    cambiarValor(screen.getByLabelText("Filtrar por condición IVA"), "RESPONSABLE_INSCRIPTO");
    expect(filasClave()).toEqual(["c1", "c4"]);

    fireEvent.click(cifraFiltro(/Ficha incompleta/));
    expect(filasClave()).toEqual(["c4"]);

    cambiarValor(screen.getByPlaceholderText("Buscar por nombre o CUIT…"), "alfa");
    await screen.findByText("Ningún cliente coincide");
  });

  it("la cifra Activos es de lectura: no filtra y el select Estado es el único control del criterio", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    const banda = screen.getByRole("group", { name: "Resumen de la cartera" });
    const cifra = within(banda).getByText("Activos").closest(".dense-stat") as HTMLElement;
    expect(cifra.querySelector("button")).toBeNull();
    expect(cifra.textContent).toContain("4");
    expect(cifra.textContent).toContain("2 inactivos");
    expect(filasClave()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect((screen.getByLabelText("Filtrar por estado") as HTMLSelectElement).value).toBe("");
  });

  it("«Quitar filtros» quita la terminación de la URL y conserva la agrupación, que no es un filtro", async () => {
    renderConRutas("/clientes?terminacion=5&agrupar=terminacion", <StudyClientes />);
    await screen.findByText("Ningún cliente coincide");

    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));

    await waitFor(() => expect(parametrosUrl().get("terminacion")).toBeNull());
    expect(parametrosUrl().get("agrupar")).toBe("terminacion");
    await screen.findByRole("table", { name: "Cartera de clientes" });
    expect(filasClave()).toHaveLength(6);
  });

  it("«Quitar filtros» limpia también búsqueda, estado, IVA y ficha incompleta", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    cambiarValor(screen.getByPlaceholderText("Buscar por nombre o CUIT…"), "zzz");
    cambiarValor(screen.getByLabelText("Filtrar por estado"), "INACTIVE");
    cambiarValor(screen.getByLabelText("Filtrar por condición IVA"), "RESPONSABLE_INSCRIPTO");
    fireEvent.click(cifraFiltro(/Ficha incompleta/));
    await screen.findByText("Ningún cliente coincide");

    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));

    await screen.findByRole("table", { name: "Cartera de clientes" });
    expect(filasClave()).toHaveLength(6);
    expect((screen.getByPlaceholderText("Buscar por nombre o CUIT…") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Filtrar por estado") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Filtrar por condición IVA") as HTMLSelectElement).value).toBe("");
  });

  it("sin filtros activos no ofrece «Quitar filtros»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(screen.queryByRole("button", { name: "Quitar filtros" })).toBeNull();
  });

  it("la búsqueda, el estado, el IVA y la ficha incompleta no escriben la URL; la terminación sí", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    cambiarValor(screen.getByPlaceholderText("Buscar por nombre o CUIT…"), "alfa");
    cambiarValor(screen.getByLabelText("Filtrar por estado"), "INACTIVE");
    cambiarValor(screen.getByLabelText("Filtrar por condición IVA"), "RESPONSABLE_INSCRIPTO");
    fireEvent.click(cifraFiltro(/Ficha incompleta/));
    expect(parametrosUrl().toString()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "9" }));
    await waitFor(() => expect(parametrosUrl().get("terminacion")).toBe("9"));
  });
});
