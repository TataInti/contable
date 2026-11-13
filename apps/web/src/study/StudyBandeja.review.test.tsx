// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { api, ApiError } from "../lib/api";
import { StudyBandeja } from "./StudyBandeja";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));
let testQueryClient: QueryClient | null = null;

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

const typedCorrectionValidCases = [
  { key: "voucherType", label: "Tipo de documento", input: "otro", expected: "otro" },
  { key: "letter", label: "Letra", input: "B", expected: "B" },
  { key: "pointOfSale", label: "Punto de venta", input: "00a04", expected: "0004" },
  { key: "voucherNumber", label: "Número", input: "00A012", expected: "00012" },
  { key: "issueDate", label: "Fecha", input: "2026-11-12", expected: "2026-11-12" },
  { key: "issuerTaxId", label: "CUIT emisor", input: "30123456789", expected: "30123456789" },
  { key: "receiverTaxId", label: "CUIT receptor", input: "30712345678", expected: "30712345678" },
  { key: "issuerName", label: "Razón social emisor", input: "Proveedor / sucursal 2", expected: "Proveedor / sucursal 2" },
  { key: "receiverName", label: "Razón social receptor", input: "Cliente, área compras", expected: "Cliente, área compras" },
  { key: "vatCondition", label: "Condición frente al IVA", input: "EXENTO", expected: "EXENTO" },
  { key: "netAmount", label: "Neto gravado", input: "1.234,56", expected: "1234.56" },
  { key: "nonTaxableAmount", label: "No gravado", input: "1.234,56", expected: "1234.56" },
  { key: "exemptAmount", label: "Exento", input: "1.234,56", expected: "1234.56" },
  { key: "totalAmount", label: "Total", input: "1.234,56", expected: "1234.56" },
  { key: "currency", label: "Moneda", input: "USD", expected: "USD" },
  { key: "cae", label: "CAE", input: "75123456789012", expected: "75123456789012" },
  { key: "caeExpiration", label: "Vencimiento del CAE", input: "2026-11-12", expected: "2026-11-12" },
] as const;

const typedCorrectionInvalidCases = [
  { key: "voucherType", label: "Tipo de documento", input: "Factura" },
  { key: "letter", label: "Letra", input: "Z" },
  { key: "pointOfSale", label: "Punto de venta", input: "---" },
  { key: "voucherNumber", label: "Número", input: "---" },
  { key: "issueDate", label: "Fecha", input: "2026-02-30" },
  { key: "issuerTaxId", label: "CUIT emisor", input: "1234567890", error: "El CUIT debe tener exactamente 11 dígitos." },
  { key: "receiverTaxId", label: "CUIT receptor", input: "123456789012", error: "El CUIT debe tener exactamente 11 dígitos." },
  { key: "vatCondition", label: "Condición frente al IVA", input: "Responsable inscripto" },
  { key: "netAmount", label: "Neto gravado", input: "no es un importe", error: "Ingresá un importe, por ejemplo 1.234,56" },
  { key: "nonTaxableAmount", label: "No gravado", input: "1.234,5,6", error: "Ingresá un importe, por ejemplo 1.234,56" },
  { key: "exemptAmount", label: "Exento", input: "10,3,5", error: "Ingresá un importe, por ejemplo 1.234,56" },
  { key: "totalAmount", label: "Total", input: "100 sin formato", error: "Ingresá un importe, por ejemplo 1.234,56" },
  { key: "currency", label: "Moneda", input: "EUR" },
  { key: "cae", label: "CAE", input: "1234567890123", error: "El CAE debe tener exactamente 14 dígitos." },
  { key: "caeExpiration", label: "Vencimiento del CAE", input: "12/11/2026" },
] as const;

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

async function openExtraction() {
  renderBandeja();
  fireEvent.click(await screen.findByRole("button", { name: /factura\.pdf/ }));
  return screen.findByRole("table", { name: "Datos fiscales extraídos" });
}

function useServerBackedDocumentMocks() {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/documents")) return Promise.resolve([structuredClone(documentFixture)]);
    if (path.endsWith("/documents/document-a/extraction")) return Promise.resolve(structuredClone(extractionFixture));
    if (path.endsWith("/documents/document-a")) return Promise.resolve(structuredClone(documentFixture));
    return Promise.resolve([]);
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  documentFixture.status = "EXTRACTED";
  documentFixture.processingJobs = [];
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
  testQueryClient?.clear();
  testQueryClient = null;
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

  it.each(typedCorrectionValidCases)(
    "corrige $key con el mismo control y formato canónico de la carga manual",
    async ({ key, label, input, expected }) => {
      Object.assign(extractionFixture, {
        fields: [{
          id: `field-${key}`,
          key,
          rawValue: "formato anterior",
          normalizedValue: "formato anterior",
          correction: null,
          confidence: 0.9,
          status: "ACCEPTED",
          reason: null,
        }],
      });

      await openExtraction();
      const control = screen.getByLabelText(label);
      fireEvent.change(control, { target: { value: input } });
      fireEvent.blur(control);

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(
          `/firms/firm-a/clients/client-a/extractions/extraction-a/fields/field-${key}`,
          { correction: expected, reason: "Corrección manual en bandeja" },
        ),
      );
    },
  );

  it.each(typedCorrectionInvalidCases)(
    "no envía una corrección inválida de $key y comunica el formato cuando el control lo admite",
    async (testCase) => {
      const { key, label, input } = testCase;
      const error = "error" in testCase ? testCase.error : undefined;
      Object.assign(extractionFixture, {
        fields: [{
          id: `field-${key}`,
          key,
          rawValue: "formato anterior",
          normalizedValue: "formato anterior",
          correction: null,
          confidence: 0.9,
          status: "ACCEPTED",
          reason: null,
        }],
      });

      await openExtraction();
      const control = screen.getByLabelText(label);
      fireEvent.change(control, { target: { value: input } });
      if (error) expect(await screen.findByText(error)).toBeTruthy();
      fireEvent.blur(control);

      expect(api.patch).not.toHaveBeenCalled();
    },
  );

  it("conserva el control de texto libre para IVA por fila fuera de las 17 claves tipadas", async () => {
    Object.assign(extractionFixture, {
      fields: [{
        id: "field-vat-rate",
        key: "vatRate",
        rawValue: "21",
        normalizedValue: "21",
        correction: null,
        confidence: 0.9,
        status: "ACCEPTED",
        reason: null,
      }],
    });

    await openExtraction();
    const control = screen.getByLabelText("Alícuota de IVA") as HTMLInputElement;
    expect(control.type).toBe("text");
    fireEvent.change(control, { target: { value: "21 por ciento" } });
    fireEvent.blur(control);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/firms/firm-a/clients/client-a/extractions/extraction-a/fields/field-vat-rate",
        { correction: "21 por ciento", reason: "Corrección manual en bandeja" },
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

  it("guarda en bloque, recarga del servidor y muestra el dato manual antes de habilitar Aprobar", async () => {
    Object.assign(extractionFixture, {
      voucherData: null,
      fields: [],
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
    });
    let persistedFields: {
      id: string;
      key: string;
      rawValue: string | null;
      normalizedValue: string | null;
      correction: string | null;
      method: string;
      confidence: number;
      status: string;
      reason: string | null;
    }[] = [];
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path.endsWith("/documents")) return Promise.resolve([documentFixture]);
      if (path.endsWith("/documents/document-a/extraction"))
        return Promise.resolve({ ...structuredClone(extractionFixture), fields: structuredClone(persistedFields) });
      if (path.endsWith("/documents/document-a")) return Promise.resolve(documentFixture);
      return Promise.resolve([]);
    }) as never);
    vi.mocked(api.put).mockImplementation((async (_path: string, body: { fields: { key: string; value: string }[] }) => {
      persistedFields = body.fields.map((field, index) => ({
        id: `field-manual-${index}`,
        key: field.key,
        rawValue: null,
        normalizedValue: null,
        correction: field.value,
        method: "HUMAN",
        confidence: 0,
        status: "CORRECTED",
        reason: null,
      }));
      return { status: "NEEDS_REVIEW", savedCount: body.fields.length, addedCount: body.fields.length };
    }) as never);

    await openExtraction();
    const loadButtons = screen.getAllByRole("button", { name: "Cargar datos a mano" });
    expect(loadButtons).toHaveLength(2);
    fireEvent.click(loadButtons[0]!);
    const dialog = screen.getByRole("dialog", { name: "Cargar datos a mano" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "  1.234,56  " },
    });
    const extractionReadsBeforeSave = vi.mocked(api.get).mock.calls.filter(([path]) =>
      path.endsWith("/documents/document-a/extraction"),
    ).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Datos guardados: 1 campo.")).toBeTruthy();
    await waitFor(() => {
      const extractionReadsAfterSave = vi.mocked(api.get).mock.calls.filter(([path]) =>
        path.endsWith("/documents/document-a/extraction"),
      ).length;
      expect(extractionReadsAfterSave).toBeGreaterThan(extractionReadsBeforeSave);
      expect(within(screen.getByRole("table", { name: "Datos fiscales extraídos" })).getByText("1234.56")).toBeTruthy();
      expect(within(screen.getByRole("table", { name: "Datos fiscales extraídos" })).getByText("cargado a mano")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Aprobar extracción" }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(api.put).toHaveBeenCalledWith(
      "/firms/firm-a/clients/client-a/extractions/extraction-a/fields",
      { fields: [{ key: "totalAmount", value: "1234.56" }] },
    );
  });

  it("mantiene el modal y los datos escritos cuando falla el guardado manual", async () => {
    Object.assign(extractionFixture, {
      voucherData: null,
      fields: [],
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
    });
    vi.mocked(api.put).mockRejectedValue(new Error("Falla de red"));

    await openExtraction();
    fireEvent.click(screen.getAllByRole("button", { name: "Cargar datos a mano" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Cargar datos a mano" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Campo de la fila 1" }), {
      target: { value: "totalAmount" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Valor de la fila 1" }), {
      target: { value: "123.00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Cargar datos a mano" })).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: "Valor de la fila 1" }) as HTMLInputElement).value).toBe("123.00");
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeTruthy();
  });

  it("oculta la carga manual sin el permiso document.review", async () => {
    Object.assign(extractionFixture, {
      voucherData: null,
      fields: [],
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
    });
    contextMock.current = { ...contextMock.current, capabilities: new Set(["client.read"]) };

    await openExtraction();

    expect(screen.queryByRole("button", { name: "Cargar datos a mano" })).toBeNull();
  });

  it.each(["GENERATED", "NEEDS_REVIEW"] as const)(
    "muestra Releer con IA cuando la extracción está en %s y tiene el permiso",
    async (status) => {
      extractionFixture.status = status;
      await openExtraction();
      expect(screen.getByRole("button", { name: "Releer con IA" })).toBeTruthy();
    },
  );

  it("no ofrece relectura para una extracción aprobada", async () => {
    documentFixture.status = "REVIEWED";
    extractionFixture.status = "REVIEWED";
    await openExtraction();
    expect(screen.queryByRole("button", { name: "Releer con IA" })).toBeNull();
  });

  it("no ofrece relectura para un documento rechazado", async () => {
    documentFixture.status = "EXTRACTION_FAILED";
    extractionFixture.status = "FAILED";
    renderBandeja();
    fireEvent.click(await screen.findByRole("button", { name: /factura\.pdf/ }));
    await screen.findByRole("heading", { name: "Procesando comprobante" });
    expect(screen.queryByRole("button", { name: "Releer con IA" })).toBeNull();
  });

  it("oculta Releer con IA sin el permiso document.review", async () => {
    contextMock.current = { ...contextMock.current, capabilities: new Set(["client.read"]) };
    await openExtraction();
    expect(screen.queryByRole("button", { name: "Releer con IA" })).toBeNull();
  });

  it("confirma la relectura, advierte sobre los campos manuales y no envía sus valores", async () => {
    Object.assign(extractionFixture, {
      fields: [
        { ...extractionFixture.fields[0], method: "HUMAN", correction: "20123456780" },
        { ...extractionFixture.fields[1], method: "VISION", correction: "10:16:00" },
      ],
    });
    vi.mocked(api.post).mockResolvedValue({ status: "QUEUED", processingJobId: "job-reprocess-a" } as never);
    await openExtraction();

    fireEvent.click(screen.getByRole("button", { name: "Releer con IA" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Releer el documento con IA?" });
    const description = within(dialog).getByText(/Se volverá a leer el documento con IA\./).textContent ?? "";
    expect(description).toContain("La lectura anterior y lo que cargaste a mano se conservan en el historial.");
    expect(description).toContain("Tiene 2 campos cargados o corregidos a mano: no se copian a la lectura nueva; podés volver a cargarlos.");
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Releer con IA" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/firms/firm-a/clients/client-a/documents/document-a/reprocess"),
    );
    expect(vi.mocked(api.post).mock.calls[0]?.length).toBe(1);
  });

  it("muestra Releyendo mientras corre y recarga la lectura vigente al terminar", async () => {
    useServerBackedDocumentMocks();
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path.endsWith("/reprocess")) {
        documentFixture.status = "VALIDATING";
        documentFixture.processingJobs = [{
          id: "job-reprocess-a",
          type: "REPROCESS",
          status: "QUEUED",
          progress: 0,
        }];
        return { status: "QUEUED", processingJobId: "job-reprocess-a" };
      }
      return {};
    }) as never);
    await openExtraction();
    fireEvent.click(screen.getByRole("button", { name: "Releer con IA" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Releer el documento con IA?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Releer con IA" }));

    await screen.findByRole("heading", { name: "Releyendo…" });
    expect((screen.getByRole("button", { name: "Releyendo…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      documentFixture.status = "EXTRACTED";
      documentFixture.processingJobs[0]!.status = "SUCCEEDED";
      extractionFixture.id = "extraction-b";
      extractionFixture.voucherData = {
        ...extractionFixture.voucherData,
        total: "999.00",
      };
      await testQueryClient!.invalidateQueries({
        queryKey: ["document", "firm-a", "client-a", "document-a"],
      });
    });

    const table = await screen.findByRole("table", { name: "Datos fiscales extraídos" });
    await waitFor(() => expect(within(table).getByText("999.00")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Releer con IA" })).toBeTruthy();
  });

  it.each([
    { status: 409, code: "REPROCESS_IN_PROGRESS", message: "Ya hay una lectura en curso. Esperá a que termine." },
    { status: 429, code: "REPROCESS_LIMIT_REACHED", message: "Se alcanzó el máximo de relecturas por hora." },
  ])("muestra el error $status de la API al releer", async ({ status, code, message }) => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(code, message, status));
    await openExtraction();
    fireEvent.click(screen.getByRole("button", { name: "Releer con IA" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Releer el documento con IA?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Releer con IA" }));

    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });
});
