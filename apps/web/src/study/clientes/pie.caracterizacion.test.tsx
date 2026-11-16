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

/** Botones del pie del cajón, en orden de DOM. */
function botonesDelPie(cajon: HTMLElement): string[] {
  const pie = cajon.querySelector("footer.action-drawer__footer");
  return Array.from(pie?.querySelectorAll("button") ?? []).map((boton) =>
    (boton.textContent ?? "").trim(),
  );
}

function pieDe(cajon: HTMLElement): HTMLElement {
  return cajon.querySelector("footer.action-drawer__footer") as HTMLElement;
}

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

async function abrirAlta(): Promise<HTMLElement> {
  renderConRutas("/clientes", <StudyClientes />);
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
  return screen.findByRole("dialog", { name: "Alta de cliente" });
}

async function abrirEdicion(): Promise<HTMLElement> {
  renderConRutas("/clientes", <StudyClientes />);
  const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
  fireEvent.click(within(detalle).getByRole("button", { name: "Editar" }));
  return screen.findByRole("dialog", { name: "Editar cliente" });
}

async function abrirEstado(): Promise<HTMLElement> {
  renderConRutas("/clientes", <StudyClientes />);
  const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
  fireEvent.click(within(detalle).getByText("Más acciones"));
  fireEvent.click(within(detalle).getByRole("button", { name: "Cambiar estado" }));
  return screen.findByRole("dialog", { name: "Cambiar estado" });
}

async function abrirContacto(): Promise<HTMLElement> {
  renderConRutas("/clientes", <StudyClientes />);
  const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
  fireEvent.click(within(detalle).getByRole("button", { name: "Nuevo contacto" }));
  return screen.findByRole("dialog", { name: "Nuevo contacto" });
}

describe("Pie de los cuatro cajones de Clientes (5.3a)", () => {
  it("alta vacía: «Cancelar» a la izquierda, motivo junto a «Crear cliente»", async () => {
    const cajon = await abrirAlta();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Crear cliente"]);
    expect(pieDe(cajon).querySelector(".action-drawer__actions > button")?.textContent).toBe(
      "Cancelar",
    );
    expect(
      pieDe(cajon).querySelector(".action-drawer__primary .action-drawer__hint")?.textContent,
    ).toBe("Falta completar 2 campos: razón social y CUIT.");
  });

  it("edición: «Cancelar» a la izquierda y «Guardar cambios» habilitado sin motivo", async () => {
    const cajon = await abrirEdicion();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Guardar cambios"]);
    expect(pieDe(cajon).querySelector(".action-drawer__actions > button")?.textContent).toBe(
      "Cancelar",
    );
    expect(pieDe(cajon).querySelector(".action-drawer__hint")).toBeNull();
  });

  it("edición sin razón social: el motivo va junto a «Guardar cambios» y la primaria queda deshabilitada", async () => {
    const cajon = await abrirEdicion();
    fireEvent.change(cajon.querySelector("#client-identity-legal-name") as HTMLInputElement, {
      target: { value: "" },
    });
    expect(
      pieDe(cajon).querySelector(".action-drawer__primary .action-drawer__hint")?.textContent,
    ).toBe("Falta completar la razón social.");
    expect(
      (within(cajon).getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("estado: «Cancelar» a la izquierda y «Guardar estado» a la derecha", async () => {
    const cajon = await abrirEstado();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Guardar estado"]);
    expect(pieDe(cajon).querySelector(".action-drawer__actions > button")?.textContent).toBe(
      "Cancelar",
    );
  });

  it("contacto vacío: «Cancelar» a la izquierda y el motivo junto a «Guardar contacto»", async () => {
    const cajon = await abrirContacto();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Guardar contacto"]);
    expect(
      pieDe(cajon).querySelector(".action-drawer__primary .action-drawer__hint")?.textContent,
    ).toBe("Falta completar el nombre del contacto.");
  });

  it("el pie es el último hijo del cajón de edición (formulario largo)", async () => {
    const cajon = await abrirEdicion();
    expect(cajon.lastElementChild).toBe(pieDe(cajon));
    expect(pieDe(cajon).closest('[role="dialog"]')).toBe(cajon);
  });
});
