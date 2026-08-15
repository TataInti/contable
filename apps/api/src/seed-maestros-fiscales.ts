/**
 * Seed de maestros fiscales (Puerta 1 + G3-01).
 * Crea catálogos base para el piloto Tucumán:
 * - Nación (AR), Tucumán (AR-T), San Miguel de Tucumán (AR-T-SMT);
 * - autoridades ARCA, DGR Tucumán, SMT;
 * - impuestos IVA, IIBB, TEM, Monotributo;
 * - regímenes RI, IIBB local, CM art.2, TEM, Monotributo;
 * - feriados nacionales 2026;
 * - rule pack AR_VAT_RI_V1 aprobado y activo (G3-01).
 *
 * Los maestros son catálogos de firma (RLS firm_scope), visibles a todo
 * miembro del estudio. Se crean dentro de una transacción con contexto de
 * firma para que el rol runtime (sin BYPASSRLS) pueda insertarlos.
 * Uso: npx tsx src/seed-maestros-fiscales.ts
 */
import { Prisma } from "@prisma/client";
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
    await tx.taxType.upsert({
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
      update: {},
      create: {
        code: "MONOTRIBUTO",
        name: "Monotributo",
        taxTypeId: iibb.id,
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

    // G3-01: rule pack AR_VAT_RI_V1 aprobado y activo (tasas IVA 21/10.5/27).
    const vatPack = await tx.taxRulePack.upsert({
      where: { code: "AR_VAT_RI_V1" },
      update: {},
      create: { code: "AR_VAT_RI_V1", name: "IVA Responsable Inscripto V1", regimeId: ri.id },
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
          engineVersion: "ar-vat-ri-v1.0.0",
          rulesHash: "sha256:ar-vat-ri-v1",
        },
      });
      await tx.taxRateRule.createMany({
        data: [
          { ruleVersionId: vatVersion.id, concept: "VENTAS", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "COMPRAS", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "VENTAS_105", rate: new Prisma.Decimal("10.5"), validFrom: new Date("2026-01-01") },
          { ruleVersionId: vatVersion.id, concept: "VENTAS_27", rate: new Prisma.Decimal("27"), validFrom: new Date("2026-01-01") },
        ],
      });
      await tx.dueDateRule.create({
        data: {
          ruleVersionId: vatVersion.id,
          jurisdictionId: ar.id,
          frequency: "MONTHLY",
          dueDay: 20,
          validFrom: new Date("2026-01-01"),
        },
      });
    }

    console.log("Maestros fiscales listos.");
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());