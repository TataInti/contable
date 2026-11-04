import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import {
  FiscalError,
  FiscalMasterService,
  TaxpayerProfileService,
  TaxPeriodService,
  TaxRuleService,
} from "./fiscal-foundation-service.js";

/**
 * Tests de integración de la fundación fiscal (Puerta 1).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 *
 * G1-02: maestros (jurisdicción, autoridad, impuesto, régimen).
 * G1-03: perfil fiscal, inscripciones, actividades y matrícula.
 * G1-04: períodos y obligaciones.
 * G1-05: rule packs, versiones, fuentes y aprobaciones.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PROFESSIONAL_A = "22222222-2222-4222-8222-222222222222";
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

const masters = new FiscalMasterService();
const profiles = new TaxpayerProfileService();
const periods = new TaxPeriodService();
const rules = new TaxRuleService();

const ctxOwner = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };
const ctxProfessional = { userId: PROFESSIONAL_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

/** Crea firma, usuarios y membresías (requeridos por RLS y FK). */
async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_A}', 'owner.a@test.local', 'Owner A', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${PROFESSIONAL_A}', 'prof.a@test.local', 'Profesional A', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_ALFA}', 'Estudio Alfa', 'Estudio Alfa', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_ALFA}', '${FIRM_ALFA}', 'Cliente Alfa', '20999999999', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${OWNER_A}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${PROFESSIONAL_A}', 'REVIEWER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

/** Crea maestros base: nación, ARCA, IVA, RI. */
async function setupMasters() {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const nacion = await tx.jurisdiction.create({
      data: { code: "AR-F", name: "Nación", kind: "NATIONAL" },
    });
    const tucuman = await tx.jurisdiction.create({
      data: { code: "AR-T-F", name: "Tucumán", kind: "PROVINCIAL", parentId: nacion.id },
    });
    const arca = await tx.taxAuthority.create({
      data: { code: "ARCA-F", name: "ARCA", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.create({ data: { code: "IVA-F", name: "IVA" } });
    const ri = await tx.taxRegime.create({
      data: {
        code: "RI-F",
        name: "Responsable Inscripto",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    const actividad = await tx.economicActivity.create({
      data: {
        code: "620100-F",
        name: "Servicios de informática",
        jurisdictionId: nacion.id,
        source: "CLAE",
        validFrom: new Date("2026-01-01"),
      },
    });
    return { nacion, tucuman, arca, iva, ri, actividad };
  });
}

/** Limpia tablas fiscales con contexto de firma (RLS FORCE exige contexto). */
async function cleanupFiscal() {
  // Usa el cliente prisma (owner) con contexto RLS para eludir la restricción
  // append-only de rule_approvals y forzar limpieza.
  // IMPORTANTE: borra SÓLO los packs propios (sufijo -F) para no romper las
  // suites que corren en paralelo (ingestión -ING, settlements -SET).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    // rule_approvals: se borran SIN filtro (sólo esta suite las crea; es
    // append-only y no interfiere con ingestion/settlement).
    await tx.$executeRawUnsafe(`DELETE FROM rule_approvals`);
    await tx.$executeRawUnsafe(`
      DELETE FROM normative_sources
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM rounding_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM due_date_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_bracket_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_minimum_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F'))
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code LIKE '%-F')`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM professional_credentials`);
    await tx.$executeRawUnsafe(`DELETE FROM holidays`);
    await tx.$executeRawUnsafe(`DELETE FROM economic_activities WHERE code LIKE '%-F'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-F'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-F'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-F'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-F'`);
  });
}

describe("G1-02 maestros (integración DB)", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanupFiscal();
  });

  it("crea y lista jurisdicciones con jerarquía", async () => {
    const nacion = await masters.createJurisdiction(ctxOwner, { code: "AR-F", name: "Nación", kind: "NATIONAL" });
    await masters.createJurisdiction(ctxOwner, { code: "AR-T-F", name: "Tucumán", kind: "PROVINCIAL", parentId: nacion.id });

    const list = await masters.listJurisdictions(ctxOwner);
    const mine = list.filter((j) => j.code.endsWith("-F"));
    expect(mine.length).toBe(2);
    const tucuman = mine.find((j) => j.code === "AR-T-F");
    expect(tucuman?.parentId).toBe(nacion.id);
  });

  it("crea impuesto, régimen y actividad", async () => {
    const fx = await setupMasters();
    expect(fx.ri.code).toBe("RI-F");
    expect(fx.ri.taxTypeId).toBe(fx.iva.id);
    expect(fx.actividad.code).toBe("620100-F");
  });

  it("los maestros son catálogos compartidos: un no-miembro no los ve (RLS runtime)", async () => {
    await setupMasters();
    // Usuario sin membresía en la firma Alfa, con contexto de otra firma.
    // Se prueba con contable_runtime (el rol real de la API), no con el owner.
    const noMemberCtx = { userId: "99999999-9999-4999-8999-999999999999", firmId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", actorKind: "USER" as const };
    const rows = await runtimePrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${noMemberCtx.userId}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${noMemberCtx.firmId}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
      return tx.jurisdiction.findMany();
    });
    expect(rows.length).toBe(0);
  });
});

describe("G1-03 perfil fiscal (integración DB)", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanupFiscal();
  });

  it("crea perfil DRAFT y lo activa tras revisión", async () => {
    const profile = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    });
    expect(profile.status).toBe("DRAFT");
    expect(profile.version).toBe(1);

    // No se puede activar desde DRAFT
    await expect(profiles.activate(ctxOwner, profile.id)).rejects.toThrow(FiscalError);

    const inReview = await profiles.submitReview(ctxOwner, profile.id);
    expect(inReview.status).toBe("IN_REVIEW");

    const active = await profiles.activate(ctxOwner, profile.id);
    expect(active.status).toBe("ACTIVE");
    expect(active.activatedAt).not.toBeNull();
  });

  it("crea una sucesora sin reemplazar el perfil activo antes de su activación", async () => {
    const p1 = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    });
    await profiles.submitReview(ctxOwner, p1.id);
    await profiles.activate(ctxOwner, p1.id);

    const p2 = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa actualizado SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-02-01",
    });
    expect(p2).toMatchObject({ version: 2, status: "DRAFT", supersedesId: p1.id });
    expect((await prisma.taxpayerProfileVersion.findUnique({ where: { id: p1.id } }))?.status).toBe("ACTIVE");

    await profiles.submitReview(ctxOwner, p2.id);
    expect((await prisma.taxpayerProfileVersion.findUnique({ where: { id: p1.id } }))?.status).toBe("ACTIVE");
    await profiles.activate(ctxOwner, p2.id);

    expect((await prisma.taxpayerProfileVersion.findUnique({ where: { id: p1.id } }))?.status).toBe("SUPERSEDED");
    expect((await prisma.taxpayerProfileVersion.findUnique({ where: { id: p2.id } }))?.status).toBe("ACTIVE");
  });

  it("registra inscripción sin solapar vigencias", async () => {
    const fx = await setupMasters();
    const profile = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    });
    await profiles.addRegistration(ctxOwner, {
      clientId: CLIENT_ALFA,
      profileVersionId: profile.id,
      regimeId: fx.ri.id,
      validFrom: "2026-01-01",
    });
    // Solapamiento rechazado
    await expect(
      profiles.addRegistration(ctxOwner, {
        clientId: CLIENT_ALFA,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        validFrom: "2026-03-01",
      }),
    ).rejects.toThrow(FiscalError);
  });

  it("registra matrícula profesional", async () => {
    const fx = await setupMasters();
    const cred = await profiles.addCredential(ctxOwner, {
      userId: PROFESSIONAL_A,
      jurisdictionId: fx.nacion.id,
      authorityId: fx.arca.id,
      registrationNumber: "CPCE-T-12345",
      validFrom: "2026-01-01",
    });
    expect(cred.status).toBe("ACTIVE");
    expect(cred.registrationNumber).toBe("CPCE-T-12345");
  });
});

describe("G1-04 períodos y obligaciones (integración DB)", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanupFiscal();
  });

  it("crea autoridad, régimen y obligación sintéticos sin reglas ni alícuotas", async () => {
    const jurisdiction = await masters.createJurisdiction(ctxOwner, {
      code: "AR-E2E-SYN-F",
      name: "Jurisdicción sintética E2E — sin validez fiscal",
      kind: "NATIONAL",
    });
    const authority = await masters.createTaxAuthority(ctxOwner, {
      code: "E2E-SYN-AUTH-F",
      name: "Autoridad sintética E2E — sin validez fiscal",
      jurisdictionId: jurisdiction.id,
    });
    const taxType = await masters.createTaxType(ctxOwner, {
      code: "E2E-SYN-TAX-F",
      name: "Impuesto sintético E2E — sin validez fiscal",
    });
    const regime = await masters.createRegime(ctxOwner, {
      code: "E2E-SYN-REGIME-F",
      name: "Régimen sintético E2E — sin reglas ni alícuotas",
      taxTypeId: taxType.id,
      jurisdictionId: jurisdiction.id,
      authorityId: authority.id,
    });
    const profile = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    });
    await profiles.submitReview(ctxOwner, profile.id);
    const activeProfile = await profiles.activate(ctxOwner, profile.id);
    const period = await periods.createPeriod(ctxOwner, {
      clientId: CLIENT_ALFA,
      taxTypeId: taxType.id,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      label: "PRUEBA E2E — noviembre sintético",
    });
    await profiles.addRegistration(ctxOwner, {
      clientId: CLIENT_ALFA,
      profileVersionId: activeProfile.id,
      regimeId: regime.id,
      validFrom: "2026-11-01",
    });
    const obligation = await periods.materializeObligation(ctxOwner, {
      clientId: CLIENT_ALFA,
      profileVersionId: activeProfile.id,
      regimeId: regime.id,
      periodId: period.id,
    });

    expect(await masters.listTaxAuthorities(ctxOwner, jurisdiction.id)).toMatchObject([
      { id: authority.id, code: "E2E-SYN-AUTH-F", jurisdictionId: jurisdiction.id },
    ]);
    expect(await masters.listRegimes(ctxOwner)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: regime.id,
          authorityId: authority.id,
          taxTypeId: taxType.id,
          jurisdictionId: jurisdiction.id,
        }),
      ]),
    );
    expect(obligation).toMatchObject({
      clientId: CLIENT_ALFA,
      profileVersionId: activeProfile.id,
      regimeId: regime.id,
      periodId: period.id,
      status: "PENDING",
      dueDate: null,
    });

    const rulePackCount = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxRulePack.count({ where: { regimeId: regime.id } }),
    );
    expect(rulePackCount).toBe(0);
  });

  it("crea período y materializa obligación sin duplicar", async () => {
    const fx = await setupMasters();
    const profile = await profiles.createProfile(ctxOwner, {
      clientId: CLIENT_ALFA,
      legalName: "Cliente Alfa SA",
      cuit: "20111111111",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: "2026-01-01",
    });
    const period = await periods.createPeriod(ctxOwner, {
      clientId: CLIENT_ALFA,
      taxTypeId: fx.iva.id,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      label: "Enero 2026",
    });
    const obligation = await periods.materializeObligation(ctxOwner, {
      clientId: CLIENT_ALFA,
      profileVersionId: profile.id,
      regimeId: fx.ri.id,
      periodId: period.id,
      dueDate: "2026-02-20",
    });
    expect(obligation.status).toBe("PENDING");
    expect(obligation.dueDate).toEqual(new Date("2026-02-20"));

    // Duplicado rechazado
    await expect(
      periods.materializeObligation(ctxOwner, {
        clientId: CLIENT_ALFA,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        periodId: period.id,
      }),
    ).rejects.toThrow(FiscalError);
  });

  it("rechaza períodos solapados", async () => {
    const fx = await setupMasters();
    await periods.createPeriod(ctxOwner, {
      clientId: CLIENT_ALFA,
      taxTypeId: fx.iva.id,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    await expect(
      periods.createPeriod(ctxOwner, {
        clientId: CLIENT_ALFA,
        taxTypeId: fx.iva.id,
        startDate: "2026-01-15",
        endDate: "2026-02-15",
      }),
    ).rejects.toThrow(FiscalError);
  });
});

describe("G1-05 reglas fiscales (integración DB)", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanupFiscal();
  });

  it("el rol runtime puede reemplazar una regla de alícuota en un borrador", async () => {
    const fx = await setupMasters();
    const pack = await rules.createPack(ctxOwner, {
      code: "AR_RATE_RULE_REPLACE-F",
      name: "Prueba de reemplazo de alícuotas",
      regimeId: fx.ri.id,
    });
    const version = await rules.createVersion(ctxOwner, {
      packId: pack.id,
      validFrom: "2026-01-01",
      engineVersion: "tax-engine-v1",
      rulesHash: "pending",
    });
    await rules.addRateRule(ctxOwner, {
      ruleVersionId: version.id,
      concept: "SINTETICO",
      activityCode: "General",
      rate: "21",
      minAmount: "0",
      validFrom: "2026-01-01",
    });

    // El cliente de fixtures usa la conexión propietaria; replicamos los pasos
    // de reemplazo bajo el rol runtime de producción para verificar permisos.
    const runtimeRules = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      await tx.taxRateRule.deleteMany({ where: { ruleVersionId: version.id } });
      await tx.taxRateRule.createMany({
        data: [{
          ruleVersionId: version.id,
          concept: "SINTETICO",
          activityCode: "General",
          rate: new Prisma.Decimal("7.25"),
          minAmount: new Prisma.Decimal("0"),
          validFrom: new Date("2026-01-01"),
        }],
      });
      return tx.taxRateRule.findMany({ where: { ruleVersionId: version.id } });
    });
    expect(runtimeRules).toHaveLength(1);
    expect(runtimeRules[0]?.rate?.toString()).toBe("7.25");
    expect(runtimeRules[0]?.minAmount?.toString()).toBe("0");

    const replacement = await rules.replaceRateRules(ctxOwner, {
      ruleVersionId: version.id,
      rules: [{
        concept: "SINTETICO",
        activityCode: "General",
        rate: "3.17",
        minAmount: "0",
        validFrom: "2026-01-01",
      }],
    });
    expect(replacement).toHaveLength(1);
    expect(replacement[0]?.rate?.toString()).toBe("3.17");

    await expect(rules.replaceRateRules(ctxOwner, {
      ruleVersionId: version.id,
      rules: [],
    })).resolves.toEqual([]);
  });

  it("rule pack: DRAFT → IN_REVIEW → APPROVED → ACTIVE con matrícula", async () => {
    const fx = await setupMasters();
    const pack = await rules.createPack(ctxOwner, {
      code: "AR_VAT_RI_V1-F",
      name: "IVA Responsable Inscripto V1",
      regimeId: fx.ri.id,
    });
    const version = await rules.createVersion(ctxOwner, {
      packId: pack.id,
      validFrom: "2026-01-01",
      engineVersion: "1.0.0",
      rulesHash: "abc123",
    });
    expect(version.status).toBe("DRAFT");

    await rules.addRateRule(ctxOwner, {
      ruleVersionId: version.id,
      concept: "VENTAS",
      rate: "21.0000",
      validFrom: "2026-01-01",
    });
    await rules.addDueDateRule(ctxOwner, {
      ruleVersionId: version.id,
      jurisdictionId: fx.nacion.id,
      dueDay: 20,
      validFrom: "2026-01-01",
    });
    await rules.addSource(ctxOwner, {
      ruleVersionId: version.id,
      authorityId: fx.arca.id,
      title: "Ley de IVA",
      consultedAt: "2026-01-10",
    });

    // No se puede aprobar desde DRAFT
    await expect(rules.approve(ctxOwner, { ruleVersionId: version.id, credentialId: "x" })).rejects.toThrow(FiscalError);

    await rules.submitReview(ctxOwner, version.id);

    // Aprobación exige matrícula activa del mismo usuario
    await expect(
      rules.approve(ctxOwner, { ruleVersionId: version.id, credentialId: "no-existe" }),
    ).rejects.toThrow(FiscalError);

    const cred = await profiles.addCredential(ctxOwner, {
      userId: PROFESSIONAL_A,
      jurisdictionId: fx.nacion.id,
      authorityId: fx.arca.id,
      registrationNumber: "CPCE-T-12345",
      validFrom: "2026-01-01",
    });

    // El owner no puede aprobar con matrícula de otro usuario
    await expect(
      rules.approve(ctxOwner, { ruleVersionId: version.id, credentialId: cred.id }),
    ).rejects.toThrow(FiscalError);

    const approval = await rules.approve(ctxProfessional, {
      ruleVersionId: version.id,
      credentialId: cred.id,
      comment: "Golden tests OK",
      goldenResultsHash: "golden-1",
    });
    expect(approval.goldenResultsHash).toBe("golden-1");

    const approved = await prisma.taxRuleVersion.findUnique({ where: { id: version.id } });
    expect(approved?.status).toBe("APPROVED");

    // Versión aprobada es inmutable: no se pueden agregar reglas
    await expect(
      rules.addRateRule(ctxOwner, {
        ruleVersionId: version.id,
        concept: "COMPRAS",
        rate: "21.0000",
        validFrom: "2026-01-01",
      }),
    ).rejects.toThrow(FiscalError);

    const active = await rules.activate(ctxOwner, version.id);
    expect(active.status).toBe("ACTIVE");
  });

  it("activar una versión retira la anterior", async () => {
    const fx = await setupMasters();
    const pack = await rules.createPack(ctxOwner, {
      code: "AR_VAT_RI_V1-F",
      name: "IVA RI V1",
      regimeId: fx.ri.id,
    });
    const v1 = await rules.createVersion(ctxOwner, {
      packId: pack.id,
      validFrom: "2026-01-01",
      engineVersion: "1.0.0",
      rulesHash: "h1",
    });
    const cred = await profiles.addCredential(ctxOwner, {
      userId: PROFESSIONAL_A,
      jurisdictionId: fx.nacion.id,
      authorityId: fx.arca.id,
      registrationNumber: "CPCE-T-12345",
      validFrom: "2026-01-01",
    });
    await rules.submitReview(ctxOwner, v1.id);
    await rules.approve(ctxProfessional, { ruleVersionId: v1.id, credentialId: cred.id });
    await rules.activate(ctxOwner, v1.id);

    const v2 = await rules.createVersion(ctxOwner, {
      packId: pack.id,
      validFrom: "2026-07-01",
      engineVersion: "1.0.0",
      rulesHash: "h2",
    });
    await rules.submitReview(ctxOwner, v2.id);
    await rules.approve(ctxProfessional, { ruleVersionId: v2.id, credentialId: cred.id });
    await rules.activate(ctxOwner, v2.id);

    const retired = await prisma.taxRuleVersion.findUnique({ where: { id: v1.id } });
    expect(retired?.status).toBe("RETIRED");
    const active = await prisma.taxRuleVersion.findUnique({ where: { id: v2.id } });
    expect(active?.status).toBe("ACTIVE");
  });

  it("B-1 expone lecturas históricas: versiones, fuentes y golden results", async () => {
    const fx = await setupMasters();
    const pack = await rules.createPack(ctxOwner, {
      code: "AR_VAT_RI_V1-F2",
      name: "IVA RI B1",
      regimeId: fx.ri.id,
    });
    const version = await rules.createVersion(ctxOwner, {
      packId: pack.id,
      validFrom: "2026-01-01",
      engineVersion: "1.0.0",
      rulesHash: "h-b1",
    });
    await rules.addSource(ctxOwner, {
      ruleVersionId: version.id,
      authorityId: fx.arca.id,
      title: "Ley de IVA (B-1)",
      consultedAt: "2026-01-10",
    });

    // Fuentes de la versión.
    const sources = await rules.getRuleVersionSources(ctxOwner, version.id);
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0]?.title).toContain("Ley de IVA");

    // Golden results vacíos antes de aprobar.
    const approvals = await rules.getRuleVersionGoldenResults(ctxOwner, version.id);
    expect(approvals).toHaveLength(0);

    // Versiones del pack.
    const list = await rules.listRuleVersions(ctxOwner, pack.id);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.id).toBe(version.id);
  });
});