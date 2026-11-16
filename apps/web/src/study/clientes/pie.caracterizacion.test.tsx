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
  return Array.from(pie?.querySelectorAll("button") ?? []).map((boton) => (boton.textContent ?? "").trim());
}

function pieDe(cajon: HTMLElement): HTMLElement {
  return cajon.querySelector("footer.action-drawer__footer") as HTMLElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
  sessionMock.current = SESION_AUTENTICADA;
  vi.mocked(api.get).mockImplementation(((path: string) => respuestaApi(path, CLIENTES_SINTETICOS)) as never);
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

describe("Pie de los cuatro cajones de Clientes: estado vigente (K9, 5.3a)", () => {
  it("alta vacía: el motivo va antes de «Cancelar»; «Crear cliente» deshabilitado", async () => {
    const cajon = await abrirAlta();
    // vigente: cambia con D5-2 (hoy el motivo va antes de «Cancelar»)
    expect(pieDe(cajon).firstElementChild?.id).toBe("client-create-hint");
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Crear cliente"]);
    expect((within(cajon).getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edición: el pie tiene solo «Guardar cambios» y no muestra motivo", async () => {
    const cajon = await abrirEdicion();
    // vigente: cambia con D5-2 (sin «Cancelar» ni motivo)
    expect(botonesDelPie(cajon)).toEqual(["Guardar cambios"]);
    expect(pieDe(cajon).querySelector(".action-drawer__hint")).toBeNull();
  });

  it("estado: «Cancelar» a la izquierda y «Guardar estado» a la derecha", async () => {
    const cajon = await abrirEstado();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Guardar estado"]);
    expect(pieDe(cajon).querySelector(".action-drawer__actions > button")?.textContent).toBe("Cancelar");
  });

  it("contacto vacío: «Guardar contacto» deshabilitado y sin motivo visible", async () => {
    const cajon = await abrirContacto();
    expect(botonesDelPie(cajon)).toEqual(["Cancelar", "Guardar contacto"]);
    expect((within(cajon).getByRole("button", { name: "Guardar contacto" }) as HTMLButtonElement).disabled).toBe(true);
    // vigente: cambia con D5-2 (hoy no hay motivo visible)
    expect(pieDe(cajon).querySelector(".action-drawer__hint")).toBeNull();
  });

  it("el pie es el último hijo del cajón de edición (formulario largo)", async () => {
    const cajon = await abrirEdicion();
    expect(cajon.lastElementChild).toBe(pieDe(cajon));
    expect(pieDe(cajon).closest('[role="dialog"]')).toBe(cajon);
  });
});
