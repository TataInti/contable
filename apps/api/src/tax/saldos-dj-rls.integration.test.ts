import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FilingDeclarationService } from "./filing-declaration-service.js";

/**
 * Saldos de la DJ escritos con el rol de producción (corte 6a, H7). Pasan por el servicio real.
 * En NODE_ENV=test lib/prisma usa DATABASE_URL (superusuario, sin RLS): acá DATABASE_URL apunta al
 * rol runtime (contable_runtime, NOBYPASSRLS) antes de cargar el servicio y se restaura al terminar.
 * Datos sintéticos rotulados «Demo»: un estudio nuevo por corrida.
 */

const SUPERUSUARIO_URL = process.env.DATABASE_URL;
const RUNTIME_URL = process.env.RUNTIME_DATABASE_URL ?? "";
const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const OWNER = randomUUID();
const OWNER_B = randomUUID();
const DJ = "DECLARACION_JURADA";
const CUERPO_DJ = {
  impuestoDeterminado: "1500.00",
  saldoFavorTecnico: "50000.0000",
  saldoLibreDisponibilidad: "20000.0000",
  totalAPagar: "1500.00",
};
const TOTALES = {
  TOTAL_A_INGRESAR: "1500.00",
  SALDO_TECNICO_AFTER: "48000.0000",
  SALDO_LIBRE_AFTER: "20000.0000",
};

let superPrisma: PrismaClient;
let runtimePrisma: PrismaClient;
let clienteServicio: PrismaClient;
let servicio: FilingDeclarationService;
let clientId: string;
let profileVersionId: string;
let regimen: { id: string; taxTypeId: string; jurisdictionId: string };
let mes = 0;

function cuitEndingIn(ending: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce(
      (total, weight, index) => total + Number(base.charAt(index)) * weight,
      0,
    );
    const check = (11 - (sum % 11)) % 11;
    if (check < 10 && String(check) === ending) return `${base}${check}`;
  }
}

/** Período sintético nuevo (uno por escenario). */
async function periodo() {
  mes += 1;
  return superPrisma.taxPeriod.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regimen.taxTypeId,
      startDate: new Date(Date.UTC(2026, mes - 1, 1)),
      endDate: new Date(Date.UTC(2026, mes, 0)),
      label: `Demo ${String(mes).padStart(2, "0")}/2026`,
    },
  });
}

/** Período, obligación, liquidación finalizada y presentación FILED con su acuse (sintéticos). */
async function escenario() {
  const per = await periodo();
  const obligacion = await superPrisma.taxObligation.create({
    data: {
      firmId: FIRM,
      clientId,
      profileVersionId,
      regimeId: regimen.id,
      periodId: per.id,
      status: "FILED",
    },
  });
  const liquidacion = await superPrisma.taxSettlement.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regimen.taxTypeId,
      regimeId: regimen.id,
      jurisdictionId: regimen.jurisdictionId,
      periodId: per.id,
      cutoff: new Date(Date.UTC(2026, mes, 0)),
      version: 1,
      engineVersion: "sintetico-6a",
      rulesHash: "sintetico-6a",
      inputHash: "sintetico-6a",
      outputHash: "sintetico-6a",
      status: "FINALIZED",
      totals: TOTALES,
      preparedByUserId: OWNER,
      finalizedByUserId: OWNER,
      finalizedAt: new Date(),
    },
  });
  const acuse = await superPrisma.document.create({
    data: { firmId: FIRM, clientId, category: "ACUSE", status: "READY" },
  });
  const presentacion = await superPrisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId,
      obligationId: obligacion.id,
      settlementId: liquidacion.id,
      filedAt: new Date(Date.UTC(2026, mes, 10)),
      amountFiled: "1500.00",
      status: "FILED",
      evidenceDocumentId: acuse.id,
      createdByUserId: OWNER,
    },
  });
  return { obligationId: obligacion.id, filingId: presentacion.id };
}

async function documento(): Promise<string> {
  const doc = await superPrisma.document.create({
    data: { firmId: FIRM, clientId, category: DJ, status: "READY" },
  });
  return doc.id;
}

/** Transacción con el rol runtime y el contexto RLS del estudio (como R14). */
function comoRuntime<T>(
  firma: string,
  usuario: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${usuario}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firma}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
    return fn(tx);
  });
}

beforeAll(async () => {
  superPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: SUPERUSUARIO_URL ?? "" }),
  });
  runtimePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: RUNTIME_URL }) });
  const iva = await superPrisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  if (!iva) throw new Error("seed-maestros-fiscales no cargado: falta un régimen activo de IVA");
  regimen = { id: iva.id, taxTypeId: iva.taxTypeId, jurisdictionId: iva.jurisdictionId };

  await superPrisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now()), ($3,$4,$4,now())`,
    FIRM,
    "Estudio sintético saldos 6A (RLS)",
    OTHER_FIRM,
    "Estudio sintético saldos 6A (RLS, otro)",
  );
  for (const [id, nombre] of [
    [OWNER, "Usuario sintético 6A (RLS)"],
    [OWNER_B, "Usuario sintético 6A (RLS, estudio ajeno)"],
  ] as const) {
    await superPrisma.$executeRawUnsafe(
      `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
      id,
      `${id}@saldos6a-rls.test.local`,
      nombre,
    );
  }
  // Cada usuario pertenece a su estudio: las políticas RLS exigen la membresía (como en R14).
  await superPrisma.$executeRawUnsafe(
    `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'OWNER','ACTIVE',now()), (gen_random_uuid()::text,$3,$4,'OWNER','ACTIVE',now())`,
    FIRM,
    OWNER,
    OTHER_FIRM,
    OWNER_B,
  );
  const cuit = cuitEndingIn("7");
  const cliente = await superPrisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente sintético saldos 6A (RLS)",
      tradeName: "Sintético saldos 6A (RLS)",
      cuit,
      status: "ACTIVE",
    },
  });
  clientId = cliente.id;
  const perfil = await superPrisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético saldos 6A (RLS)",
      cuit,
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  profileVersionId = perfil.id;

  // El servicio toma su conexión de lib/prisma, que en NODE_ENV=test lee DATABASE_URL: se apunta
  // al rol runtime antes de cargar los módulos.
  process.env.DATABASE_URL = RUNTIME_URL;
  const { FilingDeclarationService: Servicio } = await import("./filing-declaration-service.js");
  servicio = new Servicio();
  const { prisma } = await import("../lib/prisma.js");
  clienteServicio = prisma;
});

afterAll(async () => {
  if (SUPERUSUARIO_URL !== undefined) process.env.DATABASE_URL = SUPERUSUARIO_URL;
  await runtimePrisma?.$disconnect();
  await superPrisma?.$disconnect();
});

describe("saldos de la DJ escritos con el rol de producción (corte 6a, H7)", () => {
  it("H7 registrar la DJ con contable_runtime: los lotes quedan del estudio y el estudio ajeno no los ve ni los modifica", async () => {
    const [quien] = await clienteServicio.$queryRaw<Array<{ usuario: string; bypass: boolean }>>`
      SELECT current_user AS usuario,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`;
    expect(quien).toEqual({ usuario: "contable_runtime", bypass: false });

    const e = await escenario();
    const ctx = { userId: OWNER, firmId: FIRM, clientId, actorKind: "USER" as const };
    const cuerpo = {
      clientId,
      obligationId: e.obligationId,
      filingId: e.filingId,
      declarationDocumentId: await documento(),
      ...CUERPO_DJ,
    };
    const res = await servicio.recordDeclaration(ctx, cuerpo);
    expect(
      res.saldosGenerados
        .filter((g) => g.status === "CREADO")
        .map((g) => g.kind)
        .sort(),
    ).toEqual(["IVA_LIBRE", "IVA_TECNICO"]);
    const lotes = await superPrisma.taxCreditLot.findMany({
      where: { sourceFilingId: e.filingId },
    });
    expect(lotes.map((lote) => lote.kind).sort()).toEqual(["IVA_LIBRE", "IVA_TECNICO"]);

    // Estudio ajeno, con el rol runtime y su contexto: no ve los lotes ni los puede modificar.
    const visibles = await comoRuntime(OTHER_FIRM, OWNER_B, (tx) =>
      tx.taxCreditLot.findMany({ where: { sourceFilingId: e.filingId } }),
    );
    expect(visibles).toHaveLength(0);
    const modificados = await comoRuntime(OTHER_FIRM, OWNER_B, (tx) =>
      tx.taxCreditLot.updateMany({
        where: { sourceFilingId: e.filingId },
        data: { carryForward: false },
      }),
    );
    expect(modificados.count).toBe(0);
    const intactos = await superPrisma.taxCreditLot.findMany({
      where: { sourceFilingId: e.filingId },
    });
    expect(
      intactos.every((lote) => lote.carryForward && lote.verificationStatus === "VERIFIED"),
    ).toBe(true);

    // La aplicación tampoco deja cargar la DJ de este estudio desde el contexto del otro.
    await expect(
      servicio.recordDeclaration(
        { userId: OWNER_B, firmId: OTHER_FIRM, clientId, actorKind: "USER" as const },
        cuerpo,
      ),
    ).rejects.toMatchObject({ code: "FILING_NOT_FOUND", httpStatus: 404 });
  });
});
