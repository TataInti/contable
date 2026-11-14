import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { strFromU8, unzipSync } from "fflate";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Libros de compras y ventas (corte 7a) por la ruta real: API, guard, RLS y exportador.
 * Datos sintéticos rotulados («Cliente sintético 7A»): CUIT, comprobantes e importes son ficticios.
 * Requiere la base desechable de pruebas con migraciones, RLS y seeds (como en la CI).
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_NAME = "Cliente sintético 7A";
const PERIOD_LABEL = "Octubre 2026";
const CUIT_KEYS = ["CLIENT", "S1", "S2", "S3", "S4", "S5", "R1", "R2"] as const;
type CuitKey = (typeof CUIT_KEYS)[number];

const FISCAL_HEADERS = [
  "Fecha de emisión",
  "Fecha contable",
  "Tipo",
  "Letra",
  "Punto de venta",
  "Número",
  "CUIT emisor",
  "CUIT receptor",
  "Moneda",
  "Tipo de cambio",
  "Neto",
  "IVA 21 %",
  "IVA 10,5 %",
  "IVA 27 %",
  "Exento",
  "Otros tributos",
  "Total",
];

interface VoucherSpec {
  label: string;
  direction: "PURCHASE" | "SALE";
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  type: string;
  letter: string;
  pointOfSale: number;
  number: number;
  issuer: CuitKey;
  receiver: CuitKey;
  issuedOn: string;
  currency?: string;
  exchangeRate?: string;
  total: string;
  components: Array<[string, string]>;
}

/** Comprobantes sintéticos del período (octubre 2026) y uno fuera del período. */
const SPECS: VoucherSpec[] = [
  { label: "P1 factura A", direction: "PURCHASE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 1, number: 100, issuer: "S1", receiver: "CLIENT", issuedOn: "2026-10-05", total: "1210.00", components: [["NETO", "1000.00"], ["IVA_21", "210.00"]] },
  { label: "P2 factura A 10,5 %", direction: "PURCHASE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 1, number: 101, issuer: "S2", receiver: "CLIENT", issuedOn: "2026-10-10", total: "1105.00", components: [["NETO", "1000.00"], ["IVA_105", "105.00"]] },
  { label: "P10 factura en dólares con tipo de cambio", direction: "PURCHASE", status: "APPROVED", type: "B", letter: "B", pointOfSale: 1, number: 200, issuer: "S4", receiver: "CLIENT", issuedOn: "2026-10-12", currency: "USD", exchangeRate: "1000", total: "12.10", components: [["NETO", "10.00"], ["IVA_21", "2.10"]] },
  { label: "P3 nota de crédito", direction: "PURCHASE", status: "APPROVED", type: "NC", letter: "NC", pointOfSale: 1, number: 5, issuer: "S1", receiver: "CLIENT", issuedOn: "2026-10-15", total: "121.00", components: [["NETO", "100.00"], ["IVA_21", "21.00"]] },
  { label: "P4 borrador", direction: "PURCHASE", status: "DRAFT", type: "A", letter: "A", pointOfSale: 1, number: 102, issuer: "S5", receiver: "CLIENT", issuedOn: "2026-10-16", total: "500.00", components: [["NETO", "500.00"]] },
  { label: "P5 en revisión", direction: "PURCHASE", status: "IN_REVIEW", type: "A", letter: "A", pointOfSale: 1, number: 103, issuer: "S5", receiver: "CLIENT", issuedOn: "2026-10-17", total: "300.00", components: [["NETO", "300.00"]] },
  { label: "P6 rechazado", direction: "PURCHASE", status: "REJECTED", type: "A", letter: "A", pointOfSale: 1, number: 104, issuer: "S5", receiver: "CLIENT", issuedOn: "2026-10-18", total: "200.00", components: [["NETO", "200.00"]] },
  { label: "P7 reemplazado", direction: "PURCHASE", status: "SUPERSEDED", type: "A", letter: "A", pointOfSale: 1, number: 105, issuer: "S5", receiver: "CLIENT", issuedOn: "2026-10-19", total: "150.00", components: [["NETO", "150.00"]] },
  { label: "P8 posible duplicado (1)", direction: "PURCHASE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 2, number: 7, issuer: "S3", receiver: "CLIENT", issuedOn: "2026-10-20", total: "242.00", components: [["NETO", "200.00"], ["IVA_21", "42.00"]] },
  { label: "P9 posible duplicado (2)", direction: "PURCHASE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 2, number: 7, issuer: "S3", receiver: "CLIENT", issuedOn: "2026-10-21", total: "242.00", components: [["NETO", "200.00"], ["IVA_21", "42.00"]] },
  { label: "P11 dólares sin tipo de cambio", direction: "PURCHASE", status: "APPROVED", type: "B", letter: "B", pointOfSale: 1, number: 201, issuer: "S4", receiver: "CLIENT", issuedOn: "2026-10-22", currency: "USD", total: "50.00", components: [["NETO", "50.00"]] },
  { label: "P12 fuera del período", direction: "PURCHASE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 1, number: 300, issuer: "S1", receiver: "CLIENT", issuedOn: "2026-09-30", total: "999.00", components: [["NETO", "999.00"]] },
  { label: "V1 factura A venta", direction: "SALE", status: "APPROVED", type: "A", letter: "A", pointOfSale: 3, number: 1, issuer: "CLIENT", receiver: "R1", issuedOn: "2026-10-20", total: "2420.00", components: [["NETO", "2000.00"], ["IVA_21", "420.00"]] },
  { label: "V2 factura B venta exenta", direction: "SALE", status: "APPROVED", type: "B", letter: "B", pointOfSale: 3, number: 2, issuer: "CLIENT", receiver: "R2", issuedOn: "2026-10-21", total: "1000.00", components: [["NETO", "900.00"], ["EXENTO", "100.00"]] },
  { label: "V3 borrador de venta", direction: "SALE", status: "DRAFT", type: "B", letter: "B", pointOfSale: 3, number: 3, issuer: "CLIENT", receiver: "R2", issuedOn: "2026-10-22", total: "999.00", components: [["NETO", "999.00"]] },
];

/**
 * Totales esperados, calculados a mano desde SPECS (no con el servicio):
 * compras incluidas P1 + P2 + P10 (convertido) + P3 (nota de crédito, resta).
 */
const EXPECTED = {
  purchases: {
    count: 4,
    excludedCount: 7,
    excluded: [["DRAFT", 1], ["IN_REVIEW", 1], ["REJECTED", 1], ["SUPERSEDED", 1], ["POSSIBLE_DUPLICATE", 2], ["MISSING_EXCHANGE_RATE", 1]],
    totals: { neto: "11900", iva21: "2289", iva105: "105", iva27: "0", exento: "0", otrosTributos: "0", total: "14294" },
  },
  sales: {
    count: 2,
    excludedCount: 1,
    excluded: [["DRAFT", 1]],
    totals: { neto: "2900", iva21: "420", iva105: "0", iva27: "0", exento: "100", otrosTributos: "0", total: "3420" },
  },
};

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
let ownerToken = "";
let ownerBToken = "";
let preparerToken = "";
let clientId = "";
let periodId = "";
const sessionIds: string[] = [];
const cuits = {} as Record<CuitKey, string>;

function validTestCuit(): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

/** Lee la primera hoja: textos de las celdas inline y valores de las numéricas, fila por fila. */
function readSheet(buffer: Buffer): { sheetName: string; grid: string[][] } {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetName = /name="([^"]+)"/.exec(strFromU8(files["xl/workbook.xml"] ?? new Uint8Array()))?.[1] ?? "";
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
  const grid: string[][] = [];
  for (const row of sheet.matchAll(/<row r="\d+">(.*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
      const body = cell[1] ?? "";
      values.push(/<t>(.*?)<\/t>/.exec(body)?.[1] ?? /<v>(.*?)<\/v>/.exec(body)?.[1] ?? "");
    }
    grid.push(values);
  }
  return { sheetName, grid };
}

function runAsRuntime<T>(userId: string, scopedClientId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM_ALFA}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${scopedClientId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
    return fn(tx);
  });
}

function get(token: string, url: string) {
  return app.inject({ method: "GET", url, cookies: { refresh_token: token } });
}

const base = `/api/v1/firms/${FIRM_ALFA}/clients`;

beforeAll(async () => {
  const runtimeConnection = process.env.RUNTIME_DATABASE_URL;
  if (!runtimeConnection) throw new Error("RUNTIME_DATABASE_URL debe apuntar a una base de pruebas desechable");
  runtimePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeConnection }) });
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  ownerToken = randomBytes(32).toString("base64url");
  ownerBToken = randomBytes(32).toString("base64url");
  preparerToken = randomBytes(32).toString("base64url");
  const sessions = [
    { userId: OWNER_A, token: ownerToken },
    { userId: OWNER_B, token: ownerBToken },
    { userId: PREPARER_A, token: preparerToken },
  ].map(({ userId, token }) => ({
    id: randomUUID(),
    userId,
    refreshTokenHash: sha256(token),
    familyId: randomUUID(),
    rotationCounter: 0,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }));
  sessionIds.push(...sessions.map((session) => session.id));
  await prisma.deviceSession.createMany({ data: sessions });

  const taxType = await prisma.taxType.findFirst({ where: { code: "IVA" }, select: { id: true } });
  if (!taxType) throw new Error("seed-maestros-fiscales no cargado: falta el impuesto IVA");
  for (const key of CUIT_KEYS) cuits[key] = validTestCuit();

  const client = await prisma.client.create({
    data: { firmId: FIRM_ALFA, legalName: CLIENT_NAME, tradeName: "Sintético 7A", cuit: cuits.CLIENT, status: "ONBOARDING" },
  });
  clientId = client.id;
  const period = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM_ALFA,
      clientId,
      taxTypeId: taxType.id,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-31T00:00:00.000Z"),
      label: PERIOD_LABEL,
    },
  });
  periodId = period.id;

  for (const spec of SPECS) {
    await prisma.fiscalVoucher.create({
      data: {
        firmId: FIRM_ALFA,
        clientId,
        direction: spec.direction,
        status: spec.status,
        type: spec.type,
        letter: spec.letter,
        pointOfSale: spec.pointOfSale,
        number: spec.number,
        issuerCuit: cuits[spec.issuer],
        receiverCuit: cuits[spec.receiver],
        issuedOn: new Date(`${spec.issuedOn}T00:00:00.000Z`),
        currency: spec.currency ?? "ARS",
        ...(spec.exchangeRate ? { exchangeRate: new Prisma.Decimal(spec.exchangeRate) } : {}),
        total: new Prisma.Decimal(spec.total),
        version: 1,
        components: {
          create: spec.components.map(([concept, amount]) => ({
            firmId: FIRM_ALFA,
            clientId,
            concept,
            base: new Prisma.Decimal(amount),
            amount: new Prisma.Decimal(amount),
          })),
        },
      },
    });
  }
});

afterAll(async () => {
  if (clientId) {
    await prisma.fiscalVoucher.deleteMany({ where: { clientId } });
    await prisma.taxPeriod.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  }
  if (sessionIds.length > 0) await prisma.deviceSession.deleteMany({ where: { id: { in: sessionIds } } });
  await app?.close();
  await runtimePrisma?.$disconnect();
});

describe("libros fiscales: integración por la ruta real (datos sintéticos)", () => {
  it("el resumen separa incluidos y excluidos, con el motivo de cada grupo", async () => {
    const res = await get(ownerToken, `${base}/${clientId}/fiscal-books/summary?periodId=${periodId}`);
    expect(res.statusCode).toBe(200);
    const { books } = res.json().data;
    const pairs = (items: Array<{ reason: string; count: number }>) => items.map((item) => [item.reason, item.count]);
    expect(books.purchases.included.count).toBe(EXPECTED.purchases.count);
    expect(books.purchases.included.totals).toEqual(EXPECTED.purchases.totals);
    expect(books.purchases.excludedCount).toBe(EXPECTED.purchases.excludedCount);
    expect(pairs(books.purchases.excluded)).toEqual(EXPECTED.purchases.excluded);
    expect(books.sales.included.count).toBe(EXPECTED.sales.count);
    expect(books.sales.included.totals).toEqual(EXPECTED.sales.totals);
    expect(pairs(books.sales.excluded)).toEqual(EXPECTED.sales.excluded);
  });

  it("exporta el libro de compras en xlsx y concilia la fila de totales con los comprobantes", async () => {
    const res = await get(ownerToken, `${base}/${clientId}/fiscal-books/export?periodId=${periodId}&book=purchases&format=xlsx`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="libro-compras-cliente-sintetico-7a-octubre-2026.xlsx"');

    const { sheetName, grid } = readSheet(res.rawPayload);
    expect(sheetName).toBe("Libro de compras");
    const [header = [], ...rows] = grid;
    expect(header).toEqual(FISCAL_HEADERS);
    const dataRows = rows.slice(0, -1);
    const totalsRow = rows[rows.length - 1] ?? [];
    const col = (name: string) => header.indexOf(name);

    expect(dataRows.map((row) => row[col("Total")])).toEqual(["1210", "1105", "12100", "-121"]);
    expect(dataRows[0]?.[col("Fecha de emisión")]).toBe("46300");
    expect(dataRows[0]?.[col("CUIT emisor")]).toBe(cuits.S1);
    expect(dataRows[2]?.[col("Moneda")]).toBe("USD");
    expect(dataRows[2]?.[col("Tipo de cambio")]).toBe("1000");
    expect(dataRows[2]?.[col("Neto")]).toBe("10000");
    expect(dataRows[3]?.[col("Neto")]).toBe("-100");
    // Conciliación: la suma de las filas coincide con la fila de totales y con los comprobantes.
    const sumTotal = dataRows.reduce((sum, row) => sum + Number(row[col("Total")]), 0);
    expect(sumTotal).toBe(Number(EXPECTED.purchases.totals.total));
    expect(totalsRow[col("Neto")]).toBe(EXPECTED.purchases.totals.neto);
    expect(totalsRow[col("IVA 21 %")]).toBe(EXPECTED.purchases.totals.iva21);
    expect(totalsRow[col("IVA 10,5 %")]).toBe(EXPECTED.purchases.totals.iva105);
    expect(totalsRow[col("Total")]).toBe(EXPECTED.purchases.totals.total);
  });

  it("exporta el libro de ventas en csv con las columnas y el orden pedidos", async () => {
    const res = await get(
      ownerToken,
      `${base}/${clientId}/fiscal-books/export?periodId=${periodId}&book=sales&format=csv&columns=total,issuedOn,letter&sortBy=total&sortDir=desc`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="libro-ventas-cliente-sintetico-7a-octubre-2026.csv"');
    expect(res.rawPayload.toString("utf8").slice(1).split("\r\n")).toEqual([
      '"Total","Fecha de emisión","Letra"',
      '"2420.00","20/10/2026","A"',
      '"1000.00","21/10/2026","B"',
      '"3420.00","Totales (2 comprobantes)",""',
    ]);
  });

  it("un cliente no asignado al usuario no se exporta ni se resume (guard por ClientAssignment)", async () => {
    const exported = await get(preparerToken, `${base}/${clientId}/fiscal-books/export?periodId=${periodId}&book=purchases`);
    expect(exported.statusCode).toBe(404);
    expect(exported.json().error.code).toBe("RESOURCE_NOT_FOUND");
    const summary = await get(preparerToken, `${base}/${clientId}/fiscal-books/summary?periodId=${periodId}`);
    expect(summary.statusCode).toBe(404);
  });

  it("RLS: el rol de runtime no lee comprobantes de un cliente no asignado", async () => {
    const hidden = await runAsRuntime(PREPARER_A, clientId, (tx) => tx.fiscalVoucher.count({ where: { clientId } }));
    const visible = await runAsRuntime(OWNER_A, clientId, (tx) => tx.fiscalVoucher.count({ where: { clientId } }));
    expect(hidden).toBe(0);
    expect(visible).toBe(SPECS.length);
  });

  it("otra firma no accede al libro del cliente (aislamiento por firma)", async () => {
    const res = await get(ownerBToken, `${base}/${clientId}/fiscal-books/summary?periodId=${periodId}`);
    expect(res.statusCode).toBe(404);
  });

  it("parámetros inválidos responden 400 con el campo y el motivo", async () => {
    const res = await get(ownerToken, `${base}/${clientId}/fiscal-books/export?periodId=${periodId}&book=compras`);
    expect(res.statusCode).toBe(400);
    const issue = res.json().error.details[0];
    expect(issue.path).toEqual(["book"]);
    expect(issue.message).toContain("«purchases»");
  });

  it("un período inexistente responde 404 con el campo periodId", async () => {
    const res = await get(ownerToken, `${base}/${clientId}/fiscal-books/summary?periodId=${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "PERIOD_NOT_FOUND", field: "periodId" });
  });
});
