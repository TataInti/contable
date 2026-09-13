import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { DocumentService } from "../documents/document-service.js";
import { ObjectStorage } from "../storage/object-storage.js";

/**
 * Preview/descarga de documentos subidos (G2-07.5).
 *
 * Verifica que `getPreviewUrl`:
 *   - devuelve URL firmada sólo para versiones validadas (antivirus CLEAN,
 *     bucket originals) y pertenecientes al cliente en contexto;
 *   - devuelve null para versiones en cuarentena (PENDING/quarantine) o ajenas.
 *
 * El storage se inyecta como stub (F0.3) para no depender de MinIO local.
 */

const OWNER_PV = "dddddddd-dddd-4ddd-8ddd-ddddddddcc01";
const FIRM_PV = "dddddddd-dddd-4ddd-8ddd-ddddddddcc02";
const CLIENT_PV = "dddddddd-2222-4333-8444-ddddddddcc03";

const storageStub = {
  getPresignedGetUrl: async (_bucket: string, objectKey: string) =>
    `https://minio.local/presigned/${objectKey}`,
  put: async () => {},
} as unknown as ObjectStorage;

const documents = new DocumentService(storageStub);

const ctxOwner = { userId: OWNER_PV, firmId: FIRM_PV, actorKind: "USER" as const };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_PV}', 'owner.preview@test.local', 'Owner Preview', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_PV}', 'Estudio Preview', 'Estudio Preview', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_PV}', '${FIRM_PV}', 'Cliente Preview', '20999999960', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  // Cliente ajeno dentro de la misma firma (para el caso de aislamiento).
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_PV}-x', '${FIRM_PV}', 'Cliente Ajeno Preview', '20999999959', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_PV}', '${OWNER_PV}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

async function createDocument(overrides: { bucket: string; antivirusStatus: string; clientId?: string }): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_PV}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_PV}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    const document = await tx.document.create({
      data: {
        firmId: FIRM_PV,
        clientId: overrides.clientId ?? CLIENT_PV,
        status: "READY",
        uploadedByUserId: OWNER_PV,
      },
    });
    await tx.documentFileVersion.create({
      data: {
        firmId: FIRM_PV,
        clientId: overrides.clientId ?? CLIENT_PV,
        documentId: document.id,
        originalName: "factura.jpg",
        mimeType: "image/jpeg",
        extension: "jpg",
        sizeBytes: 1024,
        sha256: "b".repeat(64),
        bucket: overrides.bucket,
        objectKey: `pv/${document.id}.jpg`,
        antivirusStatus: overrides.antivirusStatus,
      },
    });
    return document.id;
  });
}

describe("G2-07.5 preview de documentos subidos", () => {
  beforeEach(async () => {
    await setupMembership();
    await prisma.$executeRawUnsafe(`DELETE FROM documents WHERE "firmId" = '${FIRM_PV}'`);
  });

  it("devuelve URL firmada para un documento validado del propio cliente", async () => {
    const documentId = await createDocument({ bucket: "originals", antivirusStatus: "CLEAN" });
    const preview = await documents.getPreviewUrl({ ...ctxOwner, clientId: CLIENT_PV }, documentId);
    expect(preview).not.toBeNull();
    expect(preview!.url).toContain("/presigned/pv/");
    expect(preview!.mimeType).toBe("image/jpeg");
    expect(preview!.originalName).toBe("factura.jpg");
  });

  it("no expone un documento aún en cuarentena (antivirus pendiente)", async () => {
    const documentId = await createDocument({ bucket: "quarantine", antivirusStatus: "PENDING" });
    const preview = await documents.getPreviewUrl({ ...ctxOwner, clientId: CLIENT_PV }, documentId);
    expect(preview).toBeNull();
  });

  it("no expone un documento rechazado por antivirus", async () => {
    const documentId = await createDocument({ bucket: "quarantine", antivirusStatus: "MALWARE" });
    const preview = await documents.getPreviewUrl({ ...ctxOwner, clientId: CLIENT_PV }, documentId);
    expect(preview).toBeNull();
  });

  it("devuelve null si el documento pertenece a otro cliente", async () => {
    const documentId = await createDocument({
      bucket: "originals",
      antivirusStatus: "CLEAN",
      clientId: `${CLIENT_PV}-x`,
    });
    const preview = await documents.getPreviewUrl({ ...ctxOwner, clientId: CLIENT_PV }, documentId);
    expect(preview).toBeNull();
  });

  it("devuelve null si el documento no existe", async () => {
    const preview = await documents.getPreviewUrl(
      { ...ctxOwner, clientId: CLIENT_PV },
      "dddddddd-0000-0000-0000-000000000000",
    );
    expect(preview).toBeNull();
  });
});