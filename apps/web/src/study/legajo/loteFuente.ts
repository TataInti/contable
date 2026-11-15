import { api } from "../../lib/api";
import { hashSourceFile, parseSourceFile } from "./archivoFuente";
import type { WorkpaperSource } from "./tipos";
import { pluralizar } from "./textos";

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

// Lote de una fuente (CSV, TXT o JSON): crea el lote, lo valida y, sin filas observadas, lo confirma.
export async function importarLoteFuente({
  firmId,
  clientId,
  source,
  file,
  workpaperId,
  clientCuit,
}: {
  firmId: string | null;
  clientId: string | null;
  source: WorkpaperSource;
  file: File;
  workpaperId: string;
  clientCuit: string;
}): Promise<void> {
  if (!source.taxTypeId || !source.periodId) {
    throw new Error("La fuente no tiene una obligación fiscal materializada");
  }
  const content = await file.text();
  const rows = parseSourceFile(file.name, content);
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
    throw new Error(
      `El lote quedó validado con ${pluralizar(errorRows, "fila observada", "filas observadas")}. Corregí el archivo antes de reimportar.`,
    );
  }
  if (status === "VALIDATED") {
    await api.post(`/firms/${firmId}/clients/${clientId}/import-batches/${batch.id}/commit`, {
      clientCuit,
    });
  }
}
