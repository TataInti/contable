import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./auth/password.js";

/**
 * Usuarios SÓLO para probar en local sobre la copia de producción (infra/scripts/dev-from-prod.sh).
 * La copia trae las cuentas reales con sus contraseñas, que no se conocen ni se usan: estas dos
 * cuentas permiten ingresar. Nunca se cargan en el servidor.
 *  - demo@contable.local     Titular y administrador de plataforma (habilita módulos del estudio).
 *  - revisor@contable.local  Revisor (control de dos personas).
 */
const USERS = [
  { email: "demo@contable.local", name: "Titular local de pruebas", password: "demo1234", role: "OWNER", platformAdmin: true },
  { email: "revisor@contable.local", name: "Revisor local de pruebas", password: "revisor1234", role: "REVIEWER", platformAdmin: false },
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL es obligatoria");
  const host = new URL(connectionString).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Este script sólo corre contra una base local");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const firm = await prisma.firm.findFirstOrThrow();
    for (const item of USERS) {
      const user = await prisma.user.upsert({
        where: { emailNormalized: item.email },
        update: { isPlatformAdmin: item.platformAdmin },
        create: {
          emailNormalized: item.email,
          name: item.name,
          passwordHash: await hashPassword(item.password),
          mustChangePassword: false,
          isPlatformAdmin: item.platformAdmin,
        },
      });
      await prisma.firmMembership.upsert({
        where: { firmId_userId: { firmId: firm.id, userId: user.id } },
        update: {},
        create: { firmId: firm.id, userId: user.id, role: item.role, status: "ACTIVE", acceptedAt: new Date() },
      });
      process.stdout.write(`Usuario local listo: ${item.email} (${item.role})\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Error"}\n`);
  process.exitCode = 1;
});
