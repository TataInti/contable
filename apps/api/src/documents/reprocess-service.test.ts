import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { DocumentReprocessService } from "./reprocess-service.js";
import { ExtractionService } from "./extraction-service.js";
import { documentRoutes } from "./routes.js";
import { outboxPublisher } from "../jobs/outbox-publisher.js";
import type { TenantContext } from "../auth/tenant.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_A = "11111111-2222-4333-8444-555555555555";
const RUNTIME_DATABASE_URL = process.env.RUNTIME_DATABASE_URL ?? "postgresql://contable_runtime:***@localhost:5432/contable";
const runtimePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: RUNTIME_DATABASE_URL }) });
const context: TenantContext = { userId: OWNER_A, firmId: FIRM_A, clientId: CLIENT_A, actorKind: "USER" };

const fixtureDocuments: string[] = [];
const fixtureOutboxIds: string[] = [];

type TransactionRunner = <T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

const runAsRuntime: TransactionRunner = (ctx, fn) => runtimePrisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
  await tx.$queryRaw`SELECT set_config('app.firm_id', ${ctx.firmId}, true)`;
  await tx.$queryRaw`SELECT set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
  await tx.$queryRaw`SELECT set_config('app.actor_kind', ${ctx.actorKind}, true)`;
  return fn(tx);
});

const service = new DocumentReprocessService(runAsRuntime);

function reprocessRoutesApp() {
  const app = Fastify({ logger: false });
  app.decorateRequest("userId", undefined);
  app.decorateRequest("firmId", undefined);
  app.decorateRequest("clientId", undefined);
  app.addHook("onRequest", async (request) => {
    request.userId = OWNER_A;
    request.firmId = FIRM_A;
    request.clientId = CLIENT_A;
  });
  documentRoutes(app);
  return app;
}

async function createFixture(options: {
  extractionStatus?: "GENERATED" | "NEEDS_REVIEW" | "REVIEWED" | "FAILED";
  documentStatus?: "EXTRACTED" | "REVIEWED" | "EXTRACTION_FAILED";
  includeManualField?: boolean;
  reviewReason?: string | null;
} = {}) {
  const extractionStatus = options.extractionStatus ?? "NEEDS_REVIEW";
  const documentStatus = options.documentStatus ?? "EXTRACTED";
  const document = await prisma.document.create({
    data: {
      firmId: FIRM_A,
      clientId: CLIENT_A,
      uploadedByUserId: OWNER_A,
      uploadOrigin: "FIRM",
      status: documentStatus,
    },
  });
  fixtureDocuments.push(document.id);

  const fileVersion = await prisma.documentFileVersion.create({
    data: {
      firmId: FIRM_A,
      clientId: CLIENT_A,
      documentId: document.id,
      originalName: `reprocess-${document.id}.pdf`,
      mimeType: "application/pdf",
      extension: "pdf",
      sizeBytes: 1,
      sha256: "b".repeat(64),
      bucket: "originals",
      objectKey: `test/reprocess-${document.id}.pdf`,
      antivirusStatus: "CLEAN",
    },
  });
  const extraction = await prisma.documentExtraction.create({
    data: {
      firmId: FIRM_A,
      clientId: CLIENT_A,
      documentId: document.id,
      fileVersionId: fileVersion.id,
      schemaVersion: "voucher-ar-v1",
      status: extractionStatus,
      ocrEngine: "tesseract-ocr",
      promptVersion: "voucher-ar-v1",
      reviewReason: options.reviewReason ?? null,
      ...(extractionStatus === "REVIEWED" || extractionStatus === "FAILED"
        ? { reviewedByUserId: OWNER_A, reviewedAt: new Date("2026-01-01T00:00:00.000Z") }
        : {}),
      ...(options.includeManualField
        ? {
            fields: {
              create: [{
                firmId: FIRM_A,
                clientId: CLIENT_A,
                key: "totalAmount",
                rawValue: null,
                normalizedValue: null,
                correction: "1234.56",
                confidence: 0,
                method: "HUMAN",
                status: "CORRECTED",
              }],
            },
          }
        : {}),
    },
  });
  await prisma.document.update({
    where: { id: document.id },
    data: { currentFileVersionId: fileVersion.id, currentExtractionId: extraction.id },
  });
  return { documentId: document.id, fileVersionId: fileVersion.id, extractionId: extraction.id };
}

async function cleanupFixtures() {
  const documents = fixtureDocuments.splice(0);
  if (!documents.length) return;
  const jobs = await prisma.documentProcessingJob.findMany({
    where: { documentId: { in: documents } },
    select: { id: true },
  });
  const outboxIds = [...fixtureOutboxIds.splice(0), ...jobs.map((job) => job.id)];
  if (outboxIds.length) {
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: outboxIds } } });
  }
  await prisma.document.deleteMany({ where: { id: { in: documents } } });
}

afterEach(cleanupFixtures);
afterAll(async () => {
  await runtimePrisma.$disconnect();
});

describe("relectura de documentos", () => {
  it("la ruta POST devuelve 202 y despacha el outbox", async () => {
    const fixture = await createFixture({ extractionStatus: "GENERATED" });
    const app = reprocessRoutesApp();
    const dispatch = vi.spyOn(outboxPublisher, "dispatchPending").mockResolvedValue(1);

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_A}/clients/${CLIENT_A}/documents/${fixture.documentId}/reprocess`,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ data: { status: "QUEUED", processingJobId: expect.any(String) } });
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      await app.close();
      dispatch.mockRestore();
    }
  });

  it("mantiene bloqueada la corrección de una lectura reemplazada", async () => {
    const fixture = await createFixture({ includeManualField: true });
    await prisma.documentExtraction.update({
      where: { id: fixture.extractionId },
      data: { status: "SUPERSEDED" },
    });
    const field = await prisma.extractedField.findFirstOrThrow({
      where: { extractionId: fixture.extractionId },
    });
    const before = await prisma.documentExtraction.findUniqueOrThrow({
      where: { id: fixture.extractionId },
      include: { fields: true },
    });

    await expect(new ExtractionService().correctField(
      FIRM_A,
      CLIENT_A,
      fixture.extractionId,
      field.id,
      "999.99",
      "Intento de cambio histórico",
      OWNER_A,
      context,
    )).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const after = await prisma.documentExtraction.findUniqueOrThrow({
      where: { id: fixture.extractionId },
      include: { fields: true },
    });
    expect(after).toEqual(before);
  });

  it.each([
    ["legacy Tesseract", { extractionStatus: "GENERATED" as const, reviewReason: null }],
    ["sin datos por lectura no disponible", { extractionStatus: "NEEDS_REVIEW" as const, reviewReason: "AI_SERVICE_UNAVAILABLE" }],
  ])("encola una lectura nueva para una extracción %s y preserva la anterior", async (_label, options) => {
    const fixture = await createFixture({ ...options, includeManualField: true });
    const oldExtractionBefore = await prisma.documentExtraction.findUniqueOrThrow({
      where: { id: fixture.extractionId },
      include: { fields: true },
    });

    const result = await service.request(context, fixture.documentId);

    expect(result.status).toBe("QUEUED");
    const [document, job, oldExtractionAfter, audit, outbox] = await Promise.all([
      prisma.document.findUniqueOrThrow({ where: { id: fixture.documentId } }),
      prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: result.processingJobId } }),
      prisma.documentExtraction.findUniqueOrThrow({ where: { id: fixture.extractionId }, include: { fields: true } }),
      prisma.auditEvent.findFirst({
        where: { action: "document.reprocess_requested", entityId: fixture.documentId },
      }),
      prisma.outboxEvent.findFirst({ where: { aggregateId: result.processingJobId } }),
    ]);

    expect(document.status).toBe("VALIDATING");
    expect(job).toMatchObject({ type: "REPROCESS", status: "QUEUED", documentId: fixture.documentId });
    expect(oldExtractionAfter).toEqual(oldExtractionBefore);
    expect(audit).toMatchObject({
      userId: OWNER_A,
      firmId: FIRM_A,
      clientId: CLIENT_A,
      action: "document.reprocess_requested",
      entityType: "Document",
      entityId: fixture.documentId,
      before: { status: "EXTRACTED", extractionId: fixture.extractionId },
      after: { status: "VALIDATING", previousExtractionId: fixture.extractionId, processingJobId: result.processingJobId },
    });
    expect(outbox?.payload).toMatchObject({
      documentId: fixture.documentId,
      fileVersionId: fixture.fileVersionId,
      processingJobId: result.processingJobId,
      previousExtractionId: fixture.extractionId,
      reprocess: true,
    });
  });

  it.each([
    ["aprobada", "REVIEWED" as const, "REVIEWED" as const],
    ["rechazada", "FAILED" as const, "EXTRACTION_FAILED" as const],
  ])("rechaza una extracción %s con 409 sin crear job", async (_label, extractionStatus, documentStatus) => {
    const fixture = await createFixture({ extractionStatus, documentStatus });

    await expect(service.request(context, fixture.documentId)).rejects.toMatchObject({
      name: "DocumentReprocessError",
      statusCode: 409,
    });
    expect(await prisma.documentProcessingJob.count({ where: { documentId: fixture.documentId } })).toBe(0);
    expect(await prisma.auditEvent.count({
      where: { action: "document.reprocess_requested", entityId: fixture.documentId },
    })).toBe(0);
  });

  it("responde 409 y no agrega otro job cuando ya existe uno en curso", async () => {
    const fixture = await createFixture();
    const activeJob = await prisma.documentProcessingJob.create({
      data: {
        firmId: FIRM_A,
        clientId: CLIENT_A,
        documentId: fixture.documentId,
        fileVersionId: fixture.fileVersionId,
        type: "REPROCESS",
        status: "RUNNING",
        deduplicationKey: `test-active:${fixture.documentId}`,
      },
    });

    await expect(service.request(context, fixture.documentId)).rejects.toMatchObject({
      statusCode: 409,
      code: "REPROCESS_IN_PROGRESS",
    });
    expect(await prisma.documentProcessingJob.count({ where: { documentId: fixture.documentId } })).toBe(1);
    fixtureOutboxIds.push(activeJob.id);
  });

  it("aplica el límite de tres relecturas en una hora", async () => {
    const fixture = await createFixture();
    for (let index = 0; index < 3; index += 1) {
      await prisma.documentProcessingJob.create({
        data: {
          firmId: FIRM_A,
          clientId: CLIENT_A,
          documentId: fixture.documentId,
          fileVersionId: fixture.fileVersionId,
          type: "REPROCESS",
          status: "SUCCEEDED",
          deduplicationKey: `test-limit:${fixture.documentId}:${index}`,
        },
      });
    }

    await expect(service.request(context, fixture.documentId)).rejects.toMatchObject({
      name: "DocumentReprocessError",
      statusCode: 429,
      code: "REPROCESS_LIMIT_REACHED",
    });
    expect(await prisma.documentProcessingJob.count({ where: { documentId: fixture.documentId } })).toBe(3);
    expect(await prisma.document.findUniqueOrThrow({ where: { id: fixture.documentId } })).toMatchObject({ status: "EXTRACTED" });
  });

  it("limita la consulta al tenant de la sesión y devuelve 404 para otra firma", async () => {
    const fixture = await createFixture();
    const otherFirmContext: TenantContext = {
      userId: OWNER_A,
      firmId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      clientId: "22222222-2222-4222-8222-222222222222",
      actorKind: "USER",
    };
    const otherTenantService = new DocumentReprocessService(runAsRuntime);

    await expect(otherTenantService.request(otherFirmContext, fixture.documentId)).rejects.toMatchObject({
      name: "DocumentReprocessError",
      statusCode: 404,
      code: "DOCUMENT_NOT_FOUND",
    });
    expect(await prisma.documentProcessingJob.count({ where: { documentId: fixture.documentId } })).toBe(0);
  });

  it("revierte estado, job y outbox si falla la auditoría", async () => {
    const fixture = await createFixture();
    const outboxBefore = await prisma.outboxEvent.count({
      where: { firmId: FIRM_A, clientId: CLIENT_A, eventType: "document.reprocess" },
    });
    const failingAuditRunner: TransactionRunner = (ctx, fn) => runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${ctx.firmId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', ${ctx.actorKind}, true)`;
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === "auditEvent") {
            return new Proxy(target.auditEvent, {
              get(delegate, method) {
                if (method === "create") return async () => { throw new Error("INJECTED_AUDIT_FAILURE"); };
                const value = Reflect.get(delegate, method, delegate);
                return typeof value === "function" ? value.bind(delegate) : value;
              },
            });
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return fn(wrapped as Prisma.TransactionClient);
    });
    const failingService = new DocumentReprocessService(failingAuditRunner);

    await expect(failingService.request(context, fixture.documentId)).rejects.toThrow("INJECTED_AUDIT_FAILURE");
    expect(await prisma.document.findUniqueOrThrow({ where: { id: fixture.documentId } })).toMatchObject({ status: "EXTRACTED" });
    expect(await prisma.documentProcessingJob.count({ where: { documentId: fixture.documentId } })).toBe(0);
    expect(await prisma.outboxEvent.count({
      where: { firmId: FIRM_A, clientId: CLIENT_A, eventType: "document.reprocess" },
    })).toBe(outboxBefore);
    expect(await prisma.auditEvent.count({
      where: { action: "document.reprocess_requested", entityId: fixture.documentId },
    })).toBe(0);
  });
});
