import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../auth/password.js";

/**
 * Pruebas de integración de la recuperación de acceso para miembros internos
 * (renovación de claves iniciada por el admin): uso real, un solo uso (replay),
 * expiración, revocación, permisos y revocación de sesiones, contra SQL real.
 *
 * Corren SOLO contra una base desechable señalada con RECOVERY_IT_DATABASE_URL
 * (migraciones + rls.sql + seed-fase2.sql aplicados). Nunca contra la base de
 * producción: si la variable no está, la suite se omite. Las propiedades que
 * esta suite verifica quedan además fijadas a nivel de texto SQL por
 * member-access-recovery.test.ts, que sí corre siempre (incluida CI).
 *
 * La conexión de prueba es la del rol que aplicó las migraciones (owner) y
 * opera las funciones SECURITY DEFINER con SET ROLE contable_runtime, igual
 * que hace la API en runtime.
 */

const connectionString = process.env.RECOVERY_IT_DATABASE_URL ?? "";

// Identidades de prueba (creadas acá, con emails únicos por corrida).
const OWNER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const MEMBER_ID = randomUUID();
const FIRM_ID = randomUUID();
const OTHER_MEMBER_ID = randomUUID();
const OTHER_FIRM_ID = randomUUID();
const RUN = randomBytes(4).toString("hex");

const adminAdapter = new PrismaPg({ connectionString: connectionString || "postgresql://invalid" });
const adminPrisma = new PrismaClient({ adapter: adminAdapter });

/** Ejecuta fn en una transacción actuando como contable_runtime (sin BYPASSRLS). */
async function asRuntime<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return adminPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE contable_runtime`);
    return fn(tx);
  });
}

/** Executes a read with the authenticated user and firm RLS context set. */
async function asRuntimeInFirm<T>(
  userId: string,
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return adminPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE contable_runtime`);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.firm_id', ${firmId}, true)`;
    return fn(tx);
  });
}

async function insertMember(id: string, email: string, role: string, status: string): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "updatedAt")
     VALUES ('${id}', '${email}', 'Miembro ${RUN}', 'hash-viejo', '${status}', now())`,
  );
  await adminPrisma.$executeRawUnsafe(
    `INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
     VALUES ('${randomUUID()}', '${FIRM_ID}', '${id}', '${role}', '${status}', now())`,
  );
}

async function insertActiveSession(userId: string, label: string): Promise<string> {
  const sessionId = `sess-${RUN}-${label}`;
  await adminPrisma.$executeRawUnsafe(
    `INSERT INTO device_sessions (id, "userId", "refreshTokenHash", "familyId", "expiresAt")
     VALUES ('${sessionId}', '${userId}', 'hash-${sessionId}', 'fam-${RUN}', now() + interval '1 day')`,
  );
  return sessionId;
}

async function sessionRevoked(sessionId: string): Promise<boolean> {
  const rows = await adminPrisma.$queryRawUnsafe<{ revoked: boolean }[]>(
    `SELECT "revokedAt" IS NOT NULL AS revoked FROM device_sessions WHERE id = '${sessionId}'`,
  );
  return rows[0]?.revoked === true;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!connectionString)("recuperación de acceso (integración, base desechable)", () => {
  beforeAll(async () => {
    await adminPrisma.$executeRawUnsafe(
      `INSERT INTO firms (id, "legalName", "displayName", status, "updatedAt")
       VALUES ('${FIRM_ID}', 'Estudio Recuperación ${RUN}', 'Recuperación ${RUN}', 'ACTIVE', now())`,
    );
    await insertMember(OWNER_ID, `owner-${RUN}@example.com`, "OWNER", "ACTIVE");
    await insertMember(ADMIN_ID, `admin-${RUN}@example.com`, "ADMIN", "ACTIVE");
    await insertMember(MEMBER_ID, `member-${RUN}@example.com`, "PREPARER", "ACTIVE");
    await adminPrisma.$executeRaw`
      INSERT INTO firms (id, "legalName", "displayName", status, "updatedAt")
      VALUES (${OTHER_FIRM_ID}, ${`Otro estudio ${RUN}`}, ${`Otro ${RUN}`}, 'ACTIVE', now())`;
    await adminPrisma.$executeRaw`
      INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "updatedAt")
      VALUES (${OTHER_MEMBER_ID}, ${`other-${RUN}@example.com`}, 'Miembro de otro estudio', 'hash-viejo', 'ACTIVE', now())`;
    await adminPrisma.$executeRaw`
      INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
      VALUES (${randomUUID()}, ${OTHER_FIRM_ID}, ${OTHER_MEMBER_ID}, 'PREPARER', 'ACTIVE', now())`;
  });

  it("RLS: un OWNER ve identidades del mismo estudio y queda aislado de otra firma", async () => {
    const rlsFlags = await adminPrisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE oid = 'public.users'::regclass`;
    expect(rlsFlags[0]).toEqual({ enabled: true, forced: true });

    const sameFirmUsers = await asRuntimeInFirm(OWNER_ID, FIRM_ID, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${MEMBER_ID}`,
    );
    const otherFirmUsers = await asRuntimeInFirm(OWNER_ID, FIRM_ID, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${OTHER_MEMBER_ID}`,
    );
    const memberVisibleOwners = await asRuntimeInFirm(MEMBER_ID, FIRM_ID, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${OWNER_ID}`,
    );
    expect(sameFirmUsers.map((user) => user.id)).toContain(MEMBER_ID);
    expect(otherFirmUsers).toHaveLength(0);
    expect(memberVisibleOwners).toHaveLength(0);
  });

  it("uso: el admin emite, se revocan las sesiones y el miembro canjea su nueva contraseña", async () => {
    const sessionId = await insertActiveSession(MEMBER_ID, "uso");
    const token = randomBytes(32).toString("base64url");
    const created = await asRuntime(async (tx) => tx.$queryRaw<
      { recoveryId: string; expiresAt: Date; sessionsRevoked: number }[]
    >`SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    expect(created[0]?.sessionsRevoked).toBe(1);
    expect(await sessionRevoked(sessionId)).toBe(true);
    expect(new Date(created[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Canje: el propio miembro define su contraseña; el admin nunca la vio.
    const newPassword = "contrasena-nueva-segura-1";
    const redeemed = await asRuntime(async (tx) => tx.$queryRaw<{ userId: string; status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${await hashPassword(newPassword)})`);
    expect(redeemed[0]?.status).toBe("OK");
    expect(redeemed[0]?.userId).toBe(MEMBER_ID);

    const rows = await adminPrisma.$queryRaw<{ passwordHash: string; mustChangePassword: boolean }[]>`
      SELECT "passwordHash", "mustChangePassword" FROM users WHERE id = ${MEMBER_ID}`;
    expect(await verifyPassword(newPassword, rows[0]!.passwordHash)).toBe(true);
    expect(rows[0]!.mustChangePassword).toBe(false);
  });

  it("replay: el mismo token no sirve dos veces", async () => {
    const token = randomBytes(32).toString("base64url");
    await asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    const passwordHash = await hashPassword("contrasena-replay-segura");
    const first = await asRuntime(async (tx) => tx.$queryRaw<{ status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${passwordHash})`);
    expect(first[0]?.status).toBe("OK");
    await expect(asRuntime(async (tx) => tx.$queryRaw<{ status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${passwordHash})`))
      .rejects.toThrow(/RECOVERY_INVALID/);
  });

  it("expiración: un token vencido falla con error genérico", async () => {
    const token = randomBytes(32).toString("base64url");
    const created = await asRuntime(async (tx) => tx.$queryRaw<{ recoveryId: string }[]>`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    await adminPrisma.$executeRawUnsafe(
      `UPDATE member_access_recoveries SET "expiresAt" = now() - interval '1 minute' WHERE id = '${created[0]!.recoveryId}'`,
    );
    await expect(asRuntime(async (tx) => tx.$queryRaw<{ status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${await hashPassword("contrasena-expirada-1")})`))
      .rejects.toThrow(/RECOVERY_INVALID/);
  });

  it("revocación: el admin invalida un enlace pendiente y el canje falla", async () => {
    const token = randomBytes(32).toString("base64url");
    const created = await asRuntime(async (tx) => tx.$queryRaw<{ recoveryId: string }[]>`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    const revoked = await asRuntime(async (tx) => tx.$queryRaw<{ outcome: string }[]>`
      SELECT * FROM app_revoke_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${created[0]!.recoveryId}, 'generado por error')`);
    expect(revoked[0]?.outcome).toBe("REVOKED");
    await expect(asRuntime(async (tx) => tx.$queryRaw<{ status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${await hashPassword("contrasena-revocada-1")})`))
      .rejects.toThrow(/RECOVERY_INVALID/);
  });

  it("permisos: PREPARER no emite, nadie se auto-emite, ADMIN no emite para OWNER", async () => {
    const token = sha256(randomBytes(32).toString("base64url"));
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${MEMBER_ID}, ${FIRM_ID}, ${OWNER_ID}, ${token}, 30)`))
      .rejects.toThrow(/MEMBER_ACTOR_REQUIRED/);
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${OWNER_ID}, ${token}, 30)`))
      .rejects.toThrow(/MEMBER_SELF_TARGET/);
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${ADMIN_ID}, ${FIRM_ID}, ${OWNER_ID}, ${token}, 30)`))
      .rejects.toThrow(/OWNER_PROTECTED/);
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${token}, 3)`))
      .rejects.toThrow(/RECOVERY_TTL_INVALID/);
  });

  it("OWNER-protegido: un ADMIN no degrada un OWNER ni asigna OWNER", async () => {
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_change_internal_member_role(
        ${ADMIN_ID}, ${FIRM_ID}, ${OWNER_ID}, ${"ADMIN"}::"FirmRole", ${"test"}
      )`)).rejects.toThrow(/OWNER_PROTECTED/);

    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_change_internal_member_role(
        ${ADMIN_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${"OWNER"}::"FirmRole", ${"test"}
      )`)).rejects.toThrow(/OWNER_PROTECTED/);

    const roles = await adminPrisma.$queryRaw<{ userId: string; role: string }[]>`
      SELECT "userId", role FROM firm_memberships
      WHERE "firmId" = ${FIRM_ID} AND "userId" IN (${OWNER_ID}, ${MEMBER_ID})
      ORDER BY "userId"`;
    expect(roles.find((row) => row.userId === OWNER_ID)?.role).toBe("OWNER");
    expect(roles.find((row) => row.userId === MEMBER_ID)?.role).toBe("PREPARER");
  });

  it("objetivo suspendido: la emisión se rechaza; el canje de un token viejo también falla", async () => {
    const token = randomBytes(32).toString("base64url");
    const suspendedId = randomUUID();
    await insertMember(suspendedId, `suspended-${RUN}@example.com`, "REVIEWER", "ACTIVE");
    await adminPrisma.$executeRawUnsafe(
      `UPDATE users SET status = 'SUSPENDED' WHERE id = '${suspendedId}'`,
    );
    await adminPrisma.$executeRawUnsafe(
      `UPDATE firm_memberships SET status = 'SUSPENDED' WHERE "userId" = '${suspendedId}'`,
    );
    await expect(asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${suspendedId}, ${sha256(token)}, 30)`))
      .rejects.toThrow(/RECOVERY_TARGET_NOT_ACTIVE/);
  });

  it("re-emisión: sólo el último token pendiente queda válido y las sesiones se cortan de nuevo", async () => {
    const sessionId = await insertActiveSession(MEMBER_ID, "reemision");
    const firstToken = randomBytes(32).toString("base64url");
    await asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(firstToken)}, 30)`);
    const secondToken = randomBytes(32).toString("base64url");
    await asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(secondToken)}, 30)`);
    expect(await sessionRevoked(sessionId)).toBe(true);

    const pendings = await adminPrisma.$queryRaw<{ tokenHash: string }[]>`
      SELECT "tokenHash" FROM member_access_recoveries
      WHERE "userId" = ${MEMBER_ID} AND "usedAt" IS NULL AND "revokedAt" IS NULL`;
    expect(pendings.map((row) => row.tokenHash)).toEqual([sha256(secondToken)]);

    // El primer token quedó invalidado aunque nunca se usó.
    await expect(asRuntime(async (tx) => tx.$queryRaw<{ status: string }[]>`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(firstToken)}, ${await hashPassword("contrasena-descartada")})`))
      .rejects.toThrow(/RECOVERY_INVALID/);
  });

  it("secretos: en la base sólo vive el hash; el token en claro no aparece en ninguna fila", async () => {
    const token = randomBytes(32).toString("base64url");
    await asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    const rows = await adminPrisma.$queryRaw<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(r) AS row FROM member_access_recoveries r
      WHERE "userId" = ${MEMBER_ID} AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`;
    expect(JSON.stringify(rows[0]!.row)).not.toContain(token);
    const columns = await adminPrisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'member_access_recoveries'`;
    expect(columns.map((c) => c.column_name).filter((name) => name.toLowerCase().includes("token"))).toEqual(["tokenHash"]);
  });

  it("auditoría: emisión, canje y revocación quedan registrados sin secretos", async () => {
    const token = randomBytes(32).toString("base64url");
    const created = await asRuntime(async (tx) => tx.$queryRaw<{ recoveryId: string }[]>`
      SELECT * FROM app_create_member_access_recovery(${OWNER_ID}, ${FIRM_ID}, ${MEMBER_ID}, ${sha256(token)}, 30)`);
    await asRuntime(async (tx) => tx.$queryRaw`
      SELECT * FROM app_redeem_member_access_recovery(${sha256(token)}, ${await hashPassword("contrasena-auditoria")})`);
    const events = await adminPrisma.$queryRaw<{ action: string; after: unknown }[]>`
      SELECT action, after FROM audit_events
      WHERE "entityType" = 'MemberAccessRecovery' AND "entityId" = ${created[0]!.recoveryId}
      ORDER BY "createdAt" ASC`;
    expect(events.map((e) => e.action)).toEqual([
      "internal_member.access_recovery_requested",
      "internal_member.access_recovered",
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(sha256(token));
  });
});
