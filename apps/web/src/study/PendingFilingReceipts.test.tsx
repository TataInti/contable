// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingFilingReceipts, type PendingReceipt } from "./PendingFilingReceipts";

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMock }));

const NOW = new Date("2026-11-14T12:00:00.000Z").getTime();

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

describe("constancias de presentación pendientes en Inicio", () => {
  it("no dibuja nada cuando no falta ninguna", async () => {
    apiMock.get.mockResolvedValue([]);
    renderList();
    await vi.waitFor(() => expect(apiMock.get).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Falta la constancia de presentación" })).toBeNull();
  });

  it("lista cliente, impuesto, período y días desde que se finalizó, y abre el legajo", async () => {
    apiMock.get.mockResolvedValue([receipt()]);
    const onOpen = renderList();

    expect(await screen.findByRole("heading", { name: "Falta la constancia de presentación" })).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledWith("/firms/firm-a/portfolio/tax-worklist/pending-receipts");
    expect(screen.getByText("Restaurante de Prueba S.R.L.")).toBeTruthy();
    expect(screen.getByText("Ingresos Brutos")).toBeTruthy();
    expect(screen.getByText("marzo de 2025")).toBeTruthy();
    expect(screen.getByText("5 días")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir legajo" }));
    expect(onOpen).toHaveBeenCalledWith("client-1");
  });

  it("no ofrece abrir el legajo de un cliente sin acceso", async () => {
    apiMock.get.mockResolvedValue([receipt()]);
    renderList(vi.fn(), () => false);

    expect(await screen.findByText("Restaurante de Prueba S.R.L.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir legajo" })).toBeNull();
  });
});
