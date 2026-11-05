import { describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ExtractionService } from "./extraction-service.js";

/**
 * Tests de integración del servicio de extracción (Fase 5).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
