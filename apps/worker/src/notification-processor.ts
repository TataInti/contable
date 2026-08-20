import { withWorkerTenant } from "./lib/prisma.js";

interface NotificationPayload {
  userId?: string;
  firmId?: string;
  clientId?: string;
  type?: string;
  severity?: string;
  title?: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  deduplicationKey?: string;
  [key: string]: unknown;
}

/**
 * F0.7: notificaciones internas (sólo in-app).
 *
 * El job persiste la notificación dentro de una transacción de sistema
 * idempotente (deduplicationKey única por usuario). No se invoca ningún
 * webhook ni proveedor externo. La entrega al cliente se hace por SSE
 * (Fase 2); aquí sólo se garantiza la persistencia durable y auditable.
 */
export async function processNotification(eventType: string, payload: unknown): Promise<void> {
  const body = payload as NotificationPayload;
  const userId = body.userId;
  if (!userId) throw new Error("NOTIFICATION_RECIPIENT_REQUIRED");

  await withWorkerTenant(body.firmId ?? "", body.clientId ?? "", async (tx) => {
      // Idempotencia: si ya existe una notificación con la misma clave de
      // deduplicación para el usuario, no se duplica (reintento seguro).
      if (body.deduplicationKey) {
        const existing = await tx.userNotification.findFirst({
          where: { userId, deduplicationKey: body.deduplicationKey },
          select: { id: true },
        });
        if (existing) return;
      }

      await tx.userNotification.create({
        data: {
          userId,
          ...(body.firmId ? { firmId: body.firmId } : {}),
          ...(body.clientId ? { clientId: body.clientId } : {}),
          type: body.type ?? eventType,
          severity: body.severity ?? "INFO",
          title: body.title ?? eventType,
          ...(body.body ? { body: body.body } : {}),
          ...(body.resourceType ? { resourceType: body.resourceType } : {}),
          ...(body.resourceId ? { resourceId: body.resourceId } : {}),
          ...(body.deduplicationKey ? { deduplicationKey: body.deduplicationKey } : {}),
        },
      });
    },
  );
}
