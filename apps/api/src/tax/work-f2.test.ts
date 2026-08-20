import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { WorkService, WorkError } from "./work-service.js";
import { DocumentService } from "../documents/document-service.js";
import { ObjectStorage } from "../storage/object-storage.js";

/**
 * F2.2: pedidos documentales por obligación/ítem y preview de evidencia.
 *
 * Verifica:
 *   - crear pedido vinculado a una obligación fiscal del cliente
 *   - rechazo si la obligación no pertenece al cliente
 *   - preview de evidencia reautorizado (URL firmada) para un ítem con documento
 *   - 404 si el ítem no tiene evidencia
 *
 * Usa firma/cliente/usuarios PROPIOS para no colisionar con suites paralelas.
 */

const OWNER_F2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const FIRM_F2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const CLIENT_F2 = "cccccccc-2222-4333-8444-cccccccccc03";

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
    return fn(tx) as Promise<T>;
  });
}

const work = new WorkService();
const storage = new ObjectStorage();
const documents = new DocumentService(storage);

const ctxOwner = { userId: OWNER_F2, firmId: FIRM_F2, actorKind: "USER" as const };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_F2}', 'owner.f2@test.local', 'Owner F2', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_F2}', 'Estudio F2', 'Estudio F2', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_F2}', '${FIRM_F2}', 'Cliente F2', '20999999976', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_F2}', '${OWNER_F2}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

/** Crea una obligación fiscal mínima para el cliente (maestros propios -F2). */
async function createObligation() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_F2}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_F2}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);

    // Maestros propios de la suite (sufijo -F2) para no colisionar con otras.
    await tx.$executeRawUnsafe(`
      INSERT INTO jurisdictions (id, code, name, kind, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'AR-F2', 'Argentina F2', 'NATIONAL', true, now(), now())
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_types (id, code, name, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'IVA-F2', 'IVA F2', true, now(), now())
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_authorities (id, code, name, "jurisdictionId", "isActive", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'ARCA-F2', 'ARCA F2', j.id, true, now(), now()
      FROM jurisdictions j WHERE j.code = 'AR-F2'
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_regimes (id, code, name, "taxTypeId", "jurisdictionId", "authorityId", "isActive", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'RI-F2', 'RI F2', tt.id, j.id, a.id, true, now(), now()
      FROM tax_types tt, jurisdictions j, tax_authorities a
      WHERE tt.code = 'IVA-F2' AND j.code = 'AR-F2' AND a.code = 'ARCA-F2'
      ON CONFLICT (code) DO NOTHING
    `);

    const regime = await tx.taxRegime.findUniqueOrThrow({ where: { code: "RI-F2" } });
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_F2,
        clientId: CLIENT_F2,
        version: 1,
        status: "ACTIVE",
        cuit: "20999999976",
        legalName: "Cliente F2",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        createdByUserId: OWNER_F2,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_F2,
        clientId: CLIENT_F2,
        taxTypeId: regime.taxTypeId,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026 F2",
      },
    });
    return tx.taxObligation.create({
      data: {
        firmId: FIRM_F2,
        clientId: CLIENT_F2,
        profileVersionId: profile.id,
        regimeId: regime.id,
        periodId: period.id,
        status: "PENDING",
        materializedBy: OWNER_F2,
      },
    });
  });
}

describe("F2.2 pedidos documentales por obligación", () => {
  beforeEach(async () => {
    await setupMembership();
    await prisma.$executeRawUnsafe(
      `DELETE FROM document_requests WHERE "firmId" = '${FIRM_F2}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tax_obligations WHERE "firmId" = '${FIRM_F2}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tax_periods WHERE "firmId" = '${FIRM_F2}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM taxpayer_profile_versions WHERE "firmId" = '${FIRM_F2}'`,
    );
  });

  it("crea un pedido vinculado a una obligación del cliente", async () => {
    const obligation = await createObligation();
    const request = await work.createRequest(ctxOwner, {
      clientId: CLIENT_F2,
      title: "Evidencia IVA Enero",
      obligationId: obligation.id,
      items: [{ description: "Libro IVA ventas" }, { description: "Libro IVA compras" }],
    });
    expect(request.obligationId).toBe(obligation.id);
    expect(request.items).toHaveLength(2);
    expect(request.items[0]?.status).toBe("PENDING");
  });

  it("rechaza vincular una obligación de otro cliente", async () => {
    const obligation = await createObligation();
    // Cliente ajeno dentro de la misma firma.
    await prisma.$executeRawUnsafe(`
      INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
      VALUES ('${CLIENT_F2}-x', '${FIRM_F2}', 'Otro F2', '20999999975', now())
      ON CONFLICT ("id") DO NOTHING
    `);
    await expect(
      work.createRequest(ctxOwner, {
        clientId: `${CLIENT_F2}-x`,
        title: "Pedido ajeno",
        obligationId: obligation.id,
        items: [{ description: "x" }],
      }),
    ).rejects.toThrow(WorkError);
  });

  it("preview de evidencia devuelve URL firmada para un ítem con documento", async () => {
    const obligation = await createObligation();
    const request = await work.createRequest(ctxOwner, {
      clientId: CLIENT_F2,
      title: "Evidencia con preview",
      obligationId: obligation.id,
      items: [{ description: "Comprobante" }],
    });
    const itemId = request.items[0]!.id;

    // Crea un documento + versión de archivo ligado al ítem.
    const doc = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_F2}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_F2}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
      const document = await tx.document.create({
        data: {
          firmId: FIRM_F2,
          clientId: CLIENT_F2,
          status: "READY",
          uploadedByUserId: OWNER_F2,
        },
      });
      const version = await tx.documentFileVersion.create({
        data: {
          firmId: FIRM_F2,
          clientId: CLIENT_F2,
          documentId: document.id,
          originalName: "comprobante.pdf",
          mimeType: "application/pdf",
          extension: "pdf",
          sizeBytes: 100,
          sha256: "a".repeat(64),
          bucket: "originals",
          objectKey: `f2/${document.id}.pdf`,
          antivirusStatus: "CLEAN",
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: { currentFileVersionId: version.id },
      });
      await tx.documentRequestItem.update({
        where: { id: itemId },
        data: { status: "ATTACHED", documentId: document.id },
      });
      return document;
    });

    const preview = await documents.getEvidencePreviewUrl(ctxOwner, itemId);
    expect(preview).not.toBeNull();
    expect(preview!.url).toContain("originals");
    expect(preview!.mimeType).toBe("application/pdf");
    expect(preview!.originalName).toBe("comprobante.pdf");
    expect(doc.id).toBeTruthy();
  });

  it("preview devuelve null si el ítem no tiene evidencia", async () => {
    const obligation = await createObligation();
    const request = await work.createRequest(ctxOwner, {
      clientId: CLIENT_F2,
      title: "Sin evidencia",
      obligationId: obligation.id,
      items: [{ description: "Pendiente" }],
    });
    const preview = await documents.getEvidencePreviewUrl(ctxOwner, request.items[0]!.id);
    expect(preview).toBeNull();
  });
});