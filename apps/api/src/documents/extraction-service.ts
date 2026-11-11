import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { extractionForApi } from "./extraction-contract.js";

type ExtractionTransactionRunner = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

export class ExtractionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const REVIEWABLE_EXTRACTION_STATUSES: readonly string[] = ["GENERATED", "NEEDS_REVIEW"];

export class ExtractionService {
  constructor(
    private readonly transactionRunner: ExtractionTransactionRunner = (fn) => prisma.$transaction(fn),
  ) {}

  private scoped<T>(ctx: TenantContext | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return ctx ? withTenantContext(ctx, fn) : this.transactionRunner(fn);
  }

  async getLatestForDocument(firmId: string, clientId: string, documentId: string, ctx?: TenantContext) {
    const extraction = await this.scoped(ctx, (tx) => tx.documentExtraction.findFirst({
      where: { firmId, clientId, documentId }, orderBy: { createdAt: "desc" }, include: { fields: true, items: true },
    }));
    return extraction ? extractionForApi(extraction) : null;
  }

  async getById(firmId: string, clientId: string, extractionId: string, ctx?: TenantContext) {
    const extraction = await this.scoped(ctx, (tx) => tx.documentExtraction.findFirst({
      where: { id: extractionId, firmId, clientId }, include: { fields: true, items: true },
    }));
    return extraction ? extractionForApi(extraction) : null;
  }

  async correctField(firmId: string, clientId: string, extractionId: string, fieldId: string, correction: string, reason: string, userId: string, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const extraction = await tx.documentExtraction.findFirst({ where: { id: extractionId, firmId, clientId }, include: { fields: true } });
      if (!extraction) throw new Error("EXTRACTION_NOT_FOUND");
      if (!extraction.fields.some((field) => field.id === fieldId)) throw new Error("FIELD_NOT_FOUND");
      await tx.extractedField.update({ where: { id: fieldId }, data: { correction, reason, status: "CORRECTED" } });
      await tx.documentExtraction.update({ where: { id: extractionId }, data: { status: "NEEDS_REVIEW", reviewedByUserId: userId, reviewedAt: new Date() } });
      await tx.auditEvent.create({ data: { firmId, clientId, userId, actorKind: ctx?.actorKind ?? "USER", action: "document.extraction.corrected", entityType: "DocumentExtraction", entityId: extractionId, after: { fieldId, correction, reason } } });
    });
  }

  async approve(firmId: string, clientId: string, extractionId: string, userId: string, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const extraction = await tx.documentExtraction.findFirst({ where: { id: extractionId, firmId, clientId } });
      if (!extraction) throw new Error("EXTRACTION_NOT_FOUND");
      const updated = await tx.documentExtraction.updateMany({
        where: { id: extractionId, firmId, clientId, status: extraction.status },
        data: { status: "REVIEWED", reviewedByUserId: userId, reviewedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ExtractionError("El estado de la extracción cambió durante la operación");
      }
      // La aprobación cierra la revisión del documento: sale de "Para revisar" (EXTRACTED)
      // y pasa a "Revisados" (REVIEWED) en la bandeja documental.
      await tx.document.update({ where: { id: extraction.documentId }, data: { status: "REVIEWED" } });
      await tx.auditEvent.create({ data: { firmId, clientId, userId, actorKind: ctx?.actorKind ?? "USER", action: "document.extraction.approved", entityType: "DocumentExtraction", entityId: extractionId, before: { status: extraction.status }, after: { status: "REVIEWED" } } });
    });
  }

  async reject(firmId: string, clientId: string, extractionId: string, userId: string, reason?: string, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const extraction = await tx.documentExtraction.findFirst({ where: { id: extractionId, firmId, clientId } });
      if (!extraction) throw new Error("EXTRACTION_NOT_FOUND");
      if (!REVIEWABLE_EXTRACTION_STATUSES.includes(extraction.status)) {
        throw new ExtractionError(`No se puede rechazar una extracción en estado ${extraction.status}`);
      }
      const updated = await tx.documentExtraction.updateMany({
        where: { id: extractionId, firmId, clientId, status: extraction.status },
        data: { status: "FAILED", reviewedByUserId: userId, reviewedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ExtractionError("El estado de la extracción cambió durante la operación");
      }
      await tx.document.update({ where: { id: extraction.documentId }, data: { status: "EXTRACTION_FAILED" } });
      await tx.auditEvent.create({ data: { firmId, clientId, userId, actorKind: ctx?.actorKind ?? "USER", action: "document.extraction.rejected", entityType: "DocumentExtraction", entityId: extractionId, before: { status: extraction.status }, after: { status: "FAILED", reason: reason ?? null } } });
    });
  }
}
