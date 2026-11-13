import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

const REPROCESS_LIMIT_PER_HOUR = 3;
const REPROCESS_WINDOW_MS = 60 * 60 * 1_000;

export class DocumentReprocessError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 404 | 409 | 429,
    message: string,
  ) {
    super(message);
    this.name = "DocumentReprocessError";
  }
}

type ReprocessTransactionRunner = <T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

const defaultTransactionRunner: ReprocessTransactionRunner = (ctx, fn) =>
  withTenantContext(ctx, fn);

/** Encola una nueva lectura IA sin modificar la extracción que ya existe. */
export class DocumentReprocessService {
  constructor(private readonly runInTenant: ReprocessTransactionRunner = defaultTransactionRunner) {}

  async request(ctx: TenantContext, documentId: string) {
    const clientId = ctx.clientId;
    if (!clientId) {
      throw new DocumentReprocessError("DOCUMENT_NOT_FOUND", 404, "Documento no encontrado");
    }

    return this.runInTenant(ctx, async (tx) => {
      // Serializa relecturas, aprobaciones y rechazos sobre el documento.
      const documents = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        currentFileVersionId: string | null;
        currentExtractionId: string | null;
      }>>`
        SELECT "id", "status", "currentFileVersionId", "currentExtractionId"
        FROM "documents"
        WHERE "id" = ${documentId}
          AND "firmId" = ${ctx.firmId}
          AND "clientId" = ${clientId}
        FOR UPDATE
      `;
      const document = documents[0];
      if (!document) {
        throw new DocumentReprocessError("DOCUMENT_NOT_FOUND", 404, "Documento no encontrado");
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
      if (activeJob) {
        throw new DocumentReprocessError(
          "REPROCESS_IN_PROGRESS",
          409,
          "Ya hay un procesamiento en curso para este documento. Esperá a que termine.",
        );
      }
      if (document.status !== "EXTRACTED") {
        throw new DocumentReprocessError(
          "DOCUMENT_NOT_REPROCESSABLE",
          409,
          "El documento no está en un estado que permita releerlo.",
        );
      }

      const previousExtraction = document.currentExtractionId
        ? await tx.documentExtraction.findFirst({
            where: {
              id: document.currentExtractionId,
              firmId: ctx.firmId,
              clientId,
              documentId,
            },
          })
        : await tx.documentExtraction.findFirst({
            where: { firmId: ctx.firmId, clientId, documentId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
      if (!previousExtraction) {
        throw new DocumentReprocessError(
          "EXTRACTION_NOT_FOUND",
          409,
          "El documento todavía no tiene una extracción para releer.",
        );
      }
      if (!["GENERATED", "NEEDS_REVIEW"].includes(previousExtraction.status)) {
        throw new DocumentReprocessError(
          "EXTRACTION_NOT_REPROCESSABLE",
          409,
          "Solo se pueden releer extracciones pendientes de revisión.",
        );
      }
      const approvedSnapshot = await tx.extractionApprovedSnapshot.findUnique({
        where: { extractionId: previousExtraction.id },
        select: { id: true },
      });
      if (approvedSnapshot) {
        throw new DocumentReprocessError(
          "EXTRACTION_NOT_REPROCESSABLE",
          409,
          "La extracción aprobada conserva una foto fija y no se puede releer.",
        );
      }

      if (!document.currentFileVersionId) {
        throw new DocumentReprocessError(
          "DOCUMENT_FILE_NOT_READY",
          409,
          "El archivo todavía no está listo para releerse.",
        );
      }
      const fileVersion = await tx.documentFileVersion.findFirst({
        where: {
          id: document.currentFileVersionId,
          firmId: ctx.firmId,
          clientId,
          documentId,
          bucket: "originals",
          antivirusStatus: "CLEAN",
        },
        select: { id: true },
      });
      if (!fileVersion) {
        throw new DocumentReprocessError(
          "DOCUMENT_FILE_NOT_READY",
          409,
          "El archivo todavía no está listo para releerse.",
        );
      }

      const now = new Date();
      const recentReprocessCount = await tx.documentProcessingJob.count({
        where: {
          firmId: ctx.firmId,
          clientId,
          documentId,
          type: "REPROCESS",
          createdAt: { gte: new Date(now.getTime() - REPROCESS_WINDOW_MS) },
        },
      });
      if (recentReprocessCount >= REPROCESS_LIMIT_PER_HOUR) {
        throw new DocumentReprocessError(
          "REPROCESS_LIMIT_REACHED",
          429,
          "Se alcanzó el máximo de 3 relecturas por documento en una hora. Intentá de nuevo más tarde.",
        );
      }

      // El estado del documento comunica el trabajo en curso y bloquea una
      // aprobación/rechazo concurrente; job, outbox y auditoría se confirman juntos.
      const transitioned = await tx.document.updateMany({
        where: {
          id: documentId,
          firmId: ctx.firmId,
          clientId,
          status: "EXTRACTED",
          currentFileVersionId: document.currentFileVersionId,
        },
        data: { status: "VALIDATING" },
      });
      if (transitioned.count !== 1) {
        throw new DocumentReprocessError(
          "DOCUMENT_NOT_REPROCESSABLE",
          409,
          "El estado del documento cambió. Actualizá la bandeja e intentá de nuevo.",
        );
      }

      const job = await tx.documentProcessingJob.create({
        data: {
          firmId: ctx.firmId,
          clientId,
          documentId,
          fileVersionId: fileVersion.id,
          type: "REPROCESS",
          status: "QUEUED",
          deduplicationKey: `reprocess:${documentId}:${randomUUID()}`,
        },
      });
      await tx.$executeRaw`SELECT app_create_outbox(
        ${ctx.firmId}::text,
        ${clientId}::text,
        'documents'::text,
        'document.reprocess'::text,
        ${job.id}::text,
        ${JSON.stringify({
          documentId,
          fileVersionId: fileVersion.id,
          firmId: ctx.firmId,
          clientId,
          processingJobId: job.id,
          previousExtractionId: previousExtraction.id,
          reprocess: true,
        })}::jsonb
      )`;
      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "document.reprocess_requested",
          entityType: "Document",
          entityId: documentId,
          before: { status: document.status, extractionId: previousExtraction.id },
          after: {
            status: "VALIDATING",
            processingJobId: job.id,
            previousExtractionId: previousExtraction.id,
          },
        },
      });

      return { status: "QUEUED" as const, processingJobId: job.id };
    });
  }
}
