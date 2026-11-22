// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api";
import { PestanaComprobantes } from "./PestanaComprobantes";

// Corte 4B: tildes de comprobantes por cliente en la configuración fiscal. La API es la fuente; esta prueba fija el uso.
vi.mock("../../../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const estadoMonotributo = {
  year: 2026,
  condicion: "MONOTRIBUTISTA",
  origen: "PROPUESTA",
  allowedClasses: ["FACTURA_C", "NOTAS_C"],
  exemptAllowed: false,
  offered: ["FACTURA_C", "FACTURA_E", "NOTAS_C", "NOTAS_E"],
  labels: {
    FACTURA_A: "Factura A", FACTURA_B: "Factura B", FACTURA_C: "Factura C", FACTURA_E: "Factura E (exportación)",
    NOTAS_A: "Notas de crédito y débito A", NOTAS_B: "Notas de crédito y débito B", NOTAS_C: "Notas de crédito y débito C", NOTAS_E: "Notas de crédito y débito E (exportación)",
  },
  propuesta: { clases: ["FACTURA_C", "NOTAS_C"], exentos: false },
  savedAt: null,
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PestanaComprobantes firmId="f1" clientId="c1" canWrite />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue(estadoMonotributo);
  vi.mocked(api.put).mockResolvedValue({ ...estadoMonotributo, origen: "GUARDADO" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PestanaComprobantes (corte 4B)", () => {
  it("muestra la propuesta de la condición y no deja guardar sin cambios", async () => {
    montar();
    expect(await screen.findByText(/Propuesta según la condición frente al IVA/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Factura C" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Puede emitir comprobantes exentos" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Factura A" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar comprobantes" })).toBeDisabled();
  });

  it("tildar un tipo y el exento habilita guardar y envía el estado completo", async () => {
    montar();
    await screen.findByRole("checkbox", { name: "Factura C" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Factura E (exportación)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Puede emitir comprobantes exentos" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar comprobantes" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/firms/f1/clients/c1/voucher-permissions/2026", {
        allowedClasses: ["FACTURA_C", "NOTAS_C", "FACTURA_E"],
        exemptAllowed: true,
      }),
    );
  });
});
