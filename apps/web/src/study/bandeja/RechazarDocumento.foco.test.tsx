// @vitest-environment jsdom
// Correcciones 7b.3c, D1 y D9: mientras se envía, «Confirmar rechazo» sigue enfocable y marcado como ocupado, sin
// enviar dos veces; al completarse el rechazo, el foco pasa al recibo «Documento rechazado». Datos sintéticos «Demo».
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import {
  BASE,
  PENDIENTE,
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

const DETALLE = `${BASE}/documents/doc-a`;
const RECHAZO = `${DETALLE}/reject`;

let documentoActual: Record<string, unknown> = {};
let respuestaRechazo: () => Respuesta = () => PENDIENTE;

function fallido() {
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
  });
}

function servidor(método: string, url: string): Respuesta {
  if (url === RUTA_DOCUMENTOS) return { status: 200, cuerpo: { data: [documentoActual] } };
  if (url === `${BASE}/document-requests`) return { status: 200, cuerpo: { data: [] } };
  if (url === DETALLE) return { status: 200, cuerpo: { data: documentoActual } };
  if (url === RECHAZO && método === "POST") return respuestaRechazo();
  return {
    status: 404,
    cuerpo: { error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" } },
  };
}

type Fetch = ReturnType<typeof fetchSimulado>;
const llamadas = (fetchMock: Fetch, url: string) => fetchMock.mock.calls.filter(([u]) => u === url);

async function abrirRechazo() {
  renderBandeja(clienteComoApp());
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Rechazar documento" }));
  return screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
}

function elegirMotivo(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "ILLEGIBLE" } });
}

beforeEach(() => {
  contextMock.current = contexto();
  documentoActual = fallido();
  respuestaRechazo = () => PENDIENTE;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function abrirYElegirMotivo() {
  const dialog = await abrirRechazo();
  elegirMotivo(dialog);
  return dialog;
}

describe("Rechazo de un documento que falló · foco y envío (D1 y D9)", () => {
  it("mientras se envía, «Confirmar rechazo» sigue enfocable, ocupado y sin enviar dos veces", async () => {
    const fetchMock = fetchSimulado(servidor);
    const dialog = await abrirYElegirMotivo();
    const confirmar = within(dialog).getByRole("button", { name: "Confirmar rechazo" });
    confirmar.focus();
    fireEvent.click(confirmar);
    await waitFor(() => expect(llamadas(fetchMock, RECHAZO)).toHaveLength(1));
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(confirmar);
    fireEvent.click(confirmar);
    expect(llamadas(fetchMock, RECHAZO)).toHaveLength(1);
  });

  it("al completarse el rechazo, el foco pasa al recibo «Documento rechazado»", async () => {
    respuestaRechazo = () => {
      documentoActual = documento("doc-a", "EXTRACTION_FAILED");
      return { status: 200, cuerpo: { data: { status: "EXTRACTION_FAILED" } } };
    };
    fetchSimulado(servidor);
    const dialog = await abrirYElegirMotivo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));
    const recibo = await waitFor(() => {
      const elemento = screen.getByText("Documento rechazado").closest(".action-receipt");
      if (!elemento) throw new Error("todavía no hay recibo");
      return elemento;
    });
    await waitFor(() => expect(document.activeElement).toBe(recibo));
  });
});
