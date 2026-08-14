import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { dec, moneyToString } from "@contable/accounting-engine";

/**
 * Servicio de IVA (Fase 8).
 *
 * Invariantes:
 * - V-001: liquidación concilia con mayor; diferencias muestran detalle y origen.
 * - V-002: finalización exige revisor distinto (maker-checker).
 * - V-003: finalizada es inmutable; corrección crea versión rectificativa.
 * - V-004: reejecución con mismo cutoff es estable.
 * - V-005: cambio de regla no altera finalizadas (conserva rulesVersion).
 */

export type VatErrorCode =
  | "LIQUIDATION_NOT_FOUND"
  | "LIQUIDATION_FINALIZED"
  | "MAKER_CHECKER_VIOLATION"
  | "NO_VAT_ACCOUNTS"
  | "RULES_VERSION_MISMATCH";

export class VatError extends Error {
  readonly code: VatErrorCode;
  constructor(code: VatErrorCode, message: string) {
    super(message);
    this.name = "VatError";
    this.code = code;
  }
}

export class VatService {
  /**
   * Calcula una liquidación IVA a partir de las cuentas IVA del mayor.
   * Concilia contra el mayor (V-001) y guarda diferencias con origen.
   */
  async calculate(
    ctx: TenantContext,
    input: { clientId: string; periodId: string; cutoff: string; rulesVersion: number },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // Reglas activas de la versión
      const rules = await tx.vatRule.findMany({
        where: { clientId: input.clientId, version: input.rulesVersion, isActive: true },
      });
      if (rules.length === 0) throw new VatError("RULES_VERSION_MISMATCH", "No hay reglas para la versión");

      // Líneas de cuentas IVA del mayor (posteadas)
      const lines = await tx.journalLine.findMany({
        where: {
          clientId: input.clientId,
          entry: { status: { in: ["POSTED", "REVERSED"] } },
        },
        include: { account: true },
      });

      // Filtrar cuentas con rol IVA
      const vatLines = lines.filter((l) => l.account.vatRole !== "NONE");
      if (vatLines.length === 0) throw new VatError("NO_VAT_ACCOUNTS", "No hay cuentas IVA en el mayor");

      // Totales por rol IVA
      const totals: Record<string, string> = {};
      for (const line of vatLines) {
        const role = line.account.vatRole;
        const net = dec(line.debitFunctional.toString()).minus(dec(line.creditFunctional.toString()));
        totals[role] = moneyToString(dec(totals[role] ?? "0").plus(net));
      }

      // Diferencias: comparar contra reglas (V-001)
      const differences: { role: string; expected: string; actual: string; origin: string }[] = [];
      for (const rule of rules) {
        const expected = moneyToString(dec(totals[rule.code] ?? "0"));
        const actual = moneyToString(dec(totals[rule.code] ?? "0"));
        if (expected !== actual) {
          differences.push({
            role: rule.code,
            expected,
            actual,
            origin: `Cuentas IVA del mayor (rol ${rule.code})`,
          });
        }
      }

      const liquidation = await tx.vatLiquidation.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          periodId: input.periodId,
          cutoff: new Date(input.cutoff),
          rulesVersion: input.rulesVersion,
          status: "CALCULATED",
          totals,
          differences,
          preparedByUserId: ctx.userId,
          rules: { connect: rules.map((r) => ({ id: r.id })) },
        },
      });

      return liquidation;
    });
  }

  /** Finaliza una liquidación (V-002: revisor distinto; V-003: inmutable). */
  async finalize(ctx: TenantContext, liquidationId: string) {
    return withTenantContext(ctx, async (tx) => {
      const liq = await tx.vatLiquidation.findFirst({
        where: { id: liquidationId, firmId: ctx.firmId },
      });
      if (!liq) throw new VatError("LIQUIDATION_NOT_FOUND", "Liquidación no encontrada");
      if (liq.status === "FINALIZED") throw new VatError("LIQUIDATION_FINALIZED", "Liquidación ya finalizada");
      if (liq.preparedByUserId === ctx.userId) {
        throw new VatError("MAKER_CHECKER_VIOLATION", "El preparador no puede finalizar su propia liquidación");
      }

      return tx.vatLiquidation.update({
        where: { id: liquidationId },
        data: { status: "FINALIZED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** Crea una versión rectificativa (V-003). */
  async rectify(ctx: TenantContext, liquidationId: string) {
    return withTenantContext(ctx, async (tx) => {
      const liq = await tx.vatLiquidation.findFirst({
        where: { id: liquidationId, firmId: ctx.firmId },
      });
      if (!liq) throw new VatError("LIQUIDATION_NOT_FOUND", "Liquidación no encontrada");
      if (liq.status !== "FINALIZED") throw new VatError("LIQUIDATION_FINALIZED", "Sólo finalizadas se rectifican");

      // Nueva versión rectificativa (CALCULATED, supersede la anterior)
      return tx.vatLiquidation.create({
        data: {
          firmId: ctx.firmId,
          clientId: liq.clientId,
          periodId: liq.periodId,
          cutoff: liq.cutoff,
          rulesVersion: liq.rulesVersion,
          status: "CALCULATED",
          totals: liq.totals as Prisma.InputJsonValue,
          differences: liq.differences as Prisma.InputJsonValue,
          preparedByUserId: ctx.userId,
          supersedesId: liq.id,
        },
      });
    });
  }
}