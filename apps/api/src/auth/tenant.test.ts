import { describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Tests de integración de tenancy (requieren PostgreSQL local con RLS aplicado
 * y seed-fase2.sql cargado). Se omiten si la DB no está disponible.
 * Usa un cliente con el rol runtime (contable_runtime) que NO tiene BYPASSRLS,
 * para validar el aislamiento real.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const ASSIGNED_CLIENT = "11111111-2222-4333-8444-555555555555";
const UNASSIGNED_CLIENT = "11111111-2222-4333-8444-666666666666";

// Cliente con rol runtime (sin BYPASSRLS) para validar RLS real.
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
    return fn(tx);
  });
}

describe("tenancy (integración DB, rol runtime)", () => {
  it("sin contexto de firma no puede listar clientes", async () => {
    const clients = await runtimePrisma.$transaction(async (tx) =>
      tx.client.findMany({ where: { firmId: FIRM_ALFA } }),
    );
    expect(clients).toHaveLength(0);
  });

  it("Owner A con contexto ve clientes de Alfa", async () => {
    const clients = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.client.findMany({ where: { firmId: FIRM_ALFA } }),
    );
    expect(clients.length).toBeGreaterThan(0);
  });

  it("Owner A con contexto NO ve clientes de Beta", async () => {
    const clients = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.client.findMany({ where: { firmId: FIRM_BETA } }),
    );
    expect(clients).toHaveLength(0);
  });

  it("un preparador sólo ve el cliente asignado", async () => {
    const clients = await runAsRuntime(PREPARER_A, FIRM_ALFA, (tx) =>
      tx.client.findMany({ where: { id: { in: [ASSIGNED_CLIENT, UNASSIGNED_CLIENT] } }, select: { id: true } }),
    );
    expect(clients.map((client) => client.id)).toEqual([ASSIGNED_CLIENT]);
  });

  it("un contexto client_id no puede leer otro cliente aun siendo owner", async () => {
    const clients = await runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER_A}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM_ALFA}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', ${ASSIGNED_CLIENT}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', ${"USER"}, true)`;
      return tx.client.findMany({ where: { id: UNASSIGNED_CLIENT } });
    });
    expect(clients).toHaveLength(0);
  });
});
