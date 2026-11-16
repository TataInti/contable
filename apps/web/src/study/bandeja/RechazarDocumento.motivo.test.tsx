// @vitest-environment jsdom
// Correcciones 7b.3c, D4: con el motivo sin elegir, «Confirmar rechazo» queda deshabilitado y el motivo se ve
// junto al botón, asociado con aria-describedby. El cajón es el mismo para el rechazo de un documento que falló y
// para el de una extracción; la prueba cubre los dos usos. Datos sintéticos «Demo».
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

describe.each([
  { caso: "documento que falló", etiqueta: "Rechazar documento", documentoPrueba: () => fallido() },
  {
    caso: "extracción en revisión",
    etiqueta: "Rechazar",
    documentoPrueba: () => documento("doc-a", "EXTRACTED"),
  },
])("Rechazo · motivo junto al botón deshabilitado (D4) · $caso", ({ etiqueta, documentoPrueba }) => {
  it("muestra «Elegí un motivo para confirmar el rechazo.» junto a «Confirmar rechazo», asociado y sin motivo al elegir", async () => {
    contextMock.current = contexto();
    fetchSimulado(rutaBandeja(documentoPrueba()));
    renderBandeja(clienteComoApp());
    fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
    fireEvent.click(await screen.findByRole("button", { name: etiqueta }));
    const dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    const confirmar = within(dialog).getByRole("button", { name: "Confirmar rechazo" });
    const motivo = within(dialog).getByText(MOTIVO_AYUDA);
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    expect(motivo.id).not.toBe("");
    expect(confirmar.getAttribute("aria-describedby")).toBe(motivo.id);
    expect(motivo.parentElement).toBe(confirmar.parentElement);
    elegirMotivo(dialog);
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).queryByText(MOTIVO_AYUDA)).toBeNull();
    expect(confirmar.hasAttribute("aria-describedby")).toBe(false);
  });
});
