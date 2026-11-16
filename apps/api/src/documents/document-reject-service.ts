import type { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

const PROCESANDO = "Todavía se está procesando: esperá a que termine";

/** Error de dominio del rechazo de un documento: código estable y mensaje en lenguaje llano (P4). */
export class DocumentRejectError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DocumentRejectError";
  }
}

type RejectTransactionRunner = <T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

const defaultTransactionRunner: RejectTransactionRunner = (ctx, fn) => withTenantContext(ctx, fn);

const noEncontrado = () =>
  new DocumentRejectError("DOCUMENT_NOT_FOUND", 404, "Documento no encontrado");

/**
 * Rechazo de un documento que falló al procesarse (D23-1 a, etapa 1): FAILED → EXTRACTION_FAILED.
 * Comparte estado y auditoría con el rechazo de una extracción (un concepto, un lugar). No vuelve a
 * procesar el archivo: para reemplazarlo se sube otro. Serializa con FOR UPDATE, como la relectura.
 */
export class DocumentRejectService {
  constructor(private readonly runInTenant: RejectTransactionRunner = defaultTransactionRunner) {}

  async reject(
    ctx: TenantContext,
    documentId: string,
    reason: string,
  ): Promise<{ status: "EXTRACTION_FAILED" }> {
    const clientId = ctx.clientId;
    if (!clientId) throw noEncontrado();

    return this.runInTenant(ctx, async (tx) => {
      // Serializa rechazos, relecturas y aprobaciones sobre el documento.
      const documents = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT "id", "status"
        FROM "documents"
        WHERE "id" = ${documentId}
          AND "firmId" = ${ctx.firmId}
          AND "clientId" = ${clientId}
        FOR UPDATE
      `;
      const document = documents[0];
      if (!document) throw noEncontrado();

      if (document.status === "EXTRACTION_FAILED") {
        throw new DocumentRejectError("DOCUMENT_ALREADY_REJECTED", 409, "Ya está rechazado");
      }
      if (document.status === "EXTRACTED") {
        throw new DocumentRejectError(
          "DOCUMENT_HAS_EXTRACTION",
          409,
          "Rechazá la extracción desde la revisión",
        );
      }
      const activeJob = await tx.documentProcessingJob.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId,
          documentId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      });
      if (activeJob || document.status === "UPLOADED" || document.status === "VALIDATING") {
        throw new DocumentRejectError("DOCUMENT_STILL_PROCESSING", 409, PROCESANDO);
      }
      if (document.status !== "FAILED") {
        throw new DocumentRejectError(
          "DOCUMENT_NOT_REJECTABLE",
          409,
          "Solo se rechaza un documento que falló al procesarse",
        );
      }

      const transitioned = await tx.document.updateMany({
        where: { id: documentId, firmId: ctx.firmId, clientId, status: "FAILED" },
        data: { status: "EXTRACTION_FAILED" },
      });
      if (transitioned.count !== 1) {
        throw new DocumentRejectError(
          "DOCUMENT_STATE_CHANGED",
          409,
          "El estado del documento cambió. Actualizá la bandeja e intentá de nuevo",
        );
      }

      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "document.extraction.rejected",
          entityType: "Document",
          entityId: documentId,
          before: { status: "FAILED" },
          after: { status: "EXTRACTION_FAILED", reason },
        },
      });
      return { status: "EXTRACTION_FAILED" as const };
    });
  }
}
