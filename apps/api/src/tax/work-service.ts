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
  | "VISIBILITY_CONFIRMATION_REQUIRED";

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
      const item = await tx.documentRequestItem.findFirst({
        where: { id: itemId, requestId, firmId: ctx.firmId },
      });
      if (!item) throw new WorkError("ITEM_NOT_FOUND", "Ítem no encontrado");

      const updated = await tx.documentRequestItem.update({
        where: { id: itemId },
        data: { status: "ATTACHED", documentId },
      });

      // Completitud derivada: si todos los ítems requeridos están ATTACHED, el pedido está COMPLETED
      const items = await tx.documentRequestItem.findMany({ where: { requestId } });
      const required = items.filter((i) => i.required);
      const allDone = required.every((i) => i.status === "ATTACHED");
      if (allDone) {
        await tx.documentRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED" },
        });
      }

      return updated;
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