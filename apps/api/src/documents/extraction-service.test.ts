import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { ExtractionService } from "./extraction-service.js";
import { approvedSnapshotDataSchema } from "@contable/contracts";
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
    const snapshot = await prisma.extractionApprovedSnapshot.findUnique({
      where: { extractionId: fixture.extractionId },
    });
    expect(extraction?.status).toBe("REVIEWED");
    expect(document?.status).toBe("REVIEWED");
    expect(events).toHaveLength(1);
    expect(events[0]?.before).toEqual({ status: "NEEDS_REVIEW" });
    expect(snapshot).toMatchObject({
      firmId: FIRM_ALFA,
      clientId: EXTRACTION_TEST_CLIENT,
      documentId: fixture.documentId,
      extractionId: fixture.extractionId,
      approvedBy: OWNER_A,
      data: { fields: [], reviewIssues: [] },
    });
    expect(events[0]?.after).toEqual({ status: "REVIEWED", approvedSnapshotId: snapshot?.id });
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

describe("foto fija de aprobación", () => {
  it("revierte estado, documento y auditoría si falla la inserción de la foto", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const suffix = fixture.extractionId.replaceAll("-", "");
    const functionName = `fail_snapshot_insert_${suffix}`;
    const triggerName = `fail_snapshot_insert_${suffix}`;

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected approved snapshot insert failure';
        RETURN NEW;
      END;
      $$
    `);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "extraction_approved_snapshots"
        FOR EACH ROW WHEN (NEW."extractionId" = '${fixture.extractionId}')
        EXECUTE FUNCTION "${functionName}"()
      `);
      await expect(
        service.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, extractionContext),
      ).rejects.toThrow("injected approved snapshot insert failure");
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "extraction_approved_snapshots"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    const [extraction, document] = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => Promise.all([
      tx.documentExtraction.findUnique({ where: { id: fixture.extractionId } }),
      tx.document.findUnique({ where: { id: fixture.documentId } }),
    ]));
    expect(extraction?.status).toBe("NEEDS_REVIEW");
    expect(document?.status).toBe("EXTRACTED");
    expect(await prisma.extractionApprovedSnapshot.count({ where: { extractionId: fixture.extractionId } })).toBe(0);
    expect(await prisma.auditEvent.count({
      where: { action: "document.extraction.approved", entityId: fixture.extractionId },
    })).toBe(0);
  });

  it("congela los valores AI, corregidos, HUMAN y las listas con trazabilidad", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const correctedFieldId = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      await tx.documentExtraction.update({
        where: { id: fixture.extractionId },
        data: {
          schemaVersion: "voucher-ar-v2.1",
          ocrEngine: "synthetic-ocr",
          model: "synthetic-model",
          provider: "synthetic-provider",
          promptVersion: "synthetic-prompt-v1",
          reviewIssues: [
            { reason: "percepción no reconocida", sourcePath: "percepciones[0].categoria" },
          ] as Prisma.InputJsonValue,
          voucherData: {
            iva: [
              { alicuota: "21.00", importe: "21.00" },
              { alicuota: "10.50", importe: "7.00" },
            ],
            percepciones: [
              { categoria: "IIBB", tipo_texto: "IIBB - Buenos Aires", importe: "5.00" },
            ],
          } as Prisma.InputJsonValue,
        },
      });
      await tx.extractedField.createMany({
        data: [
          {
            firmId: FIRM_ALFA,
            clientId: EXTRACTION_TEST_CLIENT,
            extractionId: fixture.extractionId,
            key: "totalAmount",
            rawValue: "100.00",
            normalizedValue: "100.00",
            confidence: 0.98,
            method: "VISION",
            status: "ACCEPTED",
          },
          {
            firmId: FIRM_ALFA,
            clientId: EXTRACTION_TEST_CLIENT,
            extractionId: fixture.extractionId,
            key: "issueDate",
            rawValue: "2026-11-01",
            normalizedValue: "2026-11-01",
            confidence: 0.91,
            method: "VISION",
            status: "CORRECTED",
            correction: "2026-11-02",
            reason: "Dígito confirmado contra el documento",
          },
          {
            firmId: FIRM_ALFA,
            clientId: EXTRACTION_TEST_CLIENT,
            extractionId: fixture.extractionId,
            key: "humanMemo",
            rawValue: "dato cargado por persona",
            normalizedValue: null,
            confidence: 1,
            method: "HUMAN",
            status: "CORRECTED",
          },
          ...[
            ["vatRate", "21.00"],
            ["vatAmount", "21.00"],
            ["vatRate", "10.50"],
            ["vatAmount", "7.00"],
            ["perceptionCategory", "IIBB"],
            ["perceptionText", "IIBB - Buenos Aires"],
            ["perceptionAmount", "5.00"],
          ].map(([key, value]) => ({
            firmId: FIRM_ALFA,
            clientId: EXTRACTION_TEST_CLIENT,
            extractionId: fixture.extractionId,
            key: key!,
            rawValue: value!,
            normalizedValue: value!,
            confidence: 0.88,
            method: "VISION",
            status: "ACCEPTED",
          })),
        ],
      });
      const correctedField = await tx.extractedField.findFirst({
        where: { extractionId: fixture.extractionId, key: "issueDate" },
      });
      if (!correctedField) throw new Error("TEST_CORRECTED_FIELD_NOT_CREATED");
      return correctedField.id;
    });

    await service.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, extractionContext);

    const snapshot = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.extractionApprovedSnapshot.findUnique({ where: { extractionId: fixture.extractionId } }),
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      schemaVersion: "voucher-ar-v2.1",
      ocrEngine: "synthetic-ocr",
      model: "synthetic-model",
      provider: "synthetic-provider",
      promptVersion: "synthetic-prompt-v1",
    });
    const data = approvedSnapshotDataSchema.parse(snapshot?.data);
    expect(data.fields).toHaveLength(10);
    expect(data.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "totalAmount", value: "100.00", source: "AI", originalValue: null }),
      expect.objectContaining({
        key: "issueDate",
        value: "2026-11-02",
        source: "CORRECTED",
        originalValue: "2026-11-01",
      }),
      expect.objectContaining({ key: "humanMemo", value: "dato cargado por persona", source: "HUMAN" }),
      expect.objectContaining({ key: "vatRate", value: "21.00", sourcePath: "iva[0].alicuota", index: 0 }),
      expect.objectContaining({ key: "vatRate", value: "10.50", sourcePath: "iva[1].alicuota", index: 1 }),
      expect.objectContaining({ key: "vatAmount", value: "21.00", sourcePath: "iva[0].importe", index: 0 }),
      expect.objectContaining({ key: "vatAmount", value: "7.00", sourcePath: "iva[1].importe", index: 1 }),
      expect.objectContaining({
        key: "perceptionCategory",
        value: "IIBB",
        sourcePath: "percepciones[0].categoria",
        index: 0,
      }),
      expect.objectContaining({
        key: "perceptionText",
        value: "IIBB - Buenos Aires",
        sourcePath: "percepciones[0].tipo_texto",
        index: 0,
      }),
      expect.objectContaining({
        key: "perceptionAmount",
        value: "5.00",
        sourcePath: "percepciones[0].importe",
        index: 0,
      }),
    ]));
    expect(data.reviewIssues).toEqual([
      { reason: "percepción no reconocida", sourcePath: "percepciones[0].categoria" },
    ]);

    await expect(
      service.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, extractionContext),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", message: "El estado de la extracción cambió durante la operación" });
    expect(await prisma.extractionApprovedSnapshot.count({ where: { extractionId: fixture.extractionId } })).toBe(1);

    await service.correctField(
      FIRM_ALFA,
      EXTRACTION_TEST_CLIENT,
      fixture.extractionId,
      correctedFieldId,
      "2026-11-03",
      "Ajuste posterior para comprobar inmutabilidad",
      OWNER_A,
      extractionContext,
    );
    const [snapshotAfterCorrection, correctedFieldAfterCorrection] = await runAsRuntime(
      OWNER_A,
      FIRM_ALFA,
      async (tx) => Promise.all([
        tx.extractionApprovedSnapshot.findUnique({ where: { extractionId: fixture.extractionId } }),
        tx.extractedField.findUnique({ where: { id: correctedFieldId } }),
      ]),
    );
    expect(approvedSnapshotDataSchema.parse(snapshotAfterCorrection?.data)).toEqual(data);
    expect(correctedFieldAfterCorrection).toMatchObject({
      rawValue: "2026-11-01",
      normalizedValue: "2026-11-01",
      correction: "2026-11-03",
    });
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

describe("ruta HTTP de lectura de foto aprobada", () => {
  it("devuelve 404 antes de aprobar y sólo expone la foto dentro del scope de firma", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
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
    const url = `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${fixture.extractionId}/approved-snapshot`;

    try {
      const beforeApproval = await app.inject({ method: "GET", url });
      expect(beforeApproval.statusCode).toBe(404);
      expect(beforeApproval.json()).toMatchObject({
        error: { code: "APPROVED_SNAPSHOT_NOT_FOUND" },
      });

      await service.approve(FIRM_ALFA, EXTRACTION_TEST_CLIENT, fixture.extractionId, OWNER_A, extractionContext);
      const approved = await app.inject({ method: "GET", url });
      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toMatchObject({
        data: {
          firmId: FIRM_ALFA,
          clientId: EXTRACTION_TEST_CLIENT,
          extractionId: fixture.extractionId,
          approvedBy: OWNER_A,
          data: { fields: [], reviewIssues: [] },
        },
      });
      expect(Date.parse(approved.json().data.approvedAt)).not.toBeNaN();

      const otherTenant = await app.inject({
        method: "GET",
        url: `/api/v1/firms/22222222-2222-4222-8222-222222222222/clients/dddddddd-dddd-4ddd-8ddd-dddddddddddd/extractions/${fixture.extractionId}/approved-snapshot`,
      });
      expect(otherTenant.statusCode).toBe(404);
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
      extractionApprovedSnapshot: { findUnique: async () => null },
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
