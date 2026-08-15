/**
 * Seed de maestros fiscales (Puerta 1).
 * Crea catálogos base para el piloto Tucumán:
 * - Nación (AR), Tucumán (AR-T), San Miguel de Tucumán (AR-T-SMT);
 * - autoridades ARCA, DGR Tucumán, SMT;
 * - impuestos IVA, IIBB, TEM, Monotributo;
 * - regímenes RI, IIBB local, CM art.2, TEM, Monotributo;
 * - feriados nacionales 2026.
 *
 * Los maestros son catálogos de firma (RLS firm_scope), visibles a todo
 * miembro del estudio. Uso: npx tsx src/seed-maestros-fiscales.ts
 */
import { prisma } from "./lib/prisma.js";

async function main() {
  console.log("Seed de maestros fiscales…");

  // Jurisdicciones
  const ar = await prisma.jurisdiction.upsert({
    where: { code: "AR" },
    update: {},
    create: { code: "AR", name: "Argentina (Nación)", kind: "NATIONAL" },
  });
  const tucuman = await prisma.jurisdiction.upsert({
    where: { code: "AR-T" },
    update: {},
    create: { code: "AR-T", name: "Provincia de Tucumán", kind: "PROVINCIAL", parentId: ar.id },
  });
  await prisma.jurisdiction.upsert({
    where: { code: "AR-SMT" },
    update: {},
    create: { code: "AR-SMT", name: "San Miguel de Tucumán", kind: "MUNICIPAL", parentId: tucuman.id },
  });

  // Autoridades
  const arca = await prisma.taxAuthority.upsert({
    where: { code: "ARCA" },
    update: {},
    create: { code: "ARCA", name: "ARCA — Agencia de Recaudación y Control Aduanero", jurisdictionId: ar.id },
  });
  await prisma.taxAuthority.upsert({
    where: { code: "DGR-TUC" },
    update: {},
    create: { code: "DGR-TUC", name: "DGR Tucumán", jurisdictionId: tucuman.id },
  });

  // Impuestos
  const iva = await prisma.taxType.upsert({
    where: { code: "IVA" },
    update: {},
    create: { code: "IVA", name: "IVA — Impuesto al Valor Agregado" },
  });
  const iibb = await prisma.taxType.upsert({
    where: { code: "IIBB" },
    update: {},
    create: { code: "IIBB", name: "Ingresos Brutos" },
  });
  const tem = await prisma.taxType.upsert({
    where: { code: "TEM" },
    update: {},
    create: { code: "TEM", name: "Tasa de Actividades Económicas (TEM)" },
  });
  await prisma.taxType.upsert({
    where: { code: "MONOTRIBUTO" },
    update: {},
    create: { code: "MONOTRIBUTO", name: "Monotributo" },
  });

  // Regímenes
  await prisma.taxRegime.upsert({
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
  await prisma.taxRegime.upsert({
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
  await prisma.taxRegime.upsert({
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
  await prisma.taxRegime.upsert({
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
  await prisma.taxRegime.upsert({
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
    await prisma.holiday.upsert({
      where: { jurisdictionId_date: { jurisdictionId: ar.id, date: new Date(date) } },
      update: {},
      create: { jurisdictionId: ar.id, date: new Date(date), name: "Feriado nacional" },
    });
  }

  console.log("Maestros fiscales listos.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());