/**
 * Seed de maestros fiscales (Puerta 1 + G3-01).
 * Crea catálogos base para el piloto Tucumán:
 * - Nación (AR), Tucumán (AR-T), San Miguel de Tucumán (AR-T-SMT);
 * - autoridades ARCA, DGR Tucumán, SMT;
 * - impuestos IVA, IIBB, TEM, Monotributo;
 * - regímenes RI, IIBB local, CM art.2, TEM, Monotributo;
 * - feriados nacionales 2026;
 * - rule pack IVA RI detallado por alícuota + Dto. 814 aprobado y activo.
 *
 * Los maestros son catálogos de firma (RLS firm_scope), visibles a todo
 * miembro del estudio. Se crean dentro de una transacción con contexto de
 * firma para que el rol runtime (sin BYPASSRLS) pueda insertarlos.
 * Uso: npx tsx src/seed-maestros-fiscales.ts
 */
import { Prisma } from "@prisma/client";
import {
  CM03_ENGINE_VERSION,
  IIBB_TUC_ENGINE_VERSION,
  TEM_SMT_ENGINE_VERSION,
} from "@contable/tax-engine";
import { prisma } from "./lib/prisma.js";

/** Firma demo del seed-demo (contexto RLS para catálogos de firma). */
const DEMO_FIRM_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddd001";
const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";

async function main() {
  console.log("Seed de maestros fiscales…");

  await prisma.$transaction(async (tx) => {
    // Asegura usuario + membresía OWNER en la firma demo para que el contexto
    // RLS (app_is_firm_member) permita insertar catálogos de firma.
    await tx.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${DEMO_USER_ID}', 'fiscal.seed@contable.local', 'Seed Fiscal', 'x', now())
      ON CONFLICT ("id") DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
      VALUES ('${DEMO_FIRM_ID}', 'Estudio Demo S.A.', 'Demo', now())
      ON CONFLICT ("id") DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${DEMO_FIRM_ID}', '${DEMO_USER_ID}', 'OWNER', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);

    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${DEMO_USER_ID}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${DEMO_FIRM_ID}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);

    // Jurisdicciones
    const ar = await tx.jurisdiction.upsert({
      where: { code: "AR" },
      update: {},
      create: { code: "AR", name: "Argentina (Nación)", kind: "NATIONAL" },
    });
    const tucuman = await tx.jurisdiction.upsert({
      where: { code: "AR-T" },
      update: {},
      create: { code: "AR-T", name: "Provincia de Tucumán", kind: "PROVINCIAL", parentId: ar.id },
    });
    await tx.jurisdiction.upsert({
      where: { code: "AR-SMT" },
      update: {},
      create: { code: "AR-SMT", name: "San Miguel de Tucumán", kind: "MUNICIPAL", parentId: tucuman.id },
    });
    await tx.jurisdiction.upsert({
      where: { code: "TUC" },
      update: {},
      create: { code: "TUC", name: "Tucumán — Convenio Multilateral", kind: "PROVINCIAL", parentId: ar.id },
    });
    await tx.jurisdiction.upsert({
      where: { code: "CBA" },
      update: {},
      create: { code: "CBA", name: "Córdoba — Convenio Multilateral", kind: "PROVINCIAL", parentId: ar.id },
    });

    // Actividades base utilizadas por los rule packs de IIBB/TEM. Sin estos
    // catálogos el onboarding podía mostrar el paso, pero no ofrecía ninguna
    // opción para vincular al contribuyente.
    for (const activity of [
      { code: "COMERCIO", name: "Comercio", jurisdictionId: tucuman.id },
      { code: "SERVICIOS", name: "Servicios", jurisdictionId: tucuman.id },
    ]) {
      await tx.economicActivity.upsert({
        where: { code_jurisdictionId: { code: activity.code, jurisdictionId: activity.jurisdictionId } },
        update: { name: activity.name, source: "DGR Tucumán / SMT", validFrom: new Date("2026-01-01"), isActive: true },
        create: { ...activity, source: "DGR Tucumán / SMT", validFrom: new Date("2026-01-01") },
      });
    }

    // Autoridades
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA" },
      update: {},
      create: { code: "ARCA", name: "ARCA — Agencia de Recaudación y Control Aduanero", jurisdictionId: ar.id },
    });
    await tx.taxAuthority.upsert({
      where: { code: "DGR-TUC" },
      update: {},
      create: { code: "DGR-TUC", name: "DGR Tucumán", jurisdictionId: tucuman.id },
    });

    // Impuestos
    const iva = await tx.taxType.upsert({
      where: { code: "IVA" },
      update: {},
      create: { code: "IVA", name: "IVA — Impuesto al Valor Agregado" },
    });
    const iibb = await tx.taxType.upsert({
      where: { code: "IIBB" },
      update: {},
      create: { code: "IIBB", name: "Ingresos Brutos" },
    });
    const tem = await tx.taxType.upsert({
      where: { code: "TEM" },
      update: {},
      create: { code: "TEM", name: "Tasa de Actividades Económicas (TEM)" },
    });
    const monotributo = await tx.taxType.upsert({
      where: { code: "MONOTRIBUTO" },
      update: {},
      create: { code: "MONOTRIBUTO", name: "Monotributo" },
    });

    // Regímenes
    const ri = await tx.taxRegime.upsert({
      where: { code: "RI" },
      update: {},
      create: {
        code: "RI",
        name: "Responsable Inscripto",
        taxTypeId: iva.id,
        jurisdictionId: ar.id,
        authorityId: arca.id,
      },
    });
    await tx.taxRegime.upsert({
      where: { code: "MONOTRIBUTO" },
      update: { taxTypeId: monotributo.id },
      create: {
        code: "MONOTRIBUTO",
        name: "Monotributo",
        taxTypeId: monotributo.id,
        jurisdictionId: ar.id,
        authorityId: arca.id,
      },
    });
    await tx.taxRegime.upsert({
      where: { code: "IIBB_LOCAL_TUC" },
      update: {},
      create: {
        code: "IIBB_LOCAL_TUC",
        name: "IIBB Contribuyente Local Tucumán",
        taxTypeId: iibb.id,
        jurisdictionId: tucuman.id,
        authorityId: arca.id,
      },
    });
    await tx.taxRegime.upsert({
      where: { code: "CM_ART2" },
      update: {},
      create: {
        code: "CM_ART2",
        name: "Convenio Multilateral CM03 artículo 2",
        taxTypeId: iibb.id,
        jurisdictionId: ar.id,
        authorityId: arca.id,
      },
    });
    await tx.taxRegime.upsert({
      where: { code: "TEM_SMT" },
      update: {},
      create: {
        code: "TEM_SMT",
        name: "TEM San Miguel de Tucumán",
        taxTypeId: tem.id,
        jurisdictionId: tucuman.id,
        authorityId: arca.id,
      },
    });

    // Feriados nacionales 2025-2026 (inamovibles + puente comunes, muestra).
    const feriadosNacionales = [
      "2025-01-01", "2025-03-03", "2025-03-04", "2025-04-18", "2025-05-01", "2025-05-25",
      "2025-07-09", "2025-08-18", "2025-10-13", "2025-12-08", "2025-12-25",
      "2026-01-01", "2026-02-16", "2026-03-24", "2026-04-02", "2026-04-03",
      "2026-05-01", "2026-05-25", "2026-07-09", "2026-08-17", "2026-11-23",
      "2026-12-08", "2026-12-25",
    ];
    for (const date of feriadosNacionales) {
      await tx.holiday.upsert({
        where: { jurisdictionId_date: { jurisdictionId: ar.id, date: new Date(date) } },
        update: {},
        create: { jurisdictionId: ar.id, date: new Date(date), name: "Feriado nacional" },
      });
    }

    // P3–P4: rule pack IVA RI detallado. Las instalaciones existentes no se
    // migran silenciosamente: una versión ya ACTIVE conserva su motor y debe
    // pasar por aprobación profesional antes de activar v2.1.
    const vatPack = await tx.taxRulePack.upsert({
      where: { code: "AR_VAT_RI_V1" },
      update: {},
      create: {
        code: "AR_VAT_RI_V1",
        name: "IVA Responsable Inscripto por alícuota",
        regimeId: ri.id,
        status: "ACTIVE",
      },
    });
    const existingVatVersion = await tx.taxRuleVersion.findFirst({
      where: { packId: vatPack.id, status: "ACTIVE" },
    });
    if (!existingVatVersion) {
      const vatVersion = await tx.taxRuleVersion.create({
        data: {
          packId: vatPack.id,
          version: 1,
          status: "ACTIVE",
          validFrom: new Date("2026-01-01"),
          engineVersion: "ar-vat-ri-v2.1.0",
          rulesHash: "sha256:ar-vat-ri-v2.1",
          activatedAt: new Date(),
        },
      });
      await tx.taxRateRule.createMany({
        data: [
          { ruleVersionId: vatVersion.id, concept: "IVA_21", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "IVA_105", rate: new Prisma.Decimal("10.5"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "IVA_27", rate: new Prisma.Decimal("27"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "DTO_814", rate: new Prisma.Decimal("6.5"), validFrom: new Date("2026-01-01") },
        ],
      });
      await tx.dueDateRule.create({
        data: {
          ruleVersionId: vatVersion.id,
          jurisdictionId: ar.id,
          frequency: "MONTHLY",
          dueDay: 20,
          monthOffset: 1,
          validFrom: new Date("2026-01-01"),
        },
      });
    }

    // G4: rule packs IIBB local, TEM, CM03 y Monotributo (aprobados y activos).
    const iibbLocalRegime = await tx.taxRegime.findUnique({ where: { code: "IIBB_LOCAL_TUC" } });
    const temRegime = await tx.taxRegime.findUnique({ where: { code: "TEM_SMT" } });
    const cmRegime = await tx.taxRegime.findUnique({ where: { code: "CM_ART2" } });
    const monoRegime = await tx.taxRegime.findUnique({ where: { code: "MONOTRIBUTO" } });

    const iibbPack = await tx.taxRulePack.upsert({
      where: { code: "AR_IIBB_TUC_LOCAL_V1" },
      update: {},
      create: { code: "AR_IIBB_TUC_LOCAL_V1", name: "IIBB Contribuyente Local Tucumán V1", regimeId: iibbLocalRegime!.id },
    });
    const temPack = await tx.taxRulePack.upsert({
      where: { code: "AR_TEM_SMT_V1" },
      update: {},
      create: { code: "AR_TEM_SMT_V1", name: "TEM San Miguel de Tucumán V1", regimeId: temRegime!.id },
    });
    const cmPack = await tx.taxRulePack.upsert({
      where: { code: "AR_IIBB_CM_ART2_V1" },
      update: {},
      create: { code: "AR_IIBB_CM_ART2_V1", name: "CM03 Artículo 2 V1", regimeId: cmRegime!.id },
    });
    const monoPack = await tx.taxRulePack.upsert({
      where: { code: "AR_MONOTRIBUTO_V1" },
      update: {},
      create: { code: "AR_MONOTRIBUTO_V1", name: "Monotributo V1", regimeId: monoRegime!.id },
    });

    async function ensureActivePack(packId: string, engineVersion: string, rulesHash: string) {
      const existing = await tx.taxRuleVersion.findFirst({
        where: { packId, status: "ACTIVE" },
      });
      if (existing) return existing;
      return tx.taxRuleVersion.create({
        data: {
          packId,
          version: 1,
          status: "ACTIVE",
          validFrom: new Date("2026-01-01"),
          engineVersion,
          rulesHash,
        },
      });
    }

    // IIBB local: alícuota por actividad (nomenclador DGR Tucumán, muestra).
    const iibbVersion = await ensureActivePack(
      iibbPack.id,
      IIBB_TUC_ENGINE_VERSION,
      "sha256:ar-iibb-tuc-local-v1.1",
    );
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: iibbVersion.id, concept: "COMERCIO", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: iibbVersion.id, concept: "SERVICIOS", rate: new Prisma.Decimal("4.5"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: iibbVersion.id, concept: "DEFAULT", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });
    await tx.taxMinimumRule.createMany({
      data: [
        { ruleVersionId: iibbVersion.id, concept: "MINIMO", amount: new Prisma.Decimal("5000"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });

    // TEM SMT: alícuota por actividad (nomenclador municipal, muestra).
    const temVersion = await ensureActivePack(
      temPack.id,
      TEM_SMT_ENGINE_VERSION,
      "sha256:ar-tem-smt-v1.1",
    );
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: temVersion.id, concept: "COMERCIO", rate: new Prisma.Decimal("2"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: temVersion.id, concept: "SERVICIOS", rate: new Prisma.Decimal("3"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: temVersion.id, concept: "DEFAULT", rate: new Prisma.Decimal("2"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });
    await tx.taxMinimumRule.createMany({
      data: [
        { ruleVersionId: temVersion.id, concept: "MINIMO", amount: new Prisma.Decimal("3000"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });

    // CM03 art.2: alícuota por jurisdicción + coeficientes (concept COEF_<jur>).
    const cmVersion = await ensureActivePack(
      cmPack.id,
      CM03_ENGINE_VERSION,
      "sha256:ar-iibb-cm-art2-v1.1",
    );
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: cmVersion.id, concept: "TUC", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: cmVersion.id, concept: "CBA", rate: new Prisma.Decimal("3.5"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: cmVersion.id, concept: "COEF_TUC", rate: new Prisma.Decimal("0.6"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: cmVersion.id, concept: "COEF_CBA", rate: new Prisma.Decimal("0.4"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });

    // Monotributo: cuota por categoría (concept CUOTA_<cat>). Las cuotas son
    // importes (no tasas), por eso van en minAmount (Decimal(20,4)), no en rate
    // (Decimal(10,6) que no admite > 9999).
    const monoVersion = await ensureActivePack(monoPack.id, "ar-monotributo-v1.0.0", "sha256:ar-monotributo-v1");
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: monoVersion.id, concept: "CUOTA_A", minAmount: new Prisma.Decimal("25000"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: monoVersion.id, concept: "CUOTA_B", minAmount: new Prisma.Decimal("30000"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: monoVersion.id, concept: "CUOTA_C", minAmount: new Prisma.Decimal("35000"), validFrom: new Date("2026-01-01") },
      ],
      skipDuplicates: true,
    });

    // Calendarios operativos de muestra. El desplazamiento es explícito:
    // declaraciones mensuales vencen el mes siguiente; Monotributo conserva
    // vencimiento en el mismo mes. Las instalaciones productivas versionan
    // estos días/terminaciones con la normativa de cada autoridad.
    async function ensureDueDate(
      ruleVersionId: string,
      jurisdictionId: string,
      dueDay: number,
      monthOffset: number,
    ) {
      const existing = await tx.dueDateRule.findFirst({
        where: { ruleVersionId, jurisdictionId, dueDay, monthOffset, cuitEnding: null },
      });
      if (!existing) {
        await tx.dueDateRule.create({
          data: {
            ruleVersionId,
            jurisdictionId,
            frequency: "MONTHLY",
            dueDay,
            monthOffset,
            validFrom: new Date("2026-01-01"),
          },
        });
      }
    }
    const currentVatVersion =
      existingVatVersion ??
      (await tx.taxRuleVersion.findFirstOrThrow({
        where: { packId: vatPack.id, status: "ACTIVE" },
        orderBy: { version: "desc" },
      }));
    await ensureDueDate(currentVatVersion.id, ar.id, 20, 1);
    await ensureDueDate(iibbVersion.id, tucuman.id, 20, 1);
    await ensureDueDate(temVersion.id, tucuman.id, 20, 1);
    await ensureDueDate(cmVersion.id, ar.id, 20, 1);
    await ensureDueDate(monoVersion.id, ar.id, 20, 0);

    console.log("Maestros fiscales listos.");
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
