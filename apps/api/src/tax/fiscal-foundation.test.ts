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
      data: { code: "AR", name: "Nación", kind: "NATIONAL" },
    });
    const tucuman = await tx.jurisdiction.create({
      data: { code: "AR-T", name: "Tucumán", kind: "PROVINCIAL", parentId: nacion.id },
    });
    const arca = await tx.taxAuthority.create({
      data: { code: "ARCA", name: "ARCA", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.create({ data: { code: "IVA", name: "IVA" } });
    const ri = await tx.taxRegime.create({
      data: {
        code: "RI",
        name: "Responsable Inscripto",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    const actividad = await tx.economicActivity.create({
      data: {
        code: "620100",
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
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`DELETE FROM rule_approvals`);
    await tx.$executeRawUnsafe(`DELETE FROM normative_sources`);
    await tx.$executeRawUnsafe(`DELETE FROM rounding_rules`);
    await tx.$executeRawUnsafe(`DELETE FROM due_date_rules`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_bracket_rules`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_minimum_rules`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rate_rules`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_versions`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_ALFA}'`);
    await tx.$executeRawUnsafe(`DELETE FROM professional_credentials`);
    await tx.$executeRawUnsafe(`DELETE FROM holidays`);
    await tx.$executeRawUnsafe(`DELETE FROM economic_activities`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions`);
  });
}

describe("G1-02 maestros (integración DB)", () => {
  beforeEach(async () => {
    await setupMembership();
    await cleanupFiscal();
  });

  it("crea y lista jurisdicciones con jerarquía", async () => {
    const nacion = await masters.createJurisdiction(ctxOwner, { code: "AR", name: "Nación", kind: "NATIONAL" });
    await masters.createJurisdiction(ctxOwner, { code: "AR-T", name: "Tucumán", kind: "PROVINCIAL", parentId: nacion.id });

    const list = await masters.listJurisdictions(ctxOwner);
    expect(list.length).toBe(2);
    const tucuman = list.find((j) => j.code === "AR-T");
    expect(tucuman?.parentId).toBe(nacion.id);
  });

  it("crea impuesto, régimen y actividad", async () => {
    const fx = await setupMasters();
    expect(fx.ri.code).toBe("RI");
    expect(fx.ri.taxTypeId).toBe(fx.iva.id);
    expect(fx.actividad.code).toBe("620100");
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

  it("no permite dos perfiles activos", async () => {
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

    await expect(
      profiles.createProfile(ctxOwner, {
        clientId: CLIENT_ALFA,
        legalName: "Cliente Alfa SA",
        cuit: "20111111111",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: "2026-02-01",
      }),
    ).rejects.toThrow(FiscalError);
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

  it("rule pack: DRAFT → IN_REVIEW → APPROVED → ACTIVE con matrícula", async () => {
    const fx = await setupMasters();
    const pack = await rules.createPack(ctxOwner, {
      code: "AR_VAT_RI_V1",
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
      code: "AR_VAT_RI_V1",
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
});