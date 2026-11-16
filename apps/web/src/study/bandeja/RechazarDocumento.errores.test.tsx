// @vitest-environment jsdom
// Correcciones 7b.3c, D2 y D8: tras un error del rechazo, la bandeja y el detalle se piden de nuevo, y el aviso
// del cajón depende del tipo de error (con o sin respuesta del servidor), no del texto. Cliente HTTP real con
// fetch simulado a nivel de red. Datos sintéticos «Demo».
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  fetchSimuladoConAborto,
  renderBandeja,
  rutaBandeja,
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
const MOTIVO_AYUDA = "Elegí un motivo para confirmar el rechazo.";

let documentoActual: Record<string, unknown> = {};
let respuestaRechazo: () => Respuesta = () => PENDIENTE;

function fallido() {
  return documento("doc-a", "FAILED", {
    processingJobs: [
      { id: "job-a", type: "VALIDATE", status: "FAILED", stage: null, progress: 100, error: "MAGIC_BYTES_INVALID" },
    ],
  });
}

function servidor(método: string, url: string): Respuesta {
  if (url === RUTA_DOCUMENTOS) return { status: 200, cuerpo: { data: [documentoActual] } };
  if (url === `${BASE}/document-requests`) return { status: 200, cuerpo: { data: [] } };
  if (url === DETALLE) return { status: 200, cuerpo: { data: documentoActual } };
  if (url === RECHAZO && método === "POST") return respuestaRechazo();
  return { status: 404, cuerpo: { error: { code: "NOT_FOUND", message: "No encontramos el recurso solicitado" } } };
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

const AVISO_SIN_RESPUESTA =
  "No sabemos si el rechazo llegó. Actualizamos la bandeja: si el documento sigue fallido, intentá de nuevo.";

describe("Rechazo de un documento que falló · errores del rechazo (D2 y D8)", () => {
  it("409 DOCUMENT_ALREADY_REJECTED: vuelve a pedir el detalle y «Rechazar documento» desaparece", async () => {
    respuestaRechazo = () => {
      documentoActual = documento("doc-a", "EXTRACTION_FAILED");
      return { status: 409, cuerpo: { error: { code: "DOCUMENT_ALREADY_REJECTED", message: "Ya está rechazado" } } };
    };
    const fetchMock = fetchSimuladoConAborto(servidor);
    const dialog = await abrirRechazo();
    elegirMotivo(dialog);
    const detalleAntes = llamadas(fetchMock, DETALLE).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));
    expect(await within(dialog).findByText("Ya está rechazado")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Rechazar documento" })).toBeNull());
    expect(llamadas(fetchMock, DETALLE).length).toBeGreaterThan(detalleAntes);
  });

  it("espera vencida: vuelve a pedir el detalle y avisa que no se sabe si el rechazo llegó", async () => {
    const fetchMock = fetchSimuladoConAborto(servidor);
    const dialog = await abrirRechazo();
    elegirMotivo(dialog);
    const detalleAntes = llamadas(fetchMock, DETALLE).length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));
    await waitFor(() => expect(llamadas(fetchMock, RECHAZO)).toHaveLength(1));
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(await within(dialog).findByText(AVISO_SIN_RESPUESTA)).toBeTruthy();
    await waitFor(() => expect(llamadas(fetchMock, DETALLE).length).toBeGreaterThan(detalleAntes));
    expect(screen.getByRole("button", { name: "Rechazar documento" })).toBeTruthy();
  });
});
