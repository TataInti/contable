// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";
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
  rutaActual,
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

function tablaCartera(): HTMLElement {
  return screen.getByRole("table", { name: "Cartera de clientes" });
}

function celda(clave: string, indice: number): HTMLTableCellElement {
  const fila = tablaCartera().querySelector(`tbody tr[data-row-key="${clave}"]`) as HTMLTableRowElement;
  return fila.querySelectorAll("td")[indice] as HTMLTableCellElement;
}

describe("StudyClientes — columnas de la cartera (K2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    contextMock.current = contextoDePrueba(["client.read", "client.manage"], "c1");
    sessionMock.current = SESION_AUTENTICADA;
    vi.mocked(api.get).mockImplementation(((path: string) =>
      respuestaApi(path, CLIENTES_SINTETICOS)) as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("muestra las once columnas en su orden", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const tabla = await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(Array.from(tabla.querySelectorAll("thead th")).map((th) => th.textContent?.trim())).toEqual([
      "Cliente",
      "CUIT",
      "Terminación de CUIT",
      "Condición IVA",
      "Provincia",
      "Actividad",
      "Norma",
      "Cierre",
      "Ficha",
      "Cuenta",
      "",
    ]);
  });

  it("cada columna lleva su clase; las secundarias son cuatro", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const tabla = await screen.findByRole("table", { name: "Cartera de clientes" });

    for (const clase of [
      "client-list__client-column",
      "client-list__cuit-column",
      "client-list__ending-column",
      "client-list__vat-column",
      "client-list__profile-column",
      "client-list__status-column",
      "client-list__action-column",
    ]) {
      expect(tabla.querySelectorAll(`thead th.${clase}`)).toHaveLength(1);
    }
    expect(tabla.querySelectorAll("thead th.client-list__secondary-column")).toHaveLength(4);
  });

  it("el nombre es un botón accesible; el cliente en contexto lleva aria-current y «En contexto»", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    const tabla = await screen.findByRole("table", { name: "Cartera de clientes" });

    const alfa = within(tabla).getByRole("button", { name: "Sintético Alfa S.A." });
    expect(alfa.getAttribute("aria-current")).toBe("true");
    expect(within(alfa).getByText("En contexto").classList.contains("dense-tag--context")).toBe(true);
    expect(alfa.getAttribute("title")).toBe("Sintético Alfa S.A.");

    const beta = within(tabla).getByRole("button", { name: "Sintético Beta S.R.L." });
    expect(beta.hasAttribute("aria-current")).toBe(false);
    expect(beta.getAttribute("title")).toBe("Sintético Beta S.R.L. — Sintético Beta Comercial");
    expect(within(beta).getByText("Sintético Beta Comercial").tagName).toBe("SMALL");
  });

  it("cada celda muestra su dato, con formato, o el guion y «Sin CUIT» donde corresponde", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(celda("c1", 1).textContent).toBe("20-00000006-0");
    expect(celda("c1", 2).textContent).toBe("0");
    expect(celda("c6", 2).querySelector(".dense-dim")?.textContent).toBe("Sin CUIT");
    expect(celda("c1", 3).textContent).toBe(CLIENT_VAT_CONDITION_LABELS.RESPONSABLE_INSCRIPTO);
    expect(celda("c2", 3).querySelector(".dense-dim")?.textContent).toBe("—");
    expect(celda("c1", 4).textContent).toBe("Tucumán");
    expect(celda("c2", 4).querySelector(".dense-dim")?.textContent).toBe("—");
    expect(celda("c1", 7).textContent).toBe("jun");
    expect(celda("c2", 7).querySelector(".dense-dim")?.textContent).toBe("—");
    expect(celda("c1", 8).querySelector(".dense-dim")?.textContent).toBe("Completa");
    expect(celda("c2", 8).textContent?.trim()).toBe("Falta: ficha contable, perfil fiscal activo y 4 más");
    expect(celda("c2", 8).querySelector("[title]")?.getAttribute("title")).toBe(
      "Falta: ficha contable, perfil fiscal activo, inscripción fiscal, actividad fiscal, período fiscal, obligación",
    );
  });

  it("la fila de un cliente no activo va atenuada", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });

    expect(tablaCartera().querySelector('tbody tr[data-row-key="c3"]')?.classList.contains("dense-row--muted")).toBe(
      true,
    );
    expect(tablaCartera().querySelector('tbody tr[data-row-key="c1"]')?.classList.contains("dense-row--muted")).toBe(
      false,
    );
  });

  it("«Abrir ficha de …» registra el cliente, abre el resumen y no abre el detalle", async () => {
    const setClientId = vi.fn();
    contextMock.current = { ...contextMock.current, setClientId };
    renderConRutas("/clientes", <StudyClientes />);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir ficha de Sintético Beta S.R.L." }));

    expect(setClientId).toHaveBeenCalledWith("c2");
    await waitFor(() => expect(rutaActual()).toBe("/resumen-cliente"));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("con el detalle abierto se reparten otros anchos y se ocultan las columnas secundarias", async () => {
    renderConRutas("/clientes", <StudyClientes />);
    await screen.findByRole("table", { name: "Cartera de clientes" });
    const anchos = (clases: string[]) =>
      clases.map((clase) => (tablaCartera().querySelector(`thead th.${clase}`) as HTMLElement).style.width);
    const sinDetalle = [
      "client-list__client-column",
      "client-list__vat-column",
      "client-list__secondary-column",
      "client-list__profile-column",
      "client-list__status-column",
      "client-list__action-column",
    ];
    const conDetalle = [
      "client-list__client-column",
      "client-list__vat-column",
      "client-list__profile-column",
      "client-list__status-column",
      "client-list__action-column",
    ];

    expect(anchos(sinDetalle)).toEqual(["18%", "10%", "5%", "14%", "11%", "9%"]);

    fireEvent.click(within(tablaCartera()).getByText("20-00000006-0"));
    await screen.findByRole("complementary", { name: "Detalle de Sintético Alfa S.A." });

    expect(tablaCartera().querySelectorAll("thead th.client-list__secondary-column")).toHaveLength(0);
    expect(anchos(conDetalle)).toEqual(["24%", "12%", "16%", "16%", "13%"]);
  });
});
