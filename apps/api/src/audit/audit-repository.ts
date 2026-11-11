import { prisma } from "../lib/prisma.js";

export interface AuditInput {
  firmId?: string;
  clientId?: string;
  userId?: string;
  actorKind: "USER" | "PLATFORM_ADMIN" | "SYSTEM";
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  idempotencyKey?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Auditoría append-only (plan sección 6.4 / 19.8).
 * - Los eventos no se editan ni eliminan.
 * - Datos sensibles (CUIT, email, nombre, documento, cuenta) se redactan antes de persistir.
 * - Guarda before/after de las mutaciones.
 */

const SENSITIVE_FIELDS = new Set([
  "passwordHash",
  "mfaSecretEncrypted",
  "refreshTokenHash",
  "cuit",
  "email",
  "emailNormalized",
  "phone",
  "backupCodesHash",
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export class AuditRepository {
  async record(input: AuditInput): Promise<void> {
    const data: {
      firmId?: string;
      clientId?: string;
      userId?: string;
      actorKind: string;
      action: string;
      entityType: string;
      entityId?: string;
      requestId?: string;
      idempotencyKey?: string;
      before?: object;
      after?: object;
    } = {
      actorKind: input.actorKind,
      action: input.action,
      entityType: input.entityType,
    };
    if (input.firmId !== undefined) data.firmId = input.firmId;
    if (input.clientId !== undefined) data.clientId = input.clientId;
    if (input.userId !== undefined) data.userId = input.userId;
    if (input.entityId !== undefined) data.entityId = input.entityId;
    if (input.requestId !== undefined) data.requestId = input.requestId;
    if (input.idempotencyKey !== undefined) data.idempotencyKey = input.idempotencyKey;
    if (input.before !== undefined) data.before = redact(input.before) as object;
    if (input.after !== undefined) data.after = redact(input.after) as object;

    await prisma.auditEvent.create({ data });
  }

  /** Lista eventos de una firma (para el visor de auditoría). */
  async listForFirm(firmId: string, limit = 50) {
    return prisma.auditEvent.findMany({
      where: { firmId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}