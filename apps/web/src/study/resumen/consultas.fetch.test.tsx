// @vitest-environment jsdom
// Foco 7a.2 · consultas reales: el cliente de consultas y lib/api no se mockean; solo se simula la respuesta de fetch.
// Datos sintéticos rotulados «SINTÉTICO» (CUIT 20111111112). Estas pruebas se escribieron antes del arreglo y
// se verificaron en rojo contra origin/main (ver foco/foco7a-2.md).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { StudyResumenCliente } from "../StudyResumenCliente";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

const FECHA = "2026-11-01T00:00:00.000Z";

function resumenVacio() {
  return {
    client: {
      id: "client-a",
      legalName: "Cliente SINTÉTICO A",
      tradeName: "SINTÉTICO",
      cuit: "20111111112",
      status: "ONBOARDING",
      createdAt: FECHA,
      updatedAt: FECHA,
      profile: null,
      onboarding: { completed: false, updatedAt: FECHA },
    },
    accounting: { fiscalYears: [] },
    fiscal: { profiles: [], registrations: [], activities: [], periods: [], obligations: [] },
    counts: { accounts: 0, counterparties: 0, costCenters: 0 },
  };
}

const contacto = {
  id: "contact-primary",
  name: "Ana Contacto",
  function: null,
  email: "ana@example.com",
  phone: "381-555-0101",
  isPrimary: true,
  isActive: true,
};

function respuesta(status: number, data: unknown) {
  const cuerpo =
    status >= 400 ? { error: { code: "FALLA_SINTETICA", message: "Falla sintética" } } : { data };
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Ubicacion() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

function montar(responder: (ruta: string, intento: number) => Response | Promise<Response>) {
  const llamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const ruta = String(url);
      llamadas.push(ruta);
      return responder(ruta, llamadas.filter((llamada) => llamada === ruta).length);
    }),
  );
  contextMock.current = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: null,
    isReady: true,
    capabilities: new Set(["client.read", "client.manage"]),
    hasClientAccess: (id) => id === "client-a",
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/resumen-cliente"]}>
        <StudyResumenCliente />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { llamadas };
}

function porDefecto(ruta: string) {
  return ruta.endsWith("/summary") ? respuesta(200, resumenVacio()) : respuesta(200, []);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Foco 7a.2 · consultas con fetch simulado (cliente de consultas real)", () => {
  it("F-A · error de contactos: aviso de error con «Reintentar» que vuelve a pedir /contacts", async () => {
    const { llamadas } = montar((ruta, intento) => {
      if (ruta.endsWith("/summary")) return respuesta(200, resumenVacio());
      if (ruta.endsWith("/contacts"))
        return intento === 1 ? respuesta(500, null) : respuesta(200, [contacto]);
      return respuesta(200, []);
    });
    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Secciones internas del cliente" }),
      ).getByRole("button", {
        name: "Ficha contable",
      }),
    );
    const ficha = await screen.findByRole("region", { name: "Ficha contable" });
    // vigente: defecto 3.1.2 (hoy el error de contactos no se anuncia como error)
    expect(await within(ficha).findByRole("alert")).toBeTruthy();
    fireEvent.click(within(ficha).getByRole("button", { name: "Reintentar" }));
    expect(await within(ficha).findByText("Ana Contacto")).toBeTruthy();
    expect(llamadas.filter((ruta) => ruta.endsWith("/contacts"))).toHaveLength(2);
  });

  it("F-B · vacíos de Obligaciones, Regímenes y Actividades con salida a Configuración fiscal", async () => {
    montar(porDefecto);
    const menu = within(
      await screen.findByRole("navigation", { name: "Secciones internas del cliente" }),
    );
    for (const seccion of [
      "Obligaciones",
      "Regímenes adheridos",
      "Actividades registradas",
    ]) {
      fireEvent.click(menu.getByRole("button", { name: seccion }));
      const region = await screen.findByRole("region", { name: new RegExp(seccion) });
      fireEvent.click(within(region).getByRole("button", { name: "Ir a Configuración fiscal" }));
      await waitFor(() =>
        expect(screen.getByTestId("current-path").textContent).toBe("/configuracion-fiscal"),
      );
    }
  });

  it("F-C · el encabezado no tiene «Actualizar»: el resumen y los contactos se piden una vez al abrir", async () => {
    const { llamadas } = montar(porDefecto);
    await screen.findByRole("navigation", { name: "Secciones internas del cliente" });
    expect(screen.queryByRole("button", { name: "Actualizar" })).toBeNull();
    await waitFor(() => {
      expect(llamadas.filter((ruta) => ruta.endsWith("/summary"))).toHaveLength(1);
      expect(llamadas.filter((ruta) => ruta.endsWith("/contacts"))).toHaveLength(1);
    });
  });
  it("F-D · carga de la pantalla: encabezado con un solo h1 y «Abrir Legajo» visibles mientras carga", async () => {
    montar((ruta) =>
      ruta.endsWith("/summary") ? new Promise<Response>(() => undefined) : respuesta(200, []),
    );
    expect(await screen.findByText("Preparando el resumen del cliente…")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1, name: "Resumen del cliente" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: "Abrir Legajo" })).toBeTruthy();
  });

  it("F-E · error del resumen: encabezado con un solo h1 y aviso con «Reintentar»", async () => {
    montar((ruta) => (ruta.endsWith("/summary") ? respuesta(500, null) : respuesta(200, [])));
    expect(await screen.findByText("No pudimos cargar el resumen del cliente")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1, name: "Resumen del cliente" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});
