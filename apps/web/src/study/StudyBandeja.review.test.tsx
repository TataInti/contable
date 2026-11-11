// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api } from "../lib/api";
import { StudyBandeja } from "./StudyBandeja";

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

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
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

const documentFixture = {
  id: "document-a",
  status: "EXTRACTED",
  createdAt: "2026-10-31T12:00:00.000Z",
  category: null,
  direction: null,
  fileVersions: [{ originalName: "factura.pdf", mimeType: "application/pdf", bucket: "originals" }],
};

const extractionFixture = {
  id: "extraction-a",
  status: "NEEDS_REVIEW",
  reviewReason: null,
  voucherData: {
    tipo_documento: "factura",
    letra: "A",
    punto_venta: "0004",
    numero: "00001234",
    fecha: "2026-10-31",
    hora: "10:15:00",
    cuit_emisor: "20123456786",
    cuit_receptor: "30712345678",
    razon_social_emisor: "Proveedor S.A.",
    razon_social_receptor: "Cliente S.R.L.",
    condicion_iva: "Responsable inscripto",
    neto_gravado: "1000.00",
    iva: [{ alicuota: "21", importe: "210.00" }],
    no_gravado: "0.00",
    exento: "0.00",
    percepciones: [{ tipo: "IIBB", importe: "15.00" }],
    total: "1225.00",
    moneda: "ARS",
    cae: "12345678901234",
    cae_vencimiento: "2026-11-10",
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
    {
      id: "field-time",
      key: "time",
      rawValue: "10:15:00",
      normalizedValue: "10:15:00",
      correction: null,
      confidence: 0.98,
      status: "ACCEPTED",
      reason: null,
    },
  ],
  items: [],
};

const extractionFixtureSnapshot = structuredClone(extractionFixture);

function renderBandeja() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyBandeja />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openExtraction() {
  renderBandeja();
  fireEvent.click(await screen.findByRole("button", { name: /factura\.pdf/ }));
  return screen.findByRole("table", { name: "Datos fiscales extraídos" });
}

beforeEach(() => {
  vi.clearAllMocks();
  documentFixture.status = "EXTRACTED";
  Object.assign(extractionFixture, structuredClone(extractionFixtureSnapshot));
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
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/documents")) return Promise.resolve([documentFixture]);
    if (path.endsWith("/documents/document-a/extraction")) return Promise.resolve(extractionFixture);
    if (path.endsWith("/documents/document-a")) return Promise.resolve(documentFixture);
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudyBandeja — revisión de extracción", () => {
  it("conserva las correcciones y la aprobación, y oculta campos fuera de la tabla fiscal", async () => {
    const table = await openExtraction();
    expect(within(table).getByText("Fecha")).toBeTruthy();
    expect(screen.queryByLabelText("time")).toBeNull();

    const cuit = screen.getByLabelText("CUIT emisor");
    fireEvent.change(cuit, { target: { value: "20123456780" } });
    fireEvent.blur(cuit);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/extractions/extraction-a/fields/field-cuit",
        { correction: "20123456780", reason: "Corrección manual en bandeja" },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Aprobar extracción" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Aprobar la extracción?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprobar extracción" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/extractions/extraction-a/approve",
      ),
    );
  });

  it("exige un motivo y permite cancelar el rechazo", async () => {
    await openExtraction();
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    const confirm = within(dialog).getByRole("button", { name: "Confirmar rechazo" }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "ILLEGIBLE" },
    });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "¿Rechazar este documento?" })).toBeNull();
    expect(api.post).not.toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/extractions/extraction-a/reject",
      expect.anything(),
    );
  });

  it("muestra aprobar y rechazar sólo con el permiso document.review", async () => {
    contextMock.current = {
      ...contextMock.current,
      capabilities: new Set(["client.read"]),
    };

    await openExtraction();

    expect(screen.queryByRole("button", { name: "Aprobar extracción" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });

  it("rechaza con motivo, saca el documento de Para revisar y muestra el motivo en el detalle", async () => {
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path.endsWith("/reject")) {
        documentFixture.status = "EXTRACTION_FAILED";
        extractionFixture.status = "FAILED";
        return { status: "FAILED" };
      }
      return {};
    }) as never);

    await openExtraction();
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "ILLEGIBLE" },
    });
    fireEvent.change(within(dialog).getByLabelText("Detalle (opcional)"), {
      target: { value: "El número no se distingue" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/extractions/extraction-a/reject",
        { reason: "Ilegible — El número no se distingue" },
      ),
    );
    expect(await screen.findByText("Motivo: Ilegible — El número no se distingue")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Para revisar/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /factura\.pdf/ })).toBeNull(),
    );
  });

  it("mantiene el diálogo abierto y comunica el error de la API", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Falla de red"));

    await openExtraction();
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Rechazar este documento?" });
    fireEvent.change(within(dialog).getByLabelText("Motivo del rechazo"), {
      target: { value: "OTHER" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar rechazo" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("No se pudo rechazar el documento. Volvé a intentarlo.");
    expect(screen.getByRole("dialog", { name: "¿Rechazar este documento?" })).toBeTruthy();
  });

  it("no permite aprobar una extracción sin datos y explica que la lectura no está activada", async () => {
    Object.assign(extractionFixture, {
      voucherData: null,
      fields: [],
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
    });

    await openExtraction();

    expect(screen.getByRole("status", { name: "Estado del documento" }).textContent).toContain(
      "La lectura automática no está activada para este documento.",
    );
    const approve = screen.getByRole("button", { name: "Aprobar extracción" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toBe("Cargá al menos un dato para aprobar.");
    const reject = screen.getByRole("button", { name: "Rechazar" }) as HTMLButtonElement;
    expect(reject.disabled).toBe(false);
  });

  it("habilita Aprobar cuando el revisor carga un dato a mano", async () => {
    Object.assign(extractionFixture, {
      voucherData: null,
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
      fields: [
        {
          id: "field-total",
          key: "totalAmount",
          rawValue: null,
          normalizedValue: null,
          correction: null,
          confidence: 0.2,
          status: "NEEDS_REVIEW",
          reason: null,
        },
      ],
    });

    await openExtraction();

    expect(
      (screen.getByRole("button", { name: "Aprobar extracción" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1210.00" } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Aprobar extracción" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("note")).toBeNull();
  });
});
