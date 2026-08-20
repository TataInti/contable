import { describe, expect, it, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { RulePackValidator } from "./rule-pack-validator.js";

/**
 * F2.3: revalidación programada de rule packs.
 *
 * Verifica que un pack ACTIVE con versión vigente se mantiene, y que un pack
 * sin versión vigente (validTo vencido) se retira (fail-safe) para no calcular
 * con reglas vencidas.
 *
 * Usa firma/cliente/maestros PROPIOS (sufijo -RV) para no colisionar.
 */

const OWNER_RV = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const FIRM_RV = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const CLIENT_RV = "dddddddd-2222-4333-8444-dddddddddd03";

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

const validator = new RulePackValidator();
const ctxOwner = { userId: OWNER_RV, firmId: FIRM_RV, actorKind: "USER" as const };

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_RV}', 'owner.rv@test.local', 'Owner RV', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_RV}', 'Estudio RV', 'Estudio RV', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_RV}', '${FIRM_RV}', 'Cliente RV', '20999999975', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_RV}', '${OWNER_RV}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

/** Crea un pack ACTIVE con una versión vigente (o vencida si expired=true). */
async function createActivePack(code: string, expired: boolean) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_RV}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_RV}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);

    await tx.$executeRawUnsafe(`
      INSERT INTO jurisdictions (id, code, name, kind, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'AR-RV', 'Argentina RV', 'NATIONAL', true, now(), now())
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_types (id, code, name, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'IVA-RV', 'IVA RV', true, now(), now())
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_authorities (id, code, name, "jurisdictionId", "isActive", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'ARCA-RV', 'ARCA RV', j.id, true, now(), now()
      FROM jurisdictions j WHERE j.code = 'AR-RV'
      ON CONFLICT (code) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO tax_regimes (id, code, name, "taxTypeId", "jurisdictionId", "authorityId", "isActive", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'RI-RV', 'RI RV', tt.id, j.id, a.id, true, now(), now()
      FROM tax_types tt, jurisdictions j, tax_authorities a
      WHERE tt.code = 'IVA-RV' AND j.code = 'AR-RV' AND a.code = 'ARCA-RV'
      ON CONFLICT (code) DO NOTHING
    `);

    const regime = await tx.taxRegime.findUniqueOrThrow({ where: { code: "RI-RV" } });
    const pack = await tx.taxRulePack.create({
      data: { code, name: code, regimeId: regime.id, status: "ACTIVE" },
    });
    const validFrom = expired ? new Date("2020-01-01") : new Date("2026-01-01");
    const validTo = expired ? new Date("2021-01-01") : null;
    // Hash canónico de una versión sin reglas (mismo cálculo que el validator).
    const emptyHash = createHash("sha256").update(JSON.stringify({ rate: [], min: [], bracket: [], due: [] })).digest("hex");
    await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom,
        ...(validTo ? { validTo } : {}),
        rulesHash: emptyHash,
        engineVersion: "1.0.0",
      },
    });
    return pack;
  });
}

describe("F2.3 revalidación de rule packs", () => {
  beforeEach(async () => {
    await setupMembership();
    await prisma.$executeRawUnsafe(
      `DELETE FROM tax_rule_packs WHERE code LIKE 'RV_%'`,
    );
  });

  it("mantiene un pack ACTIVE con versión vigente", async () => {
    const pack = await createActivePack("RV_VIGENTE", false);
    const results = await validator.revalidateAll(ctxOwner);
    const result = results.find((r) => r.packId === pack.id);
    expect(result).toBeTruthy();
    expect(result!.status).toBe("ACTIVE");
    expect(result!.issues).toEqual([]);
  });

  it("retira un pack ACTIVE sin versión vigente (fail-safe)", async () => {
    const pack = await createActivePack("RV_VENCIDO", true);
    const results = await runAsRuntime(OWNER_RV, FIRM_RV, async () => {
      return validator.revalidateAll(ctxOwner);
    });
    const result = results.find((r) => r.packId === pack.id);
    expect(result).toBeTruthy();
    expect(result!.status).toBe("RETIRED");
    expect(result!.issues).toContain("NO_CURRENT_VERSION");

    // El pack quedó RETIRED en DB.
    const updated = await prisma.taxRulePack.findUnique({ where: { id: pack.id } });
    expect(updated?.status).toBe("RETIRED");
  });
});