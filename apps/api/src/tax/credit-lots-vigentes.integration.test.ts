import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * «Disponible» = los saldos vigentes (corte créditos vigentes). Pruebas contra la base descartable.
 *
 * La API corre aquí con el rol de producción `contable_runtime` (sin BYPASSRLS): el módulo
 * `lib/prisma` se reemplaza por un cliente con RUNTIME_DATABASE_URL y `withTenantContext` fija el
 * contexto RLS como en producción. Los datos de arranque (estudio, usuario, cliente) se cargan con
 * un cliente administrador aparte. Todos los importes son sintéticos y el estudio es nuevo por
 * corrida; no se borran filas (la base es desechable).
 */

vi.mock("../lib/prisma.js", async () => {
  const { PrismaClient: Cliente } = await import("@prisma/client");
  const { PrismaPg: Adaptador } = await import("@prisma/adapter-pg");
  return {
    prisma: new Cliente({
      adapter: new Adaptador({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
    }),
  };
});

const { MonthlyWorkpaperService } = await import("./workpaper-service.js");
const { prisma: runtime } = await import("../lib/prisma.js");
const { filtroSaldosVigentes, periodosElegibles, sumaDisponible } =
  await import("./credit-lots-vigentes.js");

const admin = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});
const servicio = new MonthlyWorkpaperService();

const FIRM = randomUUID();
const USER = randomUUID();
const ctx = { userId: USER, firmId: FIRM, actorKind: "USER" as const };

interface Regimen {
  id: string;
  taxTypeId: string;
  jurisdictionId: string;
}
let regimen: Regimen; // IVA, Nación
let otroRegimen: Regimen; // IVA, mismo impuesto y otro régimen
let otraJurisdiccionId: string;
let sufijo = 0;

function cuitSintetico(): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce(
      (total, weight, index) => total + Number(base.charAt(index)) * weight,
      0,
    );
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,'Estudio sintético créditos vigentes','Estudio sintético créditos vigentes',now())`,
    FIRM,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,'Usuario sintético créditos vigentes','x',now())`,
    USER,
    `${USER}@creditos-vigentes.test.local`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'OWNER','ACTIVE',now())`,
    FIRM,
    USER,
  );
  const nacion = await admin.jurisdiction.upsert({
    where: { code: "AR-CDV" },
    update: {},
    create: { code: "AR-CDV", name: "Nación sintética CDV", kind: "NATIONAL" },
  });
  const otra = await admin.jurisdiction.upsert({
    where: { code: "AR-CDV2" },
    update: {},
    create: { code: "AR-CDV2", name: "Otra jurisdicción sintética CDV", kind: "NATIONAL" },
  });
  otraJurisdiccionId = otra.id;
  const autoridad = await admin.taxAuthority.upsert({
    where: { code: "ARCA-CDV" },
    update: {},
    create: { code: "ARCA-CDV", name: "ARCA sintética CDV", jurisdictionId: nacion.id },
  });
  const iva = await admin.taxType.upsert({
    where: { code: "IVA" },
    update: {},
    create: { code: "IVA", name: "IVA" },
  });
  const familia = await admin.calcFamily.findUniqueOrThrow({ where: { key: "VAT_RI" } });
  const crear = async (code: string): Promise<Regimen> => {
    const r = await admin.taxRegime.upsert({
      where: { code },
      update: { calcFamilyId: familia.id },
      create: {
        code,
        name: `Régimen sintético ${code}`,
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: autoridad.id,
        calcFamilyId: familia.id,
      },
    });
    return { id: r.id, taxTypeId: r.taxTypeId, jurisdictionId: r.jurisdictionId };
  };
  regimen = await crear("RI-CDV");
  otroRegimen = await crear("RI-CDV2");
});

afterAll(async () => {
  await admin.$disconnect();
  await runtime.$disconnect();
});

async function clienteNuevo() {
  sufijo += 1;
  return admin.client.create({
    data: {
      firmId: FIRM,
      legalName: `Cliente sintético CDV ${sufijo}`,
      tradeName: `Sintético CDV ${sufijo}`,
      cuit: cuitSintetico(),
      status: "ACTIVE",
    },
  });
}

type Estado = "VERIFIED" | "PENDING_VERIFICATION" | "SUPERSEDED";

interface Escenario {
  clientId: string;
  obligationId: string;
  octubre: string;
  noviembre: string;
  diciembre: string;
}

/** Cliente nuevo con IVA de octubre, noviembre y diciembre de 2026 y la obligación de noviembre. */
async function escenario(): Promise<Escenario> {
  const cliente = await clienteNuevo();
  const perfil = await admin.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId: cliente.id,
      legalName: cliente.legalName,
      cuit: cliente.cuit ?? cuitSintetico(),
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  const periodo = (mes: number) =>
    admin.taxPeriod.create({
      data: {
        firmId: FIRM,
        clientId: cliente.id,
        taxTypeId: regimen.taxTypeId,
        startDate: new Date(Date.UTC(2026, mes - 1, 1)),
        endDate: new Date(Date.UTC(2026, mes, 0)),
        label: `Sintético ${mes}/2026`,
      },
    });
  const [oct, nov, dic] = [await periodo(10), await periodo(11), await periodo(12)];
  const obligacion = await admin.taxObligation.create({
    data: {
      firmId: FIRM,
      clientId: cliente.id,
      profileVersionId: perfil.id,
      regimeId: regimen.id,
      periodId: nov!.id,
      status: "READY_TO_CALCULATE",
    },
  });
  return {
    clientId: cliente.id,
    obligationId: obligacion.id,
    octubre: oct!.id,
    noviembre: nov!.id,
    diciembre: dic!.id,
  };
}

async function lote(
  e: Escenario,
  datos: {
    periodId?: string | null;
    estado?: Estado;
    monto: string;
    carryForward?: boolean;
    regimeId?: string | null;
    jurisdictionId?: string | null;
    kind?: string;
    consumido?: string;
  },
) {
  const creado = await admin.taxCreditLot.create({
    data: {
      firmId: FIRM,
      clientId: e.clientId,
      taxTypeId: regimen.taxTypeId,
      regimeId: datos.regimeId === undefined ? regimen.id : datos.regimeId,
      jurisdictionId:
        datos.jurisdictionId === undefined ? regimen.jurisdictionId : datos.jurisdictionId,
      periodId: datos.periodId === undefined ? e.octubre : datos.periodId,
      kind: datos.kind ?? "IVA_TECNICO",
      originalAmount: datos.monto,
      reference: "Sintético CDV",
      verificationStatus: datos.estado ?? "VERIFIED",
      carryForward: datos.carryForward ?? true,
      createdByUserId: USER,
      ...(datos.estado === "PENDING_VERIFICATION"
        ? {}
        : { verifiedByUserId: USER, verifiedAt: new Date() }),
    },
  });
  if (datos.consumido) {
    await admin.taxCreditMovement.create({
      data: {
        firmId: FIRM,
        clientId: e.clientId,
        lotId: creado.id,
        kind: "ROLLED_FORWARD",
        amount: datos.consumido,
        reference: "Consumo sintético CDV",
        createdByUserId: USER,
      },
    });
  }
  return creado;
}

async function disponibleDeLaPosicion(e: Escenario): Promise<string> {
  const posicion = await servicio.position(ctx, e.clientId, e.noviembre);
  const fila = posicion.find((item) => item.obligationId === e.obligationId);
  if (!fila) throw new Error("la posición no trae la obligación del escenario");
  return fila.availableCredit;
}

describe("Disponible de la posición = saldos vigentes (pruebas en rojo antes del arreglo)", () => {
  it("(a) un lote reemplazado y otro verificado de igual monto suman un solo monto", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000", estado: "SUPERSEDED" });
    await lote(e, { monto: "1000.0000", estado: "VERIFIED" });
    expect(await disponibleDeLaPosicion(e)).toBe("1000.0000");
  });

  it("(b) un lote sin verificar no suma", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000" });
    await lote(e, { monto: "500.0000", estado: "PENDING_VERIFICATION" });
    expect(await disponibleDeLaPosicion(e)).toBe("1000.0000");
  });

  it("(c) un lote que no se arrastra (carryForward = false) no suma", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000" });
    await lote(e, { monto: "300.0000", carryForward: false });
    expect(await disponibleDeLaPosicion(e)).toBe("1000.0000");
  });

  it("(d) un lote de un período posterior no suma; uno anterior, del mismo período o sin período sí", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000", periodId: e.octubre });
    await lote(e, { monto: "200.0000", periodId: e.noviembre });
    await lote(e, { monto: "50.0000", periodId: null });
    await lote(e, { monto: "700.0000", periodId: e.diciembre });
    expect(await disponibleDeLaPosicion(e)).toBe("1250.0000");
  });

  it("(e) un lote de otro régimen o de otra jurisdicción no suma; uno sin régimen ni jurisdicción sí", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000" });
    await lote(e, { monto: "400.0000", regimeId: otroRegimen.id });
    await lote(e, { monto: "600.0000", jurisdictionId: otraJurisdiccionId });
    await lote(e, { monto: "25.0000", regimeId: null, jurisdictionId: null });
    expect(await disponibleDeLaPosicion(e)).toBe("1025.0000");
  });

  it("(f) los consumos restan y un lote consumido por completo no aporta", async () => {
    const e = await escenario();
    await lote(e, { monto: "1000.0000", consumido: "250.0000" });
    await lote(e, { monto: "800.0000", consumido: "800.0000" });
    expect(await disponibleDeLaPosicion(e)).toBe("750.0000");
  });

  it("(j) la suma de «Disponible» de Saldos coincide con la de la posición", async () => {
    const e = await escenario();
    await lote(e, { monto: "1749.3400", estado: "VERIFIED", consumido: "49.3400" });
    await lote(e, { monto: "1749.3400", estado: "SUPERSEDED" });
    await lote(e, { monto: "0.0000", estado: "SUPERSEDED", kind: "IVA_LIBRE" });
    await lote(e, { monto: "10.0000", kind: "IVA_LIBRE", periodId: null });
    const saldos = await servicio.creditLedger(ctx, e.clientId, {});
    const sumaSaldos = saldos.reduce(
      (suma, fila) => suma.plus(fila.available),
      new Prisma.Decimal(0),
    );
    expect(sumaSaldos.toFixed(4)).toBe("1710.0000");
    expect(await disponibleDeLaPosicion(e)).toBe(sumaSaldos.toFixed(4));
  });

  it("(h) la lista de Saldos devuelve una sola fila vigente cuando hay un lote reemplazado y otro verificado del mismo monto", async () => {
    const e = await escenario();
    const reemplazado = await lote(e, { monto: "1000.0000", estado: "SUPERSEDED" });
    const vigente = await lote(e, { monto: "1000.0000", estado: "VERIFIED" });
    const sinVerificar = await lote(e, { monto: "40.0000", estado: "PENDING_VERIFICATION" });
    const filas = await servicio.creditLedger(ctx, e.clientId, {});
    expect(filas.map((fila) => fila.id).sort()).toEqual([vigente.id, sinVerificar.id].sort());
    expect(filas.some((fila) => fila.id === reemplazado.id)).toBe(false);
  });

  it("(h2) el libro puede pedir los reemplazados con su estado, para auditoría", async () => {
    const e = await escenario();
    const reemplazado = await lote(e, { monto: "1000.0000", estado: "SUPERSEDED" });
    await lote(e, { monto: "1000.0000", estado: "VERIFIED" });
    const filas = await servicio.creditLedger(ctx, e.clientId, { incluirReemplazados: true });
    expect(filas).toHaveLength(2);
    expect(filas.find((fila) => fila.id === reemplazado.id)?.verificationStatus).toBe("SUPERSEDED");
  });

  it("(g2) con el rol runtime y su contexto RLS, la pieza compartida da la misma cifra que la posición", async () => {
    const e = await escenario();
    await lote(e, { monto: "900.0000", estado: "SUPERSEDED" });
    await lote(e, { monto: "900.0000", consumido: "100.0000" });
    await lote(e, { monto: "75.0000", estado: "PENDING_VERIFICATION" });
    const porLaPieza = await runtime.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${USER}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      const periodIds = await periodosElegibles(tx, {
        firmId: FIRM,
        clientId: e.clientId,
        taxTypeId: regimen.taxTypeId,
        hasta: new Date(Date.UTC(2026, 11, 0)),
      });
      const lots = await tx.taxCreditLot.findMany({
        where: filtroSaldosVigentes({
          firmId: FIRM,
          clientId: e.clientId,
          taxTypeId: regimen.taxTypeId,
          regimeId: regimen.id,
          jurisdictionId: regimen.jurisdictionId,
          periodIds,
        }),
        include: { movements: true },
      });
      return sumaDisponible(lots).toFixed(4);
    });
    expect(porLaPieza).toBe("800.0000");
    expect(await disponibleDeLaPosicion(e)).toBe(porLaPieza);
  });
});
