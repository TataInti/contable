// @vitest-environment jsdom
// Correcciones 7b.3c, D5: la pista de permiso y la de tarea activa van a la izquierda, junto a la acción (o sola
// en la línea de acciones si no hay botón), con el texto secundario de las ayudas. Datos sintéticos «Demo».
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import {
  BASE,
  RUTA_DOCUMENTOS,
  clienteComoApp,
  contexto,
  documento,
  fetchSimulado,
  renderBandeja,
  type Respuesta,
} from "../StudyBandeja.pruebas";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: { firms: [{ firmId: "firm-a", firmName: "Estudio Demo" }] },
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

let documentoActual: Record<string, unknown> = {};

/** Servidor del arnés: un documento fallido no tiene extracción (404), como en el flujo real. */
function servidor(_método: string, url: string): Respuesta {
  if (url === RUTA_DOCUMENTOS) return { status: 200, cuerpo: { data: [documentoActual] } };
  if (url === `${BASE}/document-requests`) return { status: 200, cuerpo: { data: [] } };
  if (url === `${BASE}/documents/doc-a`) return { status: 200, cuerpo: { data: documentoActual } };
  return {
    status: 404,
    cuerpo: { error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" } },
  };
}

async function abrirFactura() {
  renderBandeja(clienteComoApp());
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Detalle del documento · pistas de permiso y de tarea activa (D5)", () => {
  it("sin permiso de revisión: la pista va en el grupo de acciones, a la izquierda, sin estilo de negrita", async () => {
    contextMock.current = contexto(["client.read", "document.upload"]);
    documentoActual = documento("doc-a", "FAILED");
    fetchSimulado(servidor);
    await abrirFactura();
    const pista = await screen.findByText(/Para rechazarlo hace falta el permiso de revisión/);
    expect(pista.parentElement?.classList.contains("review-actions__buttons")).toBe(true);
    expect(pista.classList.contains("review-actions__hint")).toBe(false);
  });

  it("con tarea activa: la pista queda junto al botón «Rechazar documento» deshabilitado", async () => {
    contextMock.current = contexto();
    documentoActual = documento("doc-a", "FAILED", {
      processingJobs: [
        { id: "job-b", type: "VALIDATE", status: "QUEUED", stage: null, progress: 0, error: null },
      ],
    });
    fetchSimulado(servidor);
    await abrirFactura();
    const boton = (await screen.findByRole("button", {
      name: "Rechazar documento",
    })) as HTMLButtonElement;
    const pista = screen.getByText("Todavía se está procesando: esperá a que termine");
    expect(boton.disabled).toBe(true);
    expect(pista.parentElement).toBe(boton.parentElement);
  });
});
