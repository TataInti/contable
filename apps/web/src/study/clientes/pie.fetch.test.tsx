// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
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

const sessionMock = vi.hoisted(() => ({ current: null as unknown as typeof SESION_AUTENTICADA }));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => sessionMock.current,
}));

const CUIT_ALFA = "20-00000006-0";
const ALFA = "Sintético Alfa S.A.";

/** Respuesta simulada a nivel fetch: el cliente real de consultas y `api` corren sin mocks. Datos sintéticos «Sintético». */
async function respuestaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const cabeceras = { "Content-Type": "application/json" };
  if (init?.method && init.method !== "GET") {
    return new Response(JSON.stringify({ data: { id: "c1" } }), {
      status: 200,
      headers: cabeceras,
    });
  }
  const url = new URL(String(input), "http://localhost");
  const ruta = url.pathname.replace(/^\/api\/v1/, "") + url.search;
  const data = await respuestaApi(ruta, CLIENTES_SINTETICOS);
  return new Response(JSON.stringify({ data }), { status: 200, headers: cabeceras });
}

beforeEach(() => {
  contextMock.current = contextoDePrueba(["client.read", "client.manage"]);
  sessionMock.current = SESION_AUTENTICADA;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cajones de Clientes con cliente de consultas real y fetch simulado (5.3a)", () => {
  it("edición: «Cancelar» cierra sin guardar (ningún PATCH ni PUT) y devuelve el foco a «Editar»", async () => {
    const fetchEspiado = vi.spyOn(globalThis, "fetch").mockImplementation(respuestaFetch);
    renderConRutas("/clientes", <StudyClientes />);
    const detalle = await seleccionarCliente(CUIT_ALFA, ALFA);
    const disparador = within(detalle).getByRole("button", { name: "Editar" });
    disparador.focus();
    fireEvent.click(disparador);
    const cajon = await screen.findByRole("dialog", { name: "Editar cliente" });
    fireEvent.click(within(cajon).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Editar cliente" })).toBeNull(),
    );
    expect(
      fetchEspiado.mock.calls.filter(([, init]) => init?.method && init.method !== "GET"),
    ).toHaveLength(0);
    expect(document.activeElement).toBe(disparador);
  });

  it("alta: con los catálogos respondidos por fetch, «Cancelar» queda a la izquierda y el motivo junto a «Guardar cliente»", async () => {
    // vigente: cambia con decisión de Inti (16-nov)
    vi.spyOn(globalThis, "fetch").mockImplementation(respuestaFetch);
    renderConRutas("/clientes", <StudyClientes />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const cajon = await screen.findByRole("dialog", { name: "Nuevo cliente" }); // vigente: cambia con decisión de Inti (16-nov)
    await waitFor(() => expect(cajon.querySelector('small[role="status"]')).toBeNull());
    const pie = cajon.querySelector("footer.action-drawer__footer") as HTMLElement;
    expect(pie.querySelector(".action-drawer__actions > button")?.textContent).toBe("Cancelar");
    expect(pie.querySelector(".action-drawer__primary .action-drawer__hint")?.textContent).toBe(
      "Falta completar 2 campos: razón social y CUIT.",
    );
  });
});
