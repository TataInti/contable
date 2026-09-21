import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./auth/password.js";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL es obligatoria");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecutá este comando en una terminal interactiva");

  const input = createInterface({ input: process.stdin, output: process.stdout });
  let email: string;
  let name: string;
  let displayName: string;
  let legalName: string;
  try {
    email = (await input.question("Email del administrador: ")).trim().toLowerCase();
    name = (await input.question("Nombre del administrador: ")).trim();
    displayName = (await input.question("Nombre del estudio: ")).trim();
    legalName = (await input.question("Razón social del estudio: ")).trim();
  } finally {
    input.close();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !displayName || !legalName) {
    throw new Error("Email, nombre y datos del estudio son obligatorios");
  }

  const password = randomBytes(36).toString("base64url");
  const passwordHash = await hashPassword(password);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(360, 1)::text`;
      const [users, firms] = await Promise.all([tx.user.count(), tx.firm.count()]);
      if (users !== 0 || firms !== 0) throw new Error("Inicialización cancelada: ya existen usuarios o estudios");
      const user = await tx.user.create({ data: {
        emailNormalized: email, name, passwordHash, mustChangePassword: true, isPlatformAdmin: true,
      } });
      const firm = await tx.firm.create({ data: { legalName, displayName } });
      await tx.firmMembership.create({ data: {
        firmId: firm.id, userId: user.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date(),
      } });
    });
    process.stdout.write(`\nAcceso creado para ${email}. Contraseña temporal (se muestra una sola vez):\n${password}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Error de inicialización"}\n`);
  process.exitCode = 1;
});
