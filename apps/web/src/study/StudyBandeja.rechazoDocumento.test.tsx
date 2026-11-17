// @vitest-environment jsdom
// Caracterización previa a D23-1 (etapa 1): rechazo de documentos que fallaron al procesarse.
// Fija lo que hoy ofrece la Bandeja para cada estado. Lo que cambia con D23-1 lleva
// «vigente: cambia con D23-1» y se actualiza en el commit de la pantalla.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import {
  clienteComoApp,
  contexto,
  documento,
  fetchSimulado,
  renderBandeja,
  rutaBandeja,
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

describe("Caracterización · rechazo de documentos antes de D23-1", () => {
  beforeEach(() => {
    contextMock.current = contexto();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("vigente: cambia con D23-1 · un documento FAILED muestra «El procesamiento no terminó» y ofrece «Rechazar documento»", async () => {
    fetchSimulado(
      rutaBandeja(
        documento("doc-a", "FAILED", {
          processingJobs: [
            {
              id: "job-a",
              type: "VALIDATE",
              status: "FAILED",
              stage: null,
              progress: 100,
              error: "CHECKSUM_MISMATCH",
            },
          ],
        }),
      ),
    );
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("El procesamiento no terminó")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rechazar documento" })).toBeTruthy();
  });

  it("vigente, no cambia: un documento en VALIDATING sigue en «Procesando comprobante» sin acciones de rechazo", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "VALIDATING")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("Procesando comprobante")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rechazar/ })).toBeNull();
  });

  it("vigente, no cambia: un documento ya rechazado muestra «Documento rechazado» y ningún botón de rechazo", async () => {
    fetchSimulado(rutaBandeja(documento("doc-a", "EXTRACTION_FAILED")));
    renderBandeja(clienteComoApp());
    await abrirFactura();
    expect(await screen.findByText("Documento rechazado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rechazar/ })).toBeNull();
  });
});
