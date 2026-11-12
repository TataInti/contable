import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { ExtractionService } from "./extraction-service.js";
import { documentRoutes } from "./routes.js";

/**
 * Tests de integración del servicio de extracción (Fase 5).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EXTRACTION_TEST_CLIENT = "11111111-2222-4333-8444-555555555555";

const runtimeConnection =
  process.env.RUNTIME_DATABASE_URL ??
  "postgresql://contable_runtime:runtime_secret@localhost:5432/contable";
const runtimeAdapter = new PrismaPg({ connectionString: runtimeConnection });
const runtimePrisma = new PrismaClient({ adapter: runtimeAdapter });

async function runAsRuntime<T>(
  userId: string,
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    return fn(tx);
  });
}

const service = new ExtractionService();

describe("extracción (integración DB)", () => {
  it("crea una extracción con campos e ítems", async () => {
    const created = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      // Buscar un documento existente del seed para asociar la extracción
      const doc = await tx.document.findFirst({ where: { firmId: FIRM_ALFA, clientId: CLIENT_ALFA } });
      if (!doc) return null;
      const fv = await tx.documentFileVersion.findFirst({ where: { documentId: doc.id } });
      if (!fv) return null;

      return tx.documentExtraction.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          documentId: doc.id,
          fileVersionId: fv.id,
          schemaVersion: "voucher-ar-v1",
          status: "GENERATED",
          classification: "INVOICE",
          confidence: 0.9,
          ocrEngine: "embedded-text",
          fields: {
            create: [
              {
                firmId: FIRM_ALFA,
                clientId: CLIENT_ALFA,
                key: "totalAmount",
                rawValue: "121000.00",
                normalizedValue: "121000.00",
                confidence: 0.9,
                method: "EMBEDDED_TEXT",
              },
            ],
          },
        },
        include: { fields: true },
      });
    });

    if (created) {
      expect(created.classification).toBe("INVOICE");
      expect(created.fields).toHaveLength(1);
    }
  });

  it("aprueba una extracción", async () => {
    const result = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const doc = await tx.document.findFirst({ where: { firmId: FIRM_ALFA, clientId: CLIENT_ALFA } });
      if (!doc) return null;
      const fv = await tx.documentFileVersion.findFirst({ where: { documentId: doc.id } });
      if (!fv) return null;

      // Estado previo: documento extraído esperando revisión (como deja el worker).
      await tx.document.update({ where: { id: doc.id }, data: { status: "EXTRACTED" } });
      const extraction = await tx.documentExtraction.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          documentId: doc.id,
          fileVersionId: fv.id,
          schemaVersion: "voucher-ar-v1",
          status: "NEEDS_REVIEW",
        },
      });
      return { extractionId: extraction.id, documentId: doc.id };
    });

    if (result) {
      await service.approve(FIRM_ALFA, CLIENT_ALFA, result.extractionId, OWNER_A);
      const updated = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.documentExtraction.findUnique({ where: { id: result.extractionId } }),
      );
      expect(updated?.status).toBe("REVIEWED");
      // Regresión: aprobar la extracción también cierra la revisión del documento
      // (sale de "Para revisar" y pasa a "Revisados" en la bandeja).
      const document = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.document.findUnique({ where: { id: result.documentId } }),
      );
      expect(document?.status).toBe("REVIEWED");
    }
  });
});

type ExtractionFixtureStatus = "GENERATED" | "NEEDS_REVIEW" | "REVIEWED" | "FAILED";
type ExtractionFixture = { extractionId: string; documentId: string };

const createdFixtures: ExtractionFixture[] = [];
const extractionContext = {
  userId: OWNER_A,
  firmId: FIRM_ALFA,
  clientId: EXTRACTION_TEST_CLIENT,
  actorKind: "USER" as const,
};

async function createExtractionFixture(status: ExtractionFixtureStatus): Promise<ExtractionFixture> {
  const fixture = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const document = await tx.document.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: EXTRACTION_TEST_CLIENT,
        uploadedByUserId: OWNER_A,
        uploadOrigin: "FIRM",
        status: status === "REVIEWED" ? "REVIEWED" : status === "FAILED" ? "EXTRACTION_FAILED" : "EXTRACTED",
      },
    });
    const fileVersion = await tx.documentFileVersion.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: EXTRACTION_TEST_CLIENT,
        documentId: document.id,
        originalName: `extraction-${document.id}.pdf`,
        mimeType: "application/pdf",
        extension: "pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        bucket: "originals",
        objectKey: `test/${document.id}.pdf`,
        antivirusStatus: "CLEAN",
      },
    });
    const extraction = await tx.documentExtraction.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: EXTRACTION_TEST_CLIENT,
        documentId: document.id,
        fileVersionId: fileVersion.id,
        schemaVersion: "voucher-ar-v1",
        status,
        ...(status === "REVIEWED" || status === "FAILED"
          ? { reviewedByUserId: OWNER_A, reviewedAt: new Date("2026-01-01T00:00:00.000Z") }
          : {}),
      },
    });
    await tx.document.update({ where: { id: document.id }, data: { currentFileVersionId: fileVersion.id } });
    if (status === "FAILED") {
      await tx.auditEvent.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: EXTRACTION_TEST_CLIENT,
          userId: OWNER_A,
          actorKind: "USER",
          action: "document.extraction.rejected",
          entityType: "DocumentExtraction",
          entityId: extraction.id,
          before: { status: "NEEDS_REVIEW" },
          after: { status: "FAILED", reason: "Rechazo previo" },
        },
      });
    }
    return { extractionId: extraction.id, documentId: document.id };
  });
  createdFixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  const fixtures = createdFixtures.splice(0);
  if (fixtures.length === 0) return;
  const documentIds = fixtures.map((fixture) => fixture.documentId);
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
});

function extractionRoutesApp() {
  const app = Fastify({ logger: false });
  app.decorateRequest("userId", undefined);
  app.decorateRequest("firmId", undefined);
  app.decorateRequest("clientId", undefined);
  app.addHook("onRequest", async (request) => {
    request.userId = OWNER_A;
    request.firmId = FIRM_ALFA;
    request.clientId = EXTRACTION_TEST_CLIENT;
  });
  documentRoutes(app);
  return app;
}

function manualFieldsUrl(extractionId: string) {
  return `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${extractionId}/fields`;
}

async function createExtractionField(
  fixture: ExtractionFixture,
  data: { key: string; rawValue?: string | null; normalizedValue?: string | null; correction?: string | null; method?: string; confidence?: number },
) {
  return runAsRuntime(OWNER_A, FIRM_ALFA, (tx) => tx.extractedField.create({
    data: {
      firmId: FIRM_ALFA,
      clientId: EXTRACTION_TEST_CLIENT,
      extractionId: fixture.extractionId,
      key: data.key,
      rawValue: data.rawValue ?? null,
      normalizedValue: data.normalizedValue ?? null,
      correction: data.correction ?? null,
      confidence: data.confidence ?? 0.9,
      method: data.method ?? "EMBEDDED_TEXT",
      status: "ACCEPTED",
    },
  }));
}

describe("validación de estado de extracción", () => {
  it.each(["GENERATED", "NEEDS_REVIEW"] as const)(
    "rechaza una extracción pendiente en estado %s y registra auditoría",
    async (status) => {
      const fixture = await createExtractionFixture(status);

      await service.reject(
        FIRM_ALFA,
        EXTRACTION_TEST_CLIENT,
        fixture.extractionId,
        OWNER_A,
        "Falta respaldo",
        extractionContext,
      );

      const extraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
      const document = await prisma.document.findUnique({ where: { id: fixture.documentId } });
      const events = await prisma.auditEvent.findMany({
        where: { action: "document.extraction.rejected", entityId: fixture.extractionId },
      });
      expect(extraction?.status).toBe("FAILED");
      expect(document?.status).toBe("EXTRACTION_FAILED");
      expect(events).toHaveLength(1);
      expect(events[0]?.before).toEqual({ status });
      expect(events[0]?.after).toEqual({ status: "FAILED", reason: "Falta respaldo" });
    },
  );

  it("aprueba una extracción pendiente y conserva la auditoría normal", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");

    await service.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, extractionContext);

    const extraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
    const document = await prisma.document.findUnique({ where: { id: fixture.documentId } });
    const events = await prisma.auditEvent.findMany({
      where: { action: "document.extraction.approved", entityId: fixture.extractionId },
    });
    expect(extraction?.status).toBe("REVIEWED");
    expect(document?.status).toBe("REVIEWED");
    expect(events).toHaveLength(1);
    expect(events[0]?.before).toEqual({ status: "NEEDS_REVIEW" });
    expect(events[0]?.after).toEqual({ status: "REVIEWED" });
  });

  it("no rechaza una extracción REVIEWED ni modifica documento o auditoría", async () => {
    const fixture = await createExtractionFixture("REVIEWED");
    const beforeExtraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
    const beforeDocument = await prisma.document.findUnique({ where: { id: fixture.documentId } });
    const beforeRejectionEvents = await prisma.auditEvent.count({
      where: { action: "document.extraction.rejected", entityId: fixture.extractionId },
    });

    await expect(
      service.reject(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, "Duplicada", extractionContext),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const extraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
    const document = await prisma.document.findUnique({ where: { id: fixture.documentId } });
    const rejectionEvents = await prisma.auditEvent.count({
      where: { action: "document.extraction.rejected", entityId: fixture.extractionId },
    });
    expect(extraction).toEqual(beforeExtraction);
    expect(document).toEqual(beforeDocument);
    expect(extraction?.status).toBe("REVIEWED");
    expect(document?.status).toBe("REVIEWED");
    expect(rejectionEvents).toBe(beforeRejectionEvents);
  });

  it("no rechaza una extracción ya rechazada ni vuelve a auditarla", async () => {
    const fixture = await createExtractionFixture("FAILED");
    const beforeExtraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
    const beforeDocument = await prisma.document.findUnique({ where: { id: fixture.documentId } });
    const beforeRejectionEvents = await prisma.auditEvent.count({
      where: { action: "document.extraction.rejected", entityId: fixture.extractionId },
    });

    await expect(
      service.reject(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, "Otro motivo", extractionContext),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const extraction = await prisma.documentExtraction.findUnique({ where: { id: fixture.extractionId } });
    const document = await prisma.document.findUnique({ where: { id: fixture.documentId } });
    const rejectionEvents = await prisma.auditEvent.count({
      where: { action: "document.extraction.rejected", entityId: fixture.extractionId },
    });
    expect(extraction).toEqual(beforeExtraction);
    expect(document).toEqual(beforeDocument);
    expect(extraction?.status).toBe("FAILED");
    expect(document?.status).toBe("EXTRACTION_FAILED");
    expect(beforeRejectionEvents).toBe(1);
    expect(rejectionEvents).toBe(beforeRejectionEvents);
  });
});

describe("ruta HTTP de rechazo de extracción", () => {
  it("devuelve 409 INVALID_TRANSITION cuando la extracción ya está revisada", async () => {
    const fixture = await createExtractionFixture("REVIEWED");
    const app = Fastify({ logger: false });
    app.decorateRequest("userId", undefined);
    app.decorateRequest("firmId", undefined);
    app.decorateRequest("clientId", undefined);
    app.addHook("onRequest", async (request) => {
      request.userId = OWNER_A;
      request.firmId = FIRM_ALFA;
      request.clientId = EXTRACTION_TEST_CLIENT;
    });
    documentRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${fixture.extractionId}/reject`,
        payload: { reason: "No corresponde" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_TRANSITION" } });
    } finally {
      await app.close();
    }
  });
});

describe("carga manual de campos fiscales", () => {
  it("crea datos HUMAN, deja intacto el original y audita actor, fecha y claves", async () => {
    const fixture = await createExtractionFixture("GENERATED");
    const original = await createExtractionField(fixture, {
      key: "issuerTaxId",
      rawValue: "IA-original-20123456789",
      normalizedValue: "20123456789",
    });
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value: "importe sin formato" }] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { status: "NEEDS_REVIEW", savedCount: 1, addedCount: 1 } });
      const state = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => ({
        extraction: await tx.documentExtraction.findUnique({ where: { id: fixture.extractionId } }),
        fields: await tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
        events: await tx.auditEvent.findMany({
          where: { action: "document.extraction.fields_added", entityId: fixture.extractionId },
        }),
      }));
      const manual = state.fields.find((field) => field.key === "totalAmount");
      const preservedOriginal = state.fields.find((field) => field.id === original.id);

      expect(state.extraction?.status).toBe("NEEDS_REVIEW");
      expect(manual).toMatchObject({
        method: "HUMAN",
        status: "CORRECTED",
        confidence: 0,
        rawValue: null,
        normalizedValue: null,
        correction: "importe sin formato",
      });
      expect(preservedOriginal).toMatchObject({
        rawValue: "IA-original-20123456789",
        normalizedValue: "20123456789",
        method: "EMBEDDED_TEXT",
        status: "ACCEPTED",
      });
      expect(state.events).toHaveLength(1);
      expect(state.events[0]).toMatchObject({
        userId: OWNER_A,
        actorKind: "USER",
        action: "document.extraction.fields_added",
        entityType: "DocumentExtraction",
        entityId: fixture.extractionId,
        after: {
          status: "NEEDS_REVIEW",
          keys: ["totalAmount"],
          corrections: [{ key: "totalAmount", correction: "importe sin formato" }],
        },
      });
      expect(state.events[0]?.createdAt).toBeInstanceOf(Date);
      expect(JSON.stringify(state.events[0]?.after)).toContain("importe sin formato");
    } finally {
      await app.close();
    }
  });

  it("rechaza claves fuera de la lista de campos sin persistir ninguna fila del lote", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value: "100" }, { key: "vatRate", value: "21" }] },
      });
      const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_FIELDS" } });
      expect(saved).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["más de 5000 caracteres", "x".repeat(5001)],
  ])("rechaza un valor %s sin persistir campos", async (_label, value) => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value }] },
      });
      const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
      );

      expect(response.statusCode).toBe(400);
      expect(saved).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("devuelve 409 para estados no revisables", async () => {
    const fixture = await createExtractionFixture("REVIEWED");
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value: "100" }] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_TRANSITION" } });
      const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
      );
      expect(saved).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("no pisa un campo con valor y revierte el lote completo", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const original = await createExtractionField(fixture, { key: "totalAmount", rawValue: "IA-100" });
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: {
          fields: [
            { key: "voucherType", value: "Factura" },
            { key: "totalAmount", value: "200" },
          ],
        },
      });
      const state = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => ({
        fields: await tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
        events: await tx.auditEvent.count({
          where: { action: "document.extraction.fields_added", entityId: fixture.extractionId },
        }),
      }));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_TRANSITION" } });
      expect(state.fields).toHaveLength(1);
      expect(state.fields[0]).toMatchObject({ id: original.id, rawValue: "IA-100", correction: null });
      expect(state.events).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("completa un registro vacío de la misma clave sin crear una segunda fila", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const empty = await createExtractionField(fixture, { key: "totalAmount", method: "EMBEDDED_TEXT" });
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value: "carga manual" }] },
      });
      const rows = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({ where: { extractionId: fixture.extractionId, key: "totalAmount" } }),
      );

      expect(response.statusCode).toBe(200);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: empty.id,
        method: "HUMAN",
        status: "CORRECTED",
        confidence: 0,
        rawValue: null,
        correction: "carga manual",
      });
    } finally {
      await app.close();
    }
  });

  it("permite reintentar el mismo par campo/valor sin duplicar ni volver a auditar", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const app = extractionRoutesApp();

    try {
      const send = () => app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "totalAmount", value: "100 sin formato" }] },
      });
      const first = await send();
      const retry = await send();
      const state = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => ({
        fields: await tx.extractedField.findMany({ where: { extractionId: fixture.extractionId, key: "totalAmount" } }),
        events: await tx.auditEvent.count({
          where: { action: "document.extraction.fields_added", entityId: fixture.extractionId },
        }),
      }));

      expect(first.statusCode).toBe(200);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ data: { savedCount: 1, addedCount: 0 } });
      expect(state.fields).toHaveLength(1);
      expect(state.events).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("serializa dos guardados simultáneos de la misma clave y conserva una sola fila", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const app = extractionRoutesApp();
    const send = () => app.inject({
      method: "PUT",
      url: manualFieldsUrl(fixture.extractionId),
      payload: { fields: [{ key: "totalAmount", value: "100" }] },
    });

    try {
      const responses = await Promise.all([send(), send()]);
      const state = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => ({
        fields: await tx.extractedField.findMany({ where: { extractionId: fixture.extractionId, key: "totalAmount" } }),
        events: await tx.auditEvent.count({
          where: { action: "document.extraction.fields_added", entityId: fixture.extractionId },
        }),
      }));

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(state.fields).toHaveLength(1);
      expect(state.events).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("compare-and-set de aprobación", () => {
  it("devuelve conflicto si el estado cambió a rechazado después de leerlo", async () => {
    let extractionStatus: "NEEDS_REVIEW" | "FAILED" | "REVIEWED" = "NEEDS_REVIEW";
    let documentStatus: "EXTRACTED" | "EXTRACTION_FAILED" | "REVIEWED" = "EXTRACTED";
    const auditActions: string[] = [];
    const documentUpdate = vi.fn();
    const approvalAudit = vi.fn();
    const updateMany = vi.fn(async (args: { where: { status: string }; data: { status: string } }) => {
      if (args.where.status !== extractionStatus) return { count: 0 };
      extractionStatus = args.data.status as typeof extractionStatus;
      return { count: 1 };
    });
    const fakeTx = {
      documentExtraction: {
        findFirst: async () => {
          const read = {
            id: "extraction-test",
            firmId: FIRM_ALFA,
            clientId: EXTRACTION_TEST_CLIENT,
            documentId: "document-test",
            status: extractionStatus,
          };
          // Simula que un rechazo concurrente confirma antes del UPDATE de aprobación.
          extractionStatus = "FAILED";
          documentStatus = "EXTRACTION_FAILED";
          auditActions.push("document.extraction.rejected");
          return read;
        },
        updateMany,
      },
      document: { update: documentUpdate },
      auditEvent: { create: approvalAudit },
    } as unknown as Prisma.TransactionClient;
    const racedService = new ExtractionService(async (fn) => fn(fakeTx));

    await expect(
      racedService.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, "extraction-test", OWNER_A),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "NEEDS_REVIEW" }),
    }));
    expect(extractionStatus).toBe("FAILED");
    expect(documentStatus).toBe("EXTRACTION_FAILED");
    expect(auditActions).toEqual(["document.extraction.rejected"]);
    expect(documentUpdate).not.toHaveBeenCalled();
    expect(approvalAudit).not.toHaveBeenCalled();
  });
});
