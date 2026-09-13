import type { FastifyInstance } from "fastify";
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
import { z } from "zod";

/**
 * Rutas de firmas, miembros, invitaciones y asignaciones.
 * El contexto de firma se resuelve por ruta; la autorización por capacidad server-side.
 */

export function firmRoutes(app: FastifyInstance) {
  const firms = new FirmRepository();

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

  // El rol es la fuente de verdad del acceso a módulos internos.
  app.patch("/api/v1/firms/:firmId/members/:userId", async (req, reply) => {
    const { firmId, userId } = req.params as { firmId: string; userId: string };
    const body = z
      .object({ role: z.enum(["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]) })
      .strict()
      .parse(req.body);
    const member = await withTenantContext(tenantContextFromRequest(req), async (tx) => {
      const existing = await tx.firmMembership.findUnique({
        where: { firmId_userId: { firmId, userId } },
      });
      if (!existing) return null;
      return tx.firmMembership.update({
        where: { id: existing.id },
        data: { role: body.role },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          acceptedAt: true,
          user: { select: { name: true, emailNormalized: true, status: true } },
        },
      });
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "MEMBER_NOT_FOUND", message: "Usuario interno no encontrado" } });
    }
    return reply.send({ data: member });
  });

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
