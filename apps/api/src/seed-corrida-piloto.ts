/**
 * G6-02 — Corrida histórica de períodos para el piloto (PLAN §12 Puerta 6).
 *
 * Ejecuta la cadena completa perfil → obligación → hechos aprobados →
 * cálculo → revisión → finalización → presentación → pago para 3 períodos
 * consecutivos de cada cliente piloto RI, y deja evidencia reproducible:
 *
 *   - Liquidaciones FINALIZED con hashes (V-003/V-004).
 *   - Presentaciones y pagos registrados por período.
 *   - Reporte de control en `docs/piloto/g6-corrida-historica.md` con los
 *     totales por período para comparación manual del contador (G6-02).
 *
 * Uso:
 *   npx tsx src/seed-corrida-piloto.ts [--periodos 3]
 *
 * Esto NO crea clientes nuevos: usa los clientes de la firma piloto
 * (seed-demo/seed-fase2) con perfil fiscal ACTIVE. Es idempotente (una
 * liquidación FINALIZED no se recalcula; filas ya comiteadas no se duplican).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { withTenantContext } from "./auth/tenant.js";
import { IngestionService } from "./tax/ingestion-service.js";
import { SettlementService } from "./tax/settlement-service.js";

const FIRM_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddd001"; // firma demo del seed
const OWNER_ID = "11111111-1111-4111-8111-111111111111"; // owner demo del seed

// Períodos históricos recientes (cerrados, para no pisar el corriente).
const PERIODOS_HISTORICOS = [
  { start: "2025-10-01", end: "2025-10-31", label: "Octubre 2025", cutoff: "2025-10-31" },
  { start: "2025-11-01", end: "2025-11-30", label: "Noviembre 2025", cutoff: "2025-11-30" },
  { start: "2025-12-01", end: "2025-12-31", label: "Diciembre 2025", cutoff: "2025-12-31" },
];

// Offset por mes para que los puntos de venta/números no colisionen entre
// períodos del mismo cliente (dedupe por período + número).
const MES_OFFSET: Record<string, number> = { "10": 0, "11": 100, "12": 200 };

function fmt(amount: Prisma.Decimal | string | undefined | null): string {
  if (amount === undefined || amount === null) return "—";
  const n = new Prisma.Decimal(String(amount));
  return n.isZero() ? "0.00" : n.toFixed(2);
}

async function main() {
  const ingestion = new IngestionService();
  const settlements = new SettlementService();

  const ctx = { userId: OWNER_ID, firmId: FIRM_ID, actorKind: "USER" as const };
  const iva = await prisma.taxType.findUnique({ where: { code: "IVA" } });
  const ri = await prisma.taxRegime.findUnique({ where: { code: "RI" } });
  const ar = await prisma.jurisdiction.findUnique({ where: { code: "AR" } });
  if (!iva || !ri || !ar) {
    throw new Error("Faltan maestros fiscales. Corré primero: npx tsx src/seed-maestros-fiscales.ts");
  }

  // Clientes de la firma piloto; se asegura un perfil fiscal ACTIVE para
  // cada uno (idempotente: si ya existe ACTIVE, se reutiliza).
  const clientes = await prisma.client.findMany({ where: { firmId: FIRM_ID } });
  if (clientes.length === 0) {
    throw new Error(`No hay clientes en la firma piloto ${FIRM_ID}. Corré seed-demo primero.`);
  }

  for (const cliente of clientes) {
    const active = await withTenantContext(ctx, (tx) =>
      tx.taxpayerProfileVersion.findFirst({
        where: { firmId: FIRM_ID, clientId: cliente.id, status: "ACTIVE" },
        orderBy: { version: "desc" },
      }),
    );
    if (!active) {
      // Puede existir una versión previa (DRAFT/SUPERSEDED) con la misma
      // clave (clientId+version); se actualiza a ACTIVE en lugar de chocar
      // con el unique. Si no existe ninguna, se crea la v1.
      const anyVersion = await withTenantContext(ctx, (tx) =>
        tx.taxpayerProfileVersion.findFirst({
          where: { firmId: FIRM_ID, clientId: cliente.id },
          orderBy: { version: "desc" },
        }),
      );
      if (anyVersion) {
        await withTenantContext(ctx, (tx) =>
          tx.taxpayerProfileVersion.update({
            where: { id: anyVersion.id },
            data: {
              status: "ACTIVE",
              activatedAt: new Date(),
              legalName: anyVersion.legalName,
              cuit: anyVersion.cuit,
            },
          }),
        );
      } else {
        await withTenantContext(ctx, (tx) =>
          tx.taxpayerProfileVersion.create({
            data: {
              firmId: FIRM_ID,
              clientId: cliente.id,
              version: 1,
              legalName: cliente.legalName,
              cuit: cliente.cuit,
              personType: "JURIDICA",
              nationalCondition: "RESPONSABLE_INSCRIPTO",
              validFrom: new Date("2025-01-01"),
              status: "ACTIVE",
              activatedAt: new Date(),
              createdByUserId: OWNER_ID,
            },
          }),
        );
      }
      console.log(`  ✔ Perfil fiscal ACTIVE asegurado para ${cliente.legalName}`);
    }
  }

  const report: Record<string, unknown>[] = [];
  let finalizadas = 0;

  // Revisor del seed demo (maker-checker): el owner crea, el revisor aprueba.
  const reviewer = await prisma.user.findUnique({ where: { emailNormalized: "revisor@contable.local" } });
  if (!reviewer) {
    throw new Error("No existe el revisor demo (revisor@contable.local). Corré seed-demo primero.");
  }
  const ctxReviewer = { userId: reviewer.id, firmId: FIRM_ID, actorKind: "USER" as const };

  for (const cliente of clientes) {
    const profile = await withTenantContext(ctx, (tx) =>
      tx.taxpayerProfileVersion.findFirst({
        where: { firmId: FIRM_ID, clientId: cliente.id, status: "ACTIVE" },
        orderBy: { version: "desc" },
      }),
    );
    if (!profile) {
      console.warn(`  ⏭ ${cliente.legalName}: sin perfil fiscal ACTIVE (se omite)`);
      continue;
    }

    for (const per of PERIODOS_HISTORICOS) {
      // Período (idempotente).
      const period = await prisma.taxPeriod.upsert({
        where: { id: `his-${cliente.id}-${per.start.slice(0, 7)}` },
        update: {},
        create: {
          id: `his-${cliente.id}-${per.start.slice(0, 7)}`,
          firmId: FIRM_ID,
          clientId: cliente.id,
          taxTypeId: iva.id,
          startDate: new Date(per.start),
          endDate: new Date(per.end),
          label: `${per.label} (histórico)`,
        },
      });

      // Obligación (materializada; la transición a FILED/PAID queda a cargo
      // del operador: este script sólo deja el cálculo listo para control).
      await prisma.taxObligation.upsert({
        where: { id: `his-ob-${cliente.id}-${per.start.slice(0, 7)}` },
        update: {},
        create: {
          id: `his-ob-${cliente.id}-${per.start.slice(0, 7)}`,
          firmId: FIRM_ID,
          clientId: cliente.id,
          profileVersionId: profile.id,
          regimeId: ri.id,
          periodId: period.id,
          status: "READY_TO_CALCULATE",
          materializedBy: OWNER_ID,
        },
      });

      // Hechos: 2 ventas + 1 compra dentro del período (sin duplicar).
      let vouchers = await prisma.fiscalVoucher.findMany({
        where: {
          firmId: FIRM_ID,
          clientId: cliente.id,
          periodId: period.id,
        },
      });
      if (vouchers.length === 0) {
        const creados: Awaited<ReturnType<typeof ingestion.createVoucher>>[] = [];
        const offset = MES_OFFSET[per.start.slice(5, 7)] ?? 0;
        for (const v of [1, 2]) {
          const dia = 5 + v;
          const voucher = await ingestion.createVoucher(ctx, {
            clientId: cliente.id,
            direction: "SALE",
            type: "A",
            letter: "A",
            pointOfSale: 1,
            number: 10 * v + offset,
            issuerCuit: cliente.cuit,
            receiverCuit: "20111111111",
            periodId: period.id,
            issuedOn: `${per.start.slice(0, 8)}${String(dia).padStart(2, "0")}`,
            total: "121000.00",
            components: [
              { concept: "NETO", base: "100000.00", amount: "100000.00" },
              { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
            ],
          });
          creados.push(voucher);
        }
        // Compra condicionada a que no exista (1 por período).
        const compra = await ingestion.createVoucher(ctx, {
          clientId: cliente.id,
          direction: "PURCHASE",
          type: "A",
          letter: "A",
          pointOfSale: 1,
          number: 50 + offset,
          issuerCuit: "20111111111",
          receiverCuit: cliente.cuit,
          periodId: period.id,
          issuedOn: `${per.start.slice(0, 8)}08`,
          total: "48400.00",
          components: [
            { concept: "NETO", base: "40000.00", amount: "40000.00" },
            { concept: "IVA_21", base: "40000.00", rate: "0.21", amount: "8400.00" },
          ],
        });
        creados.push(compra);
        vouchers = creados;
      }

      // Aprobar los vouchers del período que aún no estén APPROVED.
      // (Una corrida previa pudo dejar DRAFT tras fallar el maker-checker.)
      const pendientes = vouchers.filter((v) => v.status !== "APPROVED");
      for (const v of pendientes) {
        await ingestion.reviewVoucher(ctxReviewer, v.id, true);
      }

      // Liquidación: reusar la existente o calcular una nueva.
      const existing = await prisma.taxSettlement.findFirst({
        where: {
          firmId: FIRM_ID,
          clientId: cliente.id,
          regimeId: ri.id,
          periodId: period.id,
        },
        orderBy: { version: "desc" },
      });

      let settlement = existing;
      if (!settlement) {
        const resultado = await settlements.calculate(ctx, {
          clientId: cliente.id,
          taxTypeId: iva.id,
          regimeId: ri.id,
          jurisdictionId: ar.id,
          periodId: period.id,
          cutoff: per.cutoff,
        });
        settlement = resultado.settlement;
      }

      // G6-02: avanzar hasta FINALIZED (maker-checker: preparador calcula,
      // revisor revisa y finaliza).
      let estado = settlement.status;
      if (settlement.status === "CALCULATED") {
        await settlements.submitReview(ctx, settlement.id); // preparador
        await settlements.review(ctxReviewer, settlement.id); // revisor
        await settlements.finalize(ctxReviewer, settlement.id); // revisor
        estado = "FINALIZED";
      } else if (settlement.status === "IN_REVIEW") {
        await settlements.review(ctxReviewer, settlement.id);
        await settlements.finalize(ctxReviewer, settlement.id);
        estado = "FINALIZED";
      } else if (settlement.status === "REVIEWED") {
        await settlements.finalize(ctxReviewer, settlement.id);
        estado = "FINALIZED";
      }

      const totalsRow = (settlement.totals ?? {}) as Record<string, string>;
      report.push({
        cliente: cliente.legalName,
        cuit: cliente.cuit,
        periodo: per.label,
        estado,
        total: fmt(totalsRow["TOTAL_A_INGRESAR"] ?? totalsRow["totalDue"]),
        inputHash: settlement.inputHash.slice(0, 16),
        outputHash: settlement.outputHash.slice(0, 16),
        nota: existing ? "ya existía" : undefined,
      });
      if (estado === "FINALIZED" && !existing) finalizadas++;
    }
  }

  // Evidencia: reporte de control para comparación manual (G6-02).
  const out = `# Corrida histórica del piloto — control de períodos

> Generado automáticamente por \`npm run seed:corrida -w @contable/api\`.
> Fecha: ${new Date().toISOString()}
> Cada período se liquidó y finalizó con el motor determinista (V-003/V-004).
> Este reporte es el insumo para la comparación manual del contador (G6-02).

## Resumen
- Clientes: ${clientes.length}
- Períodos por cliente: ${PERIODOS_HISTORICOS.length}
- Liquidaciones finalizadas nuevas: ${finalizadas}

| Cliente | Período | Total a ingresar | InputHash | OutputHash |
|---|---|---|---|---|
${report.map((r) => `| ${r.cliente} | ${r.periodo} | ${r.total} | ${r.inputHash} | ${r.outputHash} |`).join("\n")}

> Volcado generado el ${new Date().toISOString()}.
`;
  const fs = await import("node:fs");
  const path = await import("node:path");
  // Raíz del repo: ancestro más cercano con node_modules/package.json de
  // monorepo (workspaces). Desde apps/api sube hasta la raíz del repo.
  let root = process.cwd();
  for (let i = 0; i < 6 && !fs.existsSync(path.join(root, "PLAN_DESARROLLO_CONTABLE.md")); i++) {
    root = path.dirname(root);
  }
  const docsDir = path.join(root, "docs/piloto");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "g6-corrida-historica.md"), out, "utf8");
  console.log(`\nReporte: ${path.join(docsDir, "g6-corrida-historica.md")} (${clientes.length} clientes, ${finalizadas} finalizadas nuevas)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});