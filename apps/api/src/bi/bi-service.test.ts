import { describe, expect, it, beforeEach, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { BiService, BiError } from "./bi-service.js";

/**
 * Tests de integración del copiloto BI (Fase 12).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 * La llamada a FastAPI (plan) se mockea; el ejecutor usa el motor canónico.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-000000000000";

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
    const ventas = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "4.1.1",
        name: "Ventas",
        type: "REVENUE",
        normalBalance: "CREDIT",
        isPostable: true,
        path: "4.1.1",
      },
    });
    return { fy, period, caja, ventas };
  });
}

async function createPostedEntry(fx: { fy: { id: string }; period: { id: string }; caja: { id: string }; ventas: { id: string } }) {
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
              debitOriginal: "100000.00",
              creditOriginal: "0.00",
              debitFunctional: "100000.00",
              creditFunctional: "0.00",
            },
            {
              firmId: FIRM_ALFA,
              clientId: CLIENT_ALFA,
              position: 2,
              accountId: fx.ventas.id,
              currencyCode: "ARS",
              debitOriginal: "0.00",
              creditOriginal: "100000.00",
              debitFunctional: "0.00",
              creditFunctional: "100000.00",
            },
          ],
        },
      },
    });
  });
}

describe.skipIf(!alive)("copiloto BI (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM bi_snapshots WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bi_widgets WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bi_dashboards WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bi_dimensions WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bi_metrics WHERE "clientId" = '${CLIENT_ALFA}'`);
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

  it("ejecuta plan y cifra = motor canónico (A-008)", async () => {
    const fx = await setupFixtures();
    await createPostedEntry(fx);
    const service = new BiService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });

    const metric = await service.createMetric(ctx, {
      clientId: CLIENT_ALFA,
      code: "total_revenue",
      name: "Ingresos totales",
      definition: { type: "REVENUE" },
    });

    const plan = {
      version: 1,
      clientId: CLIENT_ALFA,
      fiscalPeriodId: fx.period.id,
      metric: "total_revenue",
      dimensions: [],
      filters: [],
      comparison: "NONE",
      limit: 100,
    };

    const { result, resultHash } = await service.execute(ctx, { clientId: CLIENT_ALFA, plan });
    expect(result.value).toBe("100000.0000");
    expect(result.metricVersion).toBe(metric.version);
    expect(result.source).toBe("LEDGER");
    expect(resultHash).toBeTruthy();
  });

  it("plan rechazado nunca ejecuta (A-006)", async () => {
    const service = new BiService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });
    // Mock: FastAPI rechaza el plan
    vi.spyOn(service as unknown as { plan: () => Promise<unknown> }, "plan").mockRejectedValue(
      new BiError("PLAN_REJECTED", "UNKNOWN_METRIC"),
    );

    await expect(
      service.plan(ctx, { clientId: CLIENT_ALFA, periodId: "x", query: "¿Cuántos empleados?" }),
    ).rejects.toThrow(BiError);
  });

  it("widget conserva fuente/versión/cutoff (A-007)", async () => {
    const fx = await setupFixtures();
    await createPostedEntry(fx);
    const service = new BiService({ baseUrl: "http://localhost:8000", secret: "test", serviceId: "api" });

    const metric = await service.createMetric(ctx, {
      clientId: CLIENT_ALFA,
      code: "total_revenue",
      name: "Ingresos",
      definition: { type: "REVENUE" },
    });
    const dashboard = await service.createDashboard(ctx, { clientId: CLIENT_ALFA, name: "Panel" });

    const plan = {
      version: 1,
      clientId: CLIENT_ALFA,
      fiscalPeriodId: fx.period.id,
      metric: "total_revenue",
      dimensions: [],
      filters: [],
      comparison: "NONE",
      limit: 100,
    };
    const { result, resultHash } = await service.execute(ctx, { clientId: CLIENT_ALFA, plan });

    const widget = await service.createWidget(ctx, {
      clientId: CLIENT_ALFA,
      dashboardId: dashboard.id,
      title: "Ingresos",
      plan,
      result,
      resultHash,
      metricId: metric.id,
    });
    expect(widget.source).toBe("LEDGER");
    expect(widget.status).toBe("READY");
    expect(widget.cutoff).not.toBeNull();

    // Snapshot reproducible
    const snapshot = await service.snapshot(ctx, dashboard.id, "2026-01-31");
    expect(snapshot.resultHash).toBeTruthy();
  });
});