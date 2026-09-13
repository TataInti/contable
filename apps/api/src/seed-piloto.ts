import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./auth/password.js";

const FIRM_ID = process.env.PILOT_FIRM_ID ?? "dddddddd-dddd-4ddd-8ddd-ddddddddd001";
const PILOT_FLAGS = [
  "TAX",
  "TAX_RI",
  "TAX_IIBB_LOCAL_TUC",
  "TAX_TEM_SMT",
  "TAX_CM_ART2",
  "TAX_MONOTRIBUTO",
  "DOCUMENTS",
  "PORTAL",
] as const;

const E2E_CLIENTS = [
  { id: "e2e00000-0000-4000-8000-000000000001", legalName: "Cliente E2E IIBB", cuit: "20999999001" },
  { id: "e2e00000-0000-4000-8000-000000000002", legalName: "Cliente E2E TEM", cuit: "20999999002" },
  { id: "e2e00000-0000-4000-8000-000000000003", legalName: "Cliente E2E CM03", cuit: "20999999003" },
  { id: "e2e00000-0000-4000-8000-000000000004", legalName: "Cliente E2E Mono", cuit: "20999999004" },
] as const;

async function setFirmFlag(code: string): Promise<void> {
  const existing = await prisma.featureFlag.findFirst({ where: { firmId: FIRM_ID, clientId: null, code } });
  if (existing) {
    await prisma.featureFlag.update({ where: { id: existing.id }, data: { enabled: true } });
    return;
  }
  await prisma.featureFlag.create({ data: { firmId: FIRM_ID, clientId: null, code, enabled: true } });
}

async function upsertPortalUser(input: {
  email: string;
  name: string;
  password: string;
  role: "COLLABORATOR" | "READONLY";
  firmId: string;
  clientId: string;
  invitedBy: string;
}): Promise<void> {
  const user = await prisma.user.upsert({
    where: { emailNormalized: input.email },
    update: { name: input.name, passwordHash: await hashPassword(input.password), status: "ACTIVE" },
    create: { emailNormalized: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
  });
  await prisma.portalMembership.upsert({
    where: { firmId_clientId_userId: { firmId: input.firmId, clientId: input.clientId, userId: user.id } },
    update: { role: input.role, status: "ACTIVE", acceptedAt: new Date(), invitedBy: input.invitedBy, revokedAt: null },
    create: {
      firmId: input.firmId,
      clientId: input.clientId,
      userId: user.id,
      role: input.role,
      status: "ACTIVE",
      acceptedAt: new Date(),
      invitedBy: input.invitedBy,
    },
  });
}

async function main(): Promise<void> {
  const firm = await prisma.firm.findUnique({ where: { id: FIRM_ID } });
  if (!firm) throw new Error(`No existe la firma piloto ${FIRM_ID}. Ejecutá seed:demo primero.`);

  const client = await prisma.client.findFirst({ where: { firmId: FIRM_ID }, orderBy: { createdAt: "asc" } });
  if (!client) throw new Error(`La firma piloto ${FIRM_ID} no tiene clientes.`);

  for (const e2eClient of E2E_CLIENTS) {
    await prisma.client.upsert({
      where: { id: e2eClient.id },
      update: { legalName: e2eClient.legalName, cuit: e2eClient.cuit, status: "ACTIVE" },
      create: { id: e2eClient.id, firmId: FIRM_ID, legalName: e2eClient.legalName, cuit: e2eClient.cuit, status: "ACTIVE" },
    });
  }

  const owner = await prisma.user.findFirst({
    where: { memberships: { some: { firmId: FIRM_ID, role: "OWNER", status: "ACTIVE" } } },
  });
  if (!owner) throw new Error("La firma piloto no tiene un OWNER activo.");
  const reviewer = await prisma.user.findUnique({ where: { emailNormalized: "revisor@contable.local" } });
  if (reviewer) {
    for (const e2eClient of E2E_CLIENTS) {
      await prisma.clientAssignment.upsert({
        where: { firmId_userId_clientId: { firmId: FIRM_ID, userId: reviewer.id, clientId: e2eClient.id } },
        update: {},
        create: { firmId: FIRM_ID, userId: reviewer.id, clientId: e2eClient.id, assignedBy: owner.id },
      });
    }
  }

  for (const code of PILOT_FLAGS) await setFirmFlag(code);

  await upsertPortalUser({
    email: "colaborador@contable.local",
    name: "Colaborador Demo",
    password: "colaborador1234",
    role: "COLLABORATOR",
    firmId: FIRM_ID,
    clientId: client.id,
    invitedBy: owner.id,
  });
  const portalUser = await prisma.user.findUnique({ where: { emailNormalized: "cliente@contable.local" } });
  if (portalUser) {
    for (const e2eClient of E2E_CLIENTS) {
      await prisma.portalMembership.upsert({
        where: { firmId_clientId_userId: { firmId: FIRM_ID, clientId: e2eClient.id, userId: portalUser.id } },
        update: { role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), invitedBy: owner.id, revokedAt: null },
        create: { firmId: FIRM_ID, clientId: e2eClient.id, userId: portalUser.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), invitedBy: owner.id },
      });
    }
  }
  await upsertPortalUser({
    email: "readonly@contable.local",
    name: "Consulta Demo",
    password: "readonly1234",
    role: "READONLY",
    firmId: FIRM_ID,
    clientId: client.id,
    invitedBy: owner.id,
  });

  console.log(`Piloto habilitado para ${firm.displayName} / ${client.legalName}`);
  console.log("Flags fiscales: TAX, TAX_RI, TAX_IIBB_LOCAL_TUC, TAX_TEM_SMT, TAX_CM_ART2, TAX_MONOTRIBUTO");
  console.log("Portal colaborador: colaborador@contable.local / colaborador1234");
  console.log("Portal solo lectura: readonly@contable.local / readonly1234");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
