interface NotificationPayload {
  email?: string;
  token?: string;
  expiresAt?: string;
  invitationId?: string;
  [key: string]: unknown;
}

/**
 * Entrega durable hacia un proveedor desacoplado. El job sólo se confirma con
 * una respuesta 2xx; cualquier falla queda en BullMQ para reintento/DLQ.
 */
export async function processNotification(eventType: string, payload: unknown): Promise<void> {
  const endpoint = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!endpoint) throw new Error("NOTIFICATION_PROVIDER_NOT_CONFIGURED");
  const body = payload as NotificationPayload;
  if (!body.email) throw new Error("NOTIFICATION_RECIPIENT_REQUIRED");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.NOTIFICATION_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.NOTIFICATION_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({ eventType, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`NOTIFICATION_PROVIDER_${response.status}`);
}
