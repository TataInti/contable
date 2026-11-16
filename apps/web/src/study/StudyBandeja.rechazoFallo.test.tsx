// @vitest-environment jsdom
// Rechazo de un documento que falló al procesarse (D23-1 a, etapa 1): botón, motivo y estados del cajón,
// con el cliente HTTP real y respuesta simulada a nivel fetch (StudyBandeja.pruebas). Datos «Demo».
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import {
  BASE,
  PENDIENTE,
  RUTA_DOCUMENTOS,
  clienteComoApp,
  contexto,
  documento,
  esperarTurno,
  fetchSimulado,
  renderBandeja,
  type Respuesta,
} from "./StudyBandeja.pruebas";

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

const RECHAZO = `${BASE}/documents/doc-a/reject`;
const TAREA_ACTIVA = "Todavía se está procesando: esperá a que termine";

let documentoActual: Record<string, unknown> = {};
let respuestaRechazo: () => Respuesta = () => rechazoAceptado();

function rechazoAceptado(): Respuesta {
  documentoActual = documento("doc-a", "EXTRACTION_FAILED");
  return { status: 200, cuerpo: { data: { status: "EXTRACTION_FAILED" } } };
}

/** Servidor simulado: lista, pedidos, detalle y el rechazo, que deja el documento en EXTRACTION_FAILED. */
function servidor(método: string, url: string): Respuesta {
  if (url === RUTA_DOCUMENTOS) return { status: 200, cuerpo: { data: [documentoActual] } };
  if (url === `${BASE}/document-requests`) return { status: 200, cuerpo: { data: [] } };
  if (url === `${BASE}/documents/doc-a`) return { status: 200, cuerpo: { data: documentoActual } };
  if (url === RECHAZO && método === "POST") return respuestaRechazo();
  return {
    status: 404,
    cuerpo: { error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" } },
  };
}

function fallido(extra: Record<string, unknown> = {}) {
  return documento("doc-a", "FAILED", {
    processingJobs: [
      {
        id: "job-a",
        type: "VALIDATE",
        status: "FAILED",
        stage: null,
        progress: 100,
        error: "MAGIC_BYTES_INVALID",
      },
    ],
    ...extra,
  });
}

const llamadasA = (fetchMock: ReturnType<typeof fetchSimulado>, url: string) =>
  fetchMock.mock.calls.filter(([u]) => u === url);
const envios = (fetchMock: ReturnType<typeof fetchSimulado>) =>
  fetchMock.mock.calls.filter(([u, init]) => u === RECHAZO && (init?.method ?? "GET") === "POST");

async function abrirFactura() {
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
}

async function abrirRechazo() {
  renderBandeja(clienteComoApp());
  await abrirFactura();
  fireEvent.click(await screen.findByRole("button", { name: "Rechazar documento" }));
  return screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
}

beforeEach(() => {
  contextMock.current = contexto();
  documentoActual = fallido();
  respuestaRechazo = () => rechazoAceptado();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Rechazo de un documento que falló · D23-1 (a), etapa 1", () => {
  it("ofrece «Rechazar documento» y explica que para reemplazarlo se sube un archivo nuevo", async () => {
    fetchSimulado(servidor);
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("El procesamiento no terminó")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rechazar documento" })).toBeTruthy();
    expect(screen.getByText(/subí un archivo nuevo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });

  it("confirmar envía el motivo a la ruta del documento y el detalle pasa a «Documento rechazado»", async () => {
    const fetchMock = fetchSimulado(servidor);
    const dialog = await abrirRechazo();
    const confirmar = within(dialog).getByRole("button", {
      name: "Confirmar rechazo",
    }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "ILLEGIBLE" },
    });
    fireEvent.change(within(dialog).getByLabelText("Detalle (opcional)"), {
      target: { value: "   Archivo cortado   " },
    });
    fireEvent.click(confirmar);
    await waitFor(() => expect(envios(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(envios(fetchMock)[0]?.[1]?.body))).toEqual({
      reason: "Ilegible — Archivo cortado",
    });
    expect(await screen.findByText("Motivo: Ilegible — Archivo cortado")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "¿Rechazar este documento?" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar documento" })).toBeNull();
    await waitFor(() => expect(llamadasA(fetchMock, RUTA_DOCUMENTOS).length).toBeGreaterThan(1));
  });

  it("sin document.review no hay botón y el motivo se ve junto a la acción", async () => {
    contextMock.current = contexto(["client.read"]);
    fetchSimulado(servidor);
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("El procesamiento no terminó")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rechazar documento" })).toBeNull();
    expect(screen.getByText(/hace falta el permiso de revisión/)).toBeTruthy();
  });

  it("con una tarea activa el botón queda deshabilitado y el motivo se ve a su lado", async () => {
    documentoActual = fallido({
      processingJobs: [
        { id: "job-b", type: "VALIDATE", status: "QUEUED", stage: null, progress: 0, error: null },
      ],
    });
    fetchSimulado(servidor);
    renderBandeja(clienteComoApp());
    await abrirFactura();
    const boton = (await screen.findByRole("button", {
      name: "Rechazar documento",
    })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(screen.getByText(TAREA_ACTIVA)).toBeTruthy();
  });

  it("un 409 de la API se muestra en el cajón con su mensaje y el cajón queda abierto con el motivo", async () => {
    respuestaRechazo = () => ({
      status: 409,
      cuerpo: { error: { code: "DOCUMENT_STILL_PROCESSING", message: TAREA_ACTIVA } },
    });
    const fetchMock = fetchSimulado(servidor);
    const dialog = await abrirRechazo();
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "DUPLICATE" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(TAREA_ACTIVA);
    expect(envios(fetchMock)).toHaveLength(1);
    expect((within(dialog).getByLabelText("Motivo del rechazo") as HTMLSelectElement).value).toBe(
      "DUPLICATE",
    );
  });

  it("mientras el rechazo se envía el cajón dice «Rechazando…» y no hay un segundo envío", async () => {
    respuestaRechazo = () => PENDIENTE;
    const fetchMock = fetchSimulado(servidor);
    const dialog = await abrirRechazo();
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "OTHER" },
    });
    const confirmar = within(dialog).getByRole("button", {
      name: "Confirmar rechazo",
    }) as HTMLButtonElement;
    fireEvent.click(confirmar);
    expect(await within(dialog).findByText("Rechazando…")).toBeTruthy();
    expect(confirmar.disabled).toBe(true);
    fireEvent.click(confirmar);
    await esperarTurno();
    expect(envios(fetchMock)).toHaveLength(1);
  });
});
