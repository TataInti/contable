// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyBandeja } from "./StudyBandeja";

/**
 * Lista de la Bandeja (Foco 7b.2): K1, K2, K6, K15, K16 y K17, con los reemplazos de C7B-1 a C7B-5
 * y de los defectos 7b-5, 7b-6 y 7b-12. Cada reemplazo lleva el «antes» que sustituye.
 * Datos sintéticos «Demo».
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
    fileVersions: [
      { originalName: nombre, mimeType, bucket: "originals", antivirusStatus: "CLEAN" },
    ],
    processingJobs: [],
  };
}

const factura = () =>
  documento(
    "doc-factura",
    "EXTRACTED",
    "factura.pdf",
    "application/pdf",
    "2026-10-31T12:00:00.000Z",
    "PURCHASE",
  );
const ticket = () =>
  documento(
    "doc-ticket",
    "REVIEWED",
    "ticket.jpg",
    "image/jpeg",
    "2026-10-20T12:00:00.000Z",
    "SALE",
  );

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
  vi.mocked(api.get).mockImplementation(
    ((ruta: string) => mapa(ruta) ?? Promise.resolve([])) as never,
  );
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

/** Botón de un indicador, por su nombre visible («Para revisar 1» responde a /^Para revisar\b/). */
function indicadorBoton(etiqueta: string) {
  return screen.getByRole("button", { name: new RegExp(`^${etiqueta}`) });
}

/** Veces que se pidió una ruta que termina en el sufijo dado. */
function pedidos(sufijo: string) {
  return vi.mocked(api.get).mock.calls.filter(([ruta]) => String(ruta).endsWith(sufijo)).length;
}

describe("StudyBandeja · lista de documentos (7b.2)", () => {
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
    // C7B-4 (7b.2): la cola pasa de «Revisados» a «Revisado», el mismo nombre que su etiqueta. Antes: indicador("Revisados").
    expect(indicador("Aprobado")).toBe("1");
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

  // K2 · la búsqueda recorre lo que la fila muestra (defecto 7b-6, corregido en este corte).
  it("K2 · la búsqueda recorre el nombre, el tipo, el estado con su nombre visible y la fecha dd/mm/aaaa", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    const buscar = screen.getByRole("searchbox", { name: "Buscar" });
    // 7b-6, antes: «REVIEWED» encontraba el documento por su código de estado. Ahora no.
    fireEvent.change(buscar, { target: { value: "REVIEWED" } });
    expect(screen.queryByText("ticket.jpg")).toBeNull();
    // 7b-6, antes: «Revisado» no encontraba el documento. Ahora sí: es el nombre visible del estado.
    fireEvent.change(buscar, { target: { value: "Aprobado" } });
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
    // 7b-6, antes: la fecha ISO encontraba el documento. Ahora no.
    fireEvent.change(buscar, { target: { value: "2026-10-20" } });
    expect(screen.queryByText("ticket.jpg")).toBeNull();
    // 7b-6, antes: no se buscaba la fecha dd/mm/aaaa que la fila muestra. Ahora sí.
    fireEvent.change(buscar, { target: { value: "20/10/2026" } });
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
    // 7b-6, antes: la categoría (SALE) encontraba el documento. Ahora no: la fila no la muestra.
    fireEvent.change(buscar, { target: { value: "SALE" } });
    expect(screen.queryByText("ticket.jpg")).toBeNull();
  });

  // K2 · C7B-2: un solo control para la cola; el <select> «Estado» se quita de la barra.
  it("K2 · C7B-2: el estado se filtra con el indicador «Para revisar» (aria-pressed) y ya no hay <select> «Estado»", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    // C7B-2, antes: fireEvent.change sobre el <select> «Estado» con NEEDS_REVIEW. Ahora el select no existe.
    expect(screen.queryByRole("combobox", { name: "Estado" })).toBeNull();
    fireEvent.click(indicadorBoton("Para revisar"));
    expect(indicadorBoton("Para revisar").getAttribute("aria-pressed")).toBe("true");
    expect(indicadorBoton("Todos").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("factura.pdf")).not.toBeNull();
    expect(screen.queryByText("ticket.jpg")).toBeNull();
  });

  // K6 · carga.
  it("K6 · carga: «Cargando documentos…», sin afirmar el orden mientras la lista no llega", async () => {
    responder((ruta) => (ruta.endsWith("/documents") ? new Promise(() => {}) : undefined));
    renderBandeja();
    expect(await screen.findByText("Cargando documentos…")).toBeTruthy();
    expect(screen.queryByText("Más recientes primero")).toBeNull();
  });

  // K6 · error y reintento.
  it("K6 · error: «No se pudo cargar la bandeja» y «Reintentar» vuelve a pedir la lista", async () => {
    let intentos = 0;
    responder((ruta) => {
      if (!ruta.endsWith("/documents")) return undefined;
      intentos += 1;
      return intentos === 1
        ? Promise.reject(new Error("falla de red"))
        : Promise.resolve([factura()]);
    });
    renderBandeja();
    expect(await screen.findByText("No se pudo cargar la bandeja")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("factura.pdf")).toBeTruthy();
    expect(intentos).toBe(2);
  });

  // K6 · vacío (C7B-1).
  it("K6 · vacío: «Bandeja vacía» con «Subir documento» primaria en el estado vacío; la cabecera la ofrece secundaria", async () => {
    responder(listaDe([]));
    renderBandeja();
    const titulo = await screen.findByText("Bandeja vacía");
    const estadoVacio = titulo.closest(".ds-empty") as HTMLElement;
    // C7B-1, antes: la de la cabecera era primaria (ds-button--primary). Ahora es secundaria.
    expect(screen.getAllByRole("button", { name: "Subir documento" })[0]?.className).toContain(
      "ds-button--secondary",
    );
    expect(
      within(estadoVacio).getByRole("button", { name: "Subir documento" }).className,
    ).toContain("ds-button--primary");
    expect(screen.queryByText("Más recientes primero")).toBeNull();
  });

  // K6 · sin coincidencias (7b.2, c).
  it("K6 · sin coincidencias: «No hay documentos en esta vista» con «Quitar filtros», que limpia la búsqueda", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    const buscar = screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement;
    fireEvent.change(buscar, { target: { value: "zzz" } });
    const titulo = await screen.findByText("No hay documentos en esta vista");
    // 7b.2 (c), antes: sin «Quitar filtros» y con la descripción «Probá con otro estado…». Ahora es no-results.
    expect(titulo.closest(".ds-empty")?.getAttribute("data-empty-kind")).toBe("no-results");
    expect(screen.getByText("Probá con otra vista o ajustá la búsqueda.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(buscar.value).toBe("");
    expect(screen.queryByText("ticket.jpg")).not.toBeNull();
  });

  // K6 · fila seleccionada. Se mide el elemento que contiene el nombre: vale para el botón de antes y para la fila de hoy.
  it("K6 · la fila seleccionada lleva aria-current", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura(), ticket()]);
      if (ruta.endsWith("/documents/doc-factura")) return Promise.resolve(factura());
      if (ruta.endsWith("/extraction")) return Promise.reject(new Error("sin extracción"));
      return undefined;
    });
    renderBandeja();
    fireEvent.click(await screen.findByText("factura.pdf"));
    expect(
      screen
        .getAllByText("factura.pdf")[0]
        ?.closest("[aria-current]")
        ?.getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.getByText("ticket.jpg").closest("[aria-current]")).toBeNull();
  });

  // C7B-3 · cada documento es una fila de DenseTable; la fila seleccionada lleva aria-current.
  it("C7B-3 · cada documento es una fila de DenseTable, no un botón, con aria-current en la seleccionada", async () => {
    responder(listaDe([factura(), ticket()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    // C7B-3, antes: un <button class="document-link"> por documento.
    expect(screen.queryByRole("button", { name: /factura\.pdf/ })).toBeNull();
    fireEvent.click(screen.getByRole("row", { name: /factura\.pdf/ }));
    expect(screen.getByRole("row", { name: /factura\.pdf/ }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("table", { name: "Documentos" })).toBeTruthy();
    expect(screen.getByText("2 documentos")).toBeTruthy();
  });

  // 7b-12 · la lista ordena por fecha de ingreso y solo afirma el orden cuando lo muestra.
  it("7b-12 · la lista se ordena por fecha de ingreso, más reciente primero, aunque la API llegue al revés", async () => {
    responder(listaDe([ticket(), factura()]));
    renderBandeja();
    await screen.findByText("factura.pdf");
    const claves = Array.from(document.querySelectorAll("tr[data-row-key]")).map((fila) =>
      fila.getAttribute("data-row-key"),
    );
    expect(claves).toEqual(["doc-factura", "doc-ticket"]);
    expect(screen.getByText("Más recientes primero")).toBeTruthy();
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

  // K15 · «Actualizando…» mientras la consulta corre (7b.2, a).
  it("K15 · «Actualizar» muestra «Actualizando…» y aria-busy mientras pide la lista", async () => {
    let liberar: () => void = () => {};
    let llamadas = 0;
    responder((ruta) => {
      if (!ruta.endsWith("/documents")) return undefined;
      llamadas += 1;
      if (llamadas === 1) return Promise.resolve([factura()]);
      return new Promise((resolver) => {
        liberar = () => resolver([factura()]);
      });
    });
    renderBandeja();
    await screen.findByText("factura.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    const enCurso = await screen.findByRole("button", { name: "Actualizando…" });
    expect(enCurso.getAttribute("aria-busy")).toBe("true");
    liberar();
    expect(await screen.findByRole("button", { name: "Actualizar" })).toBeTruthy();
  });

  // K16 · «Pedidos por completar» (C7B-5).
  it("K16 · «Pedidos por completar» se carga al abrir la pantalla: «…» mientras carga y después el número real", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura()]);
      if (ruta.endsWith("/document-requests")) return Promise.resolve([pedido()]);
      return undefined;
    });
    renderBandeja();
    // C7B-5, antes: «0» sin abrir el cajón de carga (defecto 7b-5).
    expect(indicador("Pedidos por completar")).toBe("…");
    await waitFor(() => expect(indicador("Pedidos por completar")).toBe("2"));
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));
    expect(indicador("Pedidos por completar")).toBe("2");
  });

  // C7B-5 · sin respuesta, nunca 0.
  it("C7B-5 · «Pedidos por completar» dice «no disponible» si falla su consulta, nunca 0", async () => {
    responder((ruta) => {
      if (ruta.endsWith("/documents")) return Promise.resolve([factura()]);
      if (ruta.endsWith("/document-requests")) return Promise.reject(new Error("falla de red"));
      return undefined;
    });
    renderBandeja();
    await waitFor(() => expect(indicador("Pedidos por completar")).toBe("no disponible"));
  });

  it("C7B-5 · con la lista en error, las cifras de las colas dicen «no disponible», nunca 0", async () => {
    responder((ruta) =>
      ruta.endsWith("/documents") ? Promise.reject(new Error("falla de red")) : undefined,
    );
    renderBandeja();
    await waitFor(() => expect(indicador("Todos")).toBe("no disponible"));
    expect(indicador("Con error")).toBe("no disponible");
    expect(screen.getByText("No se pudo cargar la bandeja")).toBeTruthy();
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
