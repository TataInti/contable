// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EtapaFuentes, type EtapaFuentesProps } from "./etapas/EtapaFuentes";
import type { CoberturaLegajo, WorkpaperSource } from "./tipos";

vi.mock("../../context/ClientContext", () => ({
  useClientContext: () => ({ firmId: "firm-1", clientId: "client-1" }),
}));

// Sin movimientos (corte 2A): la marca cubre la fuente, el mes lo muestra y el permiso decide el botón.
const base = {
  count: 0,
  taxTypeId: null,
  periodId: null,
  origin: "CSV",
  adapterVersion: "RET_V1",
  expectedColumns: [],
  batches: [],
};
const pendiente: WorkpaperSource = {
  ...base,
  code: "RET",
  label: "Retenciones IIBB",
  required: true,
  present: false,
  status: "PENDING",
  noMovements: null,
};
const sinMovimientos: WorkpaperSource = {
  ...base,
  code: "PER",
  label: "Percepciones IIBB",
  required: true,
  present: false,
  status: "NO_MOVEMENTS",
  noMovements: { byUserId: "u-1", byName: "Ana Titular", at: "2026-11-20T12:00:00.000Z" },
};

const cobertura = {
  sources: [pendiente, sinMovimientos],
  allowSelfReview: false,
  components: [],
  classifications: { total: 0, classified: 0, pending: 0, ready: true },
  allocations: { total: 0, allocated: 0, pending: 0, ready: true },
} as unknown as CoberturaLegajo;

function fakeMutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
    reset: vi.fn(),
  } as unknown as UseMutationResult<unknown, Error, never>;
}

function renderEtapa(overrides: Partial<EtapaFuentesProps> = {}) {
  const noMovementsMutation = fakeMutation();
  const props: EtapaFuentesProps = {
    workpaperId: "workpaper-1",
    coverageQuery: {
      isError: false,
      isSuccess: true,
      isFetching: false,
      data: cobertura,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<CoberturaLegajo, Error>,
    capabilities: new Set(["tax.vouchers.prepare"]),
    canEditSources: true,
    currentUserId: "u-1",
    motivoImportarLibro: null,
    onAbrirLibroIva: vi.fn(),
    sourceCode: "",
    setSourceCode: vi.fn(),
    sourceFile: null,
    setSourceFile: vi.fn(),
    sourceUploadMutation: fakeMutation() as unknown as EtapaFuentesProps["sourceUploadMutation"],
    reviewSourceMutation: fakeMutation() as unknown as EtapaFuentesProps["reviewSourceMutation"],
    noMovementsMutation: noMovementsMutation as unknown as EtapaFuentesProps["noMovementsMutation"],
    motivoSinMovimientos: null,
    ...overrides,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><EtapaFuentes {...props} /></QueryClientProvider>);
  return { noMovementsMutation };
}

/** Abre «Gestionar» de una fuente (la tabla repite el botón en dos variantes). */
function gestionar(nombre: string) {
  fireEvent.click(screen.getAllByRole("button", { name: `Gestionar ${nombre}` })[0]!);
}

const botones = (nombre: string) => screen.queryAllByRole("button", { name: nombre });

describe("Sin movimientos por fuente (corte 2A)", () => {
  afterEach(() => cleanup());

  it("la fila muestra el estado y el renglón «qué falta» ya no cuenta la fuente sin movimientos", () => {
    renderEtapa();
    const renglon = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("Falta 1:"));
    expect(renglon?.textContent).toBe("Falta 1: Retenciones IIBB");
    expect(screen.getAllByText("Sin movimientos").length).toBeGreaterThan(0);
  });

  it("marcar pide confirmación con el diálogo del sistema y después envía la marca", async () => {
    const { noMovementsMutation } = renderEtapa();
    gestionar("Retenciones IIBB");
    fireEvent.click(botones("Sin movimientos")[0]!);

    expect(screen.getByText("¿Marcar esta fuente sin movimientos?")).toBeTruthy();
    expect(noMovementsMutation.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Marcar sin movimientos" }));
    await waitFor(() =>
      expect(noMovementsMutation.mutate).toHaveBeenCalledWith({ sourceCode: "RET", marcar: true }),
    );
  });

  it("con la marca puesta, la frase dice quién y cuándo, y el botón deshace la marca", () => {
    const { noMovementsMutation } = renderEtapa();
    gestionar("Percepciones IIBB");

    expect(
      screen.getByText(/^Sin movimientos este mes · marcado por Ana Titular el /),
    ).toBeTruthy();
    expect(botones("Sin movimientos")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Deshacer sin movimientos" }));
    expect(noMovementsMutation.mutate).toHaveBeenCalledWith({ sourceCode: "PER", marcar: false });
  });

  it("sin permiso o con el mes no editable, el botón queda deshabilitado con el motivo junto a él", () => {
    renderEtapa({ motivoSinMovimientos: "Tu rol no puede cargar archivos ni marcar fuentes." });
    gestionar("Retenciones IIBB");

    expect((botones("Sin movimientos")[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Tu rol no puede cargar archivos ni marcar fuentes.")).toBeTruthy();
  });

  it("con el libro sin movimientos, las tablas manuales de IIBB y TEM no figuran como faltantes", () => {
    // La API no las marca como obligatorias cuando el libro está cubierto (satisfiedBy).
    const libro: WorkpaperSource = { ...sinMovimientos, code: "ARCA_IVA_SALES", label: "Libro IVA Ventas" };
    const tablaIibb: WorkpaperSource = { ...pendiente, code: "DGR_IIBB_TUC", label: "Ingresos Brutos Tucumán", required: false };
    const tablaTem: WorkpaperSource = { ...pendiente, code: "SMT_TEM", label: "TEM San Miguel de Tucumán", required: false };
    renderEtapa({
      coverageQuery: {
        isError: false,
        isSuccess: true,
        isFetching: false,
        data: { ...cobertura, sources: [libro, tablaIibb, tablaTem] },
        refetch: vi.fn(),
      } as unknown as UseQueryResult<CoberturaLegajo, Error>,
    });
    expect(screen.getByText("Todo listo para calcular")).toBeTruthy();
    expect(screen.queryByText(/Para calcular falta/)).toBeNull();
  });
});
