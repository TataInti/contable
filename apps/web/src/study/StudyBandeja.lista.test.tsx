// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyBandeja } from "./StudyBandeja";

/**
 * Caracterización de la lista de la Bandeja (Foco 7b.2: K1, K2, K6, K15, K16 y K17).
 * Datos sintéticos «Demo». Cada aserción marcada «vigente» describe lo que la pantalla
 * hace hoy; el corte que cambia ese comportamiento la reemplaza por la aserción nueva.
 */

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
let testQueryClient: QueryClient | null = null;

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: { firms: [{ firmId: "firm-a", firmName: "Estudio Demo" }] },
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
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

function contexto(overrides: Partial<ClientContextValue> = {}): ClientContextValue {
  return {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(["client.read", "document.upload"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
    ...overrides,
  };
}

function documento(
  id: string,
  status: string,
  nombre: string,
  mimeType: string,
  createdAt: string,
  category: string | null = null,
) {
  return {
    id,
    status,
    createdAt,
    category,
    direction: null,
    fileVersions: [{ originalName: nombre, mimeType, bucket: "originals", antivirusStatus: "CLEAN" }],
    processingJobs: [],
  };
}

const factura = () =>
  documento("doc-factura", "EXTRACTED", "factura.pdf", "application/pdf", "2026-10-31T12:00:00.000Z", "PURCHASE");
const ticket = () =>
  documento("doc-ticket", "REVIEWED", "ticket.jpg", "image/jpeg", "2026-10-20T12:00:00.000Z", "SALE");

const ESTADOS_K1 = [
  "UPLOADED",
  "VALIDATING",
  "PROCESSING",
  "IN_PROGRESS",
  "RUNNING",
  "EXTRACTED",
  "REVIEWED",
  "EXTRACTION_FAILED",
  "INFECTED",
  "READY",
];
const diezDocumentos = () =>
  ESTADOS_K1.map((estado, indice) =>
    documento(
      `doc-${indice + 1}`,
      estado,
      `comprobante-${String(indice + 1).padStart(2, "0")}.pdf`,
      "application/pdf",
      `2026-10-${String(10 + indice)}T12:00:00.000Z`,
    ),
  );

const pedido = () => ({
  id: "req-1",
  title: "Marzo 2026",
  status: "OPEN",
  items: [
    { id: "item-1", description: "Factura de compra", required: true, status: "PENDING" },
    { id: "item-2", description: "Recibo de cobro", required: false, status: "PENDING" },
    { id: "item-3", description: "Extracto bancario", required: true, status: "COMPLETED" },
  ],
});

/** Responde según la ruta; las rutas no previstas devuelven una lista vacía. */
function responder(mapa: (ruta: string) => Promise<unknown> | undefined) {
  vi.mocked(api.get).mockImplementation(((ruta: string) => mapa(ruta) ?? Promise.resolve([])) as never);
}

function listaDe(documentos: unknown[]) {
  return (ruta: string) => (ruta.endsWith("/documents") ? Promise.resolve(documentos) : undefined);
}

function renderBandeja() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  testQueryClient = client;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyBandeja />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Cifra de un indicador del StatStrip «Vistas de la bandeja», sea botón o no. */
function indicador(etiqueta: string) {
  const etiquetaEl = screen.getByText(etiqueta, { selector: ".dense-stat__label" });
  return etiquetaEl.parentElement?.querySelector(".dense-stat__value")?.textContent;
}

/** Veces que se pidió una ruta que termina en el sufijo dado. */
function pedidos(sufijo: string) {
  return vi.mocked(api.get).mock.calls.filter(([ruta]) => String(ruta).endsWith(sufijo)).length;
}

describe("StudyBandeja · caracterización de la lista (7b.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.current = contexto();
    responder(() => undefined);
  });

  afterEach(() => {
    cleanup();
    testQueryClient?.clear();
    testQueryClient = null;
    vi.restoreAllMocks();
  });

  // K1 · colas y conteos con diez documentos en estados distintos.
  it("K1 · cada cola cuenta sus documentos; «Todos» cuenta los diez", async () => {
    responder(listaDe(diezDocumentos()));
    renderBandeja();
    await waitFor(() => expect(indicador("Todos")).toBe("10"));
    expect(indicador("Para revisar")).toBe("1");
    expect(indicador("Procesando")).toBe("5");
    expect(indicador("Revisados")).toBe("1");
    expect(indicador("Con error")).toBe("2");
  });

  // K2 · búsqueda por nombre, sin tildes ni mayúsculas.
  it("K2 · la búsqueda encuentra por nombre, sin tildes ni mayúsculas", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    const buscar = screen.getByRole("searchbox", { name: "Buscar" });
    fireEvent.change(buscar, { target: { value: "factura" } });
    expect(screen.queryByText("factura.pdf")).not.toBeNull();
    expect(screen.queryByText("ticket.jpg")).toBeNull();
    fireEvent.change(buscar, { target: { value: "FACTÚRA" } });
    expect(screen.queryByText("factura.pdf")).not.toBeNull();
    expect(screen.queryByText("ticket.jpg")).toBeNull();
  });

  // K2 · la búsqueda mira campos que la pantalla no muestra (defecto 7b-6).
  it("K2 · vigente: la búsqueda usa el código de estado, la fecha ISO y la categoría", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    const buscar = screen.getByRole("searchbox", { name: "Buscar" });
    // vigente: defecto 7b-6 (busca por el código REVIEWED y no por el nombre visible «Revisado»)
    fireEvent.change(buscar, { target: { value: "REVIEWED" } });
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
    // vigente: defecto 7b-6 (el nombre visible «Revisado» no encuentra el documento)
    fireEvent.change(buscar, { target: { value: "Revisado" } });
    expect(screen.queryByText("ticket.jpg")).toBeNull();
    // vigente: defecto 7b-6 (busca la fecha ISO, que la pantalla no muestra)
    fireEvent.change(buscar, { target: { value: "2026-10-20" } });
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
    // vigente: defecto 7b-6 (busca la categoría, que la pantalla no muestra)
    fireEvent.change(buscar, { target: { value: "SALE" } });
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
  });

  // K2 · el filtro de estado es un <select> en la barra (C7B-2).
  it("K2 · vigente: el filtro de estado es un <select> «Estado» en la barra", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    // vigente: cambia con C7B-2 (se quita el <select> «Estado»; el filtro queda solo en los indicadores)
    fireEvent.change(screen.getByRole("combobox", { name: "Estado" }), {
      target: { value: "NEEDS_REVIEW" },
    });
    expect(screen.queryByText("factura.pdf")).not.toBeNull();
    expect(screen.queryByText("ticket.jpg")).toBeNull();
  });

  // K6 · carga.
  it("K6 · carga: «Cargando documentos…» mientras la lista no llega", async () => {
    responder((ruta) => (ruta.endsWith("/documents") ? new Promise(() => {}) : undefined));
    renderBandeja();
    expect(await screen.findByText("Cargando documentos…")).toBeTruthy();
  });

  // K6 · error y reintento.
  it("K6 · error: «No se pudo cargar la bandeja» y «Reintentar» vuelve a pedir la lista", async () => {
    let intentos = 0;
    responder((ruta) => {
      if (!ruta.endsWith("/documents")) return undefined;
      intentos += 1;
      return intentos === 1 ? Promise.reject(new Error("falla de red")) : Promise.resolve([factura()]);
    });
    renderBandeja();
    expect(await screen.findByText("No se pudo cargar la bandeja")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("factura.pdf")).toBeTruthy();
    expect(intentos).toBe(2);
  });

  // K6 · vacío.
  it("K6 · vacío: «Bandeja vacía» con «Subir documento» en el estado vacío", async () => {
    responder(listaDe([]));
    renderBandeja();
    const titulo = await screen.findByText("Bandeja vacía");
    const estadoVacio = titulo.closest(".ds-empty") as HTMLElement;
    expect(within(estadoVacio).getByRole("button", { name: "Subir documento" })).toBeTruthy();
    // vigente: cambia con C7B-1 («Subir documento» es primaria en la cabecera; desde 7b.2 es secundaria ahí)
    expect(screen.getAllByRole("button", { name: "Subir documento" })[0]?.className).toContain(
      "ds-button--primary",
    );
  });

  // K6 · sin coincidencias.
  it("K6 · sin coincidencias: la búsqueda sin resultados muestra «No hay documentos en esta vista»", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No hay documentos en esta vista")).toBeTruthy();
    // vigente: cambia en 7b.2 (c): «sin coincidencias» pasa a EmptyState kind="no-results" con «Quitar filtros»
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).toBeNull();
    // vigente: cambia en 7b.2 (c): la descripción habla de «otro estado», que ya no existe como selector
    expect(screen.getByText("Probá con otro estado o ajustá la búsqueda.")).toBeTruthy();
  });

  // K6 · fila seleccionada. Vale para el botón de hoy y para la fila de DenseTable: se mide el elemento que contiene el nombre.
  it("K6 · la fila seleccionada lleva aria-current", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura(), ticket()]);
      if (ruta.endsWith("/documents/doc-factura")) return Promise.resolve(factura());
      if (ruta.endsWith("/extraction")) return Promise.reject(new Error("sin extracción"));
      return undefined;
    });
    renderBandeja();
    fireEvent.click(await screen.findByText("factura.pdf"));
    expect(screen.getAllByText("factura.pdf")[0]?.closest("[aria-current]")?.getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByText("ticket.jpg").closest("[aria-current]")).toBeNull();
  });

  // K15 · Actualizar.
  it("K15 · «Actualizar» vuelve a pedir la lista y no refresca detalle, extracción ni pedidos con el cajón cerrado", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura(), ticket()]);
      if (ruta.endsWith("/documents/doc-factura")) return Promise.resolve(factura());
      if (ruta.endsWith("/extraction")) return Promise.reject(new Error("sin extracción"));
      return undefined;
    });
    renderBandeja();
    fireEvent.click(await screen.findByText("factura.pdf"));
    await waitFor(() => expect(pedidos("/extraction")).toBe(1));
    const antes = {
      lista: pedidos("/documents"),
      detalle: pedidos("/documents/doc-factura"),
      extraccion: pedidos("/extraction"),
      pedidosDocs: pedidos("/document-requests"),
    };
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(pedidos("/documents")).toBe(antes.lista + 1));
    expect(pedidos("/documents/doc-factura")).toBe(antes.detalle);
    expect(pedidos("/extraction")).toBe(antes.extraccion);
    expect(pedidos("/document-requests")).toBe(antes.pedidosDocs);
  });

  // K16 · «Ítems pendientes».
  it("K16 · vigente: «Ítems pendientes» marca 0 hasta abrir el cajón de carga y después el número real", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura()]);
      if (ruta.endsWith("/document-requests")) return Promise.resolve([pedido()]);
      return undefined;
    });
    renderBandeja();
    await screen.findByText("factura.pdf");
    // vigente: defecto 7b-5 (cambia con C7B-5: la cifra se carga al abrir la pantalla; mientras carga muestra «…»)
    expect(indicador("Ítems pendientes")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));
    await waitFor(() => expect(indicador("Ítems pendientes")).toBe("2"));
  });

  // K17 · sin cliente y permisos.
  it("K17 · sin cliente: «Seleccioná un cliente», sin buscador ni «Subir documento»", async () => {
    contextMock.current = contexto({ clientId: null });
    renderBandeja();
    expect(await screen.findByText("Seleccioná un cliente")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Buscar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull();
  });

  it("K17 · sin document.upload no hay «Subir documento» en la cabecera ni en el estado vacío", async () => {
    contextMock.current = contexto({ capabilities: new Set(["client.read"]) });
    responder(listaDe([]));
    renderBandeja();
    expect(await screen.findByText("Bandeja vacía")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull();
  });
});
