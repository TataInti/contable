// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EtapaFuentes, type EtapaFuentesProps } from "./etapas/EtapaFuentes";
import { fuentesFaltantes, textoFaltantes } from "./fuentesFaltantes";
import type { CoberturaLegajo, WorkpaperSource } from "./tipos";

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => ({ firmId: "firm-1", clientId: "client-1" }),
}));

const base = { count: 0, taxTypeId: "t", periodId: "p", adapterVersion: "V1", expectedColumns: [], noMovements: null };
const lote = (revisado: boolean) => ({
  id: "link-1", importBatchId: "ib-1", fileName: "ventas.xlsx", batchStatus: "COMMITTED", reviewStatus: revisado ? "REVIEWED" : "PENDING",
  totalRows: 3, validRows: 3, errorRows: 0, totals: null, snapshotHash: null, reviewedAt: null, reviewedByUserId: null,
  createdByUserId: "u-2", createdAt: "2026-11-20T12:00:00.000Z",
});
const ventas = (conLote: boolean): WorkpaperSource => ({
  ...base, code: "ARCA_IVA_SALES", label: "Libro IVA Ventas", origin: "ARCA", expectedColumns: ["nonTaxed"],
  required: true, present: false, status: "PENDING", batches: conLote ? [lote(false) as never] : [],
});
const iibb: WorkpaperSource = { ...base, code: "DGR_IIBB_TUC", label: "Ingresos Brutos Tucumán", origin: "DGR_IIBB", required: true, present: false, status: "PENDING", batches: [] };
const tem: WorkpaperSource = { ...base, code: "SMT_TEM", label: "TEM San Miguel de Tucumán", origin: "SMT_TEM", required: true, present: false, status: "PENDING", batches: [] };

describe("faltantes de Fuentes (10-1)", () => {
  it("con las ventas sin cargar, Ingresos Brutos y TEM no se piden: «Falta 1: Ventas del período»", () => {
    const faltantes = fuentesFaltantes([ventas(false), iibb, tem]);
    expect(faltantes.map((f) => f.code)).toEqual(["ARCA_IVA_SALES"]);
    expect(textoFaltantes(["Ventas del período"])).toBe("Falta 1: Ventas del período");
    expect(textoFaltantes(["A", "B"])).toBe("Faltan 2: A, B");
  });
  it("si las ventas ya están cubiertas y la tabla manual sigue pendiente, esa tabla se pide", () => {
    expect(fuentesFaltantes([{ ...ventas(false), present: true }, iibb]).map((f) => f.code)).toEqual(["DGR_IIBB_TUC"]);
  });
});

function fakeMutation(extra: object = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, variables: undefined, reset: vi.fn(), ...extra } as unknown as UseMutationResult<unknown, Error, never>;
}

function renderEtapa(fuentes: WorkpaperSource[], over: Partial<EtapaFuentesProps> = {}, allowSelfReview = false) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const onContinuar = vi.fn();
  const props: EtapaFuentesProps = {
    workpaperId: "wp-1",
    coverageQuery: { isError: false, isSuccess: true, isFetching: false, data: { sources: fuentes, allowSelfReview, components: [] }, refetch: vi.fn() } as unknown as UseQueryResult<CoberturaLegajo, Error>,
    capabilities: new Set(["tax.vouchers.prepare", "tax.vouchers.review"]),
    canEditSources: true, currentUserId: "u-1", motivoImportarLibro: null, onAbrirLibroIva: vi.fn(),
    sourceCode: "", setSourceCode: vi.fn(), sourceFile: null, setSourceFile: vi.fn(),
    sourceUploadMutation: fakeMutation() as never,
    reviewSourceMutation: fakeMutation({ mutateAsync }) as never,
    noMovementsMutation: fakeMutation() as never,
    motivoSinMovimientos: null, onContinuar, ...over,
  };
  render(<QueryClientProvider client={new QueryClient()}><EtapaFuentes {...props} /></QueryClientProvider>);
  return { mutateAsync, onContinuar };
}

describe("Importar ventas: «Revisar y continuar» (10-8)", () => {
  afterEach(() => cleanup());

  it("sin cargar: avisa «Falta 1» y marca como opcionales las tablas manuales", () => {
    renderEtapa([ventas(false), iibb, tem]);
    expect(screen.getByRole("status")).toHaveTextContent("Falta 1: Ventas del período");
    expect(screen.getAllByText("Opcional")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Revisar/ })).toBeNull();
  });

  it("con el lote importado, un solo botón revisa y pasa a Clasificación", async () => {
    const { mutateAsync, onContinuar } = renderEtapa([ventas(true), iibb, tem]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar y continuar" }));
    await waitFor(() => expect(onContinuar).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith("link-1");
  });

  it("si la misma persona no puede autorrevisar, no ofrece el botón y lo explica", () => {
    renderEtapa([ventas(true)], { currentUserId: "u-2" });
    expect(screen.queryByRole("button", { name: /Revisar/ })).toBeNull();
    expect(screen.getByText(/revisión de otra persona/)).toBeInTheDocument();
  });

  it("si el error de revisión llega, se muestra y no se continúa", async () => {
    const { onContinuar } = renderEtapa([ventas(true)], {
      reviewSourceMutation: fakeMutation({ mutateAsync: vi.fn().mockRejectedValue(new Error("No se pudo revisar")) }) as never,
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar y continuar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo revisar");
    expect(onContinuar).not.toHaveBeenCalled();
  });
});
