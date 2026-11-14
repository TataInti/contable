// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@contable/design-system";
import { FISCAL_BOOK_COLUMNS, FISCAL_BOOK_COLUMN_KEYS } from "@contable/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { ApiError, api, downloadFile } from "../lib/api";
import { FiscalBooksExportAction } from "./FiscalBooksExportAction";

// Datos sintéticos rotulados (cliente, período y comprobantes de prueba del corte 7b).
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
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
    downloadFile: vi.fn(),
  };
});

const FIRM = "firma-sintetica-7b";
const CLIENT = "cliente-sintetico-7b";
const PERIOD = "periodo-sintetico-7b";

const summaryFixture = {
  period: { id: PERIOD, label: "2026-10", startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z" },
  books: {
    purchases: {
      title: "Libro de compras",
      included: {
        count: 4,
        totals: { neto: "1000.00", iva21: "210.00", iva105: "0", iva27: "0", exento: "0", otrosTributos: "0", total: "14294.00" },
      },
      excluded: [
        { reason: "DRAFT", label: "Borrador: falta aprobarlo", count: 2 },
        { reason: "MISSING_EXCHANGE_RATE", label: "Moneda extranjera sin tipo de cambio cargado", count: 1 },
      ],
      excludedCount: 3,
    },
    sales: {
      title: "Libro de ventas",
      included: { count: 0, totals: { neto: "0", iva21: "0", iva105: "0", iva27: "0", exento: "0", otrosTributos: "0", total: "0" } },
      excluded: [],
      excludedCount: 0,
    },
  },
};

function setContext(overrides: Partial<ClientContextValue> = {}) {
  contextMock.current = {
    firmId: FIRM,
    clientId: CLIENT,
    periodId: PERIOD,
    isReady: true,
    capabilities: new Set(["tax.vouchers.read"]),
    hasClientAccess: () => true,
    setFirmId: () => {},
    setClientId: () => {},
    setPeriodId: () => {},
    ...overrides,
  };
}

function renderAction(periodId: string | null = PERIOD) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/legajo"]}>
          <Routes>
            <Route
              path="/legajo"
              element={<FiscalBooksExportAction periodId={periodId} periodLabel={periodId ? "IVA · 2026-10" : null} />}
            />
            <Route path="/bandeja" element={<p>Bandeja documental de prueba</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "Exportar libros" }));
  return screen.findByRole("dialog", { name: "Exportar libros" });
}

const downloadButton = () => screen.getByRole("button", { name: "Descargar libro" }) as HTMLButtonElement;

async function waitForDownloadEnabled() {
  await waitFor(() => expect(downloadButton().disabled).toBe(false));
}

beforeEach(() => {
  vi.resetAllMocks();
  setContext();
});

afterEach(() => {
  cleanup();
});

describe("Exportar libros en el Legajo", () => {
  it("abre con foco en el primer campo y Esc devuelve el foco al botón", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    renderAction();
    const trigger = screen.getByRole("button", { name: "Exportar libros" });
    trigger.focus();

    fireEvent.click(trigger);
    await openPanelDialogCheck();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Libro")));

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("por defecto: libro de compras, xlsx, orden por emisión ascendente y todas las columnas", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    renderAction();
    await openPanel();

    expect((screen.getByLabelText("Libro") as HTMLSelectElement).value).toBe("purchases");
    expect((screen.getByLabelText("Formato") as HTMLSelectElement).value).toBe("xlsx");
    expect((screen.getByLabelText("Ordenar por") as HTMLSelectElement).value).toBe("issuedOn");
    expect((screen.getByLabelText("Sentido del orden") as HTMLSelectElement).value).toBe("asc");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(FISCAL_BOOK_COLUMNS.length);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it("descarga con periodId, libro, formato, columnas y orden elegidos", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    vi.mocked(downloadFile).mockResolvedValue(undefined);
    renderAction();
    await openPanel();
    await waitForDownloadEnabled();

    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "csv" } });
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "total" } });
    fireEvent.change(screen.getByLabelText("Sentido del orden"), { target: { value: "desc" } });
    fireEvent.click(screen.getByLabelText("Exento"));
    fireEvent.click(downloadButton());

    expect(await screen.findByText("Libro de compras descargado en CSV (.csv).")).toBeTruthy();
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(downloadFile).mock.calls[0]?.[0]);
    const [path, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    expect(path).toBe(`/firms/${FIRM}/clients/${CLIENT}/fiscal-books/export`);
    expect(params.get("periodId")).toBe(PERIOD);
    expect(params.get("book")).toBe("purchases");
    expect(params.get("format")).toBe("csv");
    expect(params.get("columns")).toBe(FISCAL_BOOK_COLUMN_KEYS.filter((key) => key !== "exento").join(","));
    expect(params.get("sortBy")).toBe("total");
    expect(params.get("sortDir")).toBe("desc");
  });

  it("al desmarcar todas las columnas avisa y no descarga", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    renderAction();
    await openPanel();
    await waitForDownloadEnabled();

    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);

    expect(await screen.findByText("Elegí al menos una columna para descargar el libro.")).toBeTruthy();
    fireEvent.click(downloadButton());
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("muestra qué entra y qué queda afuera, con el motivo de cada grupo", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    renderAction();
    await openPanel();

    expect(await screen.findByText("Borrador: falta aprobarlo")).toBeTruthy();
    expect(screen.getByText("Moneda extranjera sin tipo de cambio cargado")).toBeTruthy();
    expect(screen.getByText("Borrador: falta aprobarlo").closest("tr")?.textContent).toContain("2");
    expect(screen.getByText("Entran").parentElement?.textContent).toContain("4");
    expect(screen.getByText("Quedan afuera").parentElement?.textContent).toContain("3");
  });

  it("un período sin comprobantes aprobados ofrece la salida a la Bandeja y no dice que está al día", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    renderAction();
    await openPanel();

    fireEvent.change(screen.getByLabelText("Libro"), { target: { value: "sales" } });

    expect(await screen.findByText("No hay comprobantes aprobados para este libro")).toBeTruthy();
    expect(downloadButton().disabled).toBe(true);
    expect(screen.getByText("No hay comprobantes aprobados para descargar en este libro.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/al día/i);

    fireEvent.click(screen.getByRole("button", { name: "Ir a la Bandeja documental" }));
    expect(await screen.findByText("Bandeja documental de prueba")).toBeTruthy();
  });

  it("muestra el error del servidor junto al control que lo origina", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    vi.mocked(downloadFile).mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "La solicitud contiene datos inválidos", 400, null, {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos",
        details: [{ path: ["format"], message: "format: indicá «xlsx» o «csv»" }],
      }),
    );
    renderAction();
    await openPanel();
    await waitForDownloadEnabled();

    fireEvent.click(downloadButton());

    const message = await screen.findByText("format: indicá «xlsx» o «csv»");
    const field = screen.getByLabelText("Formato").closest(".ds-field");
    expect(field?.contains(message)).toBe(true);
  });

  it("un rol sin tax.vouchers.read no ve la acción", () => {
    setContext({ capabilities: new Set(["client.read"]) });
    renderAction();

    expect(screen.queryByRole("button", { name: "Exportar libros" })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("sin período activo la acción queda deshabilitada con su motivo a la vista", () => {
    renderAction(null);

    const trigger = screen.getByRole("button", { name: "Exportar libros" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(screen.getByText("Elegí un período fiscal para exportar sus libros.")).toBeTruthy();
  });

  it("si el resumen falla, muestra el error con reintento y el panel sigue abierto", async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "Falló la consulta", 500))
      .mockResolvedValueOnce(summaryFixture);
    renderAction();
    await openPanel();

    expect(await screen.findByText("No se pudo cargar el resumen")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Exportar libros" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Borrador: falta aprobarlo")).toBeTruthy();
  });

  it("mientras descarga, el botón queda ocupado y no envía dos veces", async () => {
    vi.mocked(api.get).mockResolvedValue(summaryFixture);
    vi.mocked(downloadFile).mockReturnValue(new Promise<void>(() => {}));
    renderAction();
    await openPanel();
    await waitForDownloadEnabled();

    fireEvent.click(downloadButton());
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));

    const busy = document.querySelector<HTMLButtonElement>('button[aria-busy="true"]');
    expect(busy?.disabled).toBe(true);
    if (busy) fireEvent.click(busy);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });
});

async function openPanelDialogCheck() {
  expect(await screen.findByRole("dialog", { name: "Exportar libros" })).toBeTruthy();
}
