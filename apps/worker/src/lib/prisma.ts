import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.WORKER_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "test"
    ? "postgresql://contable:contable@localhost:5432/contable"
    : "postgresql://contable_worker:worker_secret@localhost:5432/contable");

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export async function withWorkerTenant<T>(
  firmId: string,
  clientId: string,
  fn: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${"worker"}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${clientId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', ${"SYSTEM"}, true)`;
    return fn(tx);
  });
}
