// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api";
import { PanelGestionarFuente } from "./PanelGestionarFuente";
import type { WorkpaperSource } from "../tipos";

vi.mock("../../../context/ClientContext", () => ({ useClientContext: () => ({ firmId: "firma-demo", clientId: "cliente-demo" }) }));
vi.mock("@contable/design-system", () => ({
  ActionDrawer: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) => isOpen ? <div>{children}{footer}</div> : null,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props}>{children}</button>,
}));
vi.mock("../../../ui/ConfirmAction", () => ({
  ConfirmDialog: () => null,
  useConfirmAction: () => ({ ask: vi.fn() }),
}));
vi.mock("../DetalleFilasLote", () => ({ DetalleFilasLote: () => <p>Detalle de filas</p> }));
vi.mock("../../../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const batch = {
  id: "link-old",
  importBatchId: "batch-old",
  fileName: "ventas.csv",
  batchStatus: "COMMITTED",
  reviewStatus: "REVIEWED",
  totalRows: 1,
  validRows: 1,
  errorRows: 0,
  snapshotHash: "hash",
  reviewedAt: "2026-11-20T10:00:00.000Z",
  reviewedByUserId: "reviewer-id",
  reviewedByName: "Revisor",
  createdByUserId: "creator-id",
  createdByName: "Preparador",
  createdAt: "2026-11-19T10:00:00.000Z",
  retiredByUserId: null,
  retiredAt: null,
  retireReason: null,
  replacedByBatchId: null,
  replacedAt: null,
};

const source: WorkpaperSource = {
  code: "IIBB_RPI_TUC",
  label: "Ventas del período",
  required: true,
  present: true,
  status: "LOADED",
  noMovements: null,
  count: 1,
  taxTypeId: "tax-id",
  periodId: "period-id",
  origin: "DGR_RPI_TUC",
  adapterVersion: "ARCA_RET_V1",
  expectedColumns: [],
  batches: [batch],
};

function renderPanel({ canEdit = true, initialSource = source }: { canEdit?: boolean; initialSource?: WorkpaperSource } = {}) {
  const upload = {
    mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, error: null, data: null,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [file, setFile] = useState<File | null>(null);
    return <PanelGestionarFuente
      source={initialSource}
      workpaperId="workpaper-id"
      isOpen
      onClose={vi.fn()}
      onAbrirLibroIva={vi.fn()}
      sourceFile={file}
      setSourceFile={setFile}
      sourceUploadMutation={upload as never}
      sources={[initialSource]}
      canEdit={canEdit}
      currentUserId="creator-id"
      allowSelfReview={false}
      canReview
      canEditSources={canEdit}
      reviewSourceMutation={{ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null } as never}
      editReason={canEdit ? null : "No tenés permiso para modificar esta fuente."}
      onCambiarFuente={vi.fn()}
      noMovementsMutation={{ mutate: vi.fn(), isPending: false, error: null } as never}
      puedeMarcarSinMovimientos
      motivoSinMovimientos={null}
    />;
  }
  render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  return { upload };
}

describe("PanelGestionarFuente: retiro, reemplazo e historial", () => {
  it("pide motivo obligatorio y retira el lote con el permiso de carga", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect((screen.getByRole("button", { name: "Confirmar retiro" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Archivo equivocado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar retiro" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/firms/firma-demo/clients/cliente-demo/monthly-tax-workpapers/workpaper-id/batches/batch-old/retire",
      { reason: "Archivo equivocado" },
    ));
  });

  it("reemplaza desde Archivos y conserva el lote de origen al confirmar la carga", () => {
    const { upload } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    fireEvent.change(screen.getByLabelText("Elegir archivo"), { target: { files: [new File(["fila"], "nuevo.csv", { type: "text/csv" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar archivo" }));
    expect(upload.mutate).toHaveBeenCalledWith({ replacesBatchId: "batch-old" });
  });

  it("ofrece corregir y volver a cargar desde los errores como reemplazo del lote", () => {
    const errorSource = { ...source, batches: [{ ...batch, reviewStatus: "PENDING_REVIEW", errorRows: 1 }] };
    const { upload } = renderPanel({ initialSource: errorSource });
    fireEvent.click(screen.getByRole("button", { name: "Ver errores" }));
    expect(screen.getByText("Detalle de filas")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Corregir y volver a cargar" }));
    fireEvent.change(screen.getByLabelText("Elegir archivo"), { target: { files: [new File(["fila"], "corregido.csv")] } });
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar archivo" }));
    expect(upload.mutate).toHaveBeenCalledWith({ replacesBatchId: "batch-old" });
  });

  it("incluye carga, revisión y retiro en Historial y oculta lotes retirados de Archivos", () => {
    const retiredSource = { ...source, batches: [{ ...batch, reviewStatus: "RETIRED", retiredByName: "Titular", retiredAt: "2026-11-21T12:00:00.000Z", retireReason: "Duplicado" }] };
    renderPanel({ initialSource: retiredSource });
    expect(screen.queryByText("ventas.csv")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Historial" }));
    expect(screen.getByText(/Cargado por Preparador/)).not.toBeNull();
    expect(screen.getByText(/Revisado por Revisor/)).not.toBeNull();
    expect(screen.getByText(/Retirado por Titular.*Duplicado/)).not.toBeNull();
  });

  it("no muestra acciones de edición sin permiso y explica el motivo", () => {
    renderPanel({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reemplazar" })).toBeNull();
    expect(screen.getByText("No tenés permiso para modificar esta fuente.")).not.toBeNull();
  });
});
