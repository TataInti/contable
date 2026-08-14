import { describe, expect, it, beforeEach, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { AssistantService, AssistantError } from "./assistant-service.js";

/**
 * Tests de integración del asistente (Fase 11).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 * La llamada a FastAPI se mockea (el servicio AI se testea por separado).
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-999999999999";

const alive = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

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

const ctx = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

async function setupFixtures() {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const fy = await tx.fiscalYear.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        label: "2026",
        status: "OPEN",
      },
    });
    const period = await tx.accountingPeriod.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        fiscalYearId: fy.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        ordinal: 1,
        status: "OPEN",
      },
    });
    return { fy, period };
  });
}

describe.skipIf(!alive)("asistente (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM assistant_usage WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM assistant_feedback WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM assistant_evidence WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM assistant_turns WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM assistant_conversations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM vat_liquidations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM close_cycles WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("crea conversación y envía turno con evidencia", async () => {
    const fx = await setupFixtures();
    const service = new AssistantService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });

    // Mock de la llamada a FastAPI
    vi.spyOn(service as unknown as { callAssistant: () => Promise<unknown> }, "callAssistant").mockResolvedValue({
      answer: "El saldo de caja es $100.000,00",
      abstained: false,
      abstentionReason: null,
      evidence: [{ kind: "ACCOUNT", sourceType: "LEDGER", sourceId: "1.1.1", label: "Caja", value: "100000.00" }],
      model: "contable-assistant-v1",
      provider: "internal",
      promptVersion: "assistant-ar-v1",
    });

    const conversation = await service.createConversation(ctx, {
      clientId: CLIENT_ALFA,
      periodId: fx.period.id,
      title: "Consulta enero",
    });
    expect(conversation.periodId).toBe(fx.period.id);

    const { userTurn, assistantTurn } = await service.sendTurn(ctx, {
      conversationId: conversation.id,
      query: "¿Cuál es el saldo de caja?",
    });
    expect(userTurn.role).toBe("USER");
    expect(assistantTurn.role).toBe("ASSISTANT");
    expect(assistantTurn.abstained).toBe(false);
    expect(assistantTurn.evidence).toHaveLength(1);
  });

  it("abstiene sin período (A-002)", async () => {
    const service = new AssistantService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });
    const conversation = await service.createConversation(ctx, {
      clientId: CLIENT_ALFA,
      title: "Sin período",
    });

    await expect(
      service.sendTurn(ctx, { conversationId: conversation.id, query: "¿Saldo?" }),
    ).rejects.toThrow(AssistantError);
  });

  it("registra feedback de un turno", async () => {
    const fx = await setupFixtures();
    const service = new AssistantService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });
    vi.spyOn(service as unknown as { callAssistant: () => Promise<unknown> }, "callAssistant").mockResolvedValue({
      answer: "ok",
      abstained: false,
      abstentionReason: null,
      evidence: [],
      model: "m",
      provider: "p",
      promptVersion: "v",
    });

    const conversation = await service.createConversation(ctx, {
      clientId: CLIENT_ALFA,
      periodId: fx.period.id,
    });
    const { assistantTurn } = await service.sendTurn(ctx, {
      conversationId: conversation.id,
      query: "¿Saldo?",
    });

    const feedback = await service.addFeedback(ctx, { turnId: assistantTurn.id, rating: 5, comment: "Excelente" });
    expect(feedback.rating).toBe(5);
  });
});