import { Prisma } from "@prisma/client";
import type { ApprovedSnapshotData, ApprovedSnapshotField, ApprovedSnapshotSource } from "@contable/contracts";
import { prisma } from "../lib/prisma.js";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { apiReviewIssues, extractionForApi } from "./extraction-contract.js";

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

type SnapshotFieldRow = {
  key: string;
  rawValue: string | null;
  normalizedValue: string | null;
  correction: string | null;
  method: string;
};

type ListPath = { collection: "iva" | "percepciones"; property: string };

const LIST_PATH_BY_FIELD_KEY: Record<string, ListPath> = {
  vatRate: { collection: "iva", property: "alicuota" },
  vatAmount: { collection: "iva", property: "importe" },
  perceptionCategory: { collection: "percepciones", property: "categoria" },
  perceptionText: { collection: "percepciones", property: "tipo_texto" },
  perceptionAmount: { collection: "percepciones", property: "importe" },
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sourcePathForField(
  field: SnapshotFieldRow,
  voucherData: unknown,
  usedIndexes: Map<string, Set<number>>,
): { sourcePath: string | null; index: number | null } {
  const explicitPath = field.key.match(/^(iva|percepciones)(?:\[(\d+)\]|\.(\d+))\.([a-zA-Z0-9_]+)$/);
  if (explicitPath) {
    return {
      sourcePath: field.key,
      index: Number(explicitPath[2] ?? explicitPath[3]),
    };
  }

  const listPath = LIST_PATH_BY_FIELD_KEY[field.key];
  const voucher = objectValue(voucherData);
  const entries = listPath && voucher && Array.isArray(voucher[listPath.collection])
    ? voucher[listPath.collection] as unknown[]
    : null;
  if (!listPath || !entries || field.method.toUpperCase() === "HUMAN") {
    return { sourcePath: null, index: null };
  }

  const usedKey = `${listPath.collection}.${listPath.property}`;
  const used = usedIndexes.get(usedKey) ?? new Set<number>();
  usedIndexes.set(usedKey, used);
  const originalValue = field.normalizedValue ?? field.rawValue;
  if (originalValue === null) return { sourcePath: null, index: null };

  const index = entries.findIndex((entry, candidateIndex) => {
    if (used.has(candidateIndex)) return false;
    return objectValue(entry)?.[listPath.property] === originalValue;
  });
  if (index < 0) return { sourcePath: null, index: null };

  used.add(index);
  return {
    sourcePath: `${listPath.collection}[${index}].${listPath.property}`,
    index,
  };
}

function approvedSnapshotData(
  fields: SnapshotFieldRow[],
  extraction: { voucherData: unknown; reviewIssues: unknown },
): ApprovedSnapshotData {
  const usedIndexes = new Map<string, Set<number>>();
  const snapshotFields: ApprovedSnapshotField[] = fields.map((field) => {
    const originalValue = field.normalizedValue ?? field.rawValue;
    const isHuman = field.method.toUpperCase() === "HUMAN";
    const isCorrected = !isHuman && field.correction !== null;
    const source: ApprovedSnapshotSource = isHuman ? "HUMAN" : isCorrected ? "CORRECTED" : "AI";
    const path = sourcePathForField(field, extraction.voucherData, usedIndexes);

    return {
      key: field.key,
      value: field.correction ?? originalValue,
      source,
      originalValue: isCorrected ? originalValue : null,
      sourcePath: path.sourcePath,
      index: path.index,
    };
  });

  return { fields: snapshotFields, reviewIssues: apiReviewIssues(extraction.reviewIssues) };
}

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

  async getApprovedSnapshot(firmId: string, clientId: string, extractionId: string, ctx?: TenantContext) {
    return this.scoped(ctx, (tx) => tx.extractionApprovedSnapshot.findFirst({
      where: { firmId, clientId, extractionId },
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
      if (!REVIEWABLE_EXTRACTION_STATUSES.includes(extraction.status)) {
        throw new ExtractionError("El estado de la extracción cambió durante la operación");
      }
      const existingSnapshot = await tx.extractionApprovedSnapshot.findUnique({ where: { extractionId } });
      if (existingSnapshot) {
        throw new ExtractionError("El estado de la extracción cambió durante la operación");
      }
      const approvedAt = new Date();
      const updated = await tx.documentExtraction.updateMany({
        where: { id: extractionId, firmId, clientId, status: extraction.status },
        data: { status: "REVIEWED", reviewedByUserId: userId, reviewedAt: approvedAt },
      });
      if (updated.count !== 1) {
        throw new ExtractionError("El estado de la extracción cambió durante la operación");
      }

      // Leer todas las filas, sin filtrar por método, para incluir también cargas humanas.
      const fields = await tx.extractedField.findMany({
        where: { firmId, clientId, extractionId },
        orderBy: { id: "asc" },
      });
      const snapshot = await tx.extractionApprovedSnapshot.create({
        data: {
          firmId,
          clientId,
          documentId: extraction.documentId,
          extractionId,
          approvedBy: userId,
          approvedAt,
          schemaVersion: extraction.schemaVersion,
          ocrEngine: extraction.ocrEngine,
          model: extraction.model,
          provider: extraction.provider,
          promptVersion: extraction.promptVersion,
          data: approvedSnapshotData(fields, extraction),
        },
      });

      // La aprobación cierra la revisión del documento: sale de "Para revisar" (EXTRACTED)
      // y pasa a "Revisados" (REVIEWED) en la bandeja documental.
      await tx.document.update({ where: { id: extraction.documentId }, data: { status: "REVIEWED" } });
      await tx.auditEvent.create({
        data: {
          firmId,
          clientId,
          userId,
          actorKind: ctx?.actorKind ?? "USER",
          action: "document.extraction.approved",
          entityType: "DocumentExtraction",
          entityId: extractionId,
          before: { status: extraction.status },
          after: { status: "REVIEWED", approvedSnapshotId: snapshot.id },
        },
      });
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
