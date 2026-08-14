import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de obligaciones (Fase 8).
 *
 * Invariantes:
 * - Recurrencias no duplican obligaciones (unique obligationId + periodLabel).
 * - W-001: recordatorio no se duplica (unique reminderId + instanceId).
 * - W-002: reintento no duplica email (conserva fila con attempts).
 */

export type ObligationErrorCode =
  | "OBLIGATION_NOT_FOUND"
  | "INSTANCE_EXISTS"
  | "REMINDER_EXISTS";

export class ObligationError extends Error {
  readonly code: ObligationErrorCode;
  constructor(code: ObligationErrorCode, message: string) {
    super(message);
    this.name = "ObligationError";
    this.code = code;
  }
}

export class ObligationService {
  /** Crea una obligación versionada. */
  async createObligation(
    ctx: TenantContext,
    input: {
      clientId: string;
      code: string;
      name: string;
      jurisdiction?: string;
      frequency?: string;
      dueDay?: number;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const data: Prisma.ObligationUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        code: input.code,
        name: input.name,
      };
      if (input.jurisdiction !== undefined) data.jurisdiction = input.jurisdiction;
      if (input.frequency !== undefined) data.frequency = input.frequency;
      if (input.dueDay !== undefined) data.dueDay = input.dueDay;
      return tx.obligation.create({ data });
    });
  }

  /**
   * Materializa una instancia recurrente (idempotente por obligationId + periodLabel).
   */
  async materializeInstance(
    ctx: TenantContext,
    input: { obligationId: string; periodLabel: string; dueDate: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const obligation = await tx.obligation.findFirst({
        where: { id: input.obligationId, firmId: ctx.firmId },
      });
      if (!obligation) throw new ObligationError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");

      // Idempotencia: si ya existe la instancia, no duplicar
      const existing = await tx.obligationInstance.findUnique({
        where: { obligationId_periodLabel: { obligationId: input.obligationId, periodLabel: input.periodLabel } },
      });
      if (existing) throw new ObligationError("INSTANCE_EXISTS", "Instancia ya materializada");

      return tx.obligationInstance.create({
        data: {
          firmId: ctx.firmId,
          clientId: obligation.clientId,
          obligationId: input.obligationId,
          periodLabel: input.periodLabel,
          dueDate: new Date(input.dueDate),
          status: "PENDING",
          materializedBy: "SCHEDULER",
        },
      });
    });
  }

  /**
   * Programa un recordatorio idempotente (W-001: unique reminderId + instanceId).
   */
  async scheduleReminder(
    ctx: TenantContext,
    input: { obligationId: string; instanceId: string; scheduledFor: string; rule?: string; offsetDays?: number; channel?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const obligation = await tx.obligation.findFirst({
        where: { id: input.obligationId, firmId: ctx.firmId },
      });
      if (!obligation) throw new ObligationError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");

      // Crear o reutilizar reminder
      let reminder = await tx.obligationReminder.findFirst({
        where: { obligationId: input.obligationId, instanceId: input.instanceId },
      });
      if (!reminder) {
        const data: Prisma.ObligationReminderUncheckedCreateInput = {
          firmId: ctx.firmId,
          clientId: obligation.clientId,
          obligationId: input.obligationId,
          instanceId: input.instanceId,
        };
        if (input.rule !== undefined) data.rule = input.rule;
        if (input.offsetDays !== undefined) data.offsetDays = input.offsetDays;
        if (input.channel !== undefined) data.channel = input.channel;
        reminder = await tx.obligationReminder.create({ data });
      }

      // Dispatch idempotente (W-001)
      const existing = await tx.reminderDispatch.findUnique({
        where: { reminderId_instanceId: { reminderId: reminder.id, instanceId: input.instanceId } },
      });
      if (existing) throw new ObligationError("REMINDER_EXISTS", "Recordatorio ya programado");

      return tx.reminderDispatch.create({
        data: {
          firmId: ctx.firmId,
          clientId: obligation.clientId,
          reminderId: reminder.id,
          instanceId: input.instanceId,
          scheduledFor: new Date(input.scheduledFor),
          status: "PENDING",
        },
      });
    });
  }

  /** Reintenta un dispatch fallido sin duplicar (W-002). */
  async retryDispatch(ctx: TenantContext, dispatchId: string) {
    return withTenantContext(ctx, async (tx) => {
      const dispatch = await tx.reminderDispatch.findFirst({
        where: { id: dispatchId, firmId: ctx.firmId },
      });
      if (!dispatch) throw new ObligationError("OBLIGATION_NOT_FOUND", "Dispatch no encontrado");

      // Conserva la fila, incrementa attempts (W-002)
      return tx.reminderDispatch.update({
        where: { id: dispatchId },
        data: { attempts: { increment: 1 }, status: "PENDING", error: null },
      });
    });
  }
}