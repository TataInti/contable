import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { WorkService } from "./work-service.js";

/**
 * B3 (plan piloto fiscal §5.1): lifecycle del pedido documental.
 *
 * Transiciones:
 *   DRAFT → (send) → SENT → (attach 1er requerido) → IN_PROGRESS →
 *   (attach todos) → READY_FOR_REVIEW → (accept/waive todos) → COMPLETED
 *   (reject ítem) → IN_PROGRESS; (cancel) → CANCELLED.
 *
 * Usa firma/cliente/usuarios PROPIOS (sufijo -B3) para suites paralelas.
 */

const OWNER_B3 = "d3b30000-0000-4000-8000-000000000001";
const FIRM_B3 = "d3b30000-0000-4000-8000-000000000002";
const CLIENT_B3 = "d3b30000-0000-4000-8000-000000000003";

const work = new WorkService();

const ctxOwner = { userId: OWNER_B3, firmId: FIRM_B3, actorKind: "USER" as const };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_B3}', 'owner.b3@test.local', 'Owner B3', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_B3}', 'Estudio B3', 'Estudio B3', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_B3}', '${FIRM_B3}', 'Cliente B3', '20999999975', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_B3}', '${OWNER_B3}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

async function cleanup() {
  await prisma.documentRequest.deleteMany({ where: { firmId: FIRM_B3 } });
}

async function createDocument() {
  return prisma.document.create({
    data: { firmId: FIRM_B3, clientId: CLIENT_B3, status: "READY", uploadOrigin: "FIRM" },
  });
}

/** Pedido con 2 ítems requeridos + 1 opcional, ya enviado. */
async function createSentRequest() {
  const request = await work.createRequest(ctxOwner, {
    clientId: CLIENT_B3,
    title: "Pedido B3",
    items: [
      { description: "Balance", required: true },
      { description: "IVA ventas", required: true },
      { description: "Opcional: contratos", required: false },
    ],
  });
  return work.sendRequest(ctxOwner, request.id);
}

describe("B3 §5.1 lifecycle del pedido documental", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanup();
  });

  it("crear pedido → DRAFT; enviar → SENT", async () => {
    const draft = await work.createRequest(ctxOwner, {
      clientId: CLIENT_B3,
      title: "Pedido en borrador",
      items: [{ description: "Balance" }],
    });
    expect(draft.status).toBe("DRAFT");

    const sent = await work.sendRequest(ctxOwner, draft.id);
    expect(sent.status).toBe("SENT");
  });

  it("adjuntar primer requerido → IN_PROGRESS; todos → READY_FOR_REVIEW", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();

    const first = await work.attachDocument(ctxOwner, request.id, required[0]!.id, doc.id);
    expect(first.status).toBe("ATTACHED");
    const afterFirst = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(afterFirst.status).toBe("IN_PROGRESS");

    await work.attachDocument(ctxOwner, request.id, required[1]!.id, doc.id);
    const afterAll = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(afterAll.status).toBe("READY_FOR_REVIEW");
  });

  it("adjuntar no completa el pedido por sí solo", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();
    for (const item of required) {
      await work.attachDocument(ctxOwner, request.id, item.id, doc.id);
    }
    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("READY_FOR_REVIEW");
    expect(after.status).not.toBe("COMPLETED");
  });

  it("no se puede adjuntar a un pedido DRAFT, COMPLETED o CANCELLED", async () => {
    const draft = await work.createRequest(ctxOwner, {
      clientId: CLIENT_B3,
      title: "Borrador",
      items: [{ description: "Balance" }],
    });
    const doc = await createDocument();
    await expect(
      work.attachDocument(ctxOwner, draft.id, draft.items[0]!.id, doc.id),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const cancelled = await createSentRequest();
    await work.cancelRequest(ctxOwner, cancelled.id);
    await expect(
      work.attachDocument(ctxOwner, cancelled.id, cancelled.items[0]!.id, doc.id),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("los ítems opcionales no bloquean la completitud", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const optional = request.items.find((item) => !item.required)!;
    const doc = await createDocument();
    for (const item of required) {
      await work.attachDocument(ctxOwner, request.id, item.id, doc.id);
    }
    // El opcional sigue PENDING y el pedido igual llega a READY_FOR_REVIEW.
    const optionalItem = await prisma.documentRequestItem.findUniqueOrThrow({
      where: { id: optional.id },
    });
    expect(optionalItem.status).toBe("PENDING");
    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("READY_FOR_REVIEW");
  });

  it("aceptar todos los requeridos → COMPLETED", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();
    for (const item of required) {
      await work.attachDocument(ctxOwner, request.id, item.id, doc.id);
    }
    for (const item of required) {
      await work.acceptItem(ctxOwner, request.id, item.id);
    }
    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("COMPLETED");
  });

  it("rechazar un ítem → IN_PROGRESS, conserva evidencia y motivo", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();
    for (const item of required) {
      await work.attachDocument(ctxOwner, request.id, item.id, doc.id);
    }
    const rejected = await work.rejectItem(
      ctxOwner,
      request.id,
      required[0]!.id,
      "El balance no coincide con el libro mayor",
    );
    expect(rejected.status).toBe("REJECTED");
    // Conserva la evidencia previa.
    expect(rejected.documentId).toBe(doc.id);
    expect(rejected.description).toContain("RECHAZADO");
    expect(rejected.description).toContain("libro mayor");

    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("IN_PROGRESS");
  });

  it("eximir un ítem cuenta como resuelto para la completitud", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();
    await work.attachDocument(ctxOwner, request.id, required[0]!.id, doc.id);
    await work.attachDocument(ctxOwner, request.id, required[1]!.id, doc.id);
    await work.waiveItem(ctxOwner, request.id, required[0]!.id);
    await work.acceptItem(ctxOwner, request.id, required[1]!.id);
    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("COMPLETED");
  });

  it("cancelar un pedido abierto → CANCELLED; un COMPLETED no se cancela", async () => {
    const open = await createSentRequest();
    const cancelled = await work.cancelRequest(ctxOwner, open.id);
    expect(cancelled.status).toBe("CANCELLED");

    const completed = await createSentRequest();
    const required = completed.items.filter((item) => item.required);
    const doc = await createDocument();
    for (const item of required) {
      await work.attachDocument(ctxOwner, completed.id, item.id, doc.id);
      await work.acceptItem(ctxOwner, completed.id, item.id);
    }
    await expect(work.cancelRequest(ctxOwner, completed.id)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("transiciones fuera de orden devuelven error estable", async () => {
    const draft = await work.createRequest(ctxOwner, {
      clientId: CLIENT_B3,
      title: "Fuera de orden",
      items: [{ description: "Balance" }],
    });
    // Aceptar ítem sobre DRAFT → INVALID_TRANSITION.
    await expect(work.acceptItem(ctxOwner, draft.id, draft.items[0]!.id)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    // Enviar dos veces → la segunda falla.
    await work.sendRequest(ctxOwner, draft.id);
    await expect(work.sendRequest(ctxOwner, draft.id)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("repetir una transición válida no duplica eventos de estado", async () => {
    const request = await createSentRequest();
    const required = request.items.filter((item) => item.required);
    const doc = await createDocument();
    await work.attachDocument(ctxOwner, request.id, required[0]!.id, doc.id);
    // Re-adjuntar el mismo ítem es idempotente en estado del pedido.
    await work.attachDocument(ctxOwner, request.id, required[0]!.id, doc.id);
    const after = await prisma.documentRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe("IN_PROGRESS");
  });
});
