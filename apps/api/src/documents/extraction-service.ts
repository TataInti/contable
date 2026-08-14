import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

export class ExtractionService {
  private scoped<T>(ctx: TenantContext | undefined, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return ctx ? withTenantContext(ctx, fn) : prisma.$transaction(fn);
  }

  async getLatestForDocument(firmId: string, clientId: string, documentId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.documentExtraction.findFirst({
      where: { firmId, clientId, documentId }, orderBy: { createdAt: "desc" }, include: { fields: true, items: true },
    }));
  }

  async getById(firmId: string, clientId: string, extractionId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.documentExtraction.findFirst({
      where: { id: extractionId, firmId, clientId }, include: { fields: true, items: true },
    }));
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
      await tx.documentExtraction.update({ where: { id: extractionId }, data: { status: "REVIEWED", reviewedByUserId: userId, reviewedAt: new Date() } });
      await tx.auditEvent.create({ data: { firmId, clientId, userId, actorKind: ctx?.actorKind ?? "USER", action: "document.extraction.approved", entityType: "DocumentExtraction", entityId: extractionId, before: { status: extraction.status }, after: { status: "REVIEWED" } } });
    });
  }

  async reject(firmId: string, clientId: string, extractionId: string, userId: string, reason?: string, ctx?: TenantContext) {
    return this.scoped(ctx, async (tx) => {
      const extraction = await tx.documentExtraction.findFirst({ where: { id: extractionId, firmId, clientId } });
      if (!extraction) throw new Error("EXTRACTION_NOT_FOUND");
      await tx.documentExtraction.update({ where: { id: extractionId }, data: { status: "FAILED", reviewedByUserId: userId, reviewedAt: new Date() } });
      await tx.document.update({ where: { id: extraction.documentId }, data: { status: "EXTRACTION_FAILED" } });
      await tx.auditEvent.create({ data: { firmId, clientId, userId, actorKind: ctx?.actorKind ?? "USER", action: "document.extraction.rejected", entityType: "DocumentExtraction", entityId: extractionId, before: { status: extraction.status }, after: { status: "FAILED", reason: reason ?? null } } });
    });
  }
}
