import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { profitabilityRoutes } from "./profitability-routes.js";

/**
 * Saldo de caja fiscal (corte 8a): pruebas de integración con base real (ruta, servicio y RLS).
 * Datos sintéticos rotulados «CLI-SINT-01», período 10/2026, ARS. Cada prueba arma su propio cliente:
 * las liquidaciones FINALIZED no se pueden borrar ni modificar (trg_settlement_immutable), así que no
 * se reinicia nada por borrado. Requieren la base descartable del corte: DATABASE_URL (superusuario) y
 * RUNTIME_DATABASE_URL (rol contable_runtime).
 */

type Impuesto = "IVA" | "IIBB" | "TEM";
const IMPUESTOS: Impuesto[] = ["IVA", "IIBB", "TEM"];
const DJ_TOTAL: Record<Impuesto, string> = {
  IVA: "180000.0000",
  IIBB: "45000.0000",
  TEM: "12000.0000",
};

const ESTUDIO = "8a8a8a8a-0000-4000-8000-000000000001";
const ESTUDIO_OTRO = "8a8a8a8a-0000-4000-8000-000000000003";
const USUARIO = "8a8a8a8a-0000-4000-8000-000000000011";
const USUARIO_OTRO = "8a8a8a8a-0000-4000-8000-000000000012";

const runtime = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
});

interface CajaRespuesta {
  data: {
    estado: string;
    cifra: string | null;
    periodo: { id: string; etiqueta: string };
    desglose: null | {
      ventasConIva: string;
      comprasConIva: string;
      impuestos: Array<{
        impuesto: string;
        periodo: string;
        regimen: string;
        presentacionId: string;
        totalAPagar: string;
        deduccion: string;
      }>;
      totalImpuestos: string;
    };
    faltantes: Array<{ impuesto: string; periodo: string; regimen: string }>;
    comprobantes: { ventas: number; compras: number };
    inputHash: string;
    outputHash: string;
  };
  meta: Record<string, unknown>;
}

interface ErrorRespuesta {
  error: { code: string; message: string; campo?: string; comprobantes?: string[] };
}

interface VoucherSintetico {
  direccion: "SALE" | "PURCHASE";
  tipo: string;
  letra: string;
  numero: number;
  fecha: string;
  total: string;
  estado: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  moneda?: string;
  tipoCambio?: string | null;
}

interface Escenario {
  cliente: string;
  periodo: Record<Impuesto, string>;
  obligacion: Record<Impuesto, string>;
  /** Presentación (con DJ) vigente por impuesto; null si el impuesto no tiene presentación. */
  presentacion: Record<Impuesto, string | null>;
}

const ids = {
  jurisdiccion: "",
  tipo: {} as Record<Impuesto, string>,
  regimen: {} as Record<Impuesto, string>,
};

async function crearEstudioYMaestros() {
  for (const [id, nombre] of [
    [USUARIO, "Usuario 8A"],
    [USUARIO_OTRO, "Usuario 8A otro estudio"],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt") VALUES ('${id}', 'caja8a-${id.slice(-2)}@test.local', '${nombre}', 'x', now()) ON CONFLICT ("id") DO NOTHING`,
    );
  }
  for (const [id, nombre] of [
    [ESTUDIO, "Estudio 8A"],
    [ESTUDIO_OTRO, "Estudio 8A otro"],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO firms ("id", "legalName", "displayName", "updatedAt") VALUES ('${id}', '${nombre}', '${nombre}', now()) ON CONFLICT ("id") DO NOTHING`,
    );
  }
  for (const [firmId, userId] of [
    [ESTUDIO, USUARIO],
    [ESTUDIO_OTRO, USUARIO_OTRO],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt") VALUES (gen_random_uuid()::text, '${firmId}', '${userId}', 'OWNER', 'ACTIVE', now()) ON CONFLICT ("firmId", "userId") DO NOTHING`,
    );
  }
  const jurisdiccion = await prisma.jurisdiction.upsert({
    where: { code: "AR-8A" },
    update: {},
    create: { code: "AR-8A", name: "Nación 8A", kind: "NATIONAL" },
  });
  const autoridad = await prisma.taxAuthority.upsert({
    where: { code: "ARCA-8A" },
    update: {},
    create: { code: "ARCA-8A", name: "ARCA 8A", jurisdictionId: jurisdiccion.id },
  });
  ids.jurisdiccion = jurisdiccion.id;
  for (const impuesto of IMPUESTOS) {
    const tipo = await prisma.taxType.upsert({
      where: { code: impuesto },
      update: {},
      create: { code: impuesto, name: `${impuesto} (8A)` },
    });
    const regimen = await prisma.taxRegime.upsert({
      where: { code: `${impuesto}-8A` },
      update: {},
      create: {
        code: `${impuesto}-8A`,
        name: `Régimen ${impuesto} 8A`,
        taxTypeId: tipo.id,
        jurisdictionId: jurisdiccion.id,
        authorityId: autoridad.id,
      },
    });
    ids.tipo[impuesto] = tipo.id;
    ids.regimen[impuesto] = regimen.id;
  }
}

async function crearLiquidacion(
  clienteId: string,
  impuesto: Impuesto,
  periodoId: string,
  version: number,
  supersedesId?: string,
) {
  return prisma.taxSettlement.create({
    data: {
      firmId: ESTUDIO,
      clientId: clienteId,
      taxTypeId: ids.tipo[impuesto],
      regimeId: ids.regimen[impuesto],
      jurisdictionId: ids.jurisdiccion,
      periodId: periodoId,
      cutoff: new Date("2026-10-31T00:00:00.000Z"),
      version,
      engineVersion: "ar-8a-test",
      rulesHash: "sha256:8a-test",
      inputHash: `8a-in-${impuesto}-${version}-${clienteId.slice(0, 8)}`,
      outputHash: `8a-out-${impuesto}-${version}-${clienteId.slice(0, 8)}`,
      status: "FINALIZED",
      totals: {} as Prisma.InputJsonObject,
      preparedByUserId: USUARIO,
      ...(supersedesId ? { supersedesId } : {}),
    },
  });
}

/** Presentación FILED con su DJ (declaredAt y totalAPagar) sobre la liquidación indicada. */
async function crearPresentacion(
  clienteId: string,
  obligacionId: string,
  liquidacionId: string,
  totalAPagar: string,
) {
  return prisma.taxFiling.create({
    data: {
      firmId: ESTUDIO,
      clientId: clienteId,
      obligationId: obligacionId,
      settlementId: liquidacionId,
      filedAt: new Date("2026-11-10T00:00:00.000Z"),
      amountFiled: new Prisma.Decimal(totalAPagar.startsWith("-") ? "0" : totalAPagar),
      status: "FILED",
      createdByUserId: USUARIO,
      totalAPagar: new Prisma.Decimal(totalAPagar),
      impuestoDeterminado: new Prisma.Decimal(totalAPagar),
      saldoFavorTecnico: new Prisma.Decimal(0),
      saldoLibreDisponibilidad: new Prisma.Decimal(0),
      declaredByUserId: USUARIO,
      declaredAt: new Date("2026-11-12T10:00:00.000Z"),
    },
  });
}

async function crearComprobante(clienteId: string, datos: VoucherSintetico) {
  return prisma.fiscalVoucher.create({
    data: {
      firmId: ESTUDIO,
      clientId: clienteId,
      direction: datos.direccion,
      type: datos.tipo,
      letter: datos.letra,
      pointOfSale: 1,
      number: datos.numero,
      issuerCuit: "20888888881",
      receiverCuit: "20111111111",
      issuedOn: new Date(datos.fecha),
      total: new Prisma.Decimal(datos.total),
      currency: datos.moneda ?? "ARS",
      exchangeRate: datos.tipoCambio ? new Prisma.Decimal(datos.tipoCambio) : null,
      status: datos.estado,
    },
  });
}

/**
 * Cliente sintético con su período 10/2026 (IVA, IIBB, TEM), obligaciones, liquidaciones FINALIZED y DJ.
 * Opciones: dj (por impuesto; null = sin presentación), sinAprobados (solo ruido no aprobado),
 * rectificativa (IVA: una liquidación nueva FINALIZED que reemplaza a la primera, con su DJ).
 */
async function crearEscenario(
  opciones: {
    dj?: Partial<Record<Impuesto, string | null>>;
    sinAprobados?: boolean;
    rectificativa?: string;
  } = {},
): Promise<Escenario> {
  const cliente = randomUUID();
  const cuit = `20${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt") VALUES ('${cliente}', '${ESTUDIO}', 'CLI-SINT-01 ${cliente.slice(0, 8)}', '${cuit}', now())`,
  );
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: ESTUDIO,
      clientId: cliente,
      version: 1,
      legalName: `CLI-SINT-01 ${cliente.slice(0, 8)}`,
      cuit,
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01"),
      status: "ACTIVE",
      createdByUserId: USUARIO,
    },
  });
  const escenario: Escenario = {
    cliente,
    periodo: {} as Record<Impuesto, string>,
    obligacion: {} as Record<Impuesto, string>,
    presentacion: { IVA: null, IIBB: null, TEM: null },
  };
  for (const impuesto of IMPUESTOS) {
    const periodo = await prisma.taxPeriod.create({
      data: {
        firmId: ESTUDIO,
        clientId: cliente,
        taxTypeId: ids.tipo[impuesto],
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-31"),
        label: "Octubre 2026 (CLI-SINT-01)",
      },
    });
    const obligacion = await prisma.taxObligation.create({
      data: {
        firmId: ESTUDIO,
        clientId: cliente,
        profileVersionId: perfil.id,
        regimeId: ids.regimen[impuesto],
        periodId: periodo.id,
        status: "READY_TO_CALCULATE",
        materializedBy: USUARIO,
      },
    });
    escenario.periodo[impuesto] = periodo.id;
    escenario.obligacion[impuesto] = obligacion.id;

    const liquidacion = await crearLiquidacion(cliente, impuesto, periodo.id, 1);
    const dj = opciones.dj?.[impuesto] !== undefined ? opciones.dj[impuesto] : DJ_TOTAL[impuesto];
    if (dj !== null && dj !== undefined) {
      const presentacion = await crearPresentacion(cliente, obligacion.id, liquidacion.id, dj);
      escenario.presentacion[impuesto] = presentacion.id;
    }
    if (impuesto === "IVA" && opciones.rectificativa !== undefined) {
      const nueva = await crearLiquidacion(cliente, "IVA", periodo.id, 2, liquidacion.id);
      const presentacionNueva = await crearPresentacion(
        cliente,
        obligacion.id,
        nueva.id,
        opciones.rectificativa,
      );
      escenario.presentacion.IVA = presentacionNueva.id;
    }
  }

  // Ruido que no cuenta: estados no aprobados y un comprobante aprobado de otro período.
  const ruido: VoucherSintetico[] = [
    {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 4,
      fecha: "2026-10-06",
      total: "900000.0000",
      estado: "DRAFT",
    },
    {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 5,
      fecha: "2026-10-07",
      total: "800000.0000",
      estado: "IN_REVIEW",
    },
    {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 6,
      fecha: "2026-10-08",
      total: "700000.0000",
      estado: "REJECTED",
    },
    {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 7,
      fecha: "2026-10-09",
      total: "600000.0000",
      estado: "SUPERSEDED",
    },
    {
      direccion: "PURCHASE",
      tipo: "A",
      letra: "A",
      numero: 8,
      fecha: "2026-10-11",
      total: "50000.0000",
      estado: "DRAFT",
    },
    {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 9,
      fecha: "2026-11-02",
      total: "500000.0000",
      estado: "APPROVED",
    },
  ];
  for (const voucher of ruido) await crearComprobante(cliente, voucher);
  if (!opciones.sinAprobados) {
    // Base CLI-SINT-01: 1.210.000 con IVA, NC 121.000 (ventas netas 1.089.000) y compra 605.000 con IVA.
    await crearComprobante(cliente, {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 1,
      fecha: "2026-10-05",
      total: "1210000.0000",
      estado: "APPROVED",
    });
    await crearComprobante(cliente, {
      direccion: "SALE",
      tipo: "NC",
      letra: "NC",
      numero: 2,
      fecha: "2026-10-20",
      total: "121000.0000",
      estado: "APPROVED",
    });
    await crearComprobante(cliente, {
      direccion: "PURCHASE",
      tipo: "A",
      letra: "A",
      numero: 3,
      fecha: "2026-10-10",
      total: "605000.0000",
      estado: "APPROVED",
    });
  }
  return escenario;
}

/** Llama a la ruta real con un contexto de sesión inyectado (el guard de permisos se prueba en policy-coverage). */
async function pedirCaja(userId: string, firmId: string, clientId: string, periodId: string) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.userId = userId;
    req.firmId = firmId;
    req.clientId = clientId;
  });
  profitabilityRoutes(app);
  await app.ready();
  try {
    return await app.inject({
      method: "GET",
      url: `/api/v1/firms/${firmId}/clients/${clientId}/profitability/caja-fiscal?periodId=${periodId}`,
    });
  } finally {
    await app.close();
  }
}

async function cajaDe(escenario: Escenario): Promise<CajaRespuesta> {
  const res = await pedirCaja(USUARIO, ESTUDIO, escenario.cliente, escenario.periodo.IVA);
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await crearEstudioYMaestros();
});

describe("saldo de caja fiscal (corte 8a): base real, ruta y servicio", () => {
  it("CLI-SINT-01: COMPLETO con cifra 247.000,00; los estados no aprobados y el período siguiente no suman", async () => {
    const e = await crearEscenario();
    const res = await pedirCaja(USUARIO, ESTUDIO, e.cliente, e.periodo.IVA);
    expect(res.statusCode).toBe(200);
    const cuerpo: CajaRespuesta = res.json();
    expect(cuerpo.data.estado).toBe("COMPLETO");
    expect(cuerpo.data.cifra).toBe("247000.00");
    expect(cuerpo.data.desglose?.ventasConIva).toBe("1089000.00");
    expect(cuerpo.data.desglose?.comprasConIva).toBe("605000.00");
    expect(cuerpo.data.desglose?.totalImpuestos).toBe("237000.00");
    expect(cuerpo.data.faltantes).toEqual([]);
    expect(cuerpo.data.comprobantes).toEqual({ ventas: 2, compras: 1 });
    expect(cuerpo.meta).toMatchObject({ base: "CAJA_FISCAL", publicado: false, moneda: "ARS" });
  });

  it("determinismo: dos consultas con los mismos datos dan el mismo hash de entradas y de salida", async () => {
    const e = await crearEscenario();
    const a = await cajaDe(e);
    const b = await cajaDe(e);
    expect(a.data.inputHash).toBe(b.data.inputHash);
    expect(a.data.outputHash).toBe(b.data.outputHash);
  });

  it("variante i: DJ de IVA con totalAPagar −30.000,00 deduce 0 y la cifra es 427.000,00 (S-8.4)", async () => {
    const e = await crearEscenario({ dj: { IVA: "-30000.0000" } });
    const cuerpo = await cajaDe(e);
    expect(cuerpo.data.estado).toBe("COMPLETO");
    expect(cuerpo.data.cifra).toBe("427000.00");
    const iva = cuerpo.data.desglose?.impuestos.find((i) => i.impuesto === "IVA");
    expect(iva?.totalAPagar).toBe("-30000.00");
    expect(iva?.deduccion).toBe("0.00");
  });

  it("variante ii: falta la DJ de TEM 10/2026 → PARCIAL con el faltante y sin cifra (D13-3 a)", async () => {
    const e = await crearEscenario({ dj: { TEM: null } });
    const cuerpo = await cajaDe(e);
    expect(cuerpo.data.estado).toBe("PARCIAL");
    expect(cuerpo.data.cifra).toBeNull();
    expect(cuerpo.data.faltantes).toEqual([
      { impuesto: "TEM", periodo: "10/2026", regimen: "TEM-8A" },
    ]);
    expect(cuerpo.data.desglose?.totalImpuestos).toBe("225000.00");
  });

  it("variante iii: período sin comprobantes aprobados → SIN_DATOS, no es cero", async () => {
    const e = await crearEscenario({ sinAprobados: true });
    const cuerpo = await cajaDe(e);
    expect(cuerpo.data.estado).toBe("SIN_DATOS");
    expect(cuerpo.data.cifra).toBeNull();
    expect(cuerpo.data.desglose).toBeNull();
    expect(cuerpo.data.comprobantes).toEqual({ ventas: 0, compras: 0 });
  });

  it("variante iv: comprobante en USD sin tipo de cambio → 422 con el motivo y el comprobante (L-021)", async () => {
    const e = await crearEscenario();
    const usd = await crearComprobante(e.cliente, {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 20,
      fecha: "2026-10-12",
      total: "100.0000",
      estado: "APPROVED",
      moneda: "USD",
      tipoCambio: null,
    });
    const res = await pedirCaja(USUARIO, ESTUDIO, e.cliente, e.periodo.IVA);
    expect(res.statusCode).toBe(422);
    const error: ErrorRespuesta = res.json();
    expect(error.error.code).toBe("TIPO_DE_CAMBIO_REQUERIDO");
    expect(error.error.campo).toBe("exchangeRate");
    expect(error.error.message).toContain("tipo de cambio");
    expect(error.error.comprobantes).toEqual([usd.id]);
  });

  it("L-022: tipo de cambio cero también bloquea con el motivo", async () => {
    const e = await crearEscenario();
    const usd = await crearComprobante(e.cliente, {
      direccion: "PURCHASE",
      tipo: "A",
      letra: "A",
      numero: 21,
      fecha: "2026-10-13",
      total: "100.0000",
      estado: "APPROVED",
      moneda: "USD",
      tipoCambio: "0.00000000",
    });
    const res = await pedirCaja(USUARIO, ESTUDIO, e.cliente, e.periodo.IVA);
    expect(res.statusCode).toBe(422);
    const error: ErrorRespuesta = res.json();
    expect(error.error.code).toBe("TIPO_DE_CAMBIO_REQUERIDO");
    expect(error.error.comprobantes).toEqual([usd.id]);
  });

  it("moneda extranjera con tipo de cambio: se pasa a pesos con total × tasa, a centavos (S-8.1)", async () => {
    const e = await crearEscenario();
    await crearComprobante(e.cliente, {
      direccion: "SALE",
      tipo: "A",
      letra: "A",
      numero: 22,
      fecha: "2026-10-14",
      total: "100.0000",
      estado: "APPROVED",
      moneda: "USD",
      tipoCambio: "1050.50000000",
    });
    const cuerpo = await cajaDe(e);
    expect(cuerpo.data.desglose?.ventasConIva).toBe("1194050.00");
    expect(cuerpo.data.cifra).toBe("352050.00");
  });

  it("rectificativa: usa la DJ de la liquidación vigente; la de la versión reemplazada no cuenta", async () => {
    const e = await crearEscenario({ rectificativa: "170000.0000" });
    const cuerpo = await cajaDe(e);
    expect(cuerpo.data.cifra).toBe("257000.00");
    const iva = cuerpo.data.desglose?.impuestos.find((i) => i.impuesto === "IVA");
    expect(iva?.presentacionId).toBe(e.presentacion.IVA);
    expect(iva?.totalAPagar).toBe("170000.00");
  });

  it("otro estudio: 404 CLIENT_NOT_FOUND, igual que un cliente inexistente (no revela existencia)", async () => {
    const e = await crearEscenario();
    const otroEstudio = await pedirCaja(USUARIO_OTRO, ESTUDIO_OTRO, e.cliente, e.periodo.IVA);
    const inexistente = await pedirCaja(USUARIO, ESTUDIO, randomUUID(), e.periodo.IVA);
    expect(otroEstudio.statusCode).toBe(404);
    expect(otroEstudio.json<ErrorRespuesta>().error.code).toBe("CLIENT_NOT_FOUND");
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json<ErrorRespuesta>().error).toEqual(
      otroEstudio.json<ErrorRespuesta>().error,
    );
  });

  it("período de otro cliente: 404 PERIOD_NOT_FOUND", async () => {
    const propio = await crearEscenario();
    const otro = await crearEscenario();
    const res = await pedirCaja(USUARIO, ESTUDIO, propio.cliente, otro.periodo.IVA);
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorRespuesta>().error.code).toBe("PERIOD_NOT_FOUND");
  });

  it("RLS con el rol de producción contable_runtime: el otro estudio no ve cliente, comprobantes ni DJ; el propio sí", async () => {
    const e = await crearEscenario();
    const visibilidad = (firmId: string, userId: string) =>
      runtime.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
        return {
          clientes: await tx.client.count({ where: { id: e.cliente } }),
          comprobantes: await tx.fiscalVoucher.count({ where: { clientId: e.cliente } }),
          presentaciones: await tx.taxFiling.count({ where: { clientId: e.cliente } }),
        };
      });
    expect(await visibilidad(ESTUDIO_OTRO, USUARIO_OTRO)).toEqual({
      clientes: 0,
      comprobantes: 0,
      presentaciones: 0,
    });
    const propio = await visibilidad(ESTUDIO, USUARIO);
    expect(propio.clientes).toBe(1);
    expect(propio.comprobantes).toBeGreaterThan(0);
    expect(propio.presentaciones).toBeGreaterThan(0);
  });
});
