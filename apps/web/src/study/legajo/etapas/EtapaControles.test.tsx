// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Hay una diferencia/ })).toBeInTheDocument();
  });
});
