// @vitest-environment jsdom
// Estados del detalle de la Bandeja (Foco 7b.3a): cliente de consultas real y respuesta simulada a nivel fetch.
// Se escribieron antes del arreglo y se vieron en rojo; el arreglo las pone en verde sin cambiarlas.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import {
  ERROR_SERVIDOR,
  clienteComoApp,
  contexto,
  documento,
  extraccion,
  fetchSimulado,
  renderBandeja,
  rutaBandeja,
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

async function abrirFactura() {
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
}

describe("StudyBandeja · estados del detalle con el cliente real (7b.3a)", () => {
  beforeEach(() => {
    contextMock.current = contexto();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("7b-1 · error de la extracción: aviso con «Reintentar», que vuelve a pedirla y muestra los campos", async () => {
    let extraccionRespuesta: Respuesta = ERROR_SERVIDOR;
    fetchSimulado(
      rutaBandeja(documento("doc-a", "EXTRACTED"), { extraccion: () => extraccionRespuesta }),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("No se pudo cargar la extracción");
    expect(screen.queryByText("La extracción todavía no está disponible")).toBeNull();
    extraccionRespuesta = { status: 200, cuerpo: { data: extraccion() } };
    fireEvent.click(within(aviso).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Revisá contra el comprobante" })).toBeTruthy();
  });

  it("7b-2 · documento rechazado: «Documento rechazado», sin «Procesando comprobante» ni acciones de lectura", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTION_FAILED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("Documento rechazado")).toBeTruthy();
    expect(screen.queryByText("Procesando comprobante")).toBeNull();
    expect(screen.queryByRole("button", { name: "Releer con IA" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });

  it("7b-2 · trabajo fallido: «El procesamiento no terminó» y el aviso a quien administra, sin código interno", async () => {
    fetchSimulado(
      rutaBandeja(
        documento("doc-a", "FAILED", {
          processingJobs: [
            { id: "job-a", type: "VALIDATE", status: "FAILED", stage: null, progress: 100, error: "MAGIC_BYTES_INVALID" },
          ],
        }),
      ),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("El procesamiento no terminó")).toBeTruthy();
    expect(screen.getByText("Avisá a quien administra el estudio para que revise el archivo.")).toBeTruthy();
    expect(screen.queryByText(/MAGIC_BYTES_INVALID/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });

  it("7b-2 · documento cancelado: «El procesamiento no terminó», no «Procesando comprobante»", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "CANCELED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("El procesamiento no terminó")).toBeTruthy();
    expect(screen.queryByText("Procesando comprobante")).toBeNull();
  });

  it("7b-3 · «Aprobar extracción» que falla: aviso de error con el mensaje de la API y sin recibo de éxito", async () => {
    fetchSimulado(
      rutaBandeja(documento("doc-a", "EXTRACTED"), {
        aprobar: {
          status: 409,
          cuerpo: {
            error: {
              code: "EXTRACTION_STATE_CHANGED",
              message: "La extracción cambió mientras la revisabas. Actualizá la pantalla.",
            },
          },
        },
      }),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar extracción" }));
    const dialogo = await screen.findByRole("alertdialog", { name: "¿Aprobar la extracción?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aprobar extracción" }));
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("No se pudo aprobar la extracción");
    expect(aviso.textContent).toContain("La extracción cambió mientras la revisabas.");
    expect(screen.queryByText("Extracción revisada")).toBeNull();
  });

  it("7b-4 · «Ver archivo» que falla: aviso «No se pudo abrir el archivo.» y el botón vuelve a estar disponible", async () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchSimulado(
      rutaBandeja(documento("doc-a", "EXTRACTED"), {
        preview: {
          status: 409,
          cuerpo: { error: { code: "DOCUMENT_NOT_READY", message: "El archivo todavía no está disponible." } },
        },
      }),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    fireEvent.click(await screen.findByRole("button", { name: "Ver archivo" }));
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("No se pudo abrir el archivo.");
    expect(abrir).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Ver archivo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("C7B-8 · en curso con etapa conocida: la etapa en texto y el progreso", async () => {
    fetchSimulado(
      rutaBandeja(
        documento("doc-a", "VALIDATING", {
          processingJobs: [
            { id: "job-a", type: "VALIDATE", status: "RUNNING", stage: "READING_AI", progress: 40 },
          ],
        }),
      ),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText(/Leyendo el comprobante con IA/)).toBeTruthy();
    expect(screen.getByText(/40%/)).toBeTruthy();
  });

  it("C7B-8 · etapa desconocida: «Procesando comprobante» sin mostrar el código de la etapa", async () => {
    fetchSimulado(
      rutaBandeja(
        documento("doc-a", "VALIDATING", {
          processingJobs: [
            { id: "job-a", type: "VALIDATE", status: "RUNNING", stage: "ETAPA_NUEVA_X", progress: 40 },
          ],
        }),
      ),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByRole("heading", { name: "Procesando comprobante" })).toBeTruthy();
    expect(screen.queryByText(/ETAPA_NUEVA_X/)).toBeNull();
  });
});
