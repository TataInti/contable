// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api } from "../lib/api";
import { StudyExpedienteMensual } from "./StudyExpedienteMensual";
import { abrirListado, cambiarValor } from "../test/elegirOpcion";

const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: null,
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

const taxPeriod = {
  id: "period-a",
  taxTypeId: "tax-type-a",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  label: "2026-10",
  taxType: { name: "Ingresos Brutos", isActive: true },
};

function workpaper(status: string, controls: unknown[] = []) {
  return {
    id: "wp-a",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    revision: 1,
    status,
    // Un mes calculado tiene huella de entradas (el cálculo la genera); sin ella el cálculo figura desactualizado.
    inputHash: status === "CALCULATED" ? "hash-demo" : null,
    outputHash: null,
    settlements: [],
    controls,
  };
}

function sourceCoverage(present: boolean) {
  return {
    code: "DGR_IIBB_TUC",
    label: "Ingresos Brutos Tucumán",
    required: true,
    present,
    count: present ? 4 : 0,
    taxTypeId: "tax-type-a",
    periodId: "period-a",
    origin: "DGR_IIBB",
    adapterVersion: "DGR_IIBB_V1",
    expectedColumns: ["fecha", "importe"],
    batches: [
      {
        id: "source-link-a",
        importBatchId: "import-batch-a",
        fileName: "lote-octubre.csv",
        batchStatus: "COMMITTED",
        reviewStatus: present ? "REVIEWED" : "PENDING_REVIEW",
        totalRows: 4,
        validRows: 4,
        errorRows: 0,
        snapshotHash: null,
        reviewedAt: present ? "2026-11-01T00:00:00.000Z" : null,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  };
}

const pendingClassification = {
  id: "classification-a",
  voucherId: "voucher-a",
  direction: "PURCHASE" as const,
  counterpartyCuit: "20999999999",
  documentKind: "INVOICE" as const,
  categoryCode: null,
  activityCode: null,
  rateBuckets: [],
  status: "PENDING" as const,
  origin: null,
  voucher: {
    type: "FACTURA",
    letter: "A",
    pointOfSale: 1,
    number: 1,
    issuedOn: "2026-10-10",
    total: "1000",
  },
};

const pendingAllocation = {
  id: "allocation-a",
  sourceCode: "DGR_IIBB_TUC",
  sourceType: "WITHHOLDING" as const,
  amount: "100",
  status: "PENDING" as const,
  allocatedJurisdiction: null,
  certificate: {
    cuitAgent: "20123456789",
    certificateNumber: "CERT-1",
    creditKind: "WITHHOLDING",
    issuedOn: "2026-10-10",
    sourceAmount: "100",
  },
  obligation: {
    regime: {
      name: "IIBB Tucumán",
      isActive: true,
      taxType: { name: "Ingresos Brutos", isActive: true },
      jurisdiction: { name: "Tucumán", isActive: true },
    },
    period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
  },
};

function mockPageApi({
  status = "COLLECTING_INPUTS",
  sourcePresent = false,
  classifications = { total: 0, classified: 0, pending: 0, ready: true, items: [] },
  allocations = { total: 0, allocated: 0, pending: 0, ready: true, items: [] },
  controls = [],
  documents = [],
}: {
  status?: string;
  sourcePresent?: boolean;
  classifications?: unknown;
  allocations?: unknown;
  controls?: unknown[];
  documents?: unknown[];
} = {}) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/tax-periods")) return Promise.resolve([taxPeriod]);
    if (path.includes("/monthly-tax-workpapers?")) return Promise.resolve([workpaper(status, controls)]);
    if (path.endsWith("/documents")) return Promise.resolve(documents);
    if (path.endsWith("/coverage")) {
      return Promise.resolve({
        components: [
          {
            obligationId: "obligation-a",
            regimeCode: "IIBB_LOCAL_TUC",
            taxTypeCode: "IIBB",
            required: true,
            linked: true,
            settlementStatus: null,
          },
        ],
        sources: [sourceCoverage(sourcePresent)],
      });
    }
    if (path.endsWith("/classifications")) return Promise.resolve(classifications);
    if (path.endsWith("/allocations")) return Promise.resolve(allocations);
    if (path.endsWith("/calculation")) return Promise.resolve([]);
    if (path.endsWith("/clients/client-a")) {
      return Promise.resolve({ id: "client-a", cuit: "20999999998" });
    }
    return Promise.resolve([]);
  }) as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.del).mockResolvedValue({} as never);
  vi.mocked(api.postWithHeaders).mockResolvedValue({} as never);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyExpedienteMensual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openSourcesStage() {
  fireEvent.click(await screen.findByRole("tab", { name: /Fuentes/ }));
}

let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | undefined;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("contable:firm-a:client-a:selected-tax-period", "period-a");
  contextMock.current = {
    firmId: "firm-a",
    clientId: "client-a",
    periodId: "period-a",
    isReady: true,
    capabilities: new Set([
      "client.read",
      "tax.settlements.calculate",
      "tax.settlements.submit_review",
      "tax.settlements.review",
      "tax.settlements.finalize",
      "tax.settlements.rectify",
      "tax.vouchers.prepare",
      "tax.vouchers.review",
      "tax.payments.record",
      "tax.filings.record",
    ]),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  };
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  mockPageApi();
});

afterEach(() => {
  cleanup();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  vi.restoreAllMocks();
});

describe("StudyExpedienteMensual", () => {
  it("ofrece evidencia REVIEWED y habilita Resolver con explicación y respaldo", async () => {
    const control = {
      id: "control-reviewed",
      code: "BOOK_RATE_RECONCILIATION",
      severity: "BLOCKING",
      status: "OPEN",
      expected: null,
      actual: null,
      tolerance: null,
      evidenceDocumentId: null,
      resolution: null,
    };
    mockPageApi({
      status: "REVIEWED",
      controls: [control],
      documents: [
        {
          id: "document-reviewed",
          category: "INVOICE",
          status: "REVIEWED",
          createdAt: "2026-11-01T00:00:00.000Z",
          fileVersions: [{ originalName: "factura-revisada.pdf" }],
        },
        {
          id: "document-extracted",
          category: "INVOICE",
          status: "EXTRACTED",
          createdAt: "2026-11-01T00:00:00.000Z",
          fileVersions: [{ originalName: "factura-extraida.pdf" }],
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Controles/ }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Diferencias de libro por alícuota/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolver" }));

    const evidence = await screen.findByRole("combobox", {
      name: "Evidencia BOOK_RATE_RECONCILIATION",
    });
    expect(
      within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).getByRole("option", { name: "factura-revisada.pdf · Revisado" }),
    ).toBeTruthy();
    expect(within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).queryByRole("option", { name: /factura-extraida\.pdf/ })).toBeNull();

    cambiarValor(screen.getByRole("textbox", { name: "Motivo" }), "Respaldo revisado y conciliado");
    cambiarValor(evidence, "document-reviewed");
    const resolveButton = screen.getByRole("button", { name: "Confirmar resolución" }) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(false);
    fireEvent.click(resolveButton);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/controls/control-reviewed/resolve"),
        {
          resolution: "Respaldo revisado y conciliado",
          status: "RESOLVED",
          evidenceDocumentId: "document-reviewed",
        },
      ),
    );
  });

  it("explica cómo habilitar evidencia cuando solo hay documentos extraídos", async () => {
    mockPageApi({
      controls: [
        {
          id: "control-open",
          code: "BOOK_RATE_RECONCILIATION",
          severity: "BLOCKING",
          status: "OPEN",
          expected: null,
          actual: null,
          tolerance: null,
          evidenceDocumentId: null,
          resolution: null,
        },
      ],
      documents: [
        {
          id: "document-extracted",
          category: "INVOICE",
          status: "EXTRACTED",
          createdAt: "2026-11-01T00:00:00.000Z",
          fileVersions: [{ originalName: "factura-extraida.pdf" }],
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Controles/ }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir Diferencias de libro por alícuota/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolver" }));

    const evidence = await screen.findByRole("combobox", {
      name: "Evidencia BOOK_RATE_RECONCILIATION",
    });
    const explanation = await screen.findByText(
      "El respaldo es opcional. Para adjuntar uno, aprobá la extracción del documento en Bandeja.",
    );
    expect(evidence.closest(".ds-field")?.parentElement?.contains(explanation)).toBe(true);
    expect(within(abrirListado("Evidencia BOOK_RATE_RECONCILIATION")).queryByRole("option", { name: /factura-extraida\.pdf/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Confirmar resolución" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("muestra el error de la acción actual, enfoca y desplaza el detalle de ApiError", async () => {
    mockPageApi({ status: "READY_TO_CALCULATE", sourcePresent: true });
    const validationError = new ApiError(
      "VALIDATION_ERROR",
      "La solicitud contiene datos inválidos",
      422,
      null,
      { details: [{ path: ["validFrom"], message: "Required" }] },
    );
    vi.mocked(api.post).mockImplementation(((path: string) => {
      if (path.endsWith("/monthly-tax-workpapers")) {
        return Promise.reject(new Error("Error anterior al crear el legajo"));
      }
      if (path.endsWith("/calculate")) return Promise.reject(validationError);
      return Promise.resolve({});
    }) as never);
    renderPage();

    // El botón del encabezado aparece deshabilitado hasta que carga el período
    // fiscal: esperamos a que esté habilitado antes de accionar.
    fireEvent.click(await screen.findByRole("button", { name: "Acciones del período" }));
    const createButton = await screen.findByRole<HTMLButtonElement>("menuitem", { name: /Nuevo legajo/ });
    await waitFor(() => expect(createButton.getAttribute("aria-disabled")).not.toBe("true")); // vigente: cambia con A29
    fireEvent.click(createButton);
    expect(await screen.findByText("Error anterior al crear el legajo")).toBeTruthy();

    const calculateButton = await screen.findByRole("button", { name: "Calcular liquidación" }); // vigente: cambia con decisión de Ciro (16-nov, 49a)
    fireEvent.click(calculateButton);

    const currentError = await screen.findByText("Vigencia desde: Campo obligatorio");
    expect(currentError).toBeTruthy();
    const currentAlert = currentError.closest('[role="alert"]');
    expect(currentAlert).not.toBeNull();
    const actionError = currentAlert?.closest(".workpaper-action-error");
    if (!actionError) throw new Error("No se encontró el contenedor de error de Calcular");
    expect(actionError.closest('[data-renglon="avisos"]')).not.toBeNull(); // vigente: cambia con A29 (el error va en el renglón de avisos, bajo la acción)
    await waitFor(() => expect(document.activeElement).toBe(actionError));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" });
    expect(screen.getByText("Error anterior al crear el legajo")).toBeTruthy();
  });

  it("no vuelve a ofrecer la presentación de un impuesto ya presentado", async () => {
    mockPageApi({ status: "FINALIZED" });
    const base = vi.mocked(api.get).getMockImplementation()!;
    const position = (obligationId: string, taxName: string, filedAt: string | null) => ({
      obligationId,
      status: filedAt ? "FILED" : "READY_TO_FILE",
      dueDate: "2026-11-20T00:00:00.000Z",
      filedAt,
      regime: {
        id: `regime-${obligationId}`,
        name: `Régimen ${taxName}`,
        isActive: true,
        taxType: { id: `tax-${obligationId}`, name: taxName, isActive: true },
        jurisdiction: { id: "jurisdiction-a", name: "Tucumán", isActive: true },
      },
      settlement: { id: `settlement-${obligationId}`, status: "FINALIZED", version: 1, totals: {} },
      accrued: "1000",
      paid: "0",
      pending: "1000",
      availableCredit: "0",
      interest: "0",
      totalPayable: "1000",
    });
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.includes("/tax-position")
        ? Promise.resolve([
            position("filed", "IVA", "2026-11-10T00:00:00.000Z"),
            position("open", "Ingresos Brutos", null),
          ])
        : base(path)) as never);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));

    expect(await screen.findByText(/Presentada el/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Registrar presentación" })).toHaveLength(1);
  });

  it("explica junto a Calcular qué fuentes obligatorias siguen sin revisar", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();

    const button = (await screen.findByRole("button", { name: "Calcular liquidación" })) as HTMLButtonElement; // vigente: cambia con decisión de Ciro (16-nov, 49a)
    expect(button.disabled).toBe(true);
    const explanation = await screen.findByText("Faltan fuentes obligatorias revisadas.");
    expect(explanation.closest('[data-renglon="avisos"]')).not.toBeNull(); // vigente: cambia con A29
  });

  it("muestra en Fuentes qué falta para calcular", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();
    await openSourcesStage();

    expect((await screen.findByText((_, element) => Boolean(element?.classList.contains("workpaper-source-readiness")))).textContent).toContain("Para calcular falta: Ingresos Brutos Tucumán");
    expect(screen.getByRole("button", { name: "Gestionar Ingresos Brutos Tucumán" })).toBeTruthy();
  });

  it("muestra el estado Pendiente sin códigos ni conteos técnicos", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();
    await openSourcesStage();

    const sourceTable = (await screen.findAllByRole("table"))[0]!;
    expect(within(sourceTable).getByText("Pendiente")).toBeTruthy();
    expect(within(sourceTable).queryByText("IIBB_RPI_TUC")).toBeNull();
    expect(within(sourceTable).queryByText("0")).toBeNull();
  });

  it("presenta los errores de clasificación e imputación junto a cada botón", async () => {
    mockPageApi({
      status: "COLLECTING_INPUTS",
      sourcePresent: true,
      classifications: { total: 1, classified: 0, pending: 1, ready: false, items: [pendingClassification] },
      allocations: { total: 1, allocated: 0, pending: 1, ready: false, items: [pendingAllocation] },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Clasificación/ }));

    const classifyButton = await screen.findByRole("button", { name: "Guardar" });
    fireEvent.click(classifyButton);
    const classificationError = await screen.findByText("Seleccioná el rubro de la compra");
    expect(classifyButton.closest("tr")?.contains(classificationError)).toBe(true);

    const reallocateButton = screen.getByRole("button", { name: "Reimputar" });
    fireEvent.click(reallocateButton);
    const allocationError = await screen.findByText("Seleccioná una jurisdicción para la imputación");
    expect(reallocateButton.closest("tr")?.contains(allocationError)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(allocationError.closest(".workpaper-action-error")));
  });

  // 4K: el resultado calculado no se queda con un mínimo que ya no es el que se cargó.
  const componenteCalculado = {
    role: "PRINCIPAL",
    required: true,
    obligationId: "obligation-a",
    habitual: true,
    usaMinimoDeclarado: true,
    minimoAnterior: null,
    obligation: {
      regimeCode: "IIBB_LOCAL_TUC",
      regimeName: "Contribuyente Local Tucumán",
      taxTypeCode: "IIBB",
      taxTypeName: "Ingresos Brutos",
      jurisdictionName: "Tucumán",
    },
    settlement: {
      id: "settlement-a",
      status: "CALCULATED",
      version: 1,
      totals: { BASE_TOTAL: "115000.00", IMPUESTO_POR_ACTIVIDAD: "4025.00", TOTAL_A_INGRESAR: "4025.00" },
      lines: [],
      differences: [],
      f931Inputs: [],
      minimo: null,
    },
  };

  function calculoConEstado(estadoInicial: string, alCalcular: string | null) {
    let estado = estadoInicial;
    mockPageApi({ status: estado });
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(((path: string) => {
      if (path.includes("/monthly-tax-workpapers?")) return Promise.resolve([workpaper(estado)]);
      if (path.endsWith("/calculation")) return Promise.resolve([componenteCalculado]);
      return base(path);
    }) as never);
    vi.mocked(api.post).mockImplementation(((path: string) => {
      if (path.endsWith("/calculate") && alCalcular) estado = alCalcular;
      return Promise.resolve({});
    }) as never);
  }

  it("después de calcular, cambiar el mínimo marca el resultado desactualizado y bloquea Enviar a revisión hasta recalcular", async () => {
    calculoConEstado("CHANGES_REQUESTED", "CALCULATED");
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Recalcular" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Enviar a revisión" }) as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.change(await screen.findByLabelText("Mínimo del mes"), { target: { value: "11180" } });

    expect(await screen.findByText("Cambiaste el mínimo: recalculá para actualizar el resultado.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enviar a revisión" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    await waitFor(() =>
      expect(screen.queryByText("Cambiaste el mínimo: recalculá para actualizar el resultado.")).toBeNull(),
    );
    expect((screen.getByRole("button", { name: "Enviar a revisión" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("en revisión, el mínimo y los impuestos no se modifican y se explica cómo hacerlo", async () => {
    calculoConEstado("IN_REVIEW", null);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Cálculo/ }));

    const minimo = (await screen.findByLabelText("Mínimo del mes")) as HTMLInputElement;
    expect(minimo.disabled).toBe(true);
    expect(screen.getByText(/Está en revisión: solicitá cambios para modificar/)).toBeTruthy();
  });
});

describe("StudyExpedienteMensual — aviso de cambio de actividad (brief 4L)", () => {
  const jurisdiccion = { name: "Tucumán", isActive: true };
  // Período del legajo: octubre 2026. La actividad anterior cierra el 30-09; la nueva rige desde el 01-10.
  const anterior = {
    id: "link-a",
    isPrimary: true,
    validFrom: "2026-01-01",
    validTo: "2026-09-30",
    activity: { id: "act-a", code: "101", name: "Venta de mercaderías", isActive: true, jurisdictionId: "jur-tuc", jurisdiction: jurisdiccion },
  };
  const cambio = (validFrom: string) => ({
    id: "link-b",
    isPrimary: true,
    validFrom,
    validTo: null,
    isChange: true,
    changeReason: "Suma de servicios",
    activity: { id: "act-b", code: "202", name: "Servicios de consultoría", isActive: true, jurisdictionId: "jur-tuc", jurisdiction: jurisdiccion },
  });

  function conActividades(links: unknown[]) {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.endsWith("/activities") ? Promise.resolve(links) : base(path)) as never);
  }

  it("avisa en Clasificación el cambio que empieza en el mes del legajo, sin bloquear", async () => {
    conActividades([anterior, cambio("2026-10-01")]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Clasificación/ }));
    expect(
      await screen.findByText("Desde octubre 2026 cambió la actividad de Venta de mercaderías a Servicios de consultoría: cambia la alícuota"),
    ).toBeTruthy();
    expect(screen.getByText("Es informativo y no bloquea el cálculo. Revisá la clasificación de las ventas de ese mes.")).toBeTruthy();
  });

  it("no avisa cuando el cambio empieza en otro mes", async () => {
    conActividades([anterior, cambio("2026-11-01")]);
    renderPage();
    const tab = await screen.findByRole("tab", { name: /Clasificación/ });
    fireEvent.click(tab);
    // Control: la etapa quedó abierta; así la ausencia del aviso no es por una pantalla sin renderizar.
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    expect(screen.queryByText(/cambió la actividad de/)).toBeNull();
  });
});
