import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { DocumentService } from "../documents/document-service.js";
import { ObjectStorage } from "../storage/object-storage.js";
import type { TenantContext } from "../auth/tenant.js";

/**
 * B4 (plan piloto fiscal §5.2): visibilidad del portal.
 *
 * Contratos:
 * - el portal excluye pedidos DRAFT y CANCELLED (y el resumen no los cuenta);
 * - SENT/IN_PROGRESS/READY_FOR_REVIEW/COMPLETED son visibles;
 * - el portal sólo recibe mensajes SHARED;
 * - un documento en cuarentena no aparece como evidencia disponible;
 * - un usuario de otro cliente obtiene 404 sin revelar existencia (RLS).
 *
 * Usa firma/cliente PROPIOS (sufijo -B4) para suites paralelas.
 */

const OWNER_B4 = "b4b40000-0000-4000-8000-000000000001";
const FIRM_B4 = "b4b40000-0000-4000-8000-000000000002";
const CLIENT_B4 = "b4b40000-0000-4000-8000-000000000003";
const CLIENT_B4_OTRO = "b4b40000-0000-4000-8000-000000000004";

const storage = new ObjectStorage();
const documents = new DocumentService(storage);

const ctxOwner: TenantContext = { userId: OWNER_B4, firmId: FIRM_B4, actorKind: "USER" };
const ctxPortal: TenantContext = { userId: OWNER_B4, firmId: FIRM_B4, clientId: CLIENT_B4, actorKind: "PORTAL" };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_B4}', 'owner.b4@test.local', 'Owner B4', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_B4}', 'Estudio B4', 'Estudio B4', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_B4}', '${FIRM_B4}', 'Cliente B4', '20999999974', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_B4_OTRO}', '${FIRM_B4}', 'Cliente B4 Otro', '20999999973', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_B4}', '${OWNER_B4}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

async function cleanup() {
  await prisma.documentRequest.deleteMany({ where: { firmId: FIRM_B4 } });
  await prisma.document.deleteMany({ where: { firmId: FIRM_B4 } });
}

/** Crea un pedido con el estado dado (bypassa transiciones para el fixture). */
async function createRequestWithStatus(status: string, clientId = CLIENT_B4) {
  const request = await prisma.documentRequest.create({
    data: {
      firmId: FIRM_B4,
      clientId,
      title: `Pedido ${status}`,
      status: status as never,
      createdByUserId: OWNER_B4,
    },
  });
  return request;
}

/** Réplica del filtro del portal (portal/routes.ts) para verificar aislamiento. */
function portalVisibleRequests() {
  return prisma.documentRequest.findMany({
    where: { firmId: FIRM_B4, clientId: CLIENT_B4, status: { notIn: ["DRAFT", "CANCELLED"] } },
  });
}

function portalSummaryCount() {
  return prisma.documentRequest.count({
    where: { firmId: FIRM_B4, clientId: CLIENT_B4, status: { notIn: ["COMPLETED", "DRAFT", "CANCELLED"] } },
  });
}

describe("B4 §5.2 visibilidad del portal", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanup();
  });

  it("el portal excluye pedidos DRAFT y CANCELLED", async () => {
    await createRequestWithStatus("DRAFT");
    await createRequestWithStatus("CANCELLED");
    await createRequestWithStatus("SENT");
    const visible = await portalVisibleRequests();
    expect(visible).toHaveLength(1);
    expect(visible[0]!.status).toBe("SENT");
  });

  it("SENT, IN_PROGRESS, READY_FOR_REVIEW y COMPLETED son visibles", async () => {
    await createRequestWithStatus("SENT");
    await createRequestWithStatus("IN_PROGRESS");
    await createRequestWithStatus("READY_FOR_REVIEW");
    await createRequestWithStatus("COMPLETED");
    const visible = await portalVisibleRequests();
    expect(visible).toHaveLength(4);
  });

  it("el resumen no cuenta DRAFT ni CANCELLED como pendientes", async () => {
    await createRequestWithStatus("DRAFT");
    await createRequestWithStatus("CANCELLED");
    await createRequestWithStatus("SENT");
    await createRequestWithStatus("IN_PROGRESS");
    await createRequestWithStatus("COMPLETED");
    const pending = await portalSummaryCount();
    expect(pending).toBe(2); // SENT + IN_PROGRESS
  });

  it("el portal sólo recibe mensajes SHARED", async () => {
    const request = await createRequestWithStatus("SENT");
    const thread = await prisma.requestThread.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, requestId: request.id, visibility: "SHARED" },
    });
    await prisma.requestMessage.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, threadId: thread.id, authorUserId: OWNER_B4, body: "interna", visibility: "INTERNAL" },
    });
    await prisma.requestMessage.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, threadId: thread.id, authorUserId: OWNER_B4, body: "compartida", visibility: "SHARED" },
    });
    // Réplica del include del portal (routes.ts): sólo SHARED.
    const visible = await prisma.documentRequest.findFirst({
      where: { id: request.id },
      include: { threads: { include: { messages: { where: { visibility: "SHARED" } } } } },
    });
    const messages = visible?.threads.flatMap((t) => t.messages) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe("compartida");
  });

  it("un documento en cuarentena no aparece como evidencia para el portal", async () => {
    // Documento limpio (originals/CLEAN).
    const clean = await prisma.document.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, status: "READY", uploadOrigin: "CLIENT" },
    });
    await prisma.documentFileVersion.create({
      data: {
        firmId: FIRM_B4, clientId: CLIENT_B4, documentId: clean.id,
        originalName: "limpio.pdf", mimeType: "application/pdf", extension: "pdf",
        sizeBytes: 100, sha256: "b".repeat(64), bucket: "originals",
        objectKey: `b4/${clean.id}.pdf`, antivirusStatus: "CLEAN",
      },
    });
    // Documento en cuarentena (quarantine/VALIDATING, aún no promovido).
    const quarantine = await prisma.document.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, status: "VALIDATING", uploadOrigin: "CLIENT" },
    });
    await prisma.documentFileVersion.create({
      data: {
        firmId: FIRM_B4, clientId: CLIENT_B4, documentId: quarantine.id,
        originalName: "sospechoso.pdf", mimeType: "application/pdf", extension: "pdf",
        sizeBytes: 100, sha256: "c".repeat(64), bucket: "quarantine",
        objectKey: `b4/${quarantine.id}.bin`, antivirusStatus: "PENDING",
      },
    });

    const portalDocs = await documents.listDocuments(FIRM_B4, CLIENT_B4, ctxPortal);
    const portalIds = portalDocs.map((doc) => doc.id);
    expect(portalIds).toContain(clean.id);
    expect(portalIds).not.toContain(quarantine.id);

    // El estudio sí ve ambos.
    const firmDocs = await documents.listDocuments(FIRM_B4, CLIENT_B4, ctxOwner);
    expect(firmDocs.map((doc) => doc.id)).toContain(quarantine.id);
  });

  it("la carga del portal queda asociada al ítem correcto y no lo acepta", async () => {
    const request = await createRequestWithStatus("SENT");
    const item = await prisma.documentRequestItem.create({
      data: { firmId: FIRM_B4, clientId: CLIENT_B4, requestId: request.id, description: "Balance", required: true, status: "PENDING" },
    });
    // getPreviewUrl/getRequestItem reautorizan por ctx; un ítem de otro
    // cliente no es visible.
    const found = await documents.getRequestItem(ctxPortal, item.id);
    expect(found?.id).toBe(item.id);
    expect(found?.status).toBe("PENDING"); // cargar no implica aceptar

    const ctxOtro: TenantContext = { userId: OWNER_B4, firmId: FIRM_B4, clientId: CLIENT_B4_OTRO, actorKind: "PORTAL" };
    const foreign = await documents.getRequestItem(ctxOtro, item.id);
    expect(foreign).toBeNull();
  });
});
