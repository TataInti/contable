// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingFilingReceipts, type PendingReceipt } from "./PendingFilingReceipts";

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMock }));

const NOW = new Date("2026-11-14T12:00:00.000Z").getTime();
const HEADING = /Falta el acuse de presentación/;

function receipt(overrides: Partial<PendingReceipt> = {}): PendingReceipt {
  return {
    settlementId: "settlement-1",
    clientId: "client-1",
    clientName: "Restaurante de Prueba S.R.L.",
    taxName: "Ingresos Brutos",
    regimeName: "IIBB Contribuyente Local Tucumán",
    periodStart: "2025-03-01T00:00:00.000Z",
    periodEnd: "2025-03-31T00:00:00.000Z",
    finalizedAt: "2026-11-09T12:00:00.000Z",
    dueDate: "2025-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function renderList(onOpen = vi.fn(), canOpen = () => true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PendingFilingReceipts firmId="firm-a" canOpen={canOpen} onOpen={onOpen} now={NOW} />
    </QueryClientProvider>,
  );
  return onOpen;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("acuses de presentación pendientes en Inicio", () => {
  it("no dibuja nada cuando no falta ninguna", async () => {
    apiMock.get.mockResolvedValue([]);
    renderList();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
    // Espera la respuesta confirmada: mientras consulta, el bloque muestra su carga.
    await waitFor(() => expect(screen.queryByRole("heading", { name: HEADING })).toBeNull());
  });

  it("lista cliente, impuesto, período y días desde que se finalizó, y abre el legajo", async () => {
    apiMock.get.mockResolvedValue([receipt()]);
    const onOpen = renderList();

    // Espera los datos: el encabezado también aparece durante la carga.
    expect(await screen.findByText("Restaurante de Prueba S.R.L.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: HEADING })).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/portfolio/tax-worklist/pending-receipts");
    expect(screen.getByText("Ingresos Brutos")).toBeTruthy();
    expect(screen.getByText("marzo de 2025")).toBeTruthy();
    expect(screen.getByText("5 días")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir legajo de Restaurante de Prueba S.R.L." }));
    expect(onOpen).toHaveBeenCalledWith("client-1");
  });

  it("no ofrece abrir el legajo de un cliente sin acceso", async () => {
    apiMock.get.mockResolvedValue([receipt()]);
    renderList(vi.fn(), () => false);

    expect(await screen.findByText("Restaurante de Prueba S.R.L.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir legajo de Restaurante de Prueba S.R.L." })).toBeNull();
  });

  it("en carga muestra un indicador discreto y la cifra «pendiente», sin lista ni cero", async () => {
    apiMock.get.mockReturnValue(new Promise(() => undefined));
    renderList();

    expect(await screen.findByRole("heading", { name: HEADING })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Consultando acuses pendientes");
    expect(screen.getByText("pendiente")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("con error lo dice junto a su fuente, y Reintentar vuelve a consultar y repinta", async () => {
    apiMock.get.mockRejectedValueOnce(new Error("sin conexión")).mockResolvedValueOnce([receipt()]);
    renderList();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("No se pudo cargar los acuses")).toBeTruthy();
    expect(screen.getByRole("heading", { name: HEADING })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Restaurante de Prueba S.R.L.")).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it("con datos muestra la ordenación inicial: la más antigua primero, y el conteo", async () => {
    apiMock.get.mockResolvedValue([
      receipt({ settlementId: "s-reciente", clientName: "Cliente Reciente S.A.", finalizedAt: "2026-11-12T12:00:00.000Z" }),
      receipt({ settlementId: "s-antigua", clientName: "Cliente Antiguo S.A.", finalizedAt: "2026-10-01T12:00:00.000Z" }),
    ]);
    renderList();

    const rows = within(await screen.findByRole("table")).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("Cliente Antiguo S.A.");
    expect(rows[2]?.textContent).toContain("Cliente Reciente S.A.");
    expect(screen.getByText("2 acuses pendientes")).toBeTruthy();
  });
});
