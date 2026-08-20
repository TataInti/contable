import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";

/**
 * F0.2: regresión de grants de portal para contable_runtime.
 *
 * Verifica que el rol runtime puede gestionar portal_memberships y
 * portal_invitations en una base ya migrada (el baseline no siempre
 * tenía esos grants → administración devolvía 500).
 *
 * Usa firma/cliente/usuarios PROPIOS para no colisionar con suites
 * paralelas (los tests corren con la misma DB).
 */

const OWNER_PG = "77777777-7777-4777-8777-777777777777";
const FIRM_PORTAL = "77777777-7777-4777-8777-777777777778";
const CLIENT_PORTAL = "77777777-2222-4333-8444-777777777777";

const runtimeConnection =
  process.env.RUNTIME_DATABASE_URL ??
  "postgresql://contable_runtime:runtime_secret@localhost:5432/contable";
const runtimeAdapter = new PrismaPg({ connectionString: runtimeConnection });
const runtimePrisma = new PrismaClient({ adapter: runtimeAdapter });

async function runAsRuntime<T>(
  userId: string,
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    return fn(tx) as Promise<T>;
  });
}

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_PG}', 'owner.portal@test.local', 'Owner Portal', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${FIRM_PORTAL}', 'portal.user@test.local', 'Portal User', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_PORTAL}', 'Estudio Portal', 'Estudio Portal', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_PORTAL}', '${FIRM_PORTAL}', 'Cliente Portal', '20999999988', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_PORTAL}', '${OWNER_PG}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

describe("F0.2 grants de portal para contable_runtime", () => {
  beforeEach(async () => {
    await setupMembership();
    // Idempotencia: limpia sólo los datos del cliente de esta suite.
    await prisma.$executeRawUnsafe(
      `DELETE FROM portal_invitations WHERE "firmId" = '${FIRM_PORTAL}' AND "clientId" = '${CLIENT_PORTAL}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM portal_memberships WHERE "firmId" = '${FIRM_PORTAL}' AND "clientId" = '${CLIENT_PORTAL}'`,
    );
  });

  it("el runtime puede crear una invitación de portal", async () => {
    const invitation = await runAsRuntime(OWNER_PG, FIRM_PORTAL, async (tx) =>
      tx.portalInvitation.create({
        data: {
          firmId: FIRM_PORTAL,
          clientId: CLIENT_PORTAL,
          emailNormalized: "invitado@test.local",
          role: "COLLABORATOR",
          tokenHash: "token-hash-test",
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedByUserId: OWNER_PG,
        },
      }),
    );
    expect(invitation.id).toBeTruthy();
    expect(invitation.emailNormalized).toBe("invitado@test.local");
  });

  it("el runtime puede listar y revocar una membresía de portal", async () => {
    // Crea una membresía como owner (el runtime la gestiona).
    const membership = await runAsRuntime(OWNER_PG, FIRM_PORTAL, async (tx) =>
      tx.portalMembership.create({
        data: {
          firmId: FIRM_PORTAL,
          clientId: CLIENT_PORTAL,
          userId: FIRM_PORTAL,
          role: "READONLY",
          status: "ACTIVE",
          invitedBy: OWNER_PG,
        },
      }),
    );

    const listed = await runAsRuntime(OWNER_PG, FIRM_PORTAL, (tx) =>
      tx.portalMembership.findMany({
        where: { firmId: FIRM_PORTAL, clientId: CLIENT_PORTAL },
      }),
    );
    expect(listed.some((m) => m.id === membership.id)).toBe(true);

    const revoked = await runAsRuntime(OWNER_PG, FIRM_PORTAL, (tx) =>
      tx.portalMembership.update({
        where: { id: membership.id },
        data: { status: "SUSPENDED", revokedAt: new Date() },
      }),
    );
    expect(revoked.status).toBe("SUSPENDED");
  });

  it("el runtime no puede escribir una membresía como actor PORTAL", async () => {
    // El actor PORTAL no debe poder crear membresías (policy lo impide).
    await expect(
      runtimePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${FIRM_PORTAL}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_PORTAL}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'PORTAL', true)`);
        return tx.portalMembership.create({
          data: {
            firmId: FIRM_PORTAL,
            clientId: CLIENT_PORTAL,
            userId: FIRM_PORTAL,
            role: "COLLABORATOR",
            status: "ACTIVE",
            invitedBy: OWNER_PG,
          },
        });
      }),
    ).rejects.toThrow();
  });
});