import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.RUNTIME_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "test"
    ? "postgresql://contable:contable@localhost:5432/contable"
    : "postgresql://contable_runtime:runtime_secret@localhost:5432/contable");

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
