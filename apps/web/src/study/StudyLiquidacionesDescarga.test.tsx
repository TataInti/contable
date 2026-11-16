// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@contable/design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyLiquidaciones } from "./StudyLiquidaciones";

/*
 * Descarga del papel de trabajo desde Liquidaciones (corte liq-descarga, D7C-2 a).
 * El cliente HTTP es el real (lib/api.ts); solo se simula fetch, con respuestas sintéticas.
 */

vi.mock("../context/ClientContext", () => ({
  useClientContext: () => contextMock.current,
}));

const contextMock = { current: {} as ClientContextValue };

const FIRM = "firm-a";
const CLIENT = "client-a";
const PERIOD = "period-a";
const SETTLEMENT = "settlement-final";
const DRAFT = "settlement-draft";
const BASE = `/firms/${FIRM}/clients/${CLIENT}`;
const ARTIFACTS = `${BASE}/tax-settlements/${SETTLEMENT}/artifacts`;
const FILE_PDF = "liquidacion-iva-2026-10-v1.pdf";
const FULL = ["tax.settlements.read", "tax.settlements.export"];

type Reply = Response | Promise<Response>;
type Router = (method: string, path: string) => Reply | undefined;

const calls: string[] = [];
const downloads: string[] = [];
const originalClick = HTMLAnchorElement.prototype.click;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function file(content: string, type: string, name: string): Response {
  return new Response(content, {
    status: 200,
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` },
  });
}

function settlement(id: string, status: string, version: number) {
  return {
    id,
    version,
    status,
    cutoff: "2026-11-01T00:00:00.000Z",
    totals: { TOTAL_A_INGRESAR: "1000" },
    period: {
      id: PERIOD,
      label: "Octubre 2026",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-31T00:00:00.000Z",
    },
    regime: {
      code: "IVA_GENERAL",
      name: "IVA general",
      isActive: true,
      taxType: { code: "IVA", name: "IVA", isActive: true },
      jurisdiction: { name: "Nacional", isActive: true },
    },
  };
}

const period = {
  id: PERIOD,
  taxTypeId: "tt-iva",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-31T00:00:00.000Z",
  label: "Octubre 2026",
  taxType: { name: "IVA", code: "IVA", isActive: true },
};

const regime = {
  id: "regime-a",
  name: "IVA general",
  isActive: true,
  taxTypeId: "tt-iva",
  jurisdictionId: "jur-a",
  taxType: { name: "IVA", isActive: true },
  jurisdiction: { name: "Nacional", isActive: true },
};

/** Respuestas comunes de la pantalla; `extra` decide las del caso (artefactos y descarga). */
function withBase(extra: Router): Router {
  return (method, path) => {
    if (method === "GET" && path === `${BASE}/tax-periods`) return json([period]);
    if (method === "GET" && path === "/tax/regimes") return json([regime]);
    if (method === "GET" && path === `${BASE}/tax-settlements?periodId=${PERIOD}`) {
      return json([settlement(SETTLEMENT, "FINALIZED", 1), settlement(DRAFT, "CALCULATED", 2)]);
    }
    return extra(method, path);
  };
}

/** Simula fetch: registra cada llamada («MÉTODO ruta») y responde con el router del caso. */
function stubApi(router: Router) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      const path = url.pathname.replace(/^\/api\/v1/, "") + url.search;
      calls.push(`${method} ${path}`);
      return (
        (await router(method, path)) ??
        error(404, "NOT_STUBBED", `sin respuesta simulada para ${method} ${path}`)
      );
    }),
  );
}

function renderPage(capabilities: string[]) {
  contextMock.current = {
    firmId: FIRM,
    clientId: CLIENT,
    periodId: PERIOD,
    isReady: true,
    capabilities: new Set(capabilities),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StudyLiquidaciones />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Espera a que la tabla tenga las liquidaciones del período (encabezado + 2 filas). */
async function waitForRows() {
  await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(2));
}

const pdfButton = () => screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement;

beforeEach(() => {
  downloads.length = 0;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
  URL.createObjectURL = vi.fn(() => "blob:liquidacion-demo");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  HTMLAnchorElement.prototype.click = originalClick;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("Liquidaciones: PDF y CSV del papel de trabajo", () => {
  it("PDF y CSV aparecen solo en la liquidación finalizada y con la capacidad de exportar", async () => {
    stubApi(withBase(() => undefined));
    renderPage(FULL);
    await waitForRows();
    expect(screen.getAllByRole("button", { name: "PDF" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "CSV" })).toHaveLength(1);
  });

  it("sin la capacidad de exportar no aparecen PDF ni CSV", async () => {
    stubApi(withBase(() => undefined));
    renderPage(["tax.settlements.read"]);
    await waitForRows();
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "CSV" })).toBeNull();
  });

  it("sin papel previo: lo genera, lo descarga con su nombre y avisa que se descargó", async () => {
    stubApi(
      withBase((method, path) => {
        if (method === "GET" && path === ARTIFACTS) return json([]);
        if (method === "POST" && path === ARTIFACTS) {
          return json(
            { artifact: { id: "art-new", format: "pdf" }, checksum: "c", objectKey: "k" },
            201,
          );
        }
        if (method === "GET" && path === `${ARTIFACTS}/art-new/download`) {
          return file("%PDF-1.4 Demo sintético", "application/pdf", FILE_PDF);
        }
        return undefined;
      }),
    );
    renderPage(FULL);
    await waitForRows();
    fireEvent.click(pdfButton());
    expect(await screen.findByText("Se descargó el papel de trabajo en PDF.")).toBeTruthy();
    expect(downloads).toEqual([FILE_PDF]);
    expect(vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]).toMatchObject({
      type: "application/pdf",
    });
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
  });

  it("con papel ya generado para ese formato, descarga el guardado sin generar otro", async () => {
    stubApi(
      withBase((method, path) => {
        if (method === "GET" && path === ARTIFACTS) {
          return json([
            { id: "art-csv", format: "csv" },
            { id: "art-pdf-nuevo", format: "pdf" },
            { id: "art-pdf-viejo", format: "pdf" },
          ]);
        }
        if (method === "GET" && path === `${ARTIFACTS}/art-pdf-nuevo/download`) {
          return file("%PDF-1.4 Demo sintético", "application/pdf", FILE_PDF);
        }
        return undefined;
      }),
    );
    renderPage(FULL);
    await waitForRows();
    fireEvent.click(pdfButton());
    expect(await screen.findByText("Se descargó el papel de trabajo en PDF.")).toBeTruthy();
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
    expect(calls).toContain(`GET ${ARTIFACTS}/art-pdf-nuevo/download`);
    expect(downloads).toEqual([FILE_PDF]);
  });

  it.each([
    [404, "ARTIFACT_NOT_FOUND", "Papel de trabajo no encontrado"],
    [
      409,
      "ARTIFACT_CHECKSUM_MISMATCH",
      "El papel de trabajo guardado no coincide con su checksum: no se entrega el archivo.",
    ],
    [500, "INTERNAL_ERROR", "Error interno al leer el papel de trabajo guardado."],
  ])(
    "si la descarga responde %i, avisa el motivo, no descarga y el botón vuelve a quedar disponible",
    async (status, code, message) => {
      stubApi(
        withBase((method, path) => {
          if (method === "GET" && path === ARTIFACTS) return json([{ id: "art-x", format: "pdf" }]);
          if (method === "GET" && path === `${ARTIFACTS}/art-x/download`)
            return error(status, code, message);
          return undefined;
        }),
      );
      renderPage(FULL);
      await waitForRows();
      fireEvent.click(pdfButton());
      expect(await screen.findByText(message)).toBeTruthy();
      expect(downloads).toEqual([]);
      await waitFor(() => expect(pdfButton().disabled).toBe(false));
      expect(pdfButton().getAttribute("aria-busy")).toBeNull();
    },
  );

  it("un segundo clic mientras genera no crea otro papel de trabajo", async () => {
    let release: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubApi(
      withBase((method, path) => {
        if (method === "GET" && path === ARTIFACTS) return json([]);
        if (method === "POST" && path === ARTIFACTS) return pending;
        if (method === "GET" && path === `${ARTIFACTS}/art-new/download`) {
          return file("%PDF-1.4 Demo sintético", "application/pdf", FILE_PDF);
        }
        return undefined;
      }),
    );
    renderPage(FULL);
    await waitForRows();
    fireEvent.click(pdfButton());
    const busy = (await screen.findByRole("button", { name: "Generando…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
    release(
      json({ artifact: { id: "art-new", format: "pdf" }, checksum: "c", objectKey: "k" }, 201),
    );
    expect(await screen.findByText("Se descargó el papel de trabajo en PDF.")).toBeTruthy();
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
    expect(downloads).toEqual([FILE_PDF]);
  });
});
