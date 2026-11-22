import { api } from "../../lib/api";
import { hashSourceFile, leerArchivoFuente } from "./archivoFuente";
import { avisoDeFuenteEquivocada } from "./txtDgrTucuman";
import type { WorkpaperSource } from "./tipos";

// Los libros IVA se importan desde su fila de ARCA IVA («Importar libro»); «Importar lote» queda para las demás fuentes.
export const CODIGO_FUENTE_LIBRO_IVA = {
  SALE: "ARCA_IVA_SALES",
  PURCHASE: "ARCA_IVA_PURCHASES",
} as const;

export function ladoDeLibroIva(codigo: string): "SALE" | "PURCHASE" | null {
  if (codigo === CODIGO_FUENTE_LIBRO_IVA.SALE) return "SALE";
  if (codigo === CODIGO_FUENTE_LIBRO_IVA.PURCHASE) return "PURCHASE";
  return null;
}

/** El lote quedó validado con filas con error: no se confirma. El panel muestra el detalle por fila. */
export class LoteConFilasObservadas extends Error {
  readonly batchId: string;
  readonly errorRows: number;
  readonly totalRows: number;

  constructor(batchId: string, errorRows: number, totalRows: number) {
    super(
      `El lote tiene ${errorRows} de ${totalRows} filas con error. Corregí esas filas en el archivo y volvé a importarlo.`,
    );
    this.name = "LoteConFilasObservadas";
    this.batchId = batchId;
    this.errorRows = errorRows;
    this.totalRows = totalRows;
  }
}

/** Estado visible de un lote: con filas con error no se muestra «Validado». */
export function estadoDeLote(lote: {
  reviewStatus: string;
  batchStatus: string;
  errorRows: number;
  totalRows: number;
}): { status: string; label?: string } {
  if (lote.reviewStatus === "REVIEWED") return { status: "READY" };
  if (lote.batchStatus === "VALIDATED" && lote.errorRows > 0) {
    return { status: "NEEDS_REVIEW", label: `${lote.errorRows} de ${lote.totalRows} filas con error` };
  }
  return { status: lote.batchStatus };
}

/** Resultado de una importación confirmada: lo que el contador debería mirar aunque el lote se haya cargado. */
export interface ResultadoImportacionLote {
  avisos: string[];
}

// Lote de una fuente (CSV, TXT o JSON): crea el lote, lo valida y, sin filas observadas, lo confirma.
// Los TXT de la DGR de Tucumán (per…, ret…, reca…) se leen con su propio lector y se comprueban contra
// el CUIT del cliente, el período y la fuente elegida.
export async function importarLoteFuente({
  firmId,
  clientId,
  source,
  file,
  workpaperId,
  clientCuit,
  periodo,
  fuentes,
}: {
  firmId: string | null;
  clientId: string | null;
  source: WorkpaperSource;
  file: File;
  workpaperId: string;
  clientCuit: string;
  /** Período de la fuente: las fechas del archivo fuera de este rango se avisan. */
  periodo?: { startDate: string; endDate: string };
  /** Fuentes del legajo, para nombrar la correcta cuando el archivo se sube a otra. */
  fuentes?: readonly WorkpaperSource[];
}): Promise<ResultadoImportacionLote> {
  if (!source.taxTypeId || !source.periodId) {
    throw new Error("La fuente no tiene una obligación fiscal materializada");
  }
  const fuenteEquivocada = avisoDeFuenteEquivocada(file.name, source, fuentes);
  if (fuenteEquivocada) throw new Error(fuenteEquivocada);
  const content = await file.text();
  const { rows, avisos } = leerArchivoFuente(file.name, content, { clientCuit, ...(periodo ? { periodo } : {}) });
  if (rows.length > 20_000) throw new Error("El lote supera el máximo de 20.000 filas");
  const fileHash = await hashSourceFile(content);
  const batch = await api.post<{ id: string; status: string; errorRows: number }>(
    `/firms/${firmId}/clients/${clientId}/import-batches`,
    {
      origin: source.origin,
      taxTypeId: source.taxTypeId,
      periodId: source.periodId,
      adapterVersion: source.adapterVersion,
      fileName: file.name,
      fileHash,
      workpaperId,
      sourceCode: source.code,
    },
  );

  let status = batch.status;
  let errorRows = batch.errorRows;
  if (status === "UPLOADED") {
    const validation = await api.post<{ totals: { errorRows: number } }>(
      `/firms/${firmId}/clients/${clientId}/import-batches/${batch.id}/validate`,
      { rows },
    );
    status = "VALIDATED";
    errorRows = validation.totals.errorRows;
  }
  if (errorRows > 0) {
    throw new LoteConFilasObservadas(batch.id, errorRows, rows.length);
  }
  if (status === "VALIDATED") {
    await api.post(`/firms/${firmId}/clients/${clientId}/import-batches/${batch.id}/commit`, {
      clientCuit,
    });
  }
  return { avisos };
}
