import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * F2.3: revalidación programada de rule packs.
 *
 * Verifica que cada pack ACTIVE tenga una versión vigente (validFrom <= hoy
 * <= validTo o sin validTo) y que su rulesHash sea estable. Si un pack activo
 * no tiene versión vigente, lo marca como RETIRED para que el cálculo no use
 * reglas vencidas (fail-safe).
 *
 * Se invoca desde el worker (cola maintenance) de forma programada.
 */

export type RulePackValidationIssue =
  | "NO_ACTIVE_VERSION"
  | "NO_CURRENT_VERSION"
  | "HASH_MISMATCH";

export interface RulePackValidationResult {
  packId: string;
  code: string;
  status: string;
  issues: RulePackValidationIssue[];
  currentVersion: number | null;
  rulesHash: string | null;
}

export class RulePackValidator {
  /**
   * Revalida todos los packs ACTIVE de la firma. Devuelve el resultado por pack.
   * No lanza: registra issues y retira packs sin versión vigente.
   */
  async revalidateAll(ctx: TenantContext): Promise<RulePackValidationResult[]> {
    return withTenantContext(ctx, async (tx) => {
      const packs = await tx.taxRulePack.findMany({
        where: { status: "ACTIVE" },
        include: {
          versions: {
            orderBy: { version: "desc" },
            include: { rateRules: true, minimumRules: true, bracketRules: true, dueDateRules: true },
          },
        },
      });

      const results: RulePackValidationResult[] = [];
      const now = new Date();

      for (const pack of packs) {
        const issues: RulePackValidationIssue[] = [];
        const activeVersion = pack.versions.find((v) => v.status === "ACTIVE");
        const currentVersion = pack.versions.find(
          (v) => v.status === "ACTIVE" && v.validFrom <= now && (!v.validTo || v.validTo >= now),
        );

        if (!activeVersion) issues.push("NO_ACTIVE_VERSION");
        if (!currentVersion) issues.push("NO_CURRENT_VERSION");

        // Hash estable: recalcula sobre las reglas y compara con el persistido.
        let rulesHash: string | null = null;
        if (activeVersion) {
          rulesHash = this.computeRulesHash(activeVersion);
          if (rulesHash !== activeVersion.rulesHash) issues.push("HASH_MISMATCH");
        }

        // Fail-safe: si no hay versión vigente, retira el pack para no calcular con reglas vencidas.
        if (!currentVersion && pack.status === "ACTIVE") {
          await tx.taxRulePack.update({ where: { id: pack.id }, data: { status: "RETIRED" } });
        }

        results.push({
          packId: pack.id,
          code: pack.code,
          status: currentVersion ? "ACTIVE" : "RETIRED",
          issues,
          currentVersion: activeVersion?.version ?? null,
          rulesHash,
        });
      }

      return results;
    });
  }

  /** Hash canónico de las reglas de una versión (estable y determinista). */
  private computeRulesHash(version: {
    rateRules: { concept: string; activityCode: string | null; jurisdictionId: string | null; rate: Prisma.Decimal | null; minAmount: Prisma.Decimal | null }[];
    minimumRules: { concept: string; jurisdictionId: string | null; amount: Prisma.Decimal }[];
    bracketRules: { concept: string; fromAmount: Prisma.Decimal; toAmount: Prisma.Decimal | null; rate: Prisma.Decimal; fixedAmount: Prisma.Decimal | null }[];
    dueDateRules: { jurisdictionId: string; frequency: string; dueDay: number; cuitEnding: string | null }[];
  }): string {
    const canonical = JSON.stringify({
      rate: version.rateRules.map((r) => [r.concept, r.activityCode, r.jurisdictionId, r.rate?.toString(), r.minAmount?.toString()]),
      min: version.minimumRules.map((r) => [r.concept, r.jurisdictionId, r.amount.toString()]),
      bracket: version.bracketRules.map((r) => [r.concept, r.fromAmount.toString(), r.toAmount?.toString(), r.rate.toString(), r.fixedAmount?.toString()]),
      due: version.dueDateRules.map((r) => [r.jurisdictionId, r.frequency, r.dueDay, r.cuitEnding]),
    });
    return createHash("sha256").update(canonical).digest("hex");
  }
}

export const rulePackValidator = new RulePackValidator();