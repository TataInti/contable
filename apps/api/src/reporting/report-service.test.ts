import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { ReportService, ReportError } from "./report-service.js";

/**
 * Tests de integración de reportes y publicación (Fase 9).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-888888888888";

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

const reports = new ReportService();
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
    const capital = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "3.1.1",
        name: "Capital",
        type: "EQUITY",
        normalBalance: "CREDIT",
        isPostable: true,
        path: "3.1.1",
      },
    });
    return { fy, period, caja, capital };
  });
}

async function createPostedEntry(fx: { fy: { id: string }; period: { id: string }; caja: { id: string }; capital: { id: string } }) {
  await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    await tx.journalEntry.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        fiscalYearId: fx.fy.id,
        periodId: fx.period.id,
        entryDate: new Date("2026-01-15"),
        description: "Aporte",
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
              accountId: fx.capital.id,
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

describe("reportes (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM report_publications WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM report_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM report_template_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM report_templates WHERE "clientId" = '${CLIENT_ALFA}'`);
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

  it("mismo cutoff produce mismo hash (R-001)", async () => {
    const fx = await setupFixtures();
    await createPostedEntry(fx);

    const template = await reports.createTemplate(ctx, {
      clientId: CLIENT_ALFA,
      code: "BAL",
      name: "Balance",
      lines: [
        { position: 1, code: "CAJA", label: "Caja", formulaAst: { op: "ACCOUNT", accountCode: "1.1.1" } },
        { position: 2, code: "CAP", label: "Capital", formulaAst: { op: "ACCOUNT", accountCode: "3.1.1" } },
      ],
    });

    const run1 = await reports.runReport(ctx, { clientId: CLIENT_ALFA, templateId: template.id, cutoff: "2026-01-31" });
    const run2 = await reports.runReport(ctx, { clientId: CLIENT_ALFA, templateId: template.id, cutoff: "2026-01-31" });
    expect(run1.resultHash).toBe(run2.resultHash);
  });

  it("fórmula inválida no compila (R-005)", async () => {
    await expect(
      reports.createTemplate(ctx, {
        clientId: CLIENT_ALFA,
        code: "BAD",
        name: "Inválido",
        lines: [
          { position: 1, code: "X", label: "X", formulaAst: { op: "SUM", children: [{ op: "ACCOUNT" }] } },
        ],
      }),
    ).rejects.toThrow(ReportError);
  });

  it("publicación inmutable; borrador no aparece en portal (R-002/R-003)", async () => {
    const fx = await setupFixtures();
    await createPostedEntry(fx);

    const template = await reports.createTemplate(ctx, {
      clientId: CLIENT_ALFA,
      code: "BAL2",
      name: "Balance 2",
      lines: [
        { position: 1, code: "CAJA", label: "Caja", formulaAst: { op: "ACCOUNT", accountCode: "1.1.1" } },
      ],
    });

    const run = await reports.runReport(ctx, { clientId: CLIENT_ALFA, templateId: template.id, cutoff: "2026-01-31" });
    expect(run.status).toBe("DRAFT");

    // Borrador no aparece en portal
    const before = await reports.listPublished(ctx, CLIENT_ALFA);
    expect(before).toHaveLength(0);

    // Publicar
    const published = await reports.publish(ctx, run.id);
    expect(published.status).toBe("PUBLISHED");

    // Ahora sí aparece
    const after = await reports.listPublished(ctx, CLIENT_ALFA);
    expect(after).toHaveLength(1);

    // No se puede publicar dos veces (inmutable)
    await expect(reports.publish(ctx, run.id)).rejects.toThrow(ReportError);
  });

  it("drill-down llega a líneas del asiento (R-004)", async () => {
    const fx = await setupFixtures();
    await createPostedEntry(fx);

    const data = await reports.drillDown(ctx, CLIENT_ALFA, "1.1.1");
    expect(data.account.code).toBe("1.1.1");
    expect(data.lines.length).toBeGreaterThan(0);
    expect(data.lines[0]!.debitFunctional).toBe("100000");
  });
});