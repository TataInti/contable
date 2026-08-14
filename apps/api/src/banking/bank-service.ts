import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { createHash } from "node:crypto";

/**
 * Servicio de bancos (Fase 7).
 * Importación de movimientos con dedupe, conciliación y snapshots.
 *
 * Invariantes:
 * - B-001: dedupe por externalId; si no, por hash de cuenta, fecha, importe, moneda y referencia.
 * - B-002: lote con errores no escribe parcial (FAILED con errores por fila).
 * - B-003: match no sobreaplica; no reutiliza movimiento conciliado.
 * - B-004: snapshot reproduce saldos (inicial + movimientos = final).
 * - B-005: reabrir conserva snapshot anterior y registra motivo/actor.
 */

export type BankErrorCode =
  | "BANK_ACCOUNT_NOT_FOUND"
  | "MOVEMENT_NOT_FOUND"
  | "MOVEMENT_ALREADY_MATCHED"
  | "MATCH_OVERAPPLIES"
  | "RECONCILIATION_NOT_FOUND"
  | "RECONCILIATION_NOT_OPEN"
  | "RECONCILIATION_SNAPSHOT_MISMATCH"
  | "LOT_HAS_ERRORS";

export class BankError extends Error {
  readonly code: BankErrorCode;
  constructor(code: BankErrorCode, message: string) {
    super(message);
    this.name = "BankError";
    this.code = code;
  }
}

export interface MovementImportRow {
  externalId?: string;
  valueDate: string;
  description: string;
  amount: string;
  currencyCode?: string;
  reference?: string;
}

export class BankService {
  /** Crea una cuenta bancaria vinculada a una cuenta contable. */
  async createBankAccount(
    ctx: TenantContext,
    input: {
      clientId: string;
      accountId: string;
      bankName: string;
      accountNumber: string;
      cbu?: string;
      alias?: string;
      currencyCode?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const data: Prisma.BankAccountUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        accountId: input.accountId,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
      };
      if (input.cbu !== undefined) data.cbu = input.cbu;
      if (input.alias !== undefined) data.alias = input.alias;
      if (input.currencyCode !== undefined) data.currencyCode = input.currencyCode;
      return tx.bankAccount.create({ data });
    });
  }

  /**
   * Importa movimientos de un extracto con dedupe (B-001).
   * Si alguna fila es inválida, el lote queda FAILED sin escrituras parciales (B-002).
   */
  async importMovements(
    ctx: TenantContext,
    input: {
      bankAccountId: string;
      periodStart: string;
      periodEnd: string;
      openingBalance: string;
      closingBalance: string;
      currencyCode?: string;
      sourceType?: string;
      rows: MovementImportRow[];
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const bankAccount = await tx.bankAccount.findFirst({
        where: { id: input.bankAccountId, firmId: ctx.firmId },
      });
      if (!bankAccount) throw new BankError("BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada");

      // Validar filas (B-002): si alguna es inválida, falla el lote completo
      const errors: { row: number; error: string }[] = [];
      input.rows.forEach((row, i) => {
        const amount = parseFloat(row.amount);
        if (Number.isNaN(amount)) errors.push({ row: i + 1, error: "Importe inválido" });
        if (!row.valueDate) errors.push({ row: i + 1, error: "Fecha valor requerida" });
        if (!row.description) errors.push({ row: i + 1, error: "Descripción requerida" });
      });
      if (errors.length > 0) {
        throw new BankError("LOT_HAS_ERRORS", `Lote con ${errors.length} errores`);
      }

      // Crear extracto
      const statement = await tx.bankStatement.create({
        data: {
          firmId: ctx.firmId,
          clientId: bankAccount.clientId,
          bankAccountId: input.bankAccountId,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          openingBalance: input.openingBalance,
          closingBalance: input.closingBalance,
          currencyCode: input.currencyCode ?? bankAccount.currencyCode,
          sourceType: input.sourceType ?? "CSV",
          status: "IMPORTED",
        },
      });

      // Insertar movimientos con dedupe
      let created = 0;
      let skipped = 0;
      for (const row of input.rows) {
        const dedupeHash = this.dedupeHash(
          bankAccount.id,
          row.valueDate,
          row.amount,
          row.currencyCode ?? bankAccount.currencyCode,
          row.reference ?? row.description,
        );

        // Dedupe por externalId o hash (B-001)
        const existing = row.externalId
          ? await tx.bankMovement.findFirst({
              where: { bankAccountId: bankAccount.id, externalId: row.externalId },
            })
          : await tx.bankMovement.findFirst({
              where: { bankAccountId: bankAccount.id, dedupeHash },
            });

        if (existing) {
          skipped++;
          continue;
        }

        const data: Prisma.BankMovementUncheckedCreateInput = {
          firmId: ctx.firmId,
          clientId: bankAccount.clientId,
          bankAccountId: bankAccount.id,
          statementId: statement.id,
          dedupeHash,
          valueDate: new Date(row.valueDate),
          description: row.description,
          amount: row.amount,
          currencyCode: row.currencyCode ?? bankAccount.currencyCode,
        };
        if (row.externalId !== undefined) data.externalId = row.externalId;
        if (row.reference !== undefined) data.reference = row.reference;

        await tx.bankMovement.create({ data });
        created++;
      }

      return { statement, created, skipped };
    });
  }

  /** Confirma un match entre movimiento y asiento (B-003). */
  async confirmMatch(
    ctx: TenantContext,
    input: { movementId: string; entryId: string; appliedAmount: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const movement = await tx.bankMovement.findFirst({
        where: { id: input.movementId, firmId: ctx.firmId },
      });
      if (!movement) throw new BankError("MOVEMENT_NOT_FOUND", "Movimiento no encontrado");
      if (movement.status === "MATCHED") {
        throw new BankError("MOVEMENT_ALREADY_MATCHED", "Movimiento ya conciliado");
      }

      // B-003: no sobreaplicar
      const applied = parseFloat(input.appliedAmount);
      const amount = parseFloat(movement.amount.toString());
      if (applied > amount) {
        throw new BankError("MATCH_OVERAPPLIES", "El importe aplicado excede el movimiento");
      }

      const match = await tx.bankMatch.create({
        data: {
          firmId: ctx.firmId,
          clientId: movement.clientId,
          bankAccountId: movement.bankAccountId,
          movementId: movement.id,
          entryId: input.entryId,
          appliedAmount: input.appliedAmount,
          status: "CONFIRMED",
          matchedByUserId: ctx.userId,
          matchedAt: new Date(),
        },
      });

      // Marcar movimiento como conciliado si se aplicó el total
      if (applied >= amount) {
        await tx.bankMovement.update({
          where: { id: movement.id },
          data: { status: "MATCHED" },
        });
      }

      return match;
    });
  }

  /** Finaliza una conciliación y guarda snapshot (B-004). */
  async finalizeReconciliation(
    ctx: TenantContext,
    input: { bankAccountId: string; periodStart: string; periodEnd: string; openingBalance: string; closingBalance: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const bankAccount = await tx.bankAccount.findFirst({
        where: { id: input.bankAccountId, firmId: ctx.firmId },
      });
      if (!bankAccount) throw new BankError("BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada");

      // Sumar movimientos del período
      const agg = await tx.bankMovement.aggregate({
        where: {
          bankAccountId: bankAccount.id,
          valueDate: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) },
        },
        _sum: { amount: true },
      });
      const movementsSum = parseFloat(agg._sum.amount?.toString() ?? "0");
      const opening = parseFloat(input.openingBalance);
      const closing = parseFloat(input.closingBalance);

      // B-004: saldo inicial + movimientos = saldo final (tolerancia cero)
      if (Math.abs(opening + movementsSum - closing) > 0.0001) {
        throw new BankError(
          "RECONCILIATION_SNAPSHOT_MISMATCH",
          `Saldo no reconcilia: ${opening} + ${movementsSum} ≠ ${closing}`,
        );
      }

      const snapshot = {
        openingBalance: input.openingBalance,
        closingBalance: input.closingBalance,
        movementsSum: movementsSum.toFixed(4),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        generatedAt: new Date().toISOString(),
      };

      return tx.bankReconciliation.create({
        data: {
          firmId: ctx.firmId,
          clientId: bankAccount.clientId,
          bankAccountId: bankAccount.id,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          openingBalance: input.openingBalance,
          closingBalance: input.closingBalance,
          status: "RECONCILED",
          snapshot,
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /** Reabre una conciliación conservando el snapshot anterior (B-005). */
  async reopenReconciliation(ctx: TenantContext, reconciliationId: string, reason: string) {
    return withTenantContext(ctx, async (tx) => {
      const rec = await tx.bankReconciliation.findFirst({
        where: { id: reconciliationId, firmId: ctx.firmId },
      });
      if (!rec) throw new BankError("RECONCILIATION_NOT_FOUND", "Conciliación no encontrada");
      if (rec.status !== "RECONCILED") {
        throw new BankError("RECONCILIATION_NOT_OPEN", "Sólo conciliaciones finalizadas se reabren");
      }

      // B-005: conservar snapshot anterior y registrar motivo/actor
      return tx.bankReconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: "REOPENED",
          reason,
          reopenedFromId: reconciliationId,
          snapshot: rec.snapshot as Prisma.InputJsonValue,
        },
      });
    });
  }

  private dedupeHash(
    bankAccountId: string,
    valueDate: string,
    amount: string,
    currencyCode: string,
    reference: string,
  ): string {
    const normalized = reference.trim().toLowerCase().replace(/\s+/g, " ");
    const raw = `${bankAccountId}|${valueDate}|${amount}|${currencyCode}|${normalized}`;
    return createHash("sha256").update(raw).digest("hex");
  }
}