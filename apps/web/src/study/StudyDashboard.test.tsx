// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContextValue } from "../context/ClientContext";
import { StudyDashboard } from "./StudyDashboard";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readStudyStyles } from "./studyStyles.testutil";

// Datos sintéticos rotulados: no son clientes ni liquidaciones reales.
const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
const contextMock = vi.hoisted(() => ({ current: null as unknown as ClientContextValue }));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../context/ClientContext", () => ({ useClientContext: () => contextMock.current }));
vi.mock("../session/SessionContext", () => ({
  useSession: () => ({
    status: "authenticated",
    me: { firms: [{ firmId: "firm-a", firmName: "Estudio de Prueba" }] },
    portalContexts: [],
    error: null,
    refresh: async () => {},
  }),
}));

const SUMMARY = { clients: 3, documents: 10, extracted: 4, processing: 2, openRequests: 1, pendingObligations: 5 };
const WORKLIST = [
  {
    id: "s1",
    status: "CHANGES_REQUESTED",
    clientId: "client-a",
    version: 1,
    cutoff: "2026-01-31",
    regime: { code: "IVA", name: "IVA RI", taxType: { code: "IVA", name: "IVA" } },
  },
  {
    id: "s2",
    status: "IN_REVIEW",
    clientId: "client-a",
    version: 2,
    cutoff: "2026-01-31",
    regime: { code: "IIBB", name: "IIBB Tucumán", taxType: { code: "IIBB", name: "Ingresos Brutos" } },
  },
];
const RECEIPTS = [
  {
    settlementId: "r1",
    clientId: "client-a",
    clientName: "Cliente de Prueba S.R.L.",
    taxName: "Ingresos Brutos",
    regimeName: "IIBB",
    periodStart: "2025-03-01T00:00:00.000Z",
    periodEnd: "2025-03-31T00:00:00.000Z",
    finalizedAt: "2026-11-09T12:00:00.000Z",
    dueDate: "2025-04-20T00:00:00.000Z",
  },
];

function answer(path: string): Promise<unknown> {
  if (path.endsWith("/pending-receipts")) return Promise.resolve(RECEIPTS);
  if (path.endsWith("/dashboard")) return Promise.resolve(SUMMARY);
  if (path.endsWith("/portfolio/tax-worklist")) return Promise.resolve(WORKLIST);
  return Promise.resolve([]);
}

function renderDashboard(capabilities: string[], clientId: string | null = "client-a") {
  contextMock.current = {
    firmId: "firm-a",
    clientId,
    periodId: "period-a",
    isReady: true,
    capabilities: new Set(capabilities),
    hasClientAccess: () => true,
    setFirmId: vi.fn(),
    setClientId: vi.fn(),
    setPeriodId: vi.fn(),
  } as unknown as ClientContextValue;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudyDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const worklistTable = () => screen.findByRole("table", { name: "Liquidaciones en curso" });
const receiptsTable = () => screen.findByRole("table", { name: "Acuses de presentación pendientes" });
// «Actualizar» cambia su nombre a «Actualizando» mientras alguna fuente consulta: se espera el nombre en reposo.
const actualizar = () => screen.findByRole("button", { name: "Actualizar" });
// Salida que ofrece toda fuente restringida (P1); el texto coincide con StudyDashboard.tsx.
const SALIDA = "Podés seguir trabajando en los módulos a los que tenés acceso desde la navegación lateral.";

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(answer);
});
afterEach(cleanup);

describe("Inicio: «Actualizar» refresca las fuentes que la persona puede leer (G06)", () => {
  it("consulta resumen, liquidaciones y acuses, y mientras corre queda procesando sin doble envío", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    expect(await worklistTable()).toBeTruthy();
    expect(await receiptsTable()).toBeTruthy();
    const button = await actualizar();

    apiMock.get.mockClear();
    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(button);

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(3));
    expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/dashboard");
    expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/portfolio/tax-worklist");
    expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/portfolio/tax-worklist/pending-receipts");

    const busy = screen.getByRole("button", { name: "Actualizando" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(apiMock.get).toHaveBeenCalledTimes(3);
  });

  it("con capacidad parcial actualiza solo el resumen que la persona puede leer", async () => {
    renderDashboard(["client.read"]);
    const button = await actualizar();

    apiMock.get.mockClear();
    fireEvent.click(button);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/dashboard"));
    expect(apiMock.get.mock.calls.map(([path]) => path)).toEqual(["/firms/firm-a/dashboard"]);
  });

  it("si una fuente falla, su error queda junto a ella y no oculta las otras", async () => {
    apiMock.get.mockImplementation((path: string) =>
      path.endsWith("/dashboard") ? Promise.reject(new Error("sin respuesta")) : answer(path),
    );
    renderDashboard(["client.read", "tax.settlements.read"]);

    expect(await screen.findByText("No se pudo cargar el resumen")).toBeTruthy();
    expect(await worklistTable()).toBeTruthy();
    expect(await receiptsTable()).toBeTruthy();
  });

  it("mientras actualiza identifica los datos previos y los deja visibles", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    const button = await actualizar();

    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(button);

    expect(await screen.findByText(/Actualizando: se muestran los datos de la última consulta/)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Liquidaciones en curso" })).toBeTruthy();
  });

  it("si el resumen falla al actualizar, su error queda junto a él y las demás fuentes siguen visibles", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    await receiptsTable();
    const button = await actualizar();

    apiMock.get.mockImplementation((path: string) =>
      path.endsWith("/dashboard") ? Promise.reject(new Error("sin respuesta")) : answer(path),
    );
    fireEvent.click(button);

    expect(await screen.findByText("No se pudo cargar el resumen")).toBeTruthy();
    expect(await worklistTable()).toBeTruthy();
    expect(await receiptsTable()).toBeTruthy();
  });
});

describe("Inicio: composición R01", () => {
  it("un solo h1 y como máximo una acción primaria", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll(".ds-button--primary")).toHaveLength(1);
  });

  it("el contenedor principal es una región con nombre y Actualizar es acción secundaria", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    expect(screen.getByRole("region", { name: "Trabajo del estudio" })).toBeTruthy();
    expect((await actualizar()).className).toContain("ds-button--secondary");
  });

  it("las cifras sin respuesta dicen «pendiente», nunca cero", async () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    renderDashboard(["client.read", "tax.settlements.read"]);
    expect(await screen.findByText("Temas abiertos")).toBeTruthy();
    expect(screen.getAllByText("pendiente").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("sin acceso al resumen, la fuente dice que está restringida y muestra el resto", async () => {
    renderDashboard(["tax.settlements.read"]);
    expect(await worklistTable()).toBeTruthy();
    expect(await receiptsTable()).toBeTruthy();
    expect(screen.getAllByText("restringido").length).toBeGreaterThan(0);
    expect(screen.queryByText("Resumen no disponible para tu rol")).toBeNull();
    expect(screen.getAllByText("Tu rol no permite consultar el resumen del estudio. " + SALIDA).length).toBeGreaterThan(0);
  });

  it("sin ninguna fuente, el bloque y cada fuente restringida dicen qué no ven y ofrecen la salida (P1)", async () => {
    renderDashboard([]);
    expect(await screen.findByText("Indicadores restringidos para tu rol")).toBeTruthy();
    expect(screen.getByText("Tu rol no permite consultar el resumen ni las liquidaciones de la firma. " + SALIDA)).toBeTruthy();
    expect(screen.getByText("Tu rol no permite consultar liquidaciones de la firma. " + SALIDA)).toBeTruthy();
    expect(screen.getByText("Tu rol no permite consultar los acuses de presentación de la firma. " + SALIDA)).toBeTruthy();
    expect(screen.queryByText("Resumen no disponible para tu rol")).toBeNull();
  });

  it("Otros circuitos y Panorama general son secciones del lienzo, sin panel lateral", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    expect(await screen.findByRole("heading", { name: "Otros circuitos" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Panorama general" })).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("«Abrir obligaciones» con cliente elegido lleva a Trabajo", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    expect(screen.getByRole("link", { name: "Abrir obligaciones" }).getAttribute("href")).toBe("/trabajo");
  });

  it("«Abrir obligaciones» sin cliente elegido lleva a Clientes para elegir uno", async () => {
    renderDashboard(["client.read", "tax.settlements.read"], null);
    await worklistTable();
    expect(screen.getByRole("link", { name: "Abrir obligaciones" }).getAttribute("href")).toBe("/clientes");
  });

  it("documentos y pedidos conservan su regla: con cliente, Bandeja y Trabajo; sin cliente, Clientes", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    const documentos = await screen.findByRole("link", { name: /Documentos en procesamiento/ });
    expect(documentos.getAttribute("href")).toBe("/bandeja");
    expect(screen.getByRole("link", { name: /Pedidos documentales abiertos/ }).getAttribute("href")).toBe("/trabajo");
    cleanup();
    renderDashboard(["client.read", "tax.settlements.read"], null);
    const documentosSinCliente = await screen.findByRole("link", { name: /Documentos en procesamiento/ });
    expect(documentosSinCliente.getAttribute("href")).toBe("/clientes");
    expect(screen.getByRole("link", { name: /Pedidos documentales abiertos/ }).getAttribute("href")).toBe("/clientes");
  });
  it("las acciones de fila de Inicio usan un solo tratamiento (ghost) con nombre completo", async () => {
    renderDashboard(["client.read", "tax.settlements.read"]);
    await worklistTable();
    const liquidaciones = screen.getAllByRole("button", { name: /^Abrir liquidación de IVA, versión / });
    expect(liquidaciones.length).toBeGreaterThan(0);
    for (const accion of liquidaciones) expect(accion.className).toContain("ds-button--ghost");
    for (const circuito of ["Documentos en procesamiento", "Pedidos documentales abiertos"]) {
      const accion = screen.getByRole("button", { name: `Abrir ${circuito}` });
      expect(accion.className).toContain("ds-button--ghost");
    }
  });

  it("nombre y dato secundario van en renglones separados, con la regla que usa Reglas (2.7a)", () => {
    expect(readStudyStyles()).toMatch(
      /\.dense-packs \.dense-name__text > small,\s*\.dense-worklist \.dense-name__text > small\s*\{[^}]*display:\s*block;/,
    );
  });

  it("los enlaces sueltos de Inicio tienen relleno vertical de objetivo, no tamaño de letra", () => {
    const denseStyles = readFileSync(resolve(process.cwd(), "../../packages/design-system/src/Dense.css"), "utf8");
    expect(denseStyles).toMatch(/\.dense-link\s*\{[^}]*padding-block:\s*var\(--ds-space-2\);/s);
  });
});
