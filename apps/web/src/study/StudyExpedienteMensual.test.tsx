// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api } from "../lib/api";
import { StudyExpedienteMensual } from "./StudyExpedienteMensual";

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

function workpaper(status: string) {
  return {
    id: "wp-a",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    revision: 1,
    status,
    inputHash: null,
    outputHash: null,
    settlements: [],
    controls: [],
  };
}

function sourceCoverage(present: boolean) {
  return {
    code: "DGR_IIBB_TUC",
    label: "DGR IIBB Tucumán",
    required: true,
    present,
    count: present ? 4 : 0,
    taxTypeId: "tax-type-a",
    periodId: "period-a",
    origin: "DGR",
    adapterVersion: "CSV_V1",
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
}: {
  status?: string;
  sourcePresent?: boolean;
  classifications?: unknown;
  allocations?: unknown;
} = {}) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.endsWith("/tax-periods")) return Promise.resolve([taxPeriod]);
    if (path.includes("/monthly-tax-workpapers?")) return Promise.resolve([workpaper(status)]);
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
        return Promise.reject(new Error("Error anterior al crear el expediente"));
      }
      if (path.endsWith("/calculate")) return Promise.reject(validationError);
      return Promise.resolve({});
    }) as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo expediente" }));
    expect(await screen.findByText("Error anterior al crear el expediente")).toBeTruthy();

    const calculateButton = await screen.findByRole("button", { name: "Calcular" });
    fireEvent.click(calculateButton);

    const currentError = await screen.findByText("Vigencia desde: Campo obligatorio");
    expect(currentError).toBeTruthy();
    const currentAlert = currentError.closest('[role="alert"]');
    expect(currentAlert).not.toBeNull();
    const actionError = currentAlert?.closest(".workpaper-action-error");
    if (!actionError) throw new Error("No se encontró el contenedor de error de Calcular");
    expect(calculateButton.parentElement?.contains(actionError)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(actionError));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" });
    expect(screen.getByText("Error anterior al crear el expediente")).toBeTruthy();
  });

  it("explica junto a Calcular qué fuentes obligatorias siguen sin revisar", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();

    const button = (await screen.findByRole("button", { name: "Calcular" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const explanation = await screen.findByText("Faltan fuentes obligatorias revisadas.");
    expect(button.parentElement?.contains(explanation)).toBe(true);
  });

  it("describe la acción pendiente como una liquidación sin calcular", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();
    await openSourcesStage();

    expect(await screen.findByText("Sin liquidación calculada")).toBeTruthy();
    expect(screen.queryByText("Pendiente de vincular")).toBeNull();
  });

  it("explica que Waiting inputs con cero registros cuenta solo lotes revisados", async () => {
    mockPageApi({ status: "COLLECTING_INPUTS", sourcePresent: false });
    renderPage();
    await openSourcesStage();

    const sourceTable = (await screen.findAllByRole("table"))[0]!;
    expect(within(sourceTable).getByText("Waiting inputs")).toBeTruthy();
    expect(within(sourceTable).getByText("0")).toBeTruthy();
    expect(
      screen.getByText(
        "La cobertura cuenta solo lotes revisados. Los lotes pendientes de revisión mantienen el conteo en 0 registros.",
      ),
    ).toBeTruthy();
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
});
