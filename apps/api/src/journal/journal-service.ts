import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { assertBalanced, type EngineLine } from "@contable/accounting-engine";
import type { JournalEntryDraft } from "@contable/contracts";
import { createHash, randomUUID } from "node:crypto";

/**
 * Servicio de asientos (Fase 6 — Núcleo contable).
 *
 * Invariantes:
 * - Ningún asiento desbalanceado llega a POSTED (validación en motor + DB).
 * - Un POSTED es inmutable (no se edita; sólo se revierte).
 * - La secuencia por cliente/ejercicio se asigna atómicamente en la DB.
 * - Idempotencia por Idempotency-Key.
 * - Maker-checker: DRAFT → IN_REVIEW → REVIEWED → POSTED.
 */

export type JournalErrorCode =
  | "ENTRY_NOT_FOUND"
  | "ENTRY_NOT_EDITABLE"
  | "ENTRY_NOT_REVIEWABLE"
  | "ENTRY_NOT_POSTABLE"
  | "ENTRY_ALREADY_POSTED"
  | "ENTRY_ALREADY_REVERSED"
  | "ENTRY_NOT_REVERSIBLE"
  | "PERIOD_CLOSED"
  | "FISCAL_YEAR_CLOSED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "ACCOUNT_INACTIVE"
  | "UNBALANCED_ENTRY"
  | "ROW_VERSION_CONFLICT"
  | "REVERSAL_EXISTS"
  | "SELF_REVERSAL"
  | "IDEMPOTENCY_CONFLICT";

export class JournalError extends Error {
  readonly code: JournalErrorCode;
  constructor(code: JournalErrorCode, message: string) {
    super(message);
    this.name = "JournalError";
    this.code = code;
  }
}

export class JournalService {
  /** Crea un borrador de asiento (maker). */
  async createDraft(ctx: TenantContext, input: JournalEntryDraft) {
    return withTenantContext(ctx, async (tx) => {
      // Validar período y ejercicio abiertos
      await this.assertPeriodOpen(tx, ctx.firmId, input.periodId);
      await this.assertFiscalYearOpen(tx, ctx.firmId, input.fiscalYearId);

      // Validar balance en el motor puro
      const engineLines: EngineLine[] = input.lines.map((l) => ({
        debitOriginal: l.debitOriginal,
        creditOriginal: l.creditOriginal,
        debitFunctional: l.debitFunctional,
        creditFunctional: l.creditFunctional,
        ...(l.exchangeRate !== undefined ? { exchangeRate: l.exchangeRate } : {}),
      }));
      assertBalanced(engineLines);

      // Validar cuentas
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accounts = await tx.account.findMany({
        where: { firmId: ctx.firmId, clientId: input.clientId, id: { in: accountIds } },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      for (const id of accountIds) {
        const acc = accountMap.get(id);
        if (!acc) throw new JournalError("ACCOUNT_NOT_FOUND", `Cuenta ${id} no encontrada`);
        if (!acc.isPostable) throw new JournalError("ACCOUNT_NOT_POSTABLE", `Cuenta ${acc.code} no es posteable`);
        if (!acc.isActive) throw new JournalError("ACCOUNT_INACTIVE", `Cuenta ${acc.code} inactiva`);
      }

      const entryData: Prisma.JournalEntryUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        fiscalYearId: input.fiscalYearId,
        periodId: input.periodId,
        entryDate: new Date(input.entryDate),
        description: input.description,
        sourceType: input.sourceType,
        status: "DRAFT",
        preparedByUserId: ctx.userId,
        lines: {
          create: input.lines.map((l, i) => ({
            firmId: ctx.firmId,
            clientId: input.clientId,
            position: i + 1,
            accountId: l.accountId,
            description: l.description ?? null,
            currencyCode: l.currencyCode,
            debitOriginal: l.debitOriginal,
            creditOriginal: l.creditOriginal,
            exchangeRate: l.exchangeRate ?? null,
            debitFunctional: l.debitFunctional,
            creditFunctional: l.creditFunctional,
          })),
        },
      };
      if (input.reference !== undefined) entryData.reference = input.reference;

      return tx.journalEntry.create({ data: entryData, include: { lines: true } });
    });
  }

  /** Envía a revisión (maker → IN_REVIEW). */
  async submit(ctx: TenantContext, entryId: string) {
    return withTenantContext(ctx, async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, firmId: ctx.firmId },
      });
      if (!entry) throw new JournalError("ENTRY_NOT_FOUND", "Asiento no encontrado");
      if (entry.status !== "DRAFT") throw new JournalError("ENTRY_NOT_EDITABLE", "Sólo borradores se envían a revisión");

      return tx.journalEntry.update({
        where: { id: entryId },
        data: { status: "IN_REVIEW", submittedAt: new Date() },
      });
    });
  }

  /** Aprueba (checker → REVIEWED). */
  async review(ctx: TenantContext, entryId: string) {
    return withTenantContext(ctx, async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, firmId: ctx.firmId },
      });
      if (!entry) throw new JournalError("ENTRY_NOT_FOUND", "Asiento no encontrado");
      if (entry.status !== "IN_REVIEW") throw new JournalError("ENTRY_NOT_REVIEWABLE", "Sólo asientos en revisión se aprueban");
      if (entry.preparedByUserId === ctx.userId) {
        throw new JournalError("ENTRY_NOT_REVIEWABLE", "El preparador no puede aprobar su propio asiento (maker-checker)");
      }

      return tx.journalEntry.update({
        where: { id: entryId },
        data: { status: "REVIEWED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** Rechaza (checker → REJECTED). */
  async reject(ctx: TenantContext, entryId: string) {
    return withTenantContext(ctx, async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, firmId: ctx.firmId },
      });
      if (!entry) throw new JournalError("ENTRY_NOT_FOUND", "Asiento no encontrado");
      if (entry.status !== "IN_REVIEW") throw new JournalError("ENTRY_NOT_REVIEWABLE", "Sólo asientos en revisión se rechazan");

      return tx.journalEntry.update({
        where: { id: entryId },
        data: { status: "REJECTED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /**
   * Postea un asiento (REVIEWED → POSTED).
   * Serializable: asigna secuencia atómicamente con bloqueo de fila.
   */
  async post(ctx: TenantContext, entryId: string, expectedRowVersion: number, idempotencyKey?: string) {
    return withTenantContext(ctx, async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, firmId: ctx.firmId },
        include: { lines: true },
      });
      if (!entry) throw new JournalError("ENTRY_NOT_FOUND", "Asiento no encontrado");
      if (entry.status !== "REVIEWED") throw new JournalError("ENTRY_NOT_POSTABLE", "Sólo asientos aprobados se postean");
      if (entry.rowVersion !== expectedRowVersion) {
        throw new JournalError("ROW_VERSION_CONFLICT", "Conflicto de versión: el asiento fue modificado");
      }

      let idempotencyRecordId: string | null = null;
      if (idempotencyKey) {
        const requestHash = createHash("sha256")
          .update(JSON.stringify({ entryId, expectedRowVersion }))
          .digest("hex");
        const candidateId = randomUUID();
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_records
            (id, "firmId", "clientId", "userId", scope, key, "requestHash", status)
          VALUES
            (${candidateId}, ${ctx.firmId}, ${entry.clientId}, ${ctx.userId}, ${`journal.post:${entryId}`}, ${idempotencyKey}, ${requestHash}, 'PENDING')
          ON CONFLICT ("firmId", scope, key) DO NOTHING
          RETURNING id
        `;
        if (claimed[0]) {
          idempotencyRecordId = claimed[0].id;
        } else {
          const existing = await tx.idempotencyRecord.findUnique({
            where: { firmId_scope_key: { firmId: ctx.firmId, scope: `journal.post:${entryId}`, key: idempotencyKey } },
          });
          if (!existing || existing.requestHash !== requestHash) {
            throw new JournalError("IDEMPOTENCY_CONFLICT", "La clave de idempotencia fue usada con otra solicitud");
          }
          if (existing.status === "COMPLETED" && existing.response) {
            return tx.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
          }
          throw new JournalError("IDEMPOTENCY_CONFLICT", "La operación con esta clave todavía está en curso");
        }
      }

      // Re-validar balance desde la DB (defensa en profundidad)
      const engineLines: EngineLine[] = entry.lines.map((l) => ({
        debitOriginal: l.debitOriginal.toString(),
        creditOriginal: l.creditOriginal.toString(),
        debitFunctional: l.debitFunctional.toString(),
        creditFunctional: l.creditFunctional.toString(),
        ...(l.exchangeRate !== null ? { exchangeRate: l.exchangeRate.toString() } : {}),
      }));
      assertBalanced(engineLines);

      // Asignar secuencia atómicamente (bloqueo de fila del ejercicio)
      const sequenceNumber = await this.nextSequence(tx, ctx.firmId, entry.clientId, entry.fiscalYearId);

      const posted = await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          status: "POSTED",
          sequenceNumber,
          postedByUserId: ctx.userId,
          postedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (idempotencyRecordId) {
        await tx.idempotencyRecord.update({
          where: { id: idempotencyRecordId },
          data: {
            status: "COMPLETED",
            response: JSON.parse(JSON.stringify(posted)) as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          clientId: entry.clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "journal.entry.posted",
          entityType: "JournalEntry",
          entityId: entry.id,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          before: { status: entry.status, rowVersion: entry.rowVersion },
          after: { status: posted.status, rowVersion: posted.rowVersion, sequenceNumber: posted.sequenceNumber },
        },
      });
      return posted;
    });
  }

  /** Revierte un asiento posteado (POSTED → REVERSED + asiento de reversión). */
  async reverse(ctx: TenantContext, entryId: string, description?: string) {
    return withTenantContext(ctx, async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, firmId: ctx.firmId },
        include: { lines: true },
      });
      if (!entry) throw new JournalError("ENTRY_NOT_FOUND", "Asiento no encontrado");
      if (entry.status !== "POSTED") throw new JournalError("ENTRY_NOT_REVERSIBLE", "Sólo asientos posteados se revierten");
      if (entry.reversedByEntryId) throw new JournalError("REVERSAL_EXISTS", "El asiento ya fue revertido");

      // Crear asiento de reversión (débitos ↔ créditos)
      const reversalData: Prisma.JournalEntryUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: entry.clientId,
        fiscalYearId: entry.fiscalYearId,
        periodId: entry.periodId,
        entryDate: new Date(),
        description: description ?? `Reversión de ${entry.description}`,
        sourceType: "MANUAL",
        status: "REVIEWED",
        preparedByUserId: ctx.userId,
        reversalOfId: entry.id,
        lines: {
          create: entry.lines.map((l, i) => ({
            firmId: ctx.firmId,
            clientId: entry.clientId,
            position: i + 1,
            accountId: l.accountId,
            description: l.description,
            currencyCode: l.currencyCode,
            debitOriginal: l.creditOriginal.toString(),
            creditOriginal: l.debitOriginal.toString(),
            exchangeRate: l.exchangeRate,
            debitFunctional: l.creditFunctional.toString(),
            creditFunctional: l.debitFunctional.toString(),
          })),
        },
      };

      const reversalDraft = await tx.journalEntry.create({ data: reversalData });
      const sequenceNumber = await this.nextSequence(tx, ctx.firmId, entry.clientId, entry.fiscalYearId);
      const reversal = await tx.journalEntry.update({
        where: { id: reversalDraft.id },
        data: {
          status: "POSTED",
          sequenceNumber,
          postedByUserId: ctx.userId,
          postedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });

      // Marcar el original como revertido
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: "REVERSED", reversedByEntryId: reversal.id, rowVersion: { increment: 1 } },
      });

      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          clientId: entry.clientId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "journal.entry.reversed",
          entityType: "JournalEntry",
          entityId: entry.id,
          before: { status: "POSTED" },
          after: { status: "REVERSED", reversedByEntryId: reversal.id },
        },
      });

      return reversal;
    });
  }

  /** Asigna el próximo número de secuencia con bloqueo de fila. */
  private async nextSequence(
    tx: Prisma.TransactionClient,
    firmId: string,
    clientId: string,
    fiscalYearId: string,
  ): Promise<number> {
    // Bloquear la fila del ejercicio para serializar la asignación
    await tx.$executeRaw`SELECT id FROM fiscal_years WHERE id = ${fiscalYearId} AND "firmId" = ${firmId} FOR UPDATE`;

    const last = await tx.journalEntry.findFirst({
      where: { clientId, fiscalYearId, sequenceNumber: { not: null } },
      orderBy: { sequenceNumber: "desc" },
      select: { sequenceNumber: true },
    });
    return (last?.sequenceNumber ?? 0) + 1;
  }

  private async assertPeriodOpen(tx: Prisma.TransactionClient, firmId: string, periodId: string) {
    const period = await tx.accountingPeriod.findFirst({ where: { id: periodId, firmId } });
    if (!period) throw new JournalError("PERIOD_CLOSED", "Período no encontrado o cerrado");
    if (period.status !== "OPEN") throw new JournalError("PERIOD_CLOSED", "El período está cerrado");
  }

  private async assertFiscalYearOpen(tx: Prisma.TransactionClient, firmId: string, fiscalYearId: string) {
    const fy = await tx.fiscalYear.findFirst({ where: { id: fiscalYearId, firmId } });
    if (!fy) throw new JournalError("FISCAL_YEAR_CLOSED", "Ejercicio no encontrado o cerrado");
    if (fy.status !== "OPEN") throw new JournalError("FISCAL_YEAR_CLOSED", "El ejercicio está cerrado");
  }
}
