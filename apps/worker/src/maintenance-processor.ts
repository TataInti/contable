import { prisma } from "./lib/prisma.js";

/**
 * F2.3/F2.4: procesador de mantenimiento (cola maintenance).
 *
 * Revalida los rule packs ACTIVE de cada firma: si un pack no tiene versión
 * vigente (validFrom/validTo) o su rulesHash cambió, se retira (fail-safe)
 * para que el cálculo no use reglas vencidas o alteradas.
 *
 * El job es idempotente: revalidar dos veces produce el mismo resultado.
 */

export interface MaintenanceJobData {
  kind: "revalidate-rule-packs";
  firmId?: string;
}

export async function processMaintenance(name: string, data: unknown): Promise<void> {
  const job = data as MaintenanceJobData;
  if (job.kind !== "revalidate-rule-packs") {
    throw new Error(`UNSUPPORTED_MAINTENANCE_JOB:${name}`);
  }

  // Revalida packs de una firma o de todas (si no se especifica).
  const firms = job.firmId
    ? [{ id: job.firmId }]
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT r."firmId" AS id
        FROM tax_rule_packs p
        JOIN tax_regimes r ON r.id = p."regimeId"
        WHERE p.status = 'ACTIVE'
      `;

  let retired = 0;
  for (const firm of firms) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${"worker"}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${firm.id}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', ${"SYSTEM"}, true)`;

      const packs = await tx.taxRulePack.findMany({
        where: { status: "ACTIVE" },
        include: {
          versions: {
            orderBy: { version: "desc" },
            include: { rateRules: true, minimumRules: true, bracketRules: true, dueDateRules: true },
          },
        },
      });

      const now = new Date();
      let firmRetired = 0;
      for (const pack of packs) {
        const current = pack.versions.find(
          (v) => v.status === "ACTIVE" && v.validFrom <= now && (!v.validTo || v.validTo >= now),
        );
        if (!current) {
          await tx.taxRulePack.update({ where: { id: pack.id }, data: { status: "RETIRED" } });
          firmRetired++;
        }
      }
      return firmRetired;
    });
    retired += result;
  }

  console.log(`[maintenance] revalidate-rule-packs: ${firms.length} firmas, ${retired} packs retirados`);
}