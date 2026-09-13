import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de trabajo (Fase 8).
 * Pedidos documentales, threads y mensajes.
 *
 * Invariantes:
 * - W-003: completitud del pedido se deriva de los ítems, no es editable.
 * - W-004: nota interna no cambia a compartida sin confirmación explícita.
 */

export type WorkErrorCode =
  | "REQUEST_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "THREAD_NOT_FOUND"
  | "OBLIGATION_NOT_FOUND"
  | "VISIBILITY_CONFIRMATION_REQUIRED"
  | "INVALID_TRANSITION"
  | "ITEM_NOT_REQUIRED";

export class WorkError extends Error {
  readonly code: WorkErrorCode;
  constructor(code: WorkErrorCode, message: string) {
    super(message);
    this.name = "WorkError";
    this.code = code;
  }
}

export class WorkService {
  /** Crea un pedido documental con ítems (F2.2: opcionalmente vinculado a una obligación). */
  async createRequest(
    ctx: TenantContext,
    input: { clientId: string; title: string; description?: string; dueDate?: string; obligationId?: string; items: { description: string; required?: boolean }[] },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // F2.2: si se vincula una obligación, validar que pertenece al cliente.
      if (input.obligationId !== undefined) {
        const obligation = await tx.taxObligation.findFirst({
          where: { id: input.obligationId, firmId: ctx.firmId, clientId: input.clientId },
        });
        if (!obligation) throw new WorkError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");
      }

      const data: Prisma.DocumentRequestUncheckedCreateInput = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        title: input.title,
        createdByUserId: ctx.userId,
      };
      if (input.description !== undefined) data.description = input.description;
      if (input.dueDate !== undefined) data.dueDate = new Date(input.dueDate);
      if (input.obligationId !== undefined) data.obligationId = input.obligationId;

      return tx.documentRequest.create({
        data: {
          ...data,
          items: {
            create: input.items.map((item) => ({
              firmId: ctx.firmId,
              clientId: input.clientId,
              description: item.description,
              required: item.required ?? true,
              status: "PENDING",
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  /** Adjunta un documento a un ítem (W-003: completitud derivada). */
  async attachDocument(ctx: TenantContext, requestId: string, itemId: string, documentId: string) {
    return withTenantContext(ctx, async (tx) => {
      const request = await tx.documentRequest.findFirst({
        where: { id: requestId, firmId: ctx.firmId },
      });
      if (!request) throw new WorkError("REQUEST_NOT_FOUND", "Pedido no encontrado");
      // §5.1: no se puede adjuntar a un pedido DRAFT, COMPLETED o CANCELLED.
      if (!["SENT", "IN_PROGRESS", "READY_FOR_REVIEW"].includes(request.status)) {
        throw new WorkError(
          "INVALID_TRANSITION",
          `No se puede adjuntar a un pedido ${request.status}`,
        );
      }
      const item = await tx.documentRequestItem.findFirst({
        where: { id: itemId, requestId, firmId: ctx.firmId },
      });
      if (!item) throw new WorkError("ITEM_NOT_FOUND", "Ítem no encontrado");

      const updated = await tx.documentRequestItem.update({
        where: { id: itemId },
        data: { status: "ATTACHED", documentId },
      });

      // §5.1: adjuntar el primer requerido mueve el pedido a IN_PROGRESS;
      // adjuntar todos los requeridos lo lleva a READY_FOR_REVIEW (no
      // COMPLETED: la revisión es una acción explícita del estudio).
      const items = await tx.documentRequestItem.findMany({ where: { requestId } });
      const required = items.filter((i) => i.required);
      const attachedRequired = required.filter((i) =>
        ["ATTACHED", "ACCEPTED", "WAIVED"].includes(i.status),
      );
      let nextStatus = request.status;
      if (required.length > 0 && attachedRequired.length === required.length) {
        nextStatus = "READY_FOR_REVIEW";
      } else if (attachedRequired.length > 0) {
        nextStatus = "IN_PROGRESS";
      }
      if (nextStatus !== request.status) {
        await tx.documentRequest.update({
          where: { id: requestId },
          data: { status: nextStatus },
        });
      }
      return updated;
    });
  }

  /** §5.1: envía el pedido (DRAFT → SENT). */
  async sendRequest(ctx: TenantContext, requestId: string) {
    return withTenantContext(ctx, async (tx) => {
      const request = await tx.documentRequest.findFirst({
        where: { id: requestId, firmId: ctx.firmId },
      });
      if (!request) throw new WorkError("REQUEST_NOT_FOUND", "Pedido no encontrado");
      if (request.status !== "DRAFT") {
        throw new WorkError(
          "INVALID_TRANSITION",
          `Sólo un pedido DRAFT puede enviarse (estado actual: ${request.status})`,
        );
      }
      return tx.documentRequest.update({
        where: { id: requestId },
        data: { status: "SENT" },
        include: { items: true },
      });
    });
  }

  /** §5.1: acepta un ítem (READY_FOR_REVIEW → COMPLETED si todos resueltos). */
  async acceptItem(ctx: TenantContext, requestId: string, itemId: string) {
    return this.resolveItem(ctx, requestId, itemId, "ACCEPTED");
  }

  /** §5.1: rechaza un ítem conservando evidencia previa y motivo. */
  async rejectItem(ctx: TenantContext, requestId: string, itemId: string, reason: string) {
    return this.resolveItem(ctx, requestId, itemId, "REJECTED", reason);
  }

  /** §5.1: exime un ítem (no bloquea la completitud). */
  async waiveItem(ctx: TenantContext, requestId: string, itemId: string) {
    return this.resolveItem(ctx, requestId, itemId, "WAIVED");
  }

  private async resolveItem(
    ctx: TenantContext,
    requestId: string,
    itemId: string,
    target: "ACCEPTED" | "REJECTED" | "WAIVED",
    reason?: string,
  ) {
    return withTenantContext(ctx, async (tx) => {
      const request = await tx.documentRequest.findFirst({
        where: { id: requestId, firmId: ctx.firmId },
      });
      if (!request) throw new WorkError("REQUEST_NOT_FOUND", "Pedido no encontrado");
      // §5.1: aceptar/rechazar/eximir exige pedido READY_FOR_REVIEW o
      // IN_PROGRESS (aceptar ítems uno a uno mientras el pedido está en
      // revisión parcial no debe bloquearse).
      if (!["READY_FOR_REVIEW", "IN_PROGRESS"].includes(request.status)) {
        throw new WorkError(
          "INVALID_TRANSITION",
          `Sólo un pedido en revisión permite resolver ítems (estado actual: ${request.status})`,
        );
      }
      const item = await tx.documentRequestItem.findFirst({
        where: { id: itemId, requestId, firmId: ctx.firmId },
      });
      if (!item) throw new WorkError("ITEM_NOT_FOUND", "Ítem no encontrado");
      if (target === "ACCEPTED" && !item.required) {
        throw new WorkError("ITEM_NOT_REQUIRED", "Un ítem opcional no se acepta");
      }

      const updated = await tx.documentRequestItem.update({
        where: { id: itemId },
        data: {
          status: target,
          // §5.1: un ítem rechazado conserva la evidencia previa (documentId
          // no se toca) y registra el motivo en la descripción del ítem.
          ...(target === "REJECTED" && reason
            ? { description: `${item.description} — RECHAZADO: ${reason}` }
            : {}),
        },
      });

      // §5.1: rechazar un ítem devuelve el pedido a IN_PROGRESS; aceptar o
      // eximir todos los requeridos lo completa.
      const items = await tx.documentRequestItem.findMany({ where: { requestId } });
      const required = items.filter((i) => i.required);
      const resolved = required.filter((i) => ["ACCEPTED", "WAIVED"].includes(i.status));
      const nextStatus: "COMPLETED" | "IN_PROGRESS" =
        required.length > 0 && resolved.length === required.length
          ? "COMPLETED"
          : "IN_PROGRESS";
      if (nextStatus !== (request.status as string)) {
        await tx.documentRequest.update({
          where: { id: requestId },
          data: { status: nextStatus },
        });
      }
      return updated;
    });
  }

  /** §5.1: cancela un pedido abierto (no COMPLETED). */
  async cancelRequest(ctx: TenantContext, requestId: string) {
    return withTenantContext(ctx, async (tx) => {
      const request = await tx.documentRequest.findFirst({
        where: { id: requestId, firmId: ctx.firmId },
      });
      if (!request) throw new WorkError("REQUEST_NOT_FOUND", "Pedido no encontrado");
      if (request.status === "COMPLETED" || request.status === "CANCELLED") {
        throw new WorkError(
          "INVALID_TRANSITION",
          `Un pedido ${request.status} no puede cancelarse`,
        );
      }
      return tx.documentRequest.update({
        where: { id: requestId },
        data: { status: "CANCELLED" },
      });
    });
  }

  /** Crea un thread para un pedido. */
  async createThread(ctx: TenantContext, requestId: string, visibility = "INTERNAL") {
    return withTenantContext(ctx, async (tx) => {
      const request = await tx.documentRequest.findFirst({
        where: { id: requestId, firmId: ctx.firmId },
      });
      if (!request) throw new WorkError("REQUEST_NOT_FOUND", "Pedido no encontrado");

      return tx.requestThread.create({
        data: {
          firmId: ctx.firmId,
          clientId: request.clientId,
          requestId,
          visibility,
        },
      });
    });
  }

  /** Agrega un mensaje al thread. */
  async addMessage(ctx: TenantContext, threadId: string, body: string, visibility = "INTERNAL") {
    return withTenantContext(ctx, async (tx) => {
      const thread = await tx.requestThread.findFirst({
        where: { id: threadId, firmId: ctx.firmId },
      });
      if (!thread) throw new WorkError("THREAD_NOT_FOUND", "Thread no encontrado");

      return tx.requestMessage.create({
        data: {
          firmId: ctx.firmId,
          clientId: thread.clientId,
          threadId,
          authorUserId: ctx.userId,
          body,
          visibility,
        },
      });
    });
  }

  /** Cambia visibilidad de un mensaje (W-004: exige confirmación para INTERNAL → SHARED). */
  async changeVisibility(ctx: TenantContext, messageId: string, newVisibility: string, confirmed = false) {
    return withTenantContext(ctx, async (tx) => {
      const message = await tx.requestMessage.findFirst({
        where: { id: messageId, firmId: ctx.firmId },
      });
      if (!message) throw new WorkError("THREAD_NOT_FOUND", "Mensaje no encontrado");

      if (message.visibility === "INTERNAL" && newVisibility === "SHARED" && !confirmed) {
        throw new WorkError("VISIBILITY_CONFIRMATION_REQUIRED", "Se requiere confirmación para compartir una nota interna");
      }

      return tx.requestMessage.update({
        where: { id: messageId },
        data: { visibility: newVisibility },
      });
    });
  }
}