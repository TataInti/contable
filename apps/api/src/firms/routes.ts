import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createFirmSchema,
  createMemberSchema,
  createAssignmentSchema,
  meContextsSchema,
  invitationSchema,
} from "@contable/contracts";
import { FirmRepository } from "./firm-repository.js";
import { AuthError } from "../auth/auth-service.js";
import { prisma } from "../lib/prisma.js";
import { capabilitiesForRole, type FirmRole } from "@contable/permissions";
import { tenantContextFromRequest, withTenantContext } from "../auth/tenant.js";
import {
  AUDITED_REJECTIONS,
  lifecycleHttpError,
  type LifecycleErrorCode,
} from "./member-lifecycle.js";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "../auth/password.js";

const createInternalUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]),
}).strict();

const internalRoleSchema = z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]);

// Motivo opcional del ciclo de vida (viaja al evento de auditoría; se trunca a 500 en SQL).
const memberLifecycleReasonSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

// Recuperación de acceso: vigencia del enlace, en minutos (5 min .. 24 h).
const accessRecoveryRequestSchema = z.object({
  ttlMinutes: z.number().int().min(5).max(1440).optional(),
}).strict();

/**
 * Rutas de firmas, miembros, invitaciones y asignaciones.
 * El contexto de firma se resuelve por ruta; la autorización por capacidad server-side.
 */

export function firmRoutes(app: FastifyInstance) {
  const firms = new FirmRepository();

  /** Audita un intento rechazado de administración de miembros (actor/acción). */
  const auditMemberRejection = async (
    req: FastifyRequest,
    firmId: string,
    targetUserId: string,
    code: LifecycleErrorCode,
  ): Promise<void> => {
    const action = AUDITED_REJECTIONS[code];
    if (!action) return;
    await withTenantContext(tenantContextFromRequest(req), (tx) =>
      tx.auditEvent.create({
        data: {
          firmId,
          userId: req.userId!,
          actorKind: "USER",
          action,
          entityType: "FirmMembership",
          entityId: targetUserId,
          after: { rejection: code },
        },
      }),
    );
  };

  /**
   * Mapea un error SQL del ciclo de vida a la respuesta HTTP correspondiente.
   * Audita los intentos rechazados sensibles (OWNER protegido, último
   * administrador, objetivo propio). Devuelve true cuando quedó manejado.
   */
  const handleLifecycleError = async (
    req: FastifyRequest,
    reply: FastifyReply,
    firmId: string,
    targetUserId: string,
    error: unknown,
  ): Promise<boolean> => {
    const mapped = lifecycleHttpError(String(error));
    if (!mapped) return false;
    if (AUDITED_REJECTIONS[mapped.code]) {
      await auditMemberRejection(req, firmId, targetUserId, mapped.code);
    }
    await reply.status(mapped.statusCode).send({
      error: { code: mapped.code, message: mapped.message },
    });
    return true;
  };

  app.get("/api/v1/firms/:firmId/dashboard", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, async (tx) => {
      const [clients, documents, extracted, processing, requests, obligations] = await Promise.all([
        tx.client.count({ where: { firmId: ctx.firmId } }),
        tx.document.count({ where: { firmId: ctx.firmId } }),
        tx.document.count({ where: { firmId: ctx.firmId, status: "EXTRACTED" } }),
        tx.document.count({ where: { firmId: ctx.firmId, status: { in: ["UPLOADED", "VALIDATING"] } } }),
        tx.documentRequest.count({ where: { firmId: ctx.firmId, status: { not: "COMPLETED" } } }),
        tx.obligationInstance.count({ where: { firmId: ctx.firmId, status: "PENDING" } }),
      ]);
      return { clients, documents, extracted, processing, openRequests: requests, pendingObligations: obligations };
    });
    return reply.send({ data });
  });

  // Contextos del usuario (estudios, roles, clientes)
  app.get("/api/v1/me/contexts", async (req, reply) => {
    const userId = (req as unknown as { userId?: string }).userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Sin sesión" } });
    }
    const memberships = await prisma.$queryRaw<{ firmId: string; firmName: string; role: FirmRole }[]>`
      SELECT * FROM app_internal_contexts(${userId})
    `;
    const firmsData = [];
    for (const m of memberships) {
      // Clientes de la firma (RLS: visible para miembros activos)
      const clients = await withTenantContext(
        { userId, firmId: m.firmId, actorKind: "USER" },
        (tx) => tx.client.findMany({
          where: { firmId: m.firmId },
          select: {
            id: true,
            legalName: true,
            fiscalYears: {
              select: { label: true, periods: { select: { id: true, ordinal: true, status: true }, orderBy: { ordinal: "asc" } } },
              orderBy: { startDate: "desc" },
            },
          },
          orderBy: { legalName: "asc" },
          take: 200,
        }),
      );
      firmsData.push({
        firmId: m.firmId,
        firmName: m.firmName,
        role: m.role,
        capabilities: [...capabilitiesForRole(m.role)],
        clients: clients.map((c) => ({
          clientId: c.id,
          clientName: c.legalName,
          periods: c.fiscalYears.flatMap((fy) =>
            fy.periods.map((period) => ({ periodId: period.id, label: `${fy.label} · ${period.ordinal}`, status: period.status })),
          ),
        })),
      });
    }
    const result = meContextsSchema.parse({
      userId,
      isPlatformAdmin: req.isPlatformAdmin === true,
      mustChangePassword: req.mustChangePassword === true,
      firms: firmsData,
    });
    return reply.send({ data: result });
  });

  // Alta de firma (admin de plataforma)
  app.post("/api/v1/firms", async (req, reply) => {
    const body = createFirmSchema.parse(req.body);
    const actorId = (req as unknown as { userId?: string }).userId;
    if (!actorId) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Sin sesión" } });
    }
    if (!req.isPlatformAdmin) {
      return reply.status(403).send({ error: { code: "PLATFORM_ADMIN_REQUIRED", message: "Se requiere administración de plataforma" } });
    }
    const firm = await firms.createFirmForExistingOwner({
      actorId,
      legalName: body.legalName,
      displayName: body.displayName,
      taxId: body.taxId ?? null,
    });
    if (!firm) return reply.status(403).send({ error: { code: "PLATFORM_ADMIN_REQUIRED", message: "No autorizado" } });
    return reply.status(201).send({ data: firm });
  });

  // Agregar miembro
  app.post("/api/v1/firms/:firmId/members", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const body = createMemberSchema.parse(req.body);
    try {
      const membership = await firms.addMember(firmId, body.userId, body.role, tenantContextFromRequest(req));
      return reply.status(201).send({ data: membership });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      return reply.status(409).send({ error: { code: "MEMBER_EXISTS", message: "Ya es miembro" } });
    }
  });

  // Lista de usuarios internos del estudio. La capacidad requerida se resuelve
  // en el guard: sólo OWNER/ADMIN pueden ver y editar esta colección.
  app.get("/api/v1/firms/:firmId/members", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const members = await withTenantContext(tenantContextFromRequest(req), (tx) =>
      tx.firmMembership.findMany({
        where: { firmId },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          acceptedAt: true,
          user: { select: { name: true, emailNormalized: true, status: true } },
        },
        orderBy: [{ status: "asc" }, { role: "asc" }, { acceptedAt: "asc" }],
      }),
    );
    return reply.send({ data: members });
  });

  app.post("/api/v1/firms/:firmId/users", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const body = createInternalUserSchema.parse(req.body);
    const temporaryPassword = randomBytes(24).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      const rows = await prisma.$queryRaw<{ userId: string }[]>`
        SELECT * FROM app_create_internal_user(
          ${req.userId!}, ${firmId}, ${body.email}, ${body.name},
          ${passwordHash}, ${body.role}::"FirmRole"
        )
      `;
      if (!rows[0]) return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
      const created = rows[0];
      // Alta interna auditada: actor, acción y rol asignado (sin datos sensibles).
      await withTenantContext(tenantContextFromRequest(req), (tx) =>
        tx.auditEvent.create({
          data: {
            firmId,
            userId: req.userId!,
            actorKind: "USER",
            action: "internal_user.created",
            entityType: "User",
            entityId: created.userId,
            after: { role: body.role },
          },
        }),
      );
      return reply.status(201).send({ data: {
        userId: created.userId, email: body.email, name: body.name,
        role: body.role, temporaryPassword,
      } });
    } catch (error) {
      if (String(error).includes("USER_EXISTS") || String(error).includes("23505")) {
        return reply.status(409).send({ error: { code: "USER_EXISTS", message: "Ya existe una cuenta con ese email" } });
      }
      throw error;
    }
  });

  // El rol es la fuente de verdad del acceso a módulos internos. La operación
  // vive en SQL (app_change_internal_member_role): guard de último administrador
  // bajo advisory lock, OWNER protegido (un ADMIN no modifica a un OWNER),
  // revocación de sesiones al degradar y auditoría actor/acción.
  app.patch("/api/v1/firms/:firmId/members/:userId", async (req, reply) => {
    const { firmId, userId } = req.params as { firmId: string; userId: string };
    const body = z.object({ role: internalRoleSchema }).strict().parse(req.body);
    try {
      const rows = await prisma.$queryRaw<{ userId: string; membershipId: string; role: string; outcome: string }[]>`
        SELECT "userId", "membershipId", role, outcome
        FROM app_change_internal_member_role(
          ${req.userId!}, ${firmId}, ${userId}, ${body.role}::"FirmRole"
        )`;
      if (!rows[0]) {
        return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
      }
      const member = await withTenantContext(tenantContextFromRequest(req), (tx) =>
        tx.firmMembership.findUnique({
          where: { firmId_userId: { firmId, userId } },
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            acceptedAt: true,
            user: { select: { name: true, emailNormalized: true, status: true } },
          },
        }),
      );
      if (!member) {
        return reply.status(404).send({ error: { code: "MEMBER_NOT_FOUND", message: "Usuario interno no encontrado" } });
      }
      return reply.send({ data: member });
    } catch (error) {
      if (await handleLifecycleError(req, reply, firmId, userId, error)) return reply;
      throw error;
    }
  });

  // Baja reversible (suspensión) de un miembro interno. Las invariantes de
  // autorización, guard de último administrador, revocación de sesiones y
  // auditoría viven en SQL (app_suspend_internal_member). Sin hard-delete:
  // el estado es la baja y el historial se conserva.
  app.post("/api/v1/firms/:firmId/members/:userId/suspend", async (req, reply) => {
    const { firmId, userId } = req.params as { firmId: string; userId: string };
    const body = memberLifecycleReasonSchema.parse(req.body ?? {});
    try {
      const rows = await prisma.$queryRaw<{ userId: string; membershipId: string; status: string }[]>`
        SELECT "userId", "membershipId", status
        FROM app_suspend_internal_member(${req.userId!}, ${firmId}, ${userId}, ${body.reason ?? null})`;
      if (!rows[0]) {
        return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
      }
      return reply.send({ data: rows[0] });
    } catch (error) {
      if (await handleLifecycleError(req, reply, firmId, userId, error)) return reply;
      throw error;
    }
  });

  // Reactivación explícita de un miembro suspendido. El admin debe pedirla:
  // no hay re-creación de sesiones, el usuario reingresa con login nuevo.
  app.post("/api/v1/firms/:firmId/members/:userId/reactivate", async (req, reply) => {
    const { firmId, userId } = req.params as { firmId: string; userId: string };
    const body = memberLifecycleReasonSchema.parse(req.body ?? {});
    try {
      const rows = await prisma.$queryRaw<{ userId: string; membershipId: string; status: string }[]>`
        SELECT "userId", "membershipId", status
        FROM app_reactivate_internal_member(${req.userId!}, ${firmId}, ${userId}, ${body.reason ?? null})`;
      if (!rows[0]) {
        return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
      }
      return reply.send({ data: rows[0] });
    } catch (error) {
      if (await handleLifecycleError(req, reply, firmId, userId, error)) return reply;
      throw error;
    }
  });

  // Renovación de claves: recuperación segura de acceso para un miembro
  // interno, iniciada por el admin. La autorización, OWNER-protegido, la
  // invalidación de tokens pendientes previos, la revocación de sesiones y la
  // auditoría viven en SQL (app_create_member_access_recovery). El token se
  // genera acá, se devuelve UNA sola vez en la respuesta y se persiste sólo
  // su hash SHA-256. Nunca se loguea: el gestor no ve ni define la contraseña;
  // el propio usuario la define con el enlace.
  app.post(
    "/api/v1/firms/:firmId/members/:userId/access-recovery",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { firmId, userId } = req.params as { firmId: string; userId: string };
      const body = accessRecoveryRequestSchema.parse(req.body ?? {});
      const recoveryToken = randomBytes(32).toString("base64url");
      const tokenHashValue = createHash("sha256").update(recoveryToken).digest("hex");
      try {
        const rows = await prisma.$queryRaw<
          { recoveryId: string; expiresAt: Date; sessionsRevoked: number }[]
        >`
          SELECT "recoveryId", "expiresAt", "sessionsRevoked"
          FROM app_create_member_access_recovery(
            ${req.userId!}, ${firmId}, ${userId}, ${tokenHashValue}, ${body.ttlMinutes ?? 30}
          )`;
        if (!rows[0]) {
          return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
        }
        const created = rows[0];
        return reply.status(201).send({
          data: {
            recoveryId: created.recoveryId,
            expiresAt: created.expiresAt,
            sessionsRevoked: created.sessionsRevoked,
            // Token en claro: única aparición, sólo en esta respuesta.
            recoveryToken,
          },
        });
      } catch (error) {
        if (await handleLifecycleError(req, reply, firmId, userId, error)) return reply;
        throw error;
      }
    },
  );

  // Revocación explícita de un enlace pendiente (por ejemplo, si se generó por
  // error). La verificación de actor y estado pendiente vive en SQL
  // (app_revoke_member_access_recovery) con auditoría.
  app.post(
    "/api/v1/firms/:firmId/members/:userId/access-recovery/:recoveryId/revoke",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const { firmId, userId, recoveryId } = req.params as {
        firmId: string; userId: string; recoveryId: string;
      };
      const body = memberLifecycleReasonSchema.parse(req.body ?? {});
      try {
        const rows = await prisma.$queryRaw<{ recoveryId: string; outcome: string }[]>`
          SELECT "recoveryId", outcome
          FROM app_revoke_member_access_recovery(
            ${req.userId!}, ${firmId}, ${recoveryId}, ${body.reason ?? null}
          )`;
        if (!rows[0]) {
          return reply.status(403).send({ error: { code: "CAPABILITY_REQUIRED", message: "No autorizado" } });
        }
        return reply.send({ data: rows[0] });
      } catch (error) {
        if (await handleLifecycleError(req, reply, firmId, userId, error)) return reply;
        throw error;
      }
    },
  );

  // Asignar cliente a usuario
  app.post("/api/v1/firms/:firmId/clients/:clientId/assignments", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createAssignmentSchema.parse(req.body);
    const assignment = await firms.assignClient(firmId, body.userId, clientId, tenantContextFromRequest(req));
    return reply.status(201).send({ data: assignment });
  });

  app.post("/api/v1/firms/:firmId/invitations", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const body = invitationSchema.parse(req.body);
    const actorId = req.userId!;
    const rows = await prisma.$queryRaw<{ id: string; userId: string; status: string }[]>`
      SELECT * FROM app_invite_internal_member(${actorId}, ${firmId}, ${body.email}, ${body.role}::"FirmRole")
    `;
    const invitation = rows[0];
    if (!invitation) {
      return reply.status(404).send({ error: { code: "INVITEE_NOT_FOUND", message: "La persona debe crear su cuenta antes de ser invitada" } });
    }
    return reply.status(201).send({ data: { id: invitation.id, firmId, email: body.email, role: body.role, status: invitation.status } });
  });

  app.get("/api/v1/me/invitations", async (req, reply) => {
    const data = await prisma.$queryRaw<{ firmId: string; firmName: string; role: string }[]>`
      SELECT * FROM app_pending_internal_invitations(${req.userId!})
    `;
    return reply.send({ data });
  });

  app.post("/api/v1/me/invitations/:firmId/accept", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const rows = await prisma.$queryRaw<{ accepted: boolean }[]>`
      SELECT app_accept_internal_invitation(${req.userId!}, ${firmId}) AS accepted
    `;
    if (!rows[0]?.accepted) return reply.status(404).send({ error: { code: "INVITATION_NOT_FOUND", message: "Invitación no encontrada" } });
    return reply.send({ data: { status: "ACTIVE", firmId } });
  });
}
