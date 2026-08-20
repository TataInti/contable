import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { MonthlyWorkpaperService, WorkpaperError } from "./workpaper-service.js";

/**
 * F1.1: tests de integración del expediente mensual de liquidación.
 *
 * Verifica el ciclo de vida del MonthlyTaxWorkpaper:
 *   crear → coverage → calcular → submit-review → review (maker-checker) →
 *   finalize (bloquea controles abiertos) → rectify (nueva revisión).
 *
 * Usa firma/cliente/usuarios PROPIOS para no colisionar con suites paralelas.
 */

const OWNER_WP = "99999999-9999-4999-8999-999999999999";
const REVIEWER_WP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PREPARER_WP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FIRM_WP = "99999999-9999-4999-8999-999999999998";
const CLIENT_WP = "99999999-2222-4333-8444-999999999999";

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

const service = new MonthlyWorkpaperService();

const ctxOwner = { userId: OWNER_WP, firmId: FIRM_WP, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_WP, firmId: FIRM_WP, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_WP, firmId: FIRM_WP, actorKind: "USER" as const };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_WP}', 'owner.wp@test.local', 'Owner WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${REVIEWER_WP}', 'reviewer.wp@test.local', 'Reviewer WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${PREPARER_WP}', 'preparer.wp@test.local', 'Preparer WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_WP}', 'Estudio WP', 'Estudio WP', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_WP}', '${FIRM_WP}', 'Cliente WP', '20999999977', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${OWNER_WP}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${REVIEWER_WP}', 'REVIEWER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${PREPARER_WP}', 'PREPARER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

describe("F1.1 expediente mensual de liquidación", () => {
  beforeEach(async () => {
    await setupMembership();
    // Idempotencia: limpia sólo los datos de esta suite.
    await prisma.$executeRawUnsafe(
      `DELETE FROM monthly_tax_workpapers WHERE "firmId" = '${FIRM_WP}'`,
    );
  });

  it("crea un expediente mensual idempotente", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(wp.id).toBeTruthy();
    expect(wp.status).toBe("DRAFT");
    expect(wp.revision).toBe(1);

    // Idempotente: mismo mes no duplica.
    const again = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(again.id).toBe(wp.id);
  });

  it("lista expedientes del cliente", async () => {
    await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const list = await service.list(ctxOwner, CLIENT_WP);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.clientId).toBe(CLIENT_WP);
  });

  it("calcula y transiciona a CALCULATED con hash de entrada", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const result = await service.calculate(ctxOwner, wp.id);
    expect(result.workpaper.status).toBe("CALCULATED");
    expect(result.workpaper.inputHash).toBeTruthy();
  });

  it("no permite finalizar sin revisión (INVALID_TRANSITION)", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxOwner, wp.id);
    await expect(service.finalize(ctxOwner, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("maker-checker: el preparador no revisa ni finaliza su propio expediente", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await service.submitReview(ctxPreparer, wp.id);

    await expect(service.review(ctxPreparer, wp.id, { approved: true })).rejects.toThrow(
      WorkpaperError,
    );
    await expect(service.finalize(ctxPreparer, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("recorre el ciclo completo: calcular → revisar → finalizar", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    const reviewed = await service.review(ctxReviewer, wp.id, { approved: true });
    expect(reviewed.status).toBe("REVIEWED");

    const finalized = await service.finalize(ctxOwner, wp.id);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.outputHash).toBeTruthy();
  });

  it("bloquea finalizar con controles bloqueantes abiertos", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    await service.review(ctxReviewer, wp.id, { approved: true });

    // Control bloqueante abierto.
    await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.taxControlFinding.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          workpaperId: wp.id,
          code: "BOOK_RATE_RECONCILIATION",
          severity: "BLOCKING",
          status: "OPEN",
        },
      }),
    );

    await expect(service.finalize(ctxOwner, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("F1.5: el preparador no puede eximir un control bloqueante de su propio expediente", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);

    const finding = await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.taxControlFinding.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          workpaperId: wp.id,
          code: "BOOK_RATE_RECONCILIATION",
          severity: "BLOCKING",
          status: "OPEN",
        },
      }),
    );

    // El preparador no puede waivear su propio control bloqueante.
    await expect(
      service.resolveControl(ctxPreparer, wp.id, finding.id, {
        resolution: "justificado",
        status: "WAIVED",
      }),
    ).rejects.toThrow(WorkpaperError);

    // Un revisor distinto sí puede.
    const resolved = await service.resolveControl(ctxReviewer, wp.id, finding.id, {
      resolution: "justificado por evidencia",
      status: "WAIVED",
    });
    expect(resolved.status).toBe("WAIVED");
  });

  it("rectifica creando una nueva revisión inmutable", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    await service.review(ctxReviewer, wp.id, { approved: true });
    await service.finalize(ctxOwner, wp.id);

    const rectified = await service.rectify(ctxPreparer, wp.id);
    expect(rectified.revision).toBe(2);
    expect(rectified.supersedesId).toBe(wp.id);
    expect(rectified.status).toBe("DRAFT");

    // La revisión anterior sigue FINALIZED (inmutable).
    const original = await service.get(ctxOwner, wp.id);
    expect(original?.status).toBe("FINALIZED");
  });

  it("F1.7: el libro de créditos calcula el saldo disponible desde movimientos", async () => {
    // Crea un lote de crédito con un movimiento de aplicación.
    const lot = await runAsRuntime(OWNER_WP, FIRM_WP, async (tx) => {
      const created = await tx.taxCreditLot.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          taxTypeId: "IVA",
          jurisdictionId: "AR",
          kind: "FREE_AVAILABILITY",
          originalAmount: new Prisma.Decimal("5000"),
          createdByUserId: OWNER_WP,
        },
      });
      await tx.taxCreditMovement.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          lotId: created.id,
          kind: "APPLICATION",
          amount: new Prisma.Decimal("2000"),
          createdByUserId: OWNER_WP,
        },
      });
      return created;
    });

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry).toBeDefined();
    expect(entry?.originalAmount).toBe("5000.0000");
    expect(entry?.available).toBe("3000.0000"); // 5000 - 2000
    expect(entry?.movements).toHaveLength(1);
  });
});