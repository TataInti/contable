import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { ExtractionService } from "./extraction-service.js";
import { approvedSnapshotDataSchema, type ManualExtractionFieldKey } from "@contable/contracts";
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

const validManualFields: Array<{ key: ManualExtractionFieldKey; value: string }> = [
  { key: "voucherType", value: "factura" },
  { key: "letter", value: "X" },
  { key: "pointOfSale", value: "0004" },
  { key: "voucherNumber", value: "00001234" },
  { key: "issueDate", value: "0000-02-29" },
  { key: "issuerTaxId", value: "00000000000" },
  { key: "receiverTaxId", value: "12345678901" },
  { key: "issuerName", value: "Proveedor S.A." },
  { key: "receiverName", value: "Cliente S.R.L." },
  { key: "vatCondition", value: "RESPONSABLE_INSCRIPTO" },
  { key: "netAmount", value: "1234.56" },
  { key: "nonTaxableAmount", value: "0.00" },
  { key: "exemptAmount", value: "10.00" },
  { key: "totalAmount", value: "1244.56" },
  { key: "currency", value: "ARS" },
  { key: "cae", value: "00000000000000" },
  { key: "caeExpiration", value: "2026-11-12" },
];

const invalidManualFieldFormats: Array<[ManualExtractionFieldKey, string, string, string]> = [
  ["voucherType", "Factura", "Tipo de documento", "Elegí un tipo de documento de la lista."],
  ["letter", "Z", "Letra", "Elegí una letra de la lista."],
  ["pointOfSale", "00-04", "Punto de venta", "Ingresá solo dígitos."],
  ["voucherNumber", "12A34", "Número", "Ingresá solo dígitos."],
  ["issueDate", "2026-02-30", "Fecha", "Ingresá una fecha válida con formato AAAA-MM-DD."],
  ["issuerTaxId", "1234567890", "CUIT emisor", "El CUIT debe tener exactamente 11 dígitos."],
  ["receiverTaxId", "123456789012", "CUIT receptor", "El CUIT debe tener exactamente 11 dígitos."],
  ["vatCondition", "Responsable inscripto", "Condición frente al IVA", "Elegí una condición frente al IVA de la lista."],
  ["netAmount", "1.234,56", "Neto gravado", "El importe debe tener punto decimal y dos decimales (por ejemplo, 1234.56)."],
  ["nonTaxableAmount", "no numérico", "No gravado", "El importe debe tener punto decimal y dos decimales (por ejemplo, 1234.56)."],
  ["exemptAmount", "10", "Exento", "El importe debe tener punto decimal y dos decimales (por ejemplo, 1234.56)."],
  ["totalAmount", "100 sin formato", "Total", "El importe debe tener punto decimal y dos decimales (por ejemplo, 1234.56)."],
  ["currency", "EUR", "Moneda", "Elegí una moneda de la lista."],
  ["cae", "1234567890123", "CAE", "El CAE debe tener exactamente 14 dígitos."],
  ["caeExpiration", "12/11/2026", "Vencimiento del CAE", "Ingresá una fecha válida con formato AAAA-MM-DD."],
];

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
            rawValue: null,
            normalizedValue: null,
            confidence: 1,
            method: "HUMAN",
            status: "CORRECTED",
            correction: "dato cargado por persona",
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
      expect.objectContaining({
        key: "humanMemo",
        value: "dato cargado por persona",
        source: "HUMAN",
        originalValue: null,
      }),
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

describe("carga manual con foto fija de aprobación", () => {
  it("carga tres campos a mano en una extracción vacía y los congela como HUMAN sin tocar las filas originales", async () => {
    const fixture = await createExtractionFixture("GENERATED");
    const app = extractionRoutesApp();

    try {
      const put = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: {
          fields: [
            { key: "issuerTaxId", value: "20123456789" },
            { key: "totalAmount", value: "121000.50" },
            { key: "issueDate", value: "2026-11-10" },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ data: { status: "NEEDS_REVIEW", savedCount: 3, addedCount: 3 } });

      const rowsBeforeApproval = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({
          where: { extractionId: fixture.extractionId },
          orderBy: { id: "asc" },
        }),
      );
      expect(rowsBeforeApproval).toHaveLength(3);
      expect(rowsBeforeApproval.every((row) => row.method === "HUMAN" && row.correction !== null)).toBe(true);

      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${fixture.extractionId}/approve`,
      });
      expect(approve.statusCode).toBe(200);

      const snapshotResponse = await app.inject({
        method: "GET",
        url: `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${fixture.extractionId}/approved-snapshot`,
      });
      expect(snapshotResponse.statusCode).toBe(200);
      const snapshot = snapshotResponse.json().data;
      expect(snapshot.data.fields).toHaveLength(3);
      expect(snapshot.data.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "issuerTaxId", value: "20123456789", source: "HUMAN", originalValue: null }),
        expect.objectContaining({ key: "totalAmount", value: "121000.50", source: "HUMAN", originalValue: null }),
        expect.objectContaining({ key: "issueDate", value: "2026-11-10", source: "HUMAN", originalValue: null }),
      ]));

      const events = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.auditEvent.findMany({
          where: { action: "document.extraction.approved", entityId: fixture.extractionId },
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.after).toEqual({ status: "REVIEWED", approvedSnapshotId: snapshot.id });

      const rowsAfterApproval = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({
          where: { extractionId: fixture.extractionId },
          orderBy: { id: "asc" },
        }),
      );
      expect(rowsAfterApproval).toEqual(rowsBeforeApproval);
    } finally {
      await app.close();
    }
  });

  it("mezcla un campo AI, uno corregido por PATCH y uno cargado a mano con su valor original", async () => {
    const fixture = await createExtractionFixture("NEEDS_REVIEW");
    const aiField = await createExtractionField(fixture, {
      key: "totalAmount",
      rawValue: "100.00",
      normalizedValue: "100.00",
      method: "VISION",
    });
    const correctedField = await createExtractionField(fixture, {
      key: "issueDate",
      rawValue: "2026-11-01",
      normalizedValue: "2026-11-01",
      method: "VISION",
    });
    const app = extractionRoutesApp();

    try {
      const patch = await app.inject({
        method: "PATCH",
        url: `${manualFieldsUrl(fixture.extractionId)}/${correctedField.id}`,
        payload: { correction: "2026-11-03", reason: "Dígito confirmado contra el documento" },
      });
      expect(patch.statusCode).toBe(200);

      const put = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: [{ key: "cae", value: "75123456789012" }] },
      });
      expect(put.statusCode).toBe(200);

      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_ALFA}/clients/${EXTRACTION_TEST_CLIENT}/extractions/${fixture.extractionId}/approve`,
      });
      expect(approve.statusCode).toBe(200);

      const snapshot = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractionApprovedSnapshot.findUnique({ where: { extractionId: fixture.extractionId } }),
      );
      expect(snapshot).not.toBeNull();
      const data = approvedSnapshotDataSchema.parse(snapshot?.data);
      expect(data.fields).toHaveLength(3);
      expect(data.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "totalAmount", value: "100.00", source: "AI", originalValue: null }),
        expect.objectContaining({
          key: "issueDate",
          value: "2026-11-03",
          source: "CORRECTED",
          originalValue: "2026-11-01",
        }),
        expect.objectContaining({ key: "cae", value: "75123456789012", source: "HUMAN", originalValue: null }),
      ]));

      const rows = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({
          where: { extractionId: fixture.extractionId },
          orderBy: { id: "asc" },
        }),
      );
      expect(rows.find((row) => row.id === aiField.id)).toMatchObject({
        rawValue: "100.00",
        normalizedValue: "100.00",
        method: "VISION",
        correction: null,
      });
      expect(rows.find((row) => row.id === correctedField.id)).toMatchObject({
        rawValue: "2026-11-01",
        normalizedValue: "2026-11-01",
        correction: "2026-11-03",
        method: "VISION",
      });
      expect(rows.find((row) => row.key === "cae")).toMatchObject({
        method: "HUMAN",
        correction: "75123456789012",
        rawValue: null,
      });
    } finally {
      await app.close();
    }
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

describe("corrección PATCH de campos fiscales", () => {
  it.each(validManualFields)(
    "acepta el formato canónico de $key aunque el valor guardado sea legado",
    async ({ key, value }) => {
      const fixture = await createExtractionFixture("GENERATED");
      const field = await createExtractionField(fixture, {
        key,
        rawValue: "formato legado",
        normalizedValue: "formato legado",
        correction: "corrección antigua en otro formato",
      });
      const app = extractionRoutesApp();

      try {
        const response = await app.inject({
          method: "PATCH",
          url: `${manualFieldsUrl(fixture.extractionId)}/${field.id}`,
          payload: { correction: value },
        });
        const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
          tx.extractedField.findUnique({ where: { id: field.id } }),
        );

        expect(response.statusCode).toBe(200);
        expect(saved).toMatchObject({ correction: value, status: "CORRECTED" });
      } finally {
        await app.close();
      }
    },
  );

  it.each(invalidManualFieldFormats)(
    "devuelve 400 en español para el formato inválido de $0 y no modifica lo guardado",
    async (key, value, label, expectedMessage) => {
      const fixture = await createExtractionFixture("GENERATED");
      const field = await createExtractionField(fixture, {
        key,
        rawValue: "formato legado",
        normalizedValue: "formato legado",
        correction: "corrección antigua en otro formato",
      });
      const app = extractionRoutesApp();

      try {
        const response = await app.inject({
          method: "PATCH",
          url: `${manualFieldsUrl(fixture.extractionId)}/${field.id}`,
          payload: { correction: value },
        });
        const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
          tx.extractedField.findUnique({ where: { id: field.id } }),
        );

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          error: {
            code: "INVALID_CORRECTION",
            message: `${label}: ${expectedMessage}`,
          },
        });
        expect(saved).toMatchObject({
          correction: "corrección antigua en otro formato",
          status: "ACCEPTED",
        });
      } finally {
        await app.close();
      }
    },
  );

  it("mantiene el PATCH libre para una clave fuera de las 17, como IVA por fila", async () => {
    const fixture = await createExtractionFixture("GENERATED");
    const field = await createExtractionField(fixture, {
      key: "vatRate",
      rawValue: "21",
      normalizedValue: "21",
    });
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PATCH",
        url: `${manualFieldsUrl(fixture.extractionId)}/${field.id}`,
        payload: { correction: "21 por ciento" },
      });
      const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findUnique({ where: { id: field.id } }),
      );

      expect(response.statusCode).toBe(200);
      expect(saved).toMatchObject({ correction: "21 por ciento", status: "CORRECTED" });
    } finally {
      await app.close();
    }
  });
});

describe("carga manual de campos fiscales", () => {
  it("valida y persiste las 17 claves con formatos canónicos, sin validar contenido fiscal", async () => {
    const fixture = await createExtractionFixture("GENERATED");
    const app = extractionRoutesApp();

    try {
      const response = await app.inject({
        method: "PUT",
        url: manualFieldsUrl(fixture.extractionId),
        payload: { fields: validManualFields.map((field) => ({ ...field, ...(field.key === "totalAmount" ? { value: "1.00" } : {}) })) },
      });
      const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
      );

      expect(response.statusCode).toBe(200);
      expect(saved).toHaveLength(17);
      expect(saved).toEqual(expect.arrayContaining(validManualFields.map(({ key, value }) =>
        expect.objectContaining({
          key,
          correction: key === "totalAmount" ? "1.00" : value,
          method: "HUMAN",
        }),
      )));
      expect(saved.find((field) => field.key === "issuerTaxId")?.correction).toBe("00000000000");
      expect(saved.find((field) => field.key === "totalAmount")?.correction).toBe("1.00");
    } finally {
      await app.close();
    }
  });

  it.each(invalidManualFieldFormats)(
    "rechaza con 400 y mensaje en español el formato inválido de %s",
    async (key, value, label, expectedMessage) => {
      const fixture = await createExtractionFixture("GENERATED");
      const app = extractionRoutesApp();

      try {
        const response = await app.inject({
          method: "PUT",
          url: manualFieldsUrl(fixture.extractionId),
          payload: { fields: [{ key, value }] },
        });
        const saved = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
          tx.extractedField.findMany({ where: { extractionId: fixture.extractionId } }),
        );

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          error: { code: "INVALID_FIELDS", message: `${label}: ${expectedMessage}` },
        });
        expect(saved).toHaveLength(0);
      } finally {
        await app.close();
      }
    },
  );

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
        payload: { fields: [{ key: "totalAmount", value: "1234.56" }] },
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
        correction: "1234.56",
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
          corrections: [{ key: "totalAmount", correction: "1234.56" }],
        },
      });
      expect(state.events[0]?.createdAt).toBeInstanceOf(Date);
      expect(JSON.stringify(state.events[0]?.after)).toContain("1234.56");
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
        payload: { fields: [{ key: "totalAmount", value: "100.00" }, { key: "vatRate", value: "21" }] },
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
        payload: { fields: [{ key: "totalAmount", value: "100.00" }] },
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
            { key: "voucherType", value: "factura" },
            { key: "totalAmount", value: "200.00" },
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
        payload: { fields: [{ key: "totalAmount", value: "1200.00" }] },
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
        correction: "1200.00",
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
        payload: { fields: [{ key: "totalAmount", value: "100.00" }] },
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
      payload: { fields: [{ key: "totalAmount", value: "100.00" }] },
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
