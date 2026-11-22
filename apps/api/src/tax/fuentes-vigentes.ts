import type { Prisma } from "@prisma/client";

/**
 * Fuentes vigentes (4K). Un único criterio para saber qué certificados de un lote retirado o
 * reemplazado dejan de contar, y un único lugar que los da de baja en las tablas derivadas.
 *
 * Regla: un lote retirado o reemplazado no aporta nada al cálculo. Sus certificados (retenciones y
 * percepciones) siguen en la base como registro, pero:
 * - sus imputaciones (taxInputAllocation) pasan a RETIRED al retirar o reemplazar (origen), y
 * - el cálculo ignora cualquier imputación o certificado cuyo lote esté solo en estado histórico,
 *   también los que ya quedaron ALLOCATED antes de esta corrección (la base no tiene DELETE).
 */

/** Estados del vínculo de un lote con el expediente que ya no cuentan. */
export const ESTADOS_HISTORICOS_VINCULO = ["RETIRED", "REPLACED"] as const;

/** Estado de una imputación cuya fuente fue retirada o reemplazada. */
export const ESTADO_IMPUTACION_RETIRADA = "RETIRED";

type Tx = Prisma.TransactionClient;

/**
 * Identificadores (sourceId) de los certificados de los tipos indicados cuyo lote solo tiene
 * vínculos históricos (retirado o reemplazado). Un lote sin ningún vínculo no se considera
 * histórico: sigue el criterio de siempre.
 */
export async function fuentesRetiradasOReemplazadas(
  tx: Tx,
  clientId: string,
  sourceTypes: readonly string[],
): Promise<Set<string>> {
  const filas = await tx.importRow.findMany({
    where: { clientId, sourceType: { in: [...sourceTypes] }, sourceId: { not: null } },
    select: {
      sourceId: true,
      batch: { select: { workpapers: { select: { status: true } } } },
    },
  });
  const retiradas = new Set<string>();
  for (const fila of filas) {
    const enlaces = fila.batch.workpapers;
    const soloHistoricos =
      enlaces.length > 0 &&
      enlaces.every((enlace) =>
        (ESTADOS_HISTORICOS_VINCULO as readonly string[]).includes(enlace.status),
      );
    if (soloHistoricos && fila.sourceId) retiradas.add(fila.sourceId);
  }
  return retiradas;
}

/**
 * Da de baja las imputaciones vivas de las fuentes de un lote que se retira o reemplaza. No borra
 * nada: cambia el estado a RETIRED para que el cálculo deje de sumarlas.
 */
export async function retirarImputacionesDelLote(
  tx: Tx,
  args: { workpaperId: string; importBatchId: string },
): Promise<number> {
  const filas = await tx.importRow.findMany({
    where: { batchId: args.importBatchId, sourceId: { not: null } },
    select: { sourceType: true, sourceId: true },
  });
  const ids = filas
    .filter((fila) => fila.sourceType === "WITHHOLDING" || fila.sourceType === "PERCEPTION")
    .map((fila) => fila.sourceId!);
  if (ids.length === 0) return 0;
  const cambio = await tx.taxInputAllocation.updateMany({
    where: {
      workpaperId: args.workpaperId,
      sourceId: { in: ids },
      status: { in: ["ALLOCATED", "RESERVED"] },
    },
    data: { status: ESTADO_IMPUTACION_RETIRADA },
  });
  return cambio.count;
}
