import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";

/**
 * G0-07: lease, retry, reclaim y dead-letter del outbox.
 * Verifica el comportamiento de las funciones SQL del outbox.
 * Requiere PostgreSQL local con migraciones aplicadas.
 *
 * Nota: el runtime NO opera outbox_events directamente (G0-06). El acceso se
 * hace exclusivamente vía funciones SECURITY DEFINER. Por eso los inserts de
 * este test usan el cliente superuser (prisma), como hace el publisher.
 */

const CLIENT_ALFA = "11111111-2222-4333-8444-777777777777";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function createEvent(overrides: {
  aggregateId: string;
  status?: string;
  lockedAt?: Date;
  attempts?: number;
}) {
  return prisma.$executeRaw`
    INSERT INTO outbox_events ("id", "firmId", "clientId", topic, "eventType", "aggregateId", payload, status, attempts, "lockedAt")
    VALUES (gen_random_uuid()::text, ${FIRM_ALFA}, ${CLIENT_ALFA}, 'documents', 'document.validate', ${overrides.aggregateId}, '{}'::jsonb,
      ${overrides.status ?? "PENDING"}, ${overrides.attempts ?? 0}, ${overrides.lockedAt ?? null})
  `;
}

describe("outbox (G0-07)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM outbox_events WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("claim toma eventos PENDING y los marca PROCESSING con lease", async () => {
    await createEvent({ aggregateId: "agg-1" });

    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      SELECT * FROM app_claim_outbox(10)
    `;
    expect(claimed.length).toBe(1);

    const event = await prisma.outboxEvent.findFirst({ where: { clientId: CLIENT_ALFA } });
    expect(event?.status).toBe("PROCESSING");
    expect(event?.lockedAt).not.toBeNull();
    expect(event?.attempts).toBe(1);
  });

  it("reclaim recupera PROCESSING con lease vencido", async () => {
    await createEvent({
      aggregateId: "agg-2",
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - 10 * 60 * 1000), // lease vencido hace 10 min
      attempts: 1,
    });

    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      SELECT * FROM app_claim_outbox(10)
    `;
    expect(claimed.length).toBe(1);
  });

  it("no reclama PROCESSING con lease vigente", async () => {
    await createEvent({
      aggregateId: "agg-3",
      status: "PROCESSING",
      lockedAt: new Date(), // lease vigente
      attempts: 1,
    });

    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      SELECT * FROM app_claim_outbox(10)
    `;
    expect(claimed.length).toBe(0);
  });

  it("mueve a DEAD_LETTER tras el máximo de intentos", async () => {
    await createEvent({ aggregateId: "agg-4", attempts: 10 });
    const event = await prisma.outboxEvent.findFirst({ where: { clientId: CLIENT_ALFA } });

    await prisma.$executeRaw`SELECT app_fail_outbox(${event!.id}, 'error de prueba')`;

    const updated = await prisma.outboxEvent.findFirst({ where: { clientId: CLIENT_ALFA } });
    expect(updated?.status).toBe("DEAD_LETTER");
    expect(updated?.deadLetterAt).not.toBeNull();
    expect(updated?.deadLetterReason).toContain("error de prueba");
  });

  it("completa un evento y lo marca PUBLISHED", async () => {
    await createEvent({ aggregateId: "agg-5" });

    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      SELECT * FROM app_claim_outbox(10)
    `;
    await prisma.$executeRaw`SELECT app_complete_outbox(${claimed[0]!.id})`;

    const event = await prisma.outboxEvent.findFirst({ where: { clientId: CLIENT_ALFA } });
    expect(event?.status).toBe("PUBLISHED");
    expect(event?.publishedAt).not.toBeNull();
  });
});