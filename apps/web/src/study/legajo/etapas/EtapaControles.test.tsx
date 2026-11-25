// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EtapaControles } from "./EtapaControles";
import type { Workpaper } from "../tipos";

const finding = (id: string, status = "OPEN") => ({
  id, code: "BANK_RECONCILIATION", status, severity: "BLOCKING", message: "Hay una diferencia",
  expected: null, actual: "125000", tolerance: null, evidenceDocumentId: null, resolution: null,
});
const wp = { id: "wp-1", controls: [finding("c-1")] } as unknown as Workpaper;
const query = { data: [], isSuccess: true, isError: false, refetch: vi.fn() } as never;
const mutation = { mutate: vi.fn(), isPending: false, variables: undefined, error: null } as never;

afterEach(() => cleanup());

describe("EtapaControles", () => {
  it("muestra la cola de abiertos y abre el detalle lateral del control", () => {
    render(<MemoryRouter><EtapaControles capabilities={new Set(["tax.settlements.review"])} wp={wp}
      controlResolutions={{}} setControlResolutions={vi.fn()} controlEvidence={{}} setControlEvidence={vi.fn()}
      documentsQuery={query} resolveControlMutation={mutation} confirmar={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("list", { name: "Controles abiertos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Abrir Hay una diferencia/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Hay una diferencia/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Confirmar/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolver" }));
    expect(within(dialog).getByRole("button", { name: "Confirmar resolución" })).toBeInTheDocument();
  });

  const dos = { id: "wp-2", controls: [finding("c-1"), { ...finding("c-2"), code: "CASH_ALLOCATION_RECONCILIATION", message: "Falta caja" }] } as unknown as Workpaper;
  const montar = (workpaper: Workpaper, resolveOpen = mutation) => render(<MemoryRouter><EtapaControles capabilities={new Set(["tax.settlements.review"])} wp={workpaper}
    controlResolutions={{}} setControlResolutions={vi.fn()} controlEvidence={{}} setControlEvidence={vi.fn()}
    documentsQuery={query} resolveControlMutation={mutation} resolveOpenMutation={resolveOpen} confirmar={vi.fn()} /></MemoryRouter>);

  it("resuelve los bloqueantes restantes juntos con un solo motivo", () => {
    const mutate = vi.fn();
    montar(dos, { mutate, isPending: false, variables: undefined, error: null } as never);
    fireEvent.click(screen.getByRole("button", { name: "Resolver los 2 con un solo motivo" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar resolución de 2 controles" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo para los 2 controles"), { target: { value: "Sin extracto este mes" } });
    fireEvent.click(confirmar);
    expect(mutate).toHaveBeenCalledWith({ workpaperId: "wp-2", resolution: "Sin extracto este mes" }, expect.anything());
  });

  it("no ofrece resolver juntos con un solo control abierto", () => {
    montar(wp);
    expect(screen.queryByRole("button", { name: /con un solo motivo/ })).not.toBeInTheDocument();
  });

  it("muestra a la vista los controles omitidos por falta de datos", () => {
    const omitido = { ...finding("c-3", "RESOLVED"), code: "BANK_CREDIT_RECONCILIATION", severity: "INFO", resolution: "Omitido: no hay extracto cargado" };
    montar({ id: "wp-3", controls: [omitido] } as unknown as Workpaper);
    const lista = screen.getByRole("list", { name: "Controles omitidos" });
    expect(within(lista).getByText(/Omitido: no hay extracto cargado/)).toBeInTheDocument();
    expect(screen.getByText("No hay controles abiertos para este legajo.")).toBeInTheDocument();
  });
});
