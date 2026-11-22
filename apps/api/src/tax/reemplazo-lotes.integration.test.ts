import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { MonthlyWorkpaperService } from "./workpaper-service.js";

/**
 * Reemplazo y recarga de lotes de fuentes (brief 4I). Integración con base real.
 *
 * Causas que cubren estas pruebas:
 * - Reemplazar con el mismo archivo: la deduplicación por fileHash devuelve el
 *   lote revisado (COMMITTED) y la importación intenta validarlo.
 * - Recargar tras retirar: el lote retirado conserva el fileHash y la carga lo
 *   toma como duplicado, sin crear lote nuevo ni avisar.
 *
 * Usa un estudio, un cliente y un expediente propios por corrida. Los maestros
 * (impuestos y regímenes RI e IIBB_LOCAL_TUC) vienen de los seeds, como en CI.
 */

const RUN = randomBytes(4).toString("hex");
const ingestion = new IngestionService();
const workpapers = new MonthlyWorkpaperService();

// Libro de ventas sintético del paquete tax-engine (CUIT 20-45427483-1).
const CUIT_LIBRO = "20454274831";
const libro = (nombre: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../packages/tax-engine/src/fixtures/arca/${nombre}`, import.meta.url)));

const ARCA_V1 = [
  { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "1", cuit: "20111111111", issuedOn: "2026-03-10", net: "1000.00", hasIva: true, iva21: "210.00" },
  { direction: "SALE", letter: "B", pointOfSale: "0001", numberFrom: "2", cuit: "20111111111", issuedOn: "2026-03-11", net: "2000.00", hasIva: true, iva21: "420.00" },
];
const ARCA_V2 = [
  { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "1", cuit: "20111111111", issuedOn: "2026-03-10", net: "1000.00", hasIva: true, iva21: "210.00" },
  { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "3", cuit: "20111111111", issuedOn: "2026-03-12", net: "500.00", hasIva: true, iva21: "105.00" },
];
const PERCEPCION_V1 = [
  { kind: "PERCEPCION", cuitResponsable: "20111111111", cuitAgente: "20222222223", concept: "IIBB", base: "1000.00", amount: "30.00", rate: "3.0", issuedOn: "2026-03-10", certificateNumber: "0001-000001", documentKind: "INVOICE" },
];
const PERCEPCION_V2 = [
  { kind: "PERCEPCION", cuitResponsable: "20111111111", cuitAgente: "20222222223", concept: "IIBB", base: "1500.00", amount: "45.00", rate: "3.0", issuedOn: "2026-03-14", certificateNumber: "0001-000002", documentKind: "INVOICE" },
];

type Escenario = {
  firmId: string;
  clientId: string;
  userId: string;
  ctx: { userId: string; firmId: string; clientId: string; actorKind: "USER" };
  ivaTaxTypeId: string;
  iibbTaxTypeId: string;
  ivaPeriodId: string;
  iibbPeriodId: string;
  workpaperId: string;
};

let e: Escenario;
/** Lote de percepciones vigente tras la recarga (la prueba de reemplazo lo toma de la anterior). */
let percepcionesVigenteId = "";

async function crearEscenario(): Promise<Escenario> {
  const firmId = randomUUID();
  const userId = randomUUID();
  const clientId = randomUUID();
  const cuit = `20${String(randomInt(900_000_000) + 100_000_000)}`;
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${userId}', 'titular.rl.${RUN}@test.local', 'Titular RL', 'x', now())
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${firmId}', 'Estudio RL ${RUN}', 'Estudio RL', now())
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${clientId}', '${firmId}', 'Cliente RL', '${cuit}', now())
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${firmId}', '${userId}', 'OWNER', 'ACTIVE', now())
  `);
  const ctx = { userId, firmId, clientId, actorKind: "USER" as const };

  const ivaType = await prisma.taxType.findUniqueOrThrow({ where: { code: "IVA" } });
  const iibbType = await prisma.taxType.findUniqueOrThrow({ where: { code: "IIBB" } });
  const ri = await prisma.taxRegime.findUniqueOrThrow({ where: { code: "RI" } });
  const iibbRegime = await prisma.taxRegime.findUniqueOrThrow({ where: { code: "IIBB_LOCAL_TUC" } });
  const profile = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId,
      clientId,
      version: 1,
      legalName: "Cliente RL",
      cuit,
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      createdByUserId: userId,
    },
  });

  const periodo = (taxTypeId: string) =>
    prisma.taxPeriod.create({
      data: {
        firmId,
        clientId,
        taxTypeId,
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-03-31T00:00:00.000Z"),
        label: "Marzo 2026 RL",
      },
    });
  const ivaPeriod = await periodo(ivaType.id);
  const iibbPeriod = await periodo(iibbType.id);

  for (const [period, regime] of [
    [ivaPeriod, ri],
    [iibbPeriod, iibbRegime],
  ] as const) {
    await prisma.taxObligation.create({
      data: {
        firmId,
        clientId,
        profileVersionId: profile.id,
        regimeId: regime.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        dueDate: new Date("2026-04-20T00:00:00.000Z"),
        materializedBy: userId,
      },
    });
  }

  const wp = await prisma.monthlyTaxWorkpaper.create({
    data: {
      firmId,
      clientId,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T00:00:00.000Z"),
      revision: 1,
      status: "COLLECTING_INPUTS",
    },
  });

  return {
    firmId,
    clientId,
    userId,
    ctx,
    ivaTaxTypeId: ivaType.id,
    iibbTaxTypeId: iibbType.id,
    ivaPeriodId: ivaPeriod.id,
    iibbPeriodId: iibbPeriod.id,
    workpaperId: wp.id,
  };
}

/** Carga, valida y confirma un lote de una fuente del expediente (como lo hace la pantalla). */
async function cargarLote(opts: {
  origin: string;
  adapterVersion: string;
  taxTypeId: string;
  periodId: string;
  sourceCode: string;
  fileHash: string;
  fileName: string;
  rows: readonly Record<string, unknown>[];
  replacesBatchId?: string;
}) {
  const batch = await ingestion.createBatch(e.ctx, {
    clientId: e.clientId,
    origin: opts.origin,
    taxTypeId: opts.taxTypeId,
    periodId: opts.periodId,
    adapterVersion: opts.adapterVersion,
    fileName: opts.fileName,
    fileHash: opts.fileHash,
    workpaperId: e.workpaperId,
    sourceCode: opts.sourceCode,
  });
  if (batch.status === "UPLOADED") {
    await ingestion.validateBatch(e.ctx, batch.id, opts.rows as never);
  }
  await ingestion.commitBatch(e.ctx, batch.id, CUIT_LIBRO, opts.replacesBatchId);
  return batch;
}

async function marcarRevisado(batchId: string) {
  await prisma.workpaperImportBatch.updateMany({
    where: { importBatchId: batchId, workpaperId: e.workpaperId },
    data: { status: "REVIEWED", reviewedAt: new Date(), reviewedByUserId: e.userId },
  });
}

async function enlaceDe(batchId: string) {
  return prisma.workpaperImportBatch.findUniqueOrThrow({
    where: { workpaperId_importBatchId: { workpaperId: e.workpaperId, importBatchId: batchId } },
  });
}

const IVA = () => ({
  origin: "ARCA",
  adapterVersion: "ARCA_LIBRO_IVA_V1",
  taxTypeId: e.ivaTaxTypeId,
  periodId: e.ivaPeriodId,
  sourceCode: "ARCA_IVA_SALES",
});
const PERC = () => ({
  origin: "DGR_RPI_TUC",
  adapterVersion: "ARCA_RET_V1",
  taxTypeId: e.iibbTaxTypeId,
  periodId: e.iibbPeriodId,
  sourceCode: "IIBB_RPI_TUC",
});

beforeAll(async () => {
  e = await crearEscenario();
});

describe("reemplazo y recarga de lotes de fuentes", () => {
  it("reemplazar un libro IVA revisado con el mismo archivo no crea lote y lo dice en una frase", async () => {
    const v1 = await cargarLote({ ...IVA(), fileHash: "sha256:libro-rl", fileName: "ventas.xlsx", rows: ARCA_V1 });
    await marcarRevisado(v1.id);

    const reemplazo = ingestion.importSifereWorkbook(e.ctx, {
      clientId: e.clientId,
      clientCuit: CUIT_LIBRO,
      direction: "SALE",
      raw: libro("mis-comprobantes-emitidos.xlsx"),
      fileName: "mis-comprobantes-emitidos.xlsx",
      fileHash: "sha256:libro-rl",
      taxTypeId: e.ivaTaxTypeId,
      periodId: e.ivaPeriodId,
      workpaperId: e.workpaperId,
      replacesBatchId: v1.id,
    });
    await expect(reemplazo).rejects.toMatchObject({ code: "REPLACEMENT_SAME_FILE" });

    const lotes = await prisma.importBatch.count({ where: { clientId: e.clientId, fileHash: "sha256:libro-rl" } });
    expect(lotes).toBe(1);
    expect((await enlaceDe(v1.id)).status).toBe("REVIEWED");
  });

  it("cargar otra vez el libro vigente sin reemplazar avisa que ya está cargado", async () => {
    await expect(
      ingestion.importSifereWorkbook(e.ctx, {
        clientId: e.clientId,
        clientCuit: CUIT_LIBRO,
        direction: "SALE",
        raw: libro("mis-comprobantes-emitidos.xlsx"),
        fileName: "mis-comprobantes-emitidos.xlsx",
        fileHash: "sha256:libro-rl",
        taxTypeId: e.ivaTaxTypeId,
        periodId: e.ivaPeriodId,
        workpaperId: e.workpaperId,
      }),
    ).rejects.toMatchObject({ code: "BATCH_ALREADY_COMMITTED" });
  });

  it("reemplazar un libro IVA revisado con un archivo distinto crea el lote nuevo y deja el anterior REPLACED con enlace", async () => {
    const viejo = await prisma.importBatch.findFirstOrThrow({ where: { clientId: e.clientId, fileHash: "sha256:libro-rl" } });
    const nuevo = await cargarLote({
      ...IVA(),
      fileHash: "sha256:libro-rl-v2",
      fileName: "ventas-corregidas.csv",
      rows: ARCA_V2,
      replacesBatchId: viejo.id,
    });
    const enlaceNuevo = await enlaceDe(nuevo.id);
    const enlaceViejo = await enlaceDe(viejo.id);
    expect(enlaceNuevo.status).toBe("PENDING_REVIEW");
    expect(enlaceViejo).toMatchObject({ status: "REPLACED", replacedByBatchId: enlaceNuevo.id });
    expect(enlaceViejo.replacedAt).toBeInstanceOf(Date);
  });

  it("retirar un TXT de percepciones y volver a cargar el mismo archivo crea un lote nuevo vigente", async () => {
    const v1 = await cargarLote({ ...PERC(), fileHash: "sha256:perc-rl", fileName: "percepciones.txt", rows: PERCEPCION_V1 });
    await marcarRevisado(v1.id);
    await workpapers.retireBatch(e.ctx, e.workpaperId, v1.id, "Archivo cargado por error");

    const recarga = await ingestion.createBatch(e.ctx, {
      clientId: e.clientId,
      ...PERC(),
      fileName: "percepciones.txt",
      fileHash: "sha256:perc-rl",
      workpaperId: e.workpaperId,
      sourceCode: "IIBB_RPI_TUC",
    });
    expect(recarga.id).not.toBe(v1.id);
    expect(recarga.status).toBe("UPLOADED");
    await ingestion.validateBatch(e.ctx, recarga.id, PERCEPCION_V1 as never);
    await ingestion.commitBatch(e.ctx, recarga.id, CUIT_LIBRO);

    expect((await enlaceDe(recarga.id)).status).toBe("PENDING_REVIEW");
    const retirado = await enlaceDe(v1.id);
    expect(retirado).toMatchObject({ status: "RETIRED", retireReason: "Archivo cargado por error" });
    percepcionesVigenteId = recarga.id;
  });

  it("reemplazar el TXT de percepciones revisado por uno distinto deja el anterior REPLACED", async () => {
    expect(percepcionesVigenteId).toBeTruthy();
    const vigente = { id: percepcionesVigenteId };
    await marcarRevisado(vigente.id);
    const nuevo = await cargarLote({
      ...PERC(),
      fileHash: "sha256:perc-rl-v2",
      fileName: "percepciones-corregidas.txt",
      rows: PERCEPCION_V2,
      replacesBatchId: vigente.id,
    });
    const enlaceNuevo = await enlaceDe(nuevo.id);
    expect(enlaceNuevo.status).toBe("PENDING_REVIEW");
    expect(await enlaceDe(vigente.id)).toMatchObject({ status: "REPLACED", replacedByBatchId: enlaceNuevo.id });
  });

  it("corregir y volver a cargar desde la vista de errores reemplaza el lote con filas observadas", async () => {
    const conError = await ingestion.createBatch(e.ctx, {
      clientId: e.clientId,
      ...IVA(),
      fileName: "ventas-con-error.csv",
      fileHash: "sha256:libro-error",
      workpaperId: e.workpaperId,
    });
    const validado = await ingestion.validateBatch(e.ctx, conError.id, [
      ...ARCA_V1,
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "9", cuit: "bad", issuedOn: "2026-03-13", net: "100.00", hasIva: true },
    ] as never);
    expect(validado.totals.errorRows).toBe(1);

    const corregido = await cargarLote({
      ...IVA(),
      fileHash: "sha256:libro-corregido",
      fileName: "ventas-corregidas.csv",
      rows: ARCA_V1,
      replacesBatchId: conError.id,
    });
    expect((await enlaceDe(corregido.id)).status).toBe("PENDING_REVIEW");
    expect(await enlaceDe(conError.id)).toMatchObject({ status: "REPLACED", replacedByBatchId: (await enlaceDe(corregido.id)).id });
  });
});
