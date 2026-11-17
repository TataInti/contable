// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { DetalleFilasLote, FilasConErrorDeLote } from "./DetalleFilasLote";
import { estadoDeLote, importarLoteFuente, LoteConFilasObservadas } from "./loteFuente";
import { motivoDeFila } from "./motivosFila";
import type { WorkpaperSource } from "./tipos";

// A27-1: libros IVA con filas observadas. Datos ficticios.
vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => ({ firmId: "firma-1", clientId: "cliente-1" }),
}));
vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("libros IVA con filas observadas", () => {
  it("cada código de error tiene su motivo y un código desconocido no inventa uno", () => {
    expect(motivoDeFila("LETTER_INVALID")).toBe("El tipo de comprobante no tiene una letra válida en el catálogo de ARCA.");
    expect(motivoDeFila("CODIGO_NUEVO")).toBe("Motivo no reconocido: CODIGO_NUEVO.");
  });

  it("un lote validado con filas con error no se muestra como «Validado»", () => {
    expect(estadoDeLote({ reviewStatus: "PENDING", batchStatus: "VALIDATED", errorRows: 2, totalRows: 3 })).toEqual({
      status: "NEEDS_REVIEW",
      label: "2 de 3 filas con error",
    });
    expect(estadoDeLote({ reviewStatus: "PENDING", batchStatus: "VALIDATED", errorRows: 0, totalRows: 3 })).toEqual({
      status: "VALIDATED",
    });
    expect(estadoDeLote({ reviewStatus: "REVIEWED", batchStatus: "COMMITTED", errorRows: 0, totalRows: 3 })).toEqual({
      status: "READY",
    });
  });

  it("importar un lote con filas observadas no lo confirma y lo informa con su id y sus conteos", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: "lote-1", status: "UPLOADED", errorRows: 0 } as never)
      .mockResolvedValueOnce({ totals: { errorRows: 2 } } as never);
    const csv = [
      "Fecha;Tipo;Punto de Venta;Número Desde;Tipo Doc. Receptor;Nro. Doc. Receptor;Neto Gravado Total;IVA 21%",
      "04/10/2026;6 - Factura B;3;461;DNI;12345678;1000;210",
      "05/10/2026;63 - Liquidaciónes A;3;462;DNI;12345678;1000;0",
      "06/10/2026;63 - Liquidaciónes A;3;463;DNI;12345678;1000;0",
    ].join("\n");
    const file = { name: "ventas.csv", text: async () => csv } as unknown as File;
    const source = {
      code: "ARCA_IVA_SALES",
      label: "ARCA IVA ventas",
      origin: "ARCA_IVA",
      taxTypeId: "tipo-iva",
      periodId: "periodo-oct",
      adapterVersion: "ARCA_LIBRO_IVA_V1",
    } as unknown as WorkpaperSource;

    const error = await importarLoteFuente({
      firmId: "firma-1",
      clientId: "cliente-1",
      source,
      file,
      workpaperId: "legajo-1",
      clientCuit: "30000000001",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LoteConFilasObservadas);
    expect(error).toMatchObject({ batchId: "lote-1", errorRows: 2, totalRows: 3 });
    // Crear y validar, nunca confirmar.
    expect(vi.mocked(api.post)).toHaveBeenCalledTimes(2);
  });

  it("el detalle lista solo las filas con error, con su comprobante y su motivo", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      { id: "r1", position: 0, status: "VALID", errors: [], raw: null },
      {
        id: "r2",
        position: 1,
        status: "ERROR",
        errors: ["LETTER_INVALID"],
        raw: { Tipo: "63 - Liquidaciónes A", "Número Desde": 462 },
      },
    ] as never);
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <DetalleFilasLote firmId="firma-1" clientId="cliente-1" batchId="lote-1" />
      </QueryClientProvider>,
    );

    const filas = await screen.findAllByRole("listitem");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveTextContent("Fila 2");
    expect(filas[0]).toHaveTextContent("63 - Liquidaciónes A 462");
    expect(filas[0]).toHaveTextContent("no tiene una letra válida");
    expect(vi.mocked(api.get)).toHaveBeenCalledWith("/firms/firma-1/clients/cliente-1/import-batches/lote-1/rows");
  });

  it("un lote de libro IVA con errores ofrece «Ver filas con error» y pide el detalle solo al abrirlo", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      {
        id: "r2",
        position: 1,
        status: "ERROR",
        errors: ["LETTER_INVALID"],
        raw: { Tipo: "99 - Tipo sin catálogo", "Número Desde": 462 },
      },
    ] as never);
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <FilasConErrorDeLote batchId="lote-1" />
      </QueryClientProvider>,
    );

    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver filas con error" }));
    expect(await screen.findByText(/no tiene una letra válida/)).toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});
