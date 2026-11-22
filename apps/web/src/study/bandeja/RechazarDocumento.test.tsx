// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { StudyBandeja } from "../StudyBandeja";
import { cambiarValor } from "../../test/elegirOpcion";

// Caracterización del cajón «¿Rechazar este documento?» (Foco 7b.1, prueba K12).
// Fija lo que hace hoy la pantalla antes y después de mover el rechazo a su archivo.
// Datos sintéticos: documento factura.pdf en EXTRACTED con extracción NEEDS_REVIEW.

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
let testQueryClient: QueryClient | null = null;

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

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
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

const BASE = "/firms/firm-a/clients/client-a";
const RECHAZO = `${BASE}/extractions/extraction-a/reject`;

const documentFixture = {
  id: "document-a",
  status: "EXTRACTED",
  createdAt: "2026-10-31T12:00:00.000Z",
  category: null,
  direction: null,
  fileVersions: [{ originalName: "factura.pdf", mimeType: "application/pdf", bucket: "originals" }],
  processingJobs: [] as { id: string; type: string; status: string; progress: number }[],
};

const extractionFixture = {
  id: "extraction-a",
  status: "NEEDS_REVIEW",
  schemaVersion: "voucher-ar-v2.1",
  ocrEngine: "multimodal-model",
  promptVersion: "vision-ar-v6",
  reviewReason: null,
  voucherData: {
    tipo_documento: "factura",
    letra: "A",
    punto_venta: "0004",
    numero: "00001234",
    fecha: "2026-10-31",
    cuit_emisor: "20123456786",
    total: "1225.00",
    moneda: "ARS",
    confianza: {},
  },
  fields: [
    {
      id: "field-cuit",
      key: "issuerTaxId",
      rawValue: "20123456786",
      normalizedValue: "20123456786",
      correction: null,
      confidence: 0.98,
      status: "ACCEPTED",
      reason: null,
    },
  ],
  items: [],
};

function fijarContexto() {
  contextMock.current = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(["client.read", "document.review"]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
}

function mockApi() {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/documents")) return Promise.resolve([structuredClone(documentFixture)]);
    if (path.endsWith("/documents/document-a/extraction")) {
      return Promise.resolve(structuredClone(extractionFixture));
    }
    if (path.endsWith("/documents/document-a"))
      return Promise.resolve(structuredClone(documentFixture));
    return Promise.resolve([]);
  }) as never);
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

async function abrirRechazo() {
  renderBandeja();
  fireEvent.click(await screen.findByRole("row", { name: /factura\.pdf/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
  return screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
}

const motivo = (dialog: HTMLElement) =>
  within(dialog).getByLabelText("Motivo del rechazo") as HTMLSelectElement;
const detalle = (dialog: HTMLElement) =>
  within(dialog).getByLabelText("Detalle (opcional)") as HTMLTextAreaElement;
const confirmar = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Confirmar rechazo" }) as HTMLButtonElement;

beforeEach(() => {
  vi.resetAllMocks();
  documentFixture.status = "EXTRACTED";
  fijarContexto();
  mockApi();
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
  testQueryClient = null;
});

describe("Caracterización K12 · rechazo: motivo, cancelar, motivo compuesto y error", () => {
  it("ofrece los cinco motivos después de «Elegí un motivo» y no confirma hasta elegir uno", async () => {
    const dialog = await abrirRechazo();
    const opciones = within(dialog)
      .getAllByRole("option")
      .map((option) => [option.getAttribute("value"), option.textContent]);
    expect(opciones).toEqual([
      ["", "Elegí un motivo"],
      ["ILLEGIBLE", "Ilegible"],
      ["DUPLICATE", "Duplicado"],
      ["NOT_A_VOUCHER", "No es un comprobante"],
      ["OTHER_CLIENT", "Datos de otro cliente"],
      ["OTHER", "Otro"],
    ]);
    expect(confirmar(dialog).disabled).toBe(true);
    cambiarValor(motivo(dialog), "OTHER");
    expect(confirmar(dialog).disabled).toBe(false);
  });

  it("sin detalle, envía solo el rótulo del motivo y lo muestra como recibo en el detalle", async () => {
    const dialog = await abrirRechazo();
    cambiarValor(motivo(dialog), "ILLEGIBLE");
    fireEvent.click(confirmar(dialog));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(RECHAZO, { reason: "Ilegible" }));
    expect(await screen.findByText("Motivo: Ilegible")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "¿Rechazar este documento?" })).toBeNull();
  });

  it("recorta el detalle, admite hasta 450 caracteres y lo une al motivo con « — »", async () => {
    const dialog = await abrirRechazo();
    expect(detalle(dialog).maxLength).toBe(450);
    cambiarValor(motivo(dialog), "ILLEGIBLE");
    cambiarValor(detalle(dialog), "   El número no se distingue   ");
    fireEvent.click(confirmar(dialog));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(RECHAZO, {
        reason: "Ilegible — El número no se distingue",
      }),
    );
    expect(await screen.findByText("Motivo: Ilegible — El número no se distingue")).toBeTruthy();
  });

  it("cancelar no envía; al volver a abrir, motivo y detalle empiezan en blanco", async () => {
    let dialog = await abrirRechazo();
    cambiarValor(motivo(dialog), "OTHER");
    cambiarValor(detalle(dialog), "Dato sin confirmar");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "¿Rechazar este documento?" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    expect(motivo(dialog).value).toBe("");
    expect(detalle(dialog).value).toBe("");
    expect(confirmar(dialog).disabled).toBe(true);
  });

  it("un error de la API deja el cajón abierto con motivo y detalle escritos; al reabrir, el aviso desaparece", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Falla de red"));
    let dialog = await abrirRechazo();
    cambiarValor(motivo(dialog), "OTHER");
    cambiarValor(detalle(dialog), "Revisar con el cliente");
    fireEvent.click(confirmar(dialog));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "No se pudo rechazar el documento. Volvé a intentarlo.",
    );
    expect(motivo(dialog).value).toBe("OTHER");
    expect(detalle(dialog).value).toBe("Revisar con el cliente");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("mientras el rechazo se envía, «Confirmar rechazo» sigue enfocable y marcado como ocupado", async () => {
    vi.mocked(api.post).mockImplementation((() => new Promise(() => {})) as never);
    const dialog = await abrirRechazo();
    cambiarValor(motivo(dialog), "DUPLICATE");
    fireEvent.click(confirmar(dialog));
    // vigente: cambia con 7b.3c correcciones (D1): antes el botón se deshabilitaba y el foco caía en BODY
    await waitFor(() => expect(confirmar(dialog).getAttribute("aria-busy")).toBe("true"));
    expect(confirmar(dialog).disabled).toBe(false);
    expect(api.post).toHaveBeenCalledWith(RECHAZO, { reason: "Duplicado" });
  });
});
