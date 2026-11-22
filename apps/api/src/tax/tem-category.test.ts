import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { TemCategoryError, TemCategoryService } from "./tem-category-service.js";

/**
 * Categoría anual del TEM por cliente (corte 1E): se elige una vez por año
 * entre las del catálogo de la DIM y define el mínimo mensual.
 * Fixtures sintéticos: estudios, usuarios y CUIT inventados.
 */

const OWNER_A = "aaaa1e00-1111-4111-8111-000000000001";
const OWNER_B = "aaaa1e00-2222-4222-8222-000000000002";
const FIRM_A = "aaaa1e00-3333-4333-8333-000000000003";
const FIRM_B = "aaaa1e00-4444-4444-8444-000000000004";
const CLIENT_A = "aaaa1e00-5555-4555-8555-000000000005";

const runtimePrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.RUNTIME_DATABASE_URL ??
      "postgresql://contable_runtime:***@localhost:5432/contable",
  }),
});

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

const service = new TemCategoryService();
const ctxA = { userId: OWNER_A, firmId: FIRM_A, clientId: CLIENT_A, actorKind: "USER" as const };

beforeAll(async () => {
  for (const [id, email] of [
    [OWNER_A, "owner.a.1e@test.local"],
    [OWNER_B, "owner.b.1e@test.local"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${id}', '${email}', 'Titular 1E', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  for (const [firm, owner] of [
    [FIRM_A, OWNER_A],
    [FIRM_B, OWNER_B],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
      VALUES ('${firm}', 'Estudio 1E', 'Estudio 1E', now()) ON CONFLICT ("id") DO NOTHING
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${firm}', '${owner}', 'OWNER', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_A}', '${FIRM_A}', 'Cliente 1E SRL', '30999999991', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.clientTemCategory.deleteMany({ where: { clientId: CLIENT_A } });
});

async function cleanupRegimes() {
  await prisma.taxRegistration.deleteMany({ where: { clientId: CLIENT_A } });
  await prisma.taxpayerProfileVersion.deleteMany({ where: { clientId: CLIENT_A } });
  await prisma.taxRuleVersion.deleteMany({
    where: { pack: { code: { startsWith: "T1E_PACK_" } } },
  });
  await prisma.taxRulePack.deleteMany({ where: { code: { startsWith: "T1E_PACK_" } } });
  await prisma.taxRegime.deleteMany({ where: { code: { startsWith: "T1E_REG_" } } });
  await prisma.taxType.deleteMany({ where: { code: "T1E_TYPE" } });
  await prisma.taxAuthority.deleteMany({ where: { code: "T1E_AUTH" } });
  await prisma.jurisdiction.deleteMany({ where: { code: "T1E_JUR" } });
}

afterAll(async () => {
  await cleanupRegimes();
  await prisma.clientTemCategory.deleteMany({ where: { clientId: CLIENT_A } });
  await prisma.temCategoryMinimum.deleteMany({ where: { year: 2031 } });
  await runtimePrisma.$disconnect();
});

describe("Categoría anual del TEM: catálogo y elección", () => {
  it("sin elegir: informa que falta y ofrece las seis categorías con su mínimo", async () => {
    const result = await service.get(ctxA, { clientId: CLIENT_A, year: 2026 });
    expect(result.category).toBeNull();
    expect(result.minimum).toBeNull();
    expect(result.options.map((option) => [option.category, option.label, option.minimum])).toEqual(
      [
        ["A", "A", "6210.00"],
        ["B", "B", "10028.00"],
        ["C", "C", "14674.00"],
        ["D", "D", "18998.00"],
        ["E", "E", "26910.00"],
        ["GRANDE", "Grande", "67298.00"],
      ],
    );
  });

  it("guarda la categoría del año y la lee con su mínimo", async () => {
    const saved = await service.set(ctxA, { clientId: CLIENT_A, year: 2026, category: "B" });
    expect(saved).toMatchObject({ year: 2026, category: "B", label: "B", minimum: "10028.00" });
    const read = await service.get(ctxA, { clientId: CLIENT_A, year: 2026 });
    expect(read).toMatchObject({ year: 2026, category: "B", minimum: "10028.00" });
  });

  it("cambiar la categoría del año actualiza la misma fila", async () => {
    await service.set(ctxA, { clientId: CLIENT_A, year: 2026, category: "B" });
    const changed = await service.set(ctxA, { clientId: CLIENT_A, year: 2026, category: "D" });
    expect(changed).toMatchObject({ category: "D", minimum: "18998.00" });
    expect(
      await prisma.clientTemCategory.count({ where: { clientId: CLIENT_A, year: 2026 } }),
    ).toBe(1);
  });

  it("una categoría fuera del catálogo se rechaza señalando el campo", async () => {
    const error = await service
      .set(ctxA, { clientId: CLIENT_A, year: 2026, category: "Z" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemCategoryError);
    expect(error).toMatchObject({
      code: "TEM_CATEGORY_UNKNOWN",
      path: ["category"],
      message: expect.stringContaining("Elegí una de A, B, C, D, E o Grande"),
    });
  });

  it("un año sin mínimos cargados se informa y no se guarda", async () => {
    await expect(
      service.set(ctxA, { clientId: CLIENT_A, year: 2019, category: "A" }),
    ).rejects.toMatchObject({ code: "TEM_CATEGORY_YEAR_WITHOUT_MINIMUMS", path: ["year"] });
    const read = await service.get(ctxA, { clientId: CLIENT_A, year: 2019 });
    expect(read.options).toEqual([]);
    expect(read.category).toBeNull();
  });

  it("resuelve el mínimo del período: categoría, faltante o año sin catálogo", async () => {
    await service.set(ctxA, { clientId: CLIENT_A, year: 2026, category: "B" });
    await prisma.$executeRawUnsafe(`
      INSERT INTO tem_category_minimums ("id", "year", "category", "label", "sortOrder", "amount", "createdAt")
      VALUES (gen_random_uuid()::text, 2031, 'A', 'A', 1, 7000, now())
      ON CONFLICT ("year", "category") DO NOTHING
    `);
    await runAsRuntime(OWNER_A, FIRM_A, async (tx) => {
      const base = { firmId: FIRM_A, clientId: CLIENT_A };
      expect(await service.resolveMinimum(tx, { ...base, year: 2026 })).toMatchObject({
        kind: "CATEGORY",
        category: "B",
        label: "B",
      });
      // 2027 no tiene catálogo: se conserva el mínimo del paquete de reglas.
      expect(await service.resolveMinimum(tx, { ...base, year: 2027 })).toEqual({
        kind: "NO_CATALOG",
        year: 2027,
      });
      // 2031 tiene catálogo y el cliente no eligió: falta la categoría.
      expect(await service.resolveMinimum(tx, { ...base, year: 2031 })).toEqual({
        kind: "MISSING",
        year: 2031,
      });
    });
  });
});

describe("Categoría anual del TEM: qué regímenes la usan", () => {
  it("la fila del TEM se reconoce por familia o por motor del catálogo, no por el código que escribió el usuario", async () => {
    await cleanupRegimes();
    const family = await prisma.calcFamily.findUniqueOrThrow({ where: { key: "TEM" } });
    const jurisdiction = await prisma.jurisdiction.create({
      data: { code: "T1E_JUR", name: "Jurisdicción 1E", kind: "MUNICIPAL" },
    });
    const authority = await prisma.taxAuthority.create({
      data: { code: "T1E_AUTH", name: "Autoridad 1E", jurisdictionId: jurisdiction.id },
    });
    const taxType = await prisma.taxType.create({
      data: { code: "T1E_TYPE", name: "Impuesto 1E" },
    });
    const regime = (code: string, calcFamilyId?: string) =>
      prisma.taxRegime.create({
        data: {
          code,
          name: code,
          taxTypeId: taxType.id,
          jurisdictionId: jurisdiction.id,
          authorityId: authority.id,
          ...(calcFamilyId ? { calcFamilyId } : {}),
        },
      });
    const porFamilia = await regime("T1E_REG_FAMILIA", family.id);
    const porMotor = await regime("T1E_REG_MOTOR");
    const otro = await regime("T1E_REG_OTRO");
    // Un nombre «TEM» sin familia ni motor del TEM no cuenta: el comportamiento no se deduce del texto.
    const soloNombre = await regime("T1E_REG_TEM_NOMBRE");
    for (const [reg, engineVersion] of [
      [porMotor, "ar-tem-smt-v1.1.0"],
      [otro, "ar-iibb-tuc-local-v1.1.0"],
    ] as const) {
      const pack = await prisma.taxRulePack.create({
        data: { code: `T1E_PACK_${reg.code}`, name: reg.code, regimeId: reg.id },
      });
      await prisma.taxRuleVersion.create({
        data: {
          packId: pack.id,
          version: 1,
          status: "ACTIVE",
          validFrom: new Date("2026-01-01"),
          engineVersion,
          rulesHash: `sha256:t1e-${reg.code}`,
        },
      });
    }
    const profile = await prisma.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_A,
        clientId: CLIENT_A,
        version: 1,
        legalName: "Cliente 1E SRL",
        cuit: "30999999991",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    for (const reg of [porFamilia, porMotor, otro, soloNombre]) {
      await prisma.taxRegistration.create({
        data: {
          firmId: FIRM_A,
          clientId: CLIENT_A,
          profileVersionId: profile.id,
          regimeId: reg.id,
          validFrom: new Date("2026-01-01"),
          status: "ACTIVE",
        },
      });
    }
    const state = await service.get(ctxA, { clientId: CLIENT_A, year: 2026 });
    expect([...state.regimeIds].sort()).toEqual([porFamilia.id, porMotor.id].sort());
  });
});

describe("Categoría anual del TEM: aislamiento por estudio (RLS)", () => {
  it("otro estudio no ve ni escribe la categoría del cliente", async () => {
    await service.set(ctxA, { clientId: CLIENT_A, year: 2026, category: "C" });
    const seenByB = await runAsRuntime(OWNER_B, FIRM_B, (tx) =>
      tx.clientTemCategory.count({ where: { clientId: CLIENT_A } }),
    );
    expect(seenByB).toBe(0);
    const seenByA = await runAsRuntime(OWNER_A, FIRM_A, (tx) =>
      tx.clientTemCategory.count({ where: { clientId: CLIENT_A } }),
    );
    expect(seenByA).toBeGreaterThan(0);
    await expect(
      runAsRuntime(OWNER_B, FIRM_B, (tx) =>
        tx.clientTemCategory.create({
          data: { firmId: FIRM_A, clientId: CLIENT_A, year: 2026, category: "A" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("los miembros del estudio leen el catálogo y el runtime no lo modifica", async () => {
    const rows = await runAsRuntime(OWNER_B, FIRM_B, (tx) =>
      tx.temCategoryMinimum.findMany({ where: { year: 2026 } }),
    );
    expect(rows).toHaveLength(6);
    await expect(
      runAsRuntime(OWNER_B, FIRM_B, (tx) =>
        tx.temCategoryMinimum.updateMany({ where: { year: 2026 }, data: { amount: 1 } }),
      ),
    ).rejects.toThrow();
  });
});
