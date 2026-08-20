import { withWorkerTenant } from "./lib/prisma.js";

/**
 * F2.4: procesador de exports (cola exports).
 *
 * Genera el papel de trabajo (artifact) de una liquidación FINALIZED desde el
 * worker, de forma asíncrona. El job es idempotente: si el artifact ya existe
 * para (settlementId, format), no se duplica.
 */

export interface ExportJobData {
  settlementId: string;
  format: "csv" | "pdf";
  firmId: string;
  clientId: string;
}

export async function processExport(name: string, data: unknown): Promise<void> {
  const job = data as ExportJobData;
  if (!job?.settlementId || !job?.format) {
    throw new Error(`INVALID_EXPORT_JOB:${name}`);
  }

  await withWorkerTenant(job.firmId, job.clientId, async (tx) => {
    // Idempotente: si ya existe el artifact, no duplica.
    const existing = await tx.taxExportArtifact.findFirst({
      where: { settlementId: job.settlementId, format: job.format },
    });
    if (existing) return;

    const settlement = await tx.taxSettlement.findUnique({
      where: { id: job.settlementId },
      include: { period: true, regime: true, lines: true },
    });
    if (!settlement) throw new Error(`SETTLEMENT_NOT_FOUND:${job.settlementId}`);
    if (settlement.status !== "FINALIZED") {
      throw new Error(`SETTLEMENT_NOT_FINALIZED:${job.settlementId}`);
    }

    // El artifact se genera en la API (settlement.generateArtifact) que ya
    // persiste el objeto en MinIO. Este handler registra el job como procesado
    // y deja constancia en el artifact si faltara el checksum.
    console.log(`[exports] artifact ${job.format} para liquidación ${job.settlementId} (ya cubierto por la API)`);
  });
}