// @vitest-environment jsdom
// Caracterización del detalle de la Bandeja antes de moverlo (Foco 7b.3a). Fija lo que hace hoy, defectos
// incluidos. Cada aserción que el corte cambia lleva «// vigente: defecto 7b-N» y se reemplaza en su bloque.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import {
  ERROR_SERVIDOR,
  PENDIENTE,
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

const ARCHIVO_EN_CUARENTENA = [
  {
    id: "fv-doc-b",
    originalName: "factura.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    bucket: "quarantine",
    antivirusStatus: "PENDING",
  },
];

/** Abre el documento de la lista (la fila lleva el nombre del archivo). */
async function abrirFactura() {
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
}

describe("StudyBandeja · caracterización del detalle (7b.3a, antes de mover nada)", () => {
  beforeEach(() => {
    contextMock.current = contexto();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("K7 · «Abrir el más reciente» abre el documento de la lista", async () => {
    // 07-3: un documento «Para revisar» se abre solo; el panel vacío queda para los que no lo están.
    fetchSimulado(rutaBandeja(documento("doc-a", "REVIEWED")));
    renderBandeja(clienteComoApp());
    expect(await screen.findByText("Elegí un documento")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir el más reciente" }));
    expect(await screen.findByRole("heading", { name: "factura.pdf" })).toBeTruthy();
  });

  it("K7 · mientras el detalle no responde dice «Abriendo documento…»", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED"), { detalle: PENDIENTE }));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("Abriendo documento…")).toBeTruthy();
  });

  it("K7 · con el documento cargado muestra el nombre, «Ingresó» y «Ver archivo»", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByRole("heading", { name: "factura.pdf" })).toBeTruthy();
    expect(screen.getByText(/Ingresó 31\/10\/2026 09:00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver archivo" })).toBeTruthy();
  });

  it("K7 · «Ver archivo» no aparece mientras el archivo no está listo", async () => {
    fetchSimulado(
      rutaBandeja(documento("doc-a", "UPLOADED", { fileVersions: ARCHIVO_EN_CUARENTENA })),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByRole("heading", { name: "Procesando comprobante" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver archivo" })).toBeNull();
  });

  it("K7 · «Ver archivo» llama a la vista previa y abre la URL firmada", async () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    fireEvent.click(await screen.findByRole("button", { name: "Ver archivo" }));
    await waitFor(() =>
      expect(abrir).toHaveBeenCalledWith(
        "https://minio.local/vista-demo",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("K7 · error al abrir el documento: «No se pudo abrir el documento» con «Reintentar»", async () => {
    let detalle: Respuesta = ERROR_SERVIDOR;
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED"), { detalle: () => detalle }));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("No se pudo abrir el documento")).toBeTruthy();
    detalle = { status: 200, cuerpo: { data: documento("doc-a", "EXTRACTED") } };
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "factura.pdf" })).toBeTruthy();
  });

  it("K7 · si la vista previa falla, «Ver archivo» avisa «No se pudo abrir el archivo.» (defecto 7b-4 corregido)", async () => {
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
    // Corregido en 7b.3a (defecto 7b-4): antes no había aviso.
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("No se pudo abrir el archivo.");
    expect(abrir).not.toHaveBeenCalled();
  });

  it.each(["UPLOADED", "VALIDATING"])(
    "K8 · %s (en curso): «Procesando comprobante» con la barra y sin botones de revisión",
    async (estado) => {
      fetchSimulado(rutaBandeja(documento("doc-a", estado, { fileVersions: ARCHIVO_EN_CUARENTENA })));
      renderBandeja(clienteComoApp());
      await abrirFactura();
      expect(await screen.findByRole("heading", { name: "Procesando comprobante" })).toBeTruthy();
      expect(document.querySelector(".processing-state__track")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Aprobar extracción" })).toBeNull();
    },
  );

  // Corregido en 7b.3a (defecto 7b-2): cada estado de error dice qué pasó, no «Procesando comprobante».
  it.each([
    ["EXTRACTION_FAILED", "Documento rechazado"],
    ["INFECTED", "Se detectó una amenaza en el archivo"],
    ["FAILED", "El procesamiento no terminó"],
    ["CANCELED", "El procesamiento no terminó"],
  ])("K8 · %s (defecto 7b-2 corregido): dice «%s»", async (estado, titulo) => {
    fetchSimulado(rutaBandeja(documento("doc-a", estado)));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText(titulo)).toBeTruthy();
    expect(screen.queryByText("Procesando comprobante")).toBeNull();
  });

  it("K9 · con la extracción cargando dice «Recuperando campos extraídos…»", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED"), { extraccion: PENDIENTE }));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("Recuperando campos extraídos…")).toBeTruthy();
  });

  it("K9 · con datos muestra «Revisá contra el comprobante» y el conteo de campos corregibles", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByRole("heading", { name: "Revisá contra el comprobante" })).toBeTruthy();
    expect(screen.getByText("1 campos corregibles")).toBeTruthy();
  });

  it("K9 · error 500 de la extracción: aviso «No se pudo cargar la extracción» (defecto 7b-1 corregido)", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTED"), { extraccion: ERROR_SERVIDOR }));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("No se pudo cargar la extracción")).toBeTruthy();
    expect(screen.queryByText("La extracción todavía no está disponible")).toBeNull();
  });

  it("K11 · sin datos leídos ni corregidos, «Aprobar extracción» está deshabilitado y lo dice", async () => {
    fetchSimulado(
      rutaBandeja(documento("doc-a", "EXTRACTED"), {
        extraccion: { status: 200, cuerpo: { data: extraccion({ conDatos: false }) } },
      }),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    const aprobar = (await screen.findByRole("button", {
      name: "Aprobar extracción",
    })) as HTMLButtonElement;
    expect(aprobar.disabled).toBe(true);
    expect(screen.getByText("Cargá al menos un dato para aprobar.")).toBeTruthy();
  });

  it("K11 · si «Aprobar extracción» falla, avisa con el mensaje de la API (defecto 7b-3 corregido)", async () => {
    const fetchMock = fetchSimulado(
      rutaBandeja(documento("doc-a", "EXTRACTED"), {
        aprobar: {
          status: 409,
          cuerpo: { error: { code: "EXTRACTION_STATE_CHANGED", message: "La extracción cambió." } },
        },
      }),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar extracción" }));
    const dialogo = await screen.findByRole("alertdialog", { name: "¿Aprobar la extracción?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aprobar extracción" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).endsWith("/approve") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    // Corregido en 7b.3a (defecto 7b-3): antes no había aviso.
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("No se pudo aprobar la extracción");
    expect(aviso.textContent).toContain("La extracción cambió.");
  });
});
