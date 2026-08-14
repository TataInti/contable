import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { dec, moneyToString } from "@contable/accounting-engine";

/**
 * Servicio de moneda extranjera e inflación (Fase 7).
 *
 * Invariantes:
 * - I-001: un run no modifica el ledger; produce worksheet + asiento borrador.
 * - I-002: run reproducible (indexVersion + policyVersion + ledgerCutoff → mismo resultado).
 * - I-003: la IA no decide categorías; sólo señala faltantes.
 */

export type AdjustmentErrorCode =
  | "RATE_NOT_FOUND"
  | "INDEX_NOT_FOUND"
  | "OBSERVATION_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "NO_MONETARY_ACCOUNTS"
  | "NO_ORIGIN_LAYER";

export class AdjustmentError extends Error {
  readonly code: AdjustmentErrorCode;
  constructor(code: AdjustmentErrorCode, message: string) {
    super(message);
    this.name = "AdjustmentError";
    this.code = code;
  }
}

export class AdjustmentService {
  /**
   * Ejecuta un run de diferencia de cambio.
   * Calcula el ajuste por cuenta monetaria en moneda extranjera y produce
   * un worksheet + asiento borrador (no postea).
   */
  async runExchangeDifference(
    ctx: TenantContext,
    input: {
      clientId: string;
      fiscalYearId: string;
      periodId: string;
      asOfDate: string;
      rateSourceId: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // Obtener tasa de cierre
      const rate = await tx.exchangeRate.findFirst({
        where: { sourceId: input.rateSourceId, date: { lte: new Date(input.asOfDate) } },
        orderBy: { date: "desc" },
      });
      if (!rate) throw new AdjustmentError("RATE_NOT_FOUND", "No hay tasa de cambio para la fecha");

      // Cuentas monetarias en moneda extranjera con saldo
      const lines = await tx.journalLine.findMany({
        where: {
          clientId: input.clientId,
          currencyCode: { not: "ARS" },
          entry: { status: { in: ["POSTED", "REVERSED"] } },
        },
        include: { account: true },
      });

      // Agrupar saldo neto por cuenta
      const balances = new Map<string, { accountId: string; code: string; name: string; netOriginal: ReturnType<typeof dec> }>();
      for (const line of lines) {
        const net = dec(line.debitOriginal.toString()).minus(dec(line.creditOriginal.toString()));
        const existing = balances.get(line.accountId) ?? {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          netOriginal: dec(0),
        };
        existing.netOriginal = existing.netOriginal.plus(net);
        balances.set(line.accountId, existing);
      }

      // Calcular diferencia de cambio (saldo original × tasa - saldo funcional)
      const adjustments: { accountId: string; code: string; name: string; original: string; functional: string; difference: string }[] = [];
      for (const b of balances.values()) {
        if (b.netOriginal.isZero()) continue;
        const functional = b.netOriginal.mul(rate.rate);
        const difference = functional.minus(b.netOriginal);
        if (difference.isZero()) continue;
        adjustments.push({
          accountId: b.accountId,
          code: b.code,
          name: b.name,
          original: moneyToString(b.netOriginal),
          functional: moneyToString(functional),
          difference: moneyToString(difference),
        });
      }

      if (adjustments.length === 0) {
        throw new AdjustmentError("NO_MONETARY_ACCOUNTS", "No hay cuentas monetarias con diferencia");
      }

      const worksheet = {
        asOfDate: input.asOfDate,
        rate: rate.rate.toString(),
        rateSourceId: input.rateSourceId,
        adjustments,
        generatedAt: new Date().toISOString(),
      };

      // Crear run en DRAFT (no toca ledger)
      return tx.exchangeDifferenceRun.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          fiscalYearId: input.fiscalYearId,
          periodId: input.periodId,
          asOfDate: new Date(input.asOfDate),
          rateSourceId: input.rateSourceId,
          status: "DRAFT",
          worksheet,
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /**
   * Ejecuta un run de inflación.
   * Calcula el ajuste por cuenta monetaria usando el coeficiente del índice
   * y produce worksheet + asiento borrador (no postea).
   */
  async runInflation(
    ctx: TenantContext,
    input: {
      clientId: string;
      fiscalYearId: string;
      periodId: string;
      asOfDate: string;
      indexId: string;
      indexVersion: string;
      policyVersion: string;
      ledgerCutoff: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const index = await tx.inflationIndex.findFirst({
        where: { id: input.indexId, firmId: ctx.firmId },
      });
      if (!index) throw new AdjustmentError("INDEX_NOT_FOUND", "Índice no encontrado");

      // Observación del índice a la fecha de corte
      const obs = await tx.inflationObservation.findFirst({
        where: { indexId: input.indexId, date: { lte: new Date(input.asOfDate) } },
        orderBy: { date: "desc" },
      });
      if (!obs) throw new AdjustmentError("OBSERVATION_NOT_FOUND", "No hay observación del índice");

      // Coeficiente = valor actual / valor base
      const coefficient = dec(obs.value).div(index.baseValue);

      // Cuentas monetarias con saldo funcional
      const lines = await tx.journalLine.findMany({
        where: {
          clientId: input.clientId,
          entry: { status: { in: ["POSTED", "REVERSED"] } },
        },
        include: { account: true },
      });

      const balances = new Map<string, { accountId: string; code: string; name: string; netFunctional: ReturnType<typeof dec> }>();
      for (const line of lines) {
        // Sólo cuentas monetarias (clasificación MONETARY)
        if (line.account.monetaryClassification !== "MONETARY") continue;
        const net = dec(line.debitFunctional.toString()).minus(dec(line.creditFunctional.toString()));
        const existing = balances.get(line.accountId) ?? {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          netFunctional: dec(0),
        };
        existing.netFunctional = existing.netFunctional.plus(net);
        balances.set(line.accountId, existing);
      }

      const adjustments: { accountId: string; code: string; name: string; balance: string; adjustment: string }[] = [];
      for (const b of balances.values()) {
        if (b.netFunctional.isZero()) continue;
        const restated = b.netFunctional.mul(coefficient);
        const adjustment = restated.minus(b.netFunctional);
        if (adjustment.isZero()) continue;
        adjustments.push({
          accountId: b.accountId,
          code: b.code,
          name: b.name,
          balance: moneyToString(b.netFunctional),
          adjustment: moneyToString(adjustment),
        });
      }

      if (adjustments.length === 0) {
        throw new AdjustmentError("NO_MONETARY_ACCOUNTS", "No hay cuentas monetarias para ajustar");
      }

      const worksheet = {
        asOfDate: input.asOfDate,
        indexId: input.indexId,
        indexVersion: input.indexVersion,
        policyVersion: input.policyVersion,
        ledgerCutoff: input.ledgerCutoff,
        coefficient: coefficient.toString(),
        adjustments,
        generatedAt: new Date().toISOString(),
      };

      // I-002: reproducible por indexVersion + policyVersion + ledgerCutoff
      return tx.inflationRun.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          fiscalYearId: input.fiscalYearId,
          periodId: input.periodId,
          asOfDate: new Date(input.asOfDate),
          indexId: input.indexId,
          indexVersion: input.indexVersion,
          policyVersion: input.policyVersion,
          ledgerCutoff: new Date(input.ledgerCutoff),
          status: "DRAFT",
          worksheet,
          createdByUserId: ctx.userId,
        },
      });
    });
  }
}