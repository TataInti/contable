import { z } from "zod";

/**
 * Avisos propios del usuario (corte 3c): contratos de lectura y marcado de los avisos de vencimiento.
 * Un solo nombre por concepto (P3): «aviso». Cada error indica el campo y el motivo (P4).
 *
 * Convención de origen: un aviso de vencimiento apunta a su obligación con resourceType «TAX_OBLIGATION» y
 * resourceId igual al id de la obligación. La produce el corte 3b; la API solo lee y marca.
 */

/** Tipos de aviso que la API lista y cuenta. Los fija el servidor: nunca salen de texto libre del usuario. */
export const DUE_ALERT_NOTIFICATION_TYPES = ["DUE_ALERT", "DUE_OVERDUE"] as const;
export type DueAlertNotificationType = (typeof DUE_ALERT_NOTIFICATION_TYPES)[number];

export const NOTIFICATION_DEFAULT_LIMIT = 20;
export const NOTIFICATION_MAX_LIMIT = 50;

const LIMIT_MESSAGE = `limit: indicá un número entero entre 1 y ${NOTIFICATION_MAX_LIMIT}`;
const OFFSET_MESSAGE = "offset: indicá un número entero desde 0";

/** Consulta del listado: GET /api/v1/me/notifications?limit=&offset= */
export const notificationListQuerySchema = z.object({
  limit: z.coerce
    .number({ message: LIMIT_MESSAGE })
    .int({ message: LIMIT_MESSAGE })
    .min(1, { message: LIMIT_MESSAGE })
    .max(NOTIFICATION_MAX_LIMIT, { message: LIMIT_MESSAGE })
    .default(NOTIFICATION_DEFAULT_LIMIT),
  offset: z.coerce
    .number({ message: OFFSET_MESSAGE })
    .int({ message: OFFSET_MESSAGE })
    .min(0, { message: OFFSET_MESSAGE })
    .default(0),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/** Aviso tal como lo devuelve la API. dueDate es AAAA-MM-DD (día calendario guardado en medianoche UTC). */
export const notificationItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(DUE_ALERT_NOTIFICATION_TYPES),
  severity: z.string().min(1),
  title: z.string(),
  body: z.string().nullable(),
  firmId: z.string().min(1),
  firmName: z.string(),
  clientId: z.string().min(1),
  clientName: z.string().nullable(),
  obligationId: z.string().min(1),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** Respuesta del listado: {data, meta: {limit, offset, total}}. */
export const notificationListResponseSchema = z.object({
  data: z.array(notificationItemSchema),
  meta: z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    total: z.number().int(),
  }),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/** Respuesta del contador: {data: {count}}. Cuenta no leídos visibles (sin presentadas ni archivados). */
export const notificationUnreadCountResponseSchema = z.object({
  data: z.object({ count: z.number().int().min(0) }),
});
export type NotificationUnreadCountResponse = z.infer<typeof notificationUnreadCountResponseSchema>;

/** Respuesta de marcar como leído: {data: {id, readAt}}. */
export const notificationReadResponseSchema = z.object({
  data: z.object({ id: z.string().min(1), readAt: z.string().datetime() }),
});
export type NotificationReadResponse = z.infer<typeof notificationReadResponseSchema>;

/** Respuesta de archivar: {data: {id, archivedAt}}. */
export const notificationArchiveResponseSchema = z.object({
  data: z.object({ id: z.string().min(1), archivedAt: z.string().datetime() }),
});
export type NotificationArchiveResponse = z.infer<typeof notificationArchiveResponseSchema>;
