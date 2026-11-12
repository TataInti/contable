import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const enabled = process.env.C5A_USERS_API_IT === "1";
const ownerDatabaseUrl = process.env.C5A_USERS_API_ADMIN_DATABASE_URL ?? "postgresql://invalid";
const adminPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerDatabaseUrl }) });

const FIRM_ID = randomUUID();
const OTHER_FIRM_ID = randomUUID();
const OWNER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const MEMBER_ID = randomUUID();
const COLLISION_USER_ID = randomUUID();
const PORTAL_USER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();
const CLIENT_ID = randomUUID();
const PORTAL_MEMBERSHIP_ID = randomUUID();
const CSRF = "csrf-c5a-users-api-test-token-0123456789";

let app: FastifyInstance | null = null;
let ownerToken = "";
let adminToken = "";
let memberToken = "";
let portalToken = "";
const refreshTokens: string[] = [];
const memberEmail = `member.${MEMBER_ID}@c5a.test.invalid`;
const updatedMemberEmail = `new.member.${MEMBER_ID}@c5a.test.invalid`;
const collisionEmail = `collision.${COLLISION_USER_ID}@c5a.test.invalid`;
const portalEmail = `portal.${PORTAL_USER_ID}@c5a.test.invalid`;
const otherEmail = `other.${OTHER_USER_ID}@c5a.test.invalid`;

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  refreshTokens.push(token);
  await adminPrisma.deviceSession.create({
    data: {
      id: randomUUID(),
      userId,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  });
}

async function sessionRevoked(token: string): Promise<boolean> {
  const session = await adminPrisma.deviceSession.findUniqueOrThrow({
    where: { refreshTokenHash: sha256(token) },
    select: { revokedAt: true },
  });
  return session.revokedAt !== null;
}

beforeAll(async () => {
  if (!enabled) return;
  if (!process.env.DATABASE_URL || !process.env.C5A_USERS_API_ADMIN_DATABASE_URL) {
    throw new Error("C5A_USERS_API_IT requiere DATABASE_URL runtime y C5A_USERS_API_ADMIN_DATABASE_URL owner");
  }

  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  await adminPrisma.firm.createMany({
    data: [
      { id: FIRM_ID, legalName: "C5a Estudio", displayName: "C5a", taxId: "20-12345678-9", timezone: "UTC" },
      { id: OTHER_FIRM_ID, legalName: "C5a Otro Estudio", displayName: "C5a Otro" },
    ],
  });
  await adminPrisma.user.createMany({
    data: [
      { id: OWNER_ID, emailNormalized: `owner.${OWNER_ID}@c5a.test.invalid`, name: "Titular C5a", passwordHash: "synthetic-test-hash" },
      { id: ADMIN_ID, emailNormalized: `admin.${ADMIN_ID}@c5a.test.invalid`, name: "Admin C5a", passwordHash: "synthetic-test-hash" },
      { id: MEMBER_ID, emailNormalized: memberEmail, name: "Miembro C5a", passwordHash: "synthetic-test-hash" },
      { id: COLLISION_USER_ID, emailNormalized: collisionEmail, name: "Colisión C5a", passwordHash: "synthetic-test-hash" },
      { id: PORTAL_USER_ID, emailNormalized: portalEmail, name: "Portal C5a", passwordHash: "synthetic-test-hash" },
      { id: OTHER_USER_ID, emailNormalized: otherEmail, name: "Usuario otro estudio", passwordHash: "synthetic-test-hash" },
    ],
  });
  await adminPrisma.firmMembership.createMany({
    data: [
      { id: randomUUID(), firmId: FIRM_ID, userId: OWNER_ID, role: "OWNER", status: "ACTIVE", acceptedAt: new Date() },
      { id: randomUUID(), firmId: FIRM_ID, userId: ADMIN_ID, role: "ADMIN", status: "ACTIVE", acceptedAt: new Date() },
      { id: randomUUID(), firmId: FIRM_ID, userId: MEMBER_ID, role: "PREPARER", status: "ACTIVE", acceptedAt: new Date() },
      { id: randomUUID(), firmId: OTHER_FIRM_ID, userId: OTHER_USER_ID, role: "OWNER", status: "ACTIVE", acceptedAt: new Date() },
    ],
  });
  await adminPrisma.client.create({
    data: { id: CLIENT_ID, firmId: FIRM_ID, legalName: "Cliente sintético C5a", cuit: "20987654321", status: "ACTIVE" },
  });
  await adminPrisma.portalMembership.create({
    data: {
      id: PORTAL_MEMBERSHIP_ID,
      firmId: FIRM_ID,
      clientId: CLIENT_ID,
      userId: PORTAL_USER_ID,
      role: "COLLABORATOR",
      status: "ACTIVE",
      acceptedAt: new Date(),
    },
  });

  ownerToken = await createSession(OWNER_ID);
  adminToken = await createSession(ADMIN_ID);
  memberToken = await createSession(MEMBER_ID);
  portalToken = await createSession(PORTAL_USER_ID);
});

afterAll(async () => {
  if (enabled) {
    await app?.close();
    await adminPrisma.clientAssignment.deleteMany({ where: { firmId: FIRM_ID } });
    await adminPrisma.portalMembership.deleteMany({ where: { firmId: FIRM_ID } });
    await adminPrisma.deviceSession.deleteMany({ where: { userId: { in: [OWNER_ID, ADMIN_ID, MEMBER_ID, PORTAL_USER_ID] } } });
    await adminPrisma.client.deleteMany({ where: { firmId: FIRM_ID } });
    await adminPrisma.firmMembership.deleteMany({ where: { firmId: { in: [FIRM_ID, OTHER_FIRM_ID] } } });
    await adminPrisma.firm.deleteMany({ where: { id: { in: [FIRM_ID, OTHER_FIRM_ID] } } });
    await adminPrisma.user.deleteMany({ where: { id: { in: [OWNER_ID, ADMIN_ID, MEMBER_ID, COLLISION_USER_ID, PORTAL_USER_ID, OTHER_USER_ID] } } });
    await adminPrisma.$disconnect();
  }
});

describe.skipIf(!enabled)("C5a usuarios, accesos y firma — HTTP/RLS real", () => {
  it("edita identidad, preserva userId, devuelve 403 por rol y reporta correo global duplicado", async () => {
    const updated = await request("PATCH", `/api/v1/firms/${FIRM_ID}/users/${MEMBER_ID}`, adminToken, {
      name: "Miembro actualizado",
      email: `  ${updatedMemberEmail.toUpperCase()}  `,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ userId: MEMBER_ID, name: "Miembro actualizado", emailNormalized: updatedMemberEmail });
    const stored = await adminPrisma.user.findUniqueOrThrow({ where: { id: MEMBER_ID } });
    expect(stored.id).toBe(MEMBER_ID);
    expect(stored.emailNormalized).toBe(updatedMemberEmail);

    const audit = await adminPrisma.auditEvent.findFirstOrThrow({
      where: { firmId: FIRM_ID, userId: ADMIN_ID, entityType: "User", entityId: MEMBER_ID, action: "internal_user.identity_updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.before).toMatchObject({ name: "Miembro C5a", emailNormalized: "[REDACTED]" });
    expect(audit.after).toMatchObject({ name: "Miembro actualizado", emailNormalized: "[REDACTED]" });
    expect(JSON.stringify([audit.before, audit.after])).not.toContain(updatedMemberEmail);

    const denied = await request("PATCH", `/api/v1/firms/${FIRM_ID}/users/${MEMBER_ID}`, memberToken, { name: "No autorizado" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("CAPABILITY_REQUIRED");

    const duplicate = await request("PATCH", `/api/v1/firms/${FIRM_ID}/users/${MEMBER_ID}`, adminToken, { email: collisionEmail });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("USER_EMAIL_CONFLICT");
    expect((await adminPrisma.user.findUniqueOrThrow({ where: { id: MEMBER_ID } })).emailNormalized)
      .toBe(updatedMemberEmail);
  });

  it("edita los cuatro campos de firma y agrega/lista/quita asignaciones con auditoría", async () => {
    const profile = await request("PATCH", `/api/v1/firms/${FIRM_ID}/profile`, adminToken, {
      legalName: "C5a Estudio actualizado",
      displayName: "C5a actualizado",
      taxId: "30-98765432-1",
      timezone: "America/Argentina/Buenos_Aires",
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data).toMatchObject({ legalName: "C5a Estudio actualizado", displayName: "C5a actualizado", taxId: "30-98765432-1" });
    const profileAudit = await adminPrisma.auditEvent.findFirstOrThrow({
      where: { firmId: FIRM_ID, action: "firm.profile_updated", entityType: "Firm", entityId: FIRM_ID },
    });
    expect(profileAudit.before).toMatchObject({ legalName: "C5a Estudio", taxId: "[REDACTED]" });
    expect(profileAudit.after).toMatchObject({ legalName: "C5a Estudio actualizado", taxId: "[REDACTED]" });

    const added = await request("POST", `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/assignments`, adminToken, {
      userId: MEMBER_ID,
      clientId: CLIENT_ID,
      capabilities: ["document.prepare"],
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().data).toMatchObject({ userId: MEMBER_ID, clientId: CLIENT_ID, assignedBy: ADMIN_ID });
    const listed = await request("GET", `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/assignments`, adminToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);

    const removed = await request("DELETE", `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/assignments/${MEMBER_ID}`, adminToken);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.status).toBe("REMOVED");
    expect(await adminPrisma.clientAssignment.count({ where: { firmId: FIRM_ID, clientId: CLIENT_ID } })).toBe(0);
    const assignmentAudit = await adminPrisma.auditEvent.findMany({
      where: { firmId: FIRM_ID, clientId: CLIENT_ID, entityType: "ClientAssignment" },
      orderBy: { createdAt: "asc" },
    });
    expect(assignmentAudit.map((event) => event.action)).toEqual(["client.assignment.created", "client.assignment.removed"]);
    expect(assignmentAudit[0]?.before).toMatchObject({ assignment: null });
    expect(assignmentAudit[1]?.after).toMatchObject({ assignment: null });
  });

  it("permite editar OWNER desde ADMIN, conserva último admin y revoca sesiones al degradar/suspender", async () => {
    const ownerRole = await request("PATCH", `/api/v1/firms/${FIRM_ID}/members/${OWNER_ID}`, adminToken, { role: "ADMIN" });
    expect(ownerRole.statusCode).toBe(200);
    expect(ownerRole.json().data.role).toBe("ADMIN");

    const downgraded = await request("PATCH", `/api/v1/firms/${FIRM_ID}/members/${ADMIN_ID}`, ownerToken, { role: "PREPARER" });
    expect(downgraded.statusCode).toBe(200);
    expect(downgraded.json().data.role).toBe("PREPARER");
    expect(await sessionRevoked(adminToken)).toBe(true);

    const suspended = await request("POST", `/api/v1/firms/${FIRM_ID}/members/${MEMBER_ID}/suspend`, ownerToken);
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().data.status).toBe("SUSPENDED");
    expect(await sessionRevoked(memberToken)).toBe(true);
    const reactivated = await request("POST", `/api/v1/firms/${FIRM_ID}/members/${MEMBER_ID}/reactivate`, ownerToken);
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().data.status).toBe("ACTIVE");
    expect(await sessionRevoked(memberToken)).toBe(true);

    const lastAdmin = await request("PATCH", `/api/v1/firms/${FIRM_ID}/members/${OWNER_ID}`, ownerToken, { role: "PREPARER" });
    expect(lastAdmin.statusCode).toBe(409);
    expect(lastAdmin.json().error.code).toBe("LAST_ADMIN_REQUIRED");
    const lastAdminSuspension = await request("POST", `/api/v1/firms/${FIRM_ID}/members/${OWNER_ID}/suspend`, ownerToken);
    expect(lastAdminSuspension.statusCode).toBe(409);
    expect(lastAdminSuspension.json().error.code).toBe("LAST_ADMIN_REQUIRED");
    expect(await adminPrisma.firmMembership.findUniqueOrThrow({
      where: { firmId_userId: { firmId: FIRM_ID, userId: OWNER_ID } },
    })).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    expect(await adminPrisma.auditEvent.count({
      where: { firmId: FIRM_ID, userId: OWNER_ID, action: "internal_member.last_admin_guard.rejected" },
    })).toBe(2);
  });

  it("edita, suspende y reactiva acceso portal con auditoría y revocación de sesiones", async () => {
    const role = await request(
      "PATCH",
      `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/portal-memberships/${PORTAL_MEMBERSHIP_ID}`,
      ownerToken,
      { role: "READONLY" },
    );
    expect(role.statusCode).toBe(200);
    expect(role.json().data.role).toBe("READONLY");
    expect(await sessionRevoked(portalToken)).toBe(true);

    portalToken = await createSession(PORTAL_USER_ID);
    const suspended = await request(
      "POST",
      `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/portal-memberships/${PORTAL_MEMBERSHIP_ID}/revoke`,
      ownerToken,
    );
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().data.status).toBe("SUSPENDED");
    expect(await sessionRevoked(portalToken)).toBe(true);

    const reactivated = await request(
      "POST",
      `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/portal-memberships/${PORTAL_MEMBERSHIP_ID}/reactivate`,
      ownerToken,
    );
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().data.status).toBe("ACTIVE");
    expect((await adminPrisma.portalMembership.findUniqueOrThrow({ where: { id: PORTAL_MEMBERSHIP_ID } })).revokedAt).toBeNull();
    expect(await adminPrisma.auditEvent.count({
      where: { firmId: FIRM_ID, clientId: CLIENT_ID, entityType: "PortalMembership", entityId: PORTAL_MEMBERSHIP_ID, action: "portal.membership.updated" },
    })).toBe(3);
  });

  it("verifica execute/RLS con consultas PostgreSQL usando runtime", async () => {
    const currentRole = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(currentRole[0]?.current_user).toBe("contable_runtime");

    const privileges = await adminPrisma.$queryRaw<{
      proname: string; runtime_execute: boolean; worker_execute: boolean; public_execute: boolean;
    }[]>`
      SELECT p.proname,
        has_function_privilege('contable_runtime', p.oid, 'EXECUTE') AS runtime_execute,
        has_function_privilege('contable_worker', p.oid, 'EXECUTE') AS worker_execute,
        EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'app_c5a_%'
      ORDER BY p.proname
    `;
    expect(privileges).toHaveLength(5);
    for (const privilege of privileges) {
      expect(privilege.runtime_execute).toBe(true);
      expect(privilege.worker_execute).toBe(false);
      expect(privilege.public_execute).toBe(false);
    }

    const rls = await adminPrisma.$queryRaw<{
      relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean;
    }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('users', 'firms', 'firm_memberships', 'client_assignments', 'portal_memberships', 'device_sessions')
      ORDER BY relname
    `;
    expect(rls).toHaveLength(6);
    expect(rls.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);

    const hiddenUser = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER_ID}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM_ID}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${OTHER_USER_ID}`;
    });
    expect(hiddenUser).toHaveLength(0);

    await expect(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER_ID}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM_ID}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return tx.$queryRaw`SELECT * FROM app_c5a_update_member_identity(
        ${OWNER_ID}, ${OTHER_FIRM_ID}, ${OTHER_USER_ID}, ${"Intrusión"}, ${null}
      )`;
    })).rejects.toThrow(/FORBIDDEN/);
  });
});
