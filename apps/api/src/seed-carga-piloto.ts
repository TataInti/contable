/**
 * G6-06: carga sintética para prueba de rendimiento del piloto.
 *
 * Genera una cartera representativa de clientes con hechos fiscales para
 * medir la worklist, la apertura de liquidación y el cálculo (PLAN §13.8).
 *
 * Uso:
 *   npx tsx src/seed-carga-piloto.ts --clientes 300 --ventas 20 --compras 10
 *
 * Crea (por cliente):
 *   - perfil fiscal ACTIVE (RI), período mensual, obligación;
 *   - N ventas y M compras aprobadas dentro del período;
 *   - una liquidación CALCULATED (para medir apertura sin finalizar).
 *
 * Es idempotente por cliente (reintentar no duplica).
 */
import { prisma } from "./lib/prisma.js";
import { IngestionService } from "./tax/ingestion-service.js";
import { SettlementService } from "./tax/settlement-service.js";

const FIRM_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddd001";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function parseArgs(argv: string[]) {
  const get = (name: string, def: number) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
  };
  return {
    clientes: get("clientes", 300),
    ventas: get("ventas", 20),
    compras: get("compras", 10),
  };
}

async function main() {
  const { clientes, ventas, compras } = parseArgs(process.argv.slice(2));
  console.log(`Carga sintética: ${clientes} clientes, ${ventas} ventas, ${compras} compras c/u`);

  const ingestion = new IngestionService();
  const settlements = new SettlementService();
  const ctx = { userId: OWNER_ID, firmId: FIRM_ID, actorKind: "USER" as const };

  // Maestros del demo (deben existir: seed-maestros-fiscales.ts).
  const iva = await prisma.taxType.findUnique({ where: { code: "IVA" } });
  const ri = await prisma.taxRegime.findUnique({ where: { code: "RI" } });
  const ar = await prisma.jurisdiction.findUnique({ where: { code: "AR" } });
  if (!iva || !ri || !ar) {
    throw new Error("Faltan maestros fiscales. Corré primero: npx tsx src/seed-maestros-fiscales.ts");
  }

  const start = Date.now();
  let created = 0;

  for (let i = 1; i <= clientes; i++) {
    const cuit = `20${String(20000000000 + i).slice(0, 10)}`;
    const clientId = `carga-${String(i).padStart(4, "0")}`;

    // Cliente (idempotente).
    await prisma.client.upsert({
      where: { id: clientId },
      update: {},
      create: {
        id: clientId,
        firmId: FIRM_ID,
        legalName: `Cliente Carga ${i}`,
        cuit,
      },
    });

    // Perfil ACTIVE.
    const profile = await prisma.taxpayerProfileVersion.upsert({
      where: { clientId_version: { clientId, version: 1 } },
      update: {},
      create: {
        firmId: FIRM_ID,
        clientId,
        version: 1,
        legalName: `Cliente Carga ${i}`,
        cuit,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_ID,
      },
    });

    // Período mensual.
    const period = await prisma.taxPeriod.upsert({
      where: { id: `carga-period-${i}` },
      update: {},
      create: {
        id: `carga-period-${i}`,
        firmId: FIRM_ID,
        clientId,
        taxTypeId: iva.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });

    // Obligación.
    await prisma.taxObligation.upsert({
      where: { id: `carga-oblig-${i}` },
      update: {},
      create: {
        id: `carga-oblig-${i}`,
        firmId: FIRM_ID,
        clientId,
        profileVersionId: profile.id,
        regimeId: ri.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_ID,
      },
    });

    // Hechos aprobados (ventas + compras).
    const vouchers: { id: string }[] = [];
    for (let v = 1; v <= ventas; v++) {
      const voucher = await ingestion.createVoucher(ctx, {
        clientId,
        direction: "SALE",
        type: "A",
        letter: "A",
        pointOfSale: 1,
        number: v,
        issuerCuit: cuit,
        receiverCuit: "20111111111",
        issuedOn: `2026-01-${String((v % 28) + 1).padStart(2, "0")}`,
        total: "121000.00",
        components: [
          { concept: "NETO", base: "100000.00", amount: "100000.00" },
          { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
        ],
      });
      vouchers.push(voucher);
    }
    for (let c = 1; c <= compras; c++) {
      const voucher = await ingestion.createVoucher(ctx, {
        clientId,
        direction: "PURCHASE",
        type: "A",
        letter: "A",
        pointOfSale: 1,
        number: c,
        issuerCuit: "20111111111",
        receiverCuit: cuit,
        issuedOn: `2026-01-${String((c % 28) + 1).padStart(2, "0")}`,
        total: "48400.00",
        components: [
          { concept: "NETO", base: "40000.00", amount: "40000.00" },
          { concept: "IVA_21", base: "40000.00", rate: "0.21", amount: "8400.00" },
        ],
      });
      vouchers.push(voucher);
    }
    for (const v of vouchers) {
      await ingestion.reviewVoucher(ctx, v.id, true);
    }

    // Liquidación CALCULATED (para medir apertura sin finalizar).
    try {
      await settlements.calculate(ctx, {
        clientId,
        taxTypeId: iva.id,
        regimeId: ri.id,
        jurisdictionId: ar.id,
        periodId: period.id,
        cutoff: "2026-01-31",
      });
    } catch {
      // Si ya existe una finalizada o en curso, se ignora (idempotente).
    }

    created++;
    if (i % 50 === 0) console.log(`  ${i}/${clientes} clientes…`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Carga completa: ${created} clientes en ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
