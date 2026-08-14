import type { FastifyInstance } from "fastify";
import { AssistantService, AssistantError } from "./assistant-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { z } from "zod";

/**
 * Rutas del asistente contable (Fase 11).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function assistantRoutes(app: FastifyInstance) {
  const assistant = new AssistantService();
  const tenantCtx = tenantContextFromRequest;

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof AssistantError) {
      const status = err.code === "CONVERSATION_NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // Crear conversación
  app.post("/api/v1/firms/:firmId/clients/:clientId/assistant/conversations", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ periodId: z.string().uuid().optional(), title: z.string().trim().min(1).max(160).optional() }).strict().parse(req.body ?? {});
    try {
      const conversation = await assistant.createConversation(tenantCtx(req), {
        clientId,
        ...(body.periodId ? { periodId: body.periodId } : {}),
        ...(body.title ? { title: body.title } : {}),
      });
      return reply.status(201).send({ data: conversation });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Listar conversaciones
  app.get("/api/v1/firms/:firmId/clients/:clientId/assistant/conversations", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const conversations = await assistant.listConversations(tenantCtx(req), clientId);
    return reply.send({ data: conversations });
  });

  // Enviar turno
  app.post("/api/v1/firms/:firmId/clients/:clientId/assistant/conversations/:conversationId/turns", async (req, reply) => {
    const { conversationId } = req.params as { conversationId: string };
    const body = z.object({ query: z.string().trim().min(1).max(8000) }).strict().parse(req.body);
    try {
      const result = await assistant.sendTurn(tenantCtx(req), { conversationId, query: body.query });
      return reply.status(201).send({ data: result });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Feedback
  app.post("/api/v1/firms/:firmId/clients/:clientId/assistant/turns/:turnId/feedback", async (req, reply) => {
    const { turnId } = req.params as { turnId: string };
    const body = z.object({ rating: z.number().int().min(-1).max(1).optional(), comment: z.string().max(2000).optional() }).strict().parse(req.body ?? {});
    try {
      const feedback = await assistant.addFeedback(tenantCtx(req), {
        turnId,
        ...(body.rating !== undefined ? { rating: body.rating } : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      return reply.status(201).send({ data: feedback });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
