import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { VatService, VatError } from "./vat-service.js";
import { ObligationService, ObligationError } from "./obligation-service.js";
import { CloseService, CloseError } from "./close-service.js";
import { WorkService, WorkError } from "./work-service.js";

/**
 * Tests de integración de IVA, obligaciones, cierres y trabajo (Fase 8).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-777777777777";

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

const vat = new VatService();
const obligations = new ObligationService();
const close = new CloseService();
const work = new WorkService();

const ctxOwner = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

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
    const ivaDebito = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "2.1.1",
        name: "IVA Débito Fiscal",
        type: "LIABILITY",
        normalBalance: "CREDIT",
        isPostable: true,
        vatRole: "IVA_DEBITO",
        path: "2.1.1",
      },
    });
    const caja = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "1.1.1",
        name: "Caja",
        type: "ASSET",
        normalBalance: "DEBIT",
        isPostable: true,
        path: "1.1.1",
      },
    });
    return { fy, period, ivaDebito, caja };
  });
}

/** Crea un asiento posteado con IVA débito para que el mayor tenga cuentas IVA. */
async function createPostedVatEntry(fx: { fy: { id: string }; period: { id: string }; ivaDebito: { id: string }; caja: { id: string } }) {
  await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    await tx.journalEntry.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        fiscalYearId: fx.fy.id,
        periodId: fx.period.id,
        entryDate: new Date("2026-01-15"),
        description: "Venta",
        sourceType: "MANUAL",
        status: "POSTED",
        preparedByUserId: OWNER_A,
        postedByUserId: OWNER_A,
        postedAt: new Date(),
        sequenceNumber: 1,
        lines: {
          create: [
            {
              firmId: FIRM_ALFA,
              clientId: CLIENT_ALFA,
              position: 1,
              accountId: fx.caja.id,
              currencyCode: "ARS",
              debitOriginal: "21000.00",
              creditOriginal: "0.00",
              debitFunctional: "21000.00",
              creditFunctional: "0.00",
            },
            {
              firmId: FIRM_ALFA,
              clientId: CLIENT_ALFA,
              position: 2,
              accountId: fx.ivaDebito.id,
              currencyCode: "ARS",
              debitOriginal: "0.00",
              creditOriginal: "21000.00",
              debitFunctional: "0.00",
              creditFunctional: "21000.00",
            },
          ],
        },
      },
    });
  });
}

describe("IVA (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM vat_liquidations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM vat_rules WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM close_work_items WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM close_cycles WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("calcula liquidación y concilia con mayor (V-001)", async () => {
    const fx = await setupFixtures();
    await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.vatRule.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          code: "IVA_DEBITO",
          name: "IVA Débito",
          rate: "21.0000",
          version: 1,
        },
      }),
    );

    // Asiento posteado con IVA débito
    await createPostedVatEntry(fx);

    const liq = await vat.calculate(ctxPreparer, {
      clientId: CLIENT_ALFA,
      periodId: fx.period.id,
      cutoff: "2026-01-31",
      rulesVersion: 1,
    });
    expect(liq.status).toBe("CALCULATED");
    expect(liq.totals).not.toBeNull();
  });

  it("finalización exige revisor distinto (V-002)", async () => {
    const fx = await setupFixtures();
    await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.vatRule.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          code: "IVA_DEBITO",
          name: "IVA Débito",
          rate: "21.0000",
          version: 1,
        },
      }),
    );
    await createPostedVatEntry(fx);
    const liq = await vat.calculate(ctxPreparer, {
      clientId: CLIENT_ALFA,
      periodId: fx.period.id,
      cutoff: "2026-01-31",
      rulesVersion: 1,
    });

    // El preparador no puede finalizar su propia liquidación
    await expect(vat.finalize(ctxPreparer, liq.id)).rejects.toThrow(VatError);
    // El owner sí
    const finalized = await vat.finalize(ctxOwner, liq.id);
    expect(finalized.status).toBe("FINALIZED");
  });

  it("finalizada es inmutable; rectificación crea versión (V-003)", async () => {
    const fx = await setupFixtures();
    await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.vatRule.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          code: "IVA_DEBITO",
          name: "IVA Débito",
          rate: "21.0000",
          version: 1,
        },
      }),
    );
    await createPostedVatEntry(fx);
    const liq = await vat.calculate(ctxPreparer, {
      clientId: CLIENT_ALFA,
      periodId: fx.period.id,
      cutoff: "2026-01-31",
      rulesVersion: 1,
    });
    await vat.finalize(ctxOwner, liq.id);

    // No se puede finalizar dos veces
    await expect(vat.finalize(ctxOwner, liq.id)).rejects.toThrow(VatError);

    // Rectificación crea nueva versión
    const rectified = await vat.rectify(ctxPreparer, liq.id);
    expect(rectified.supersedesId).toBe(liq.id);
    expect(rectified.status).toBe("CALCULATED");
  });
});

describe("obligaciones (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM reminder_dispatches WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM obligation_reminders WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM obligation_instances WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM obligations WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("materializa instancia sin duplicar (recurrencia idempotente)", async () => {
    const obligation = await obligations.createObligation(ctxOwner, {
      clientId: CLIENT_ALFA,
      code: "IVA-MENSUAL",
      name: "IVA Mensual",
      frequency: "MONTHLY",
      dueDay: 20,
    });

    const instance = await obligations.materializeInstance(ctxOwner, {
      obligationId: obligation.id,
      periodLabel: "2026-01",
      dueDate: "2026-02-20",
    });
    expect(instance.status).toBe("PENDING");

    // Reintento no duplica
    await expect(
      obligations.materializeInstance(ctxOwner, {
        obligationId: obligation.id,
        periodLabel: "2026-01",
        dueDate: "2026-02-20",
      }),
    ).rejects.toThrow(ObligationError);
  });

  it("recordatorio no se duplica (W-001)", async () => {
    const obligation = await obligations.createObligation(ctxOwner, {
      clientId: CLIENT_ALFA,
      code: "IIBB",
      name: "IIBB",
      frequency: "MONTHLY",
    });
    const instance = await obligations.materializeInstance(ctxOwner, {
      obligationId: obligation.id,
      periodLabel: "2026-01",
      dueDate: "2026-02-20",
    });

    const dispatch = await obligations.scheduleReminder(ctxOwner, {
      obligationId: obligation.id,
      instanceId: instance.id,
      scheduledFor: "2026-02-19",
    });
    expect(dispatch.status).toBe("PENDING");

    // Reintento no duplica
    await expect(
      obligations.scheduleReminder(ctxOwner, {
        obligationId: obligation.id,
        instanceId: instance.id,
        scheduledFor: "2026-02-19",
      }),
    ).rejects.toThrow(ObligationError);
  });

  it("reintento de dispatch conserva fila (W-002)", async () => {
    const obligation = await obligations.createObligation(ctxOwner, {
      clientId: CLIENT_ALFA,
      code: "Ganancias",
      name: "Ganancias",
      frequency: "ANNUAL",
    });
    const instance = await obligations.materializeInstance(ctxOwner, {
      obligationId: obligation.id,
      periodLabel: "2025",
      dueDate: "2026-06-30",
    });
    const dispatch = await obligations.scheduleReminder(ctxOwner, {
      obligationId: obligation.id,
      instanceId: instance.id,
      scheduledFor: "2026-06-29",
    });

    const retried = await obligations.retryDispatch(ctxOwner, dispatch.id);
    expect(retried.attempts).toBe(1);
    expect(retried.id).toBe(dispatch.id);
  });
});

describe("cierres (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM close_work_items WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM close_cycles WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM vat_liquidations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM vat_rules WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("finaliza ciclo solo cuando todos los work items están DONE", async () => {
    const fx = await setupFixtures();
    const cycle = await close.createCycle(ctxOwner, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      items: [
        { code: "IVA", title: "Liquidar IVA" },
        { code: "BANCOS", title: "Conciliar bancos" },
      ],
    });
    expect(cycle.workItems).toHaveLength(2);

    // No finaliza con pendientes
    await expect(close.finalizeCycle(ctxOwner, cycle.id)).rejects.toThrow(CloseError);

    // Completar ambos
    for (const item of cycle.workItems) {
      await close.completeWorkItem(ctxOwner, cycle.id, item.id);
    }
    const finalized = await close.finalizeCycle(ctxOwner, cycle.id);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.version).toBe(2);
  });
});

describe("trabajo (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM request_messages WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM request_threads WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM document_request_items WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM document_requests WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("completitud del pedido se deriva de los ítems (W-003)", async () => {
    const request = await work.createRequest(ctxOwner, {
      clientId: CLIENT_ALFA,
      title: "Documentación anual",
      items: [
        { description: "Balance", required: true },
        { description: "DDJJ", required: true },
      ],
    });
    expect(request.status).toBe("DRAFT");

    // Adjuntar un documento a un ítem (documento dummy)
    const doc = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.document.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          status: "READY",
        },
      }),
    );
    await work.attachDocument(ctxOwner, request.id, request.items[0]!.id, doc.id);

    // Aún no completo (falta el segundo ítem)
    const partial = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.documentRequest.findUnique({ where: { id: request.id } }),
    );
    expect(partial?.status).toBe("DRAFT");

    await work.attachDocument(ctxOwner, request.id, request.items[1]!.id, doc.id);
    const complete = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.documentRequest.findUnique({ where: { id: request.id } }),
    );
    expect(complete?.status).toBe("COMPLETED");
  });

  it("nota interna no cambia a compartida sin confirmación (W-004)", async () => {
    const request = await work.createRequest(ctxOwner, {
      clientId: CLIENT_ALFA,
      title: "Pedido",
      items: [{ description: "Item" }],
    });
    const thread = await work.createThread(ctxOwner, request.id, "INTERNAL");
    const message = await work.addMessage(ctxOwner, thread.id, "Nota interna", "INTERNAL");

    await expect(
      work.changeVisibility(ctxOwner, message.id, "SHARED", false),
    ).rejects.toThrow(WorkError);

    const shared = await work.changeVisibility(ctxOwner, message.id, "SHARED", true);
    expect(shared.visibility).toBe("SHARED");
  });
});
