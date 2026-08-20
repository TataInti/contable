import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * F2.4: endpoint SSE de notificaciones.
 *
 * Emite eventos de notificaciones internas del usuario autenticado vía
 * Server-Sent Events. El cliente se suscribe a /api/v1/events y recibe las
 * notificaciones no leídas (y las nuevas en tiempo real).
 *
 * El nginx ya declara la ubicación /events con buffering off y read timeout 1h.
 */

const SSE_KEEPALIVE_MS = 25_000;

interface SseClient {
  userId: string;
  reply: FastifyReply;
}

const clients = new Set<SseClient>();

/** Registra un cliente SSE y lo mantiene conectado hasta que se desconecte. */
export function sseRoutes(app: FastifyInstance) {
  app.get("/api/v1/events", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId as string | undefined;
    if (!userId) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "No autenticado" } });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const client: SseClient = { userId, reply };
    clients.add(client);

    // Envía las notificaciones no leídas al conectar (sin tenant context:
    // las notificaciones se filtran por userId, no por firma).
    const pending = await prisma.userNotification.findMany({
      where: { userId, readAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    for (const n of pending) {
      writeEvent(reply, "notification", n);
    }

    try {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, SSE_KEEPALIVE_MS));
        if (reply.raw.socket?.closed) break;
        reply.raw.write(`: keepalive\n\n`);
      }
    } catch {
      // Cliente desconectado.
    } finally {
      clients.delete(client);
    }
    return reply;
  });
}

function writeEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Emite una notificación a todos los streams del usuario (usado por el worker/API). */
export function emitNotification(userId: string, notification: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) {
      writeEvent(client.reply, "notification", notification);
    }
  }
}