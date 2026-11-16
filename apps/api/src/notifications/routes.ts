import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notificationListQuerySchema } from "@contable/contracts";
import { requireAuth } from "../auth/guard.js";
import { NotificationService } from "./service.js";

const idParamsSchema = z.object({
  id: z.string().min(1, { message: "id: indicá el identificador del aviso" }),
});

/**
 * Avisos propios del usuario (corte 3c). Son datos del propio usuario: estas rutas no tienen entrada en
 * ROUTE_POLICY y, por decisión explícita, no exigen capacidad (ver policy-coverage.test.ts). Lo que se ve y se
 * marca lo limitan el usuario y la membresía ACTIVE de cada consulta (service.ts) y la RLS de user_notifications.
 * Sin estudio en la ruta: el guard exige sesión y no busca membresía.
 */
export function notificationRoutes(app: FastifyInstance) {
  const service = new NotificationService();

  app.get("/api/v1/me/notifications", async (req, reply) => {
    const { userId } = await requireAuth(req);
    const query = notificationListQuerySchema.parse(req.query);
    return reply.send(await service.list(userId, query));
  });

  app.get("/api/v1/me/notifications/unread-count", async (req, reply) => {
    const { userId } = await requireAuth(req);
    return reply.send({ data: { count: await service.unreadCount(userId) } });
  });

  app.post("/api/v1/me/notifications/:id/read", async (req, reply) => {
    const { userId } = await requireAuth(req);
    const { id } = idParamsSchema.parse(req.params);
    return reply.send({ data: await service.markRead(userId, id) });
  });

  app.post("/api/v1/me/notifications/:id/archive", async (req, reply) => {
    const { userId } = await requireAuth(req);
    const { id } = idParamsSchema.parse(req.params);
    return reply.send({ data: await service.archive(userId, id) });
  });
}
