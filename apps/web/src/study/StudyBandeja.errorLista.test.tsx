// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyBandeja } from "./StudyBandeja";

/**
 * Error de lista de la Bandeja (Foco 7b.2, cierre del PR #143).
 * Estas pruebas no mockean `api`: la lista recibe lo que devuelve el cliente HTTP real sobre un `fetch`
 * simulado, con un QueryClient igual al de App.tsx (retry: 1). Datos sintéticos «Demo».
 */

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

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

const RUTA_DOCUMENTOS = "/api/v1/firms/firm-a/clients/client-a/documents";
const CLAVE_DOCUMENTOS = ["documents", "firm-a", "client-a"];

interface RespuestaSimulada {
  status: number;
  cuerpo: unknown;
}

const ERROR_SERVIDOR: RespuestaSimulada = {
  status: 500,
  cuerpo: { error: { code: "INTERNAL_ERROR", message: "Error interno" } },
};

function contexto(): ClientContextValue {
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
  };
}

function factura() {
  return {
    id: "doc-factura",
    status: "EXTRACTED",
    createdAt: "2026-10-31T12:00:00.000Z",
    category: "PURCHASE",
    direction: null,
    fileVersions: [
      {
        originalName: "factura.pdf",
        mimeType: "application/pdf",
        bucket: "originals",
        antivirusStatus: "CLEAN",
      },
    ],
    processingJobs: [],
  };
}

/** fetch simulado: «/documents» responde lo que diga `respuesta`; las demás consultas, una lista vacía. */
function fetchSimulado(respuesta: () => RespuestaSimulada) {
  const fetchMock = vi.fn(async (url: string) => {
    const { status, cuerpo } =
      url === RUTA_DOCUMENTOS ? respuesta() : { status: 200, cuerpo: { data: [] } };
    return new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Pedidos a la lista de documentos (sin contar las demás consultas). */
function pedidosDeDocumentos(fetchMock: ReturnType<typeof fetchSimulado>) {
  return fetchMock.mock.calls.filter(([url]) => url === RUTA_DOCUMENTOS).length;
}

/** Cliente igual al de App.tsx (retry: 1); sin espera entre intentos para que la prueba no demore. */
function clienteComoApp() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 0, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

function renderBandeja(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyBandeja />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Fija document.visibilityState: la pestaña del arnés puede estar oculta. */
function fijarVisibilidad(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
}

/** Espera a que la consulta de documentos quede pausada: sin dato, sin error y sin pedir nada. */
async function esperarPausa(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(CLAVE_DOCUMENTOS)?.fetchStatus).toBe("paused"));
}

describe("StudyBandeja · error de lista con el cliente real (7b.2, cierre)", () => {
  beforeEach(() => {
    contextMock.current = contexto();
    fijarVisibilidad("visible");
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.unstubAllGlobals();
  });

  // Sin conexión: la consulta queda pausada. La lista no recibió respuesta, así que no puede decir «Bandeja vacía».
  it("sin conexión: la consulta pausada muestra «Cargando documentos…», no «Bandeja vacía»", async () => {
    fetchSimulado(() => ({ status: 200, cuerpo: { data: [] } }));
    const client = clienteComoApp();
    onlineManager.setOnline(false);
    renderBandeja(client);
    await esperarPausa(client);
    expect(screen.getByText("Cargando documentos…")).toBeTruthy();
    expect(screen.queryByText("Bandeja vacía")).toBeNull();
  });

  // Pestaña oculta tras el primer fallo: el reintento se pausa (retryer.ts). Mientras está pausada, no puede decir
  // «Bandeja vacía»; al volver la pestaña, la consulta sigue y la lista aparece.
  it("pestaña oculta tras el primer fallo: «Cargando documentos…» y, al volver la pestaña, la lista", async () => {
    let intentos = 0;
    const fetchMock = fetchSimulado(() => {
      intentos += 1;
      return intentos === 1 ? ERROR_SERVIDOR : { status: 200, cuerpo: { data: [factura()] } };
    });
    fijarVisibilidad("hidden");
    const client = clienteComoApp();
    renderBandeja(client);
    await esperarPausa(client);
    expect(screen.getByText("Cargando documentos…")).toBeTruthy();
    expect(screen.queryByText("Bandeja vacía")).toBeNull();
    fijarVisibilidad("visible");
    window.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("factura.pdf")).toBeTruthy();
    expect(pedidosDeDocumentos(fetchMock)).toBe(2);
  });

  // Error del servidor en los dos intentos de App.tsx (retry: 1): la lista muestra el error y «Reintentar» vuelve a pedirla.
  it("error del servidor: «No se pudo cargar la bandeja» con «Reintentar», que vuelve a pedir la lista", async () => {
    let respuesta: RespuestaSimulada = ERROR_SERVIDOR;
    const fetchMock = fetchSimulado(() => respuesta);
    renderBandeja(clienteComoApp());
    expect(await screen.findByText("No se pudo cargar la bandeja")).toBeTruthy();
    expect(screen.queryByText("Bandeja vacía")).toBeNull();
    expect(pedidosDeDocumentos(fetchMock)).toBe(2);
    respuesta = { status: 200, cuerpo: { data: [factura()] } };
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("factura.pdf")).toBeTruthy();
  });
});
