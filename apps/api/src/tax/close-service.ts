import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de cierres (Fase 8).
 * Close cycles guiados con work items y checklists.
 * La finalización es versionada e inmutable.
 */

export type CloseErrorCode =
  | "CYCLE_NOT_FOUND"
  | "CYCLE_FINALIZED"
  | "WORK_ITEM_NOT_FOUND"
  | "WORK_ITEM_ALREADY_DONE";

export class CloseError extends Error {
  readonly code: CloseErrorCode;
  constructor(code: CloseErrorCode, message: string) {
    super(message);
    this.name = "CloseError";
    this.code = code;
  }
}

export class CloseService {
  /** Crea un ciclo de cierre con work items por defecto. */
  async createCycle(
    ctx: TenantContext,
    input: { clientId: string; fiscalYearId: string; periodId: string; items: { code: string; title: string }[] },
  ) {
    return withTenantContext(ctx, async (tx) => {
      return tx.closeCycle.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          fiscalYearId: input.fiscalYearId,
          periodId: input.periodId,
          status: "IN_PROGRESS",
          createdByUserId: ctx.userId,
          workItems: {
            create: input.items.map((item) => ({
              firmId: ctx.firmId,
              clientId: input.clientId,
              code: item.code,
              title: item.title,
              status: "PENDING",
            })),
          },
        },
        include: { workItems: true },
      });
    });
  }

  /** Completa un work item. */
  async completeWorkItem(ctx: TenantContext, cycleId: string, workItemId: string) {
    return withTenantContext(ctx, async (tx) => {
      const cycle = await tx.closeCycle.findFirst({ where: { id: cycleId, firmId: ctx.firmId } });
      if (!cycle) throw new CloseError("CYCLE_NOT_FOUND", "Ciclo no encontrado");
      if (cycle.status === "FINALIZED") throw new CloseError("CYCLE_FINALIZED", "Ciclo ya finalizado");

      const item = await tx.closeWorkItem.findFirst({ where: { id: workItemId, cycleId } });
      if (!item) throw new CloseError("WORK_ITEM_NOT_FOUND", "Work item no encontrado");
      if (item.status === "DONE") throw new CloseError("WORK_ITEM_ALREADY_DONE", "Work item ya completado");

      return tx.closeWorkItem.update({
        where: { id: workItemId },
        data: { status: "DONE", completedByUserId: ctx.userId, completedAt: new Date() },
      });
    });
  }

  /** Finaliza el ciclo (versionado e inmutable). */
  async finalizeCycle(ctx: TenantContext, cycleId: string) {
    return withTenantContext(ctx, async (tx) => {
      const cycle = await tx.closeCycle.findFirst({
        where: { id: cycleId, firmId: ctx.firmId },
        include: { workItems: true },
      });
      if (!cycle) throw new CloseError("CYCLE_NOT_FOUND", "Ciclo no encontrado");
      if (cycle.status === "FINALIZED") throw new CloseError("CYCLE_FINALIZED", "Ciclo ya finalizado");

      // Todos los work items deben estar DONE
      const pending = cycle.workItems.filter((w) => w.status !== "DONE");
      if (pending.length > 0) {
        throw new CloseError("WORK_ITEM_NOT_FOUND", `Faltan ${pending.length} work items por completar`);
      }

      return tx.closeCycle.update({
        where: { id: cycleId },
        data: { status: "FINALIZED", version: { increment: 1 } },
      });
    });
  }
}