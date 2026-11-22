import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import {
  materializeWorkpaperClassifications,
  voucherGivesIvaCredit,
} from "./workpaper-classification.js";

/**
 * Corte 3B: clasificación en bloque, «recordar para este proveedor/cliente», exclusión con motivo y
 * compras B/C sin crédito. Datos inventados: CUIT sintéticos con dígito verificador válido, importes redondos.
 */

const OWNER = randomUUID();
const AUDITOR = randomUUID();
const OTHER_OWNER = randomUUID();
const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-3b-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const START = "2026-10-01";
const END = "2026-10-31";
const OWNER_NAME = `T-Titular 3B ${RUN}`;

let app: FastifyInstance | null = null;
let ownerToken = "";
let auditorToken = "";
let otherToken = "";
let runtimePrisma: PrismaClient;

type ApiResponse = { statusCode: number; body: string; json(): unknown };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function data<T>(response: ApiResponse): T {
  return (response.json() as { data: T }).data;
}

function ok(response: ApiResponse, status: number, what: string) {
  expect(response.statusCode, `${what}; respuesta: ${response.body}`).toBe(status);
}

async function requestAs(
  token: string,
  method: Method,
  url: string,
  payload?: Record<string, unknown>,
) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  });
}

const request = (method: Method, url: string, payload?: Record<string, unknown>) =>
  requestAs(ownerToken, method, url, payload);

function validTestCuit() {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = [...base].reduce(
      (total, digit, index) => total + Number(digit) * weights[index]!,
      0,
    );
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

async function resolveMaster(path: string, code: string) {
  const response = await request("GET", path);
  ok(response, 200, `catálogo ${path}`);
  const row = data<Array<{ id: string; code: string }>>(response).find((item) => item.code === code);
  expect(row, `el maestro ${code} está sembrado`).toBeTruthy();
  return row!.id;
}

type Celda = string | number;

/** «Mis Comprobantes Emitidos»: título con el CUIT del contribuyente, encabezados en la fila 2, datos desde la 3. */
function libroEmitidos(
  cuitTitulo: string,
  encabezados: string[],
  filas: Array<Record<string, Celda>>,
): Uint8Array {
  const celda = (ref: string, valor: Celda) =>
    typeof valor === "number"
      ? `<c r="${ref}"><v>${valor}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${valor}</t></is></c>`;
  const matriz: Celda[][] = [
    [`Mis Comprobantes Emitidos - CUIT ${cuitTitulo}`],
    encabezados,
    ...filas.map((fila) => encabezados.map((h) => fila[h] ?? "")),
  ];
  const col = (indice: number) => String.fromCharCode(65 + indice);
  const datos = matriz
    .map(
      (fila, r) =>
        `<row r="${r + 1}">${fila.map((v, c) => (v === "" ? "" : celda(`${col(c)}${r + 1}`, v))).join("")}</row>`,
    )
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${datos}</sheetData></worksheet>`,
    ),
  });
}

const ENCABEZADOS = [
  "Fecha",
  "Tipo",
  "Punto de Venta",
  "Número Desde",
  "Número Hasta",
  "Tipo Doc. Receptor",
  "Nro. Doc. Receptor",
  "Denominación Receptor",
  "Tipo Cambio",
  "Moneda",
  "Neto Gravado Total",
  "Neto No Gravado",
  "Op. Exentas",
  "Otros Tributos",
  "Total IVA",
  "Imp. Total",
];

/** Factura C emitida a una contraparte (sin IVA discriminado): la base es el importe total. */
function facturaC(fecha: string, numero: number, receptorCuit: string, total: number) {
  return {
    Fecha: fecha,
    Tipo: "11 - Factura C",
    "Punto de Venta": 1,
    "Número Desde": numero,
    "Número Hasta": numero,
    "Tipo Doc. Receptor": "CUIT",
    "Nro. Doc. Receptor": Number(receptorCuit),
    "Denominación Receptor": "CONTRAPARTE FICTICIA",
    "Tipo Cambio": 1,
    Moneda: "$",
    "Imp. Total": total,
  } satisfies Record<string, Celda>;
}

type Coverage = {
  total: number;
  classified: number;
  pending: number;
  excluded: number;
  ready: boolean;
  items: Array<{
    id: string;
    voucherId: string;
    direction: "PURCHASE" | "SALE";
    counterpartyCuit: string;
    categoryCode: string | null;
    activityCode: string | null;
    status: string;
    origin: string | null;
    ivaCredit: boolean;
    excludedAt: string | null;
    excludedReason: string | null;
    excludedBy: { id: string; name: string } | null;
    voucher: { number: number; letter: string | null; type: string };
  }>;
};

type Rule = {
  id: string;
  direction: string;
  counterpartyCuit: string;
  categoryCode: string | null;
  activityCode: string | null;
  createdByName: string;
};

type Legajo = {
  clientId: string;
  clientBase: string;
  workpaperId: string;
  sourceBase: string;
  bookTaxTypeId: string;
  bookPeriodId: string;
  cuit: string;
  seq: number;
};

/** Arma un cliente monotributista de Tucumán con IIBB y TEM y su legajo de octubre, con una o dos actividades. */
async function armarLegajo(label: string, secondActivity: boolean): Promise<Legajo> {
  const jurisdictionId = await resolveMaster("/api/v1/tax/jurisdictions", "AR-T");
  const iibbTypeId = await resolveMaster("/api/v1/tax/types", "IIBB");
  const temTypeId = await resolveMaster("/api/v1/tax/types", "TEM");
  const iibbRegimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
  const temRegimeId = await resolveMaster("/api/v1/tax/regimes", "TEM_SMT");
  const cuit = validTestCuit();

  const clientResponse = await request("POST", `${BASE}/clients`, {
    legalName: `T-Cliente 3B ${label} ${RUN}`,
    tradeName: `T-Cliente 3B ${label} ${RUN}`,
    cuit,
  });
  ok(clientResponse, 201, "alta del cliente");
  const clientId = data<{ id: string }>(clientResponse).id;
  const clientBase = `${BASE}/clients/${clientId}`;

  const profile = data<{ id: string }>(
    await request("POST", `${clientBase}/tax-profile-versions`, {
      legalName: `T-Cliente 3B ${label} ${RUN}`,
      cuit,
      personType: "FISICA",
      nationalCondition: "MONOTRIBUTISTA",
      fiscalAddress: `T-Domicilio ${RUN}, San Miguel de Tucumán`,
      validFrom: "2026-01-01",
    }),
  );
  ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`), 200, "perfil a revisión");
  ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`), 200, "perfil activo");
  ok(await request("PUT", `${clientBase}/tem-categories/2026`, { category: "B" }), 200, "categoría TEM 2026");

  for (const [code, isPrimary] of [
    ["SERVICIOS", true],
    ...(secondActivity ? ([["COMERCIO", false]] as const) : []),
  ] as const) {
    const activity = await prisma.economicActivity.findFirstOrThrow({ where: { code, jurisdictionId } });
    ok(
      await request("POST", `${clientBase}/activities`, {
        profileVersionId: profile.id,
        activityId: activity.id,
        isPrimary,
        validFrom: "2026-01-01",
      }),
      201,
      `actividad ${code}`,
    );
  }

  for (const [taxTypeId, regimeId] of [
    [iibbTypeId, iibbRegimeId],
    [temTypeId, temRegimeId],
  ] as const) {
    ok(
      await request("POST", `${clientBase}/tax-registrations`, {
        profileVersionId: profile.id,
        regimeId,
        validFrom: "2026-01-01",
        registrationNumber: `T-REG-3B-${RUN.slice(0, 8)}-${regimeId.slice(0, 4)}-${label}`,
      }),
      201,
      "adhesión",
    );
    const period = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-periods`, {
        taxTypeId,
        startDate: START,
        endDate: END,
        label: "T-Octubre 2026",
      }),
    );
    ok(
      await request("POST", `${clientBase}/tax-obligations`, {
        profileVersionId: profile.id,
        regimeId,
        periodId: period.id,
        dueDate: "2026-11-20",
      }),
      201,
      "obligación",
    );
  }

  const workpaper = data<{ id: string }>(
    await request("POST", `${clientBase}/monthly-tax-workpapers`, { periodStart: START, periodEnd: END }),
  );
  const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;
  const coverage = data<{
    sources: Array<{ code: string; taxTypeId: string | null; periodId: string | null }>;
  }>(await request("GET", `${sourceBase}/coverage`));
  const book = coverage.sources.find((source) => source.code === "ARCA_IVA_SALES")!;
  return {
    clientId,
    clientBase,
    workpaperId: workpaper.id,
    sourceBase,
    bookTaxTypeId: book.taxTypeId!,
    bookPeriodId: book.periodId!,
    cuit,
    seq: 0,
  };
}

/** Importa y revisa un libro de ventas con las filas indicadas. */
async function cargarVentas(legajo: Legajo, filas: Array<Record<string, Celda>>) {
  legajo.seq += 1;
  const libro = libroEmitidos(legajo.cuit, ENCABEZADOS, filas);
  ok(
    await request("POST", `${legajo.clientBase}/sifere/import`, {
      direction: "SALE",
      base64: Buffer.from(libro).toString("base64"),
      fileName: `T-Emitidos-3B-${legajo.seq}-${RUN}.xlsx`,
      fileHash: `sha256:T-3B-${legajo.clientId}-${legajo.seq}`,
      taxTypeId: legajo.bookTaxTypeId,
      periodId: legajo.bookPeriodId,
      clientCuit: legajo.cuit,
      workpaperId: legajo.workpaperId,
    }),
    201,
    "importación del libro de ventas",
  );
  const coverage = data<{
    sources: Array<{ code: string; batches: Array<{ id: string; reviewStatus: string }> }>;
  }>(await request("GET", `${legajo.sourceBase}/coverage`));
  const pendiente = coverage.sources
    .find((source) => source.code === "ARCA_IVA_SALES")!
    .batches.find((batch) => batch.reviewStatus !== "REVIEWED");
  ok(
    await request("POST", `${legajo.sourceBase}/sources/${pendiente!.id}/review`),
    200,
    "revisión del libro",
  );
}

const clasificaciones = async (legajo: Legajo) =>
  data<Coverage>(await request("GET", `${legajo.sourceBase}/classifications`));

const porNumero = (coverage: Coverage, numero: number) =>
  coverage.items.find((item) => item.voucher.number === numero && item.direction === "SALE")!;

async function baseTotalIibb(legajo: Legajo) {
  const calculation = data<
    Array<{ obligation: { taxTypeCode: string }; settlement: { totals: Record<string, string> } }>
  >(await request("GET", `${legajo.sourceBase}/calculation`));
  return calculation.find((item) => item.obligation.taxTypeCode === "IIBB")!.settlement.totals["BASE_TOTAL"];
}

const estadoMes = async (legajo: Legajo) =>
  data<{ status: string }>(await request("GET", legajo.sourceBase)).status;

describe("3B — clasificación en bloque, reglas, exclusión y B/C sin crédito", () => {
  const unaActividad = {} as Legajo;
  const dosActividades = {} as Legajo;
  const cuitX = validTestCuit();
  const cuitY = validTestCuit();
  const proveedorB = validTestCuit();
  const proveedorA = validTestCuit();

  beforeAll(async () => {
    runtimePrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
    });
    app = await buildServer({
      postgres: async () => true,
      valkey: async () => true,
      minio: async () => true,
      ai: async () => true,
    });
    await app.ready();

    for (const [id, name] of [
      [FIRM, `T-Estudio 3B ${RUN}`],
      [OTHER_FIRM, `T-Otro 3B ${RUN}`],
    ] as const) {
      await prisma.firm.create({
        data: { id, legalName: name, displayName: name, allowSelfReview: true },
      });
    }
    for (const [id, tag, name] of [
      [OWNER, "owner", OWNER_NAME],
      [AUDITOR, "auditor", `T-Auditor 3B ${RUN}`],
      [OTHER_OWNER, "other", `T-Otro titular 3B ${RUN}`],
    ] as const) {
      await prisma.user.create({
        data: { id, emailNormalized: `t-3b-${tag}-${RUN}@example.invalid`, name, passwordHash: "-" },
      });
    }
    for (const [firmId, userId, role] of [
      [FIRM, OWNER, "OWNER"],
      [FIRM, AUDITOR, "AUDITOR_READONLY"],
      [OTHER_FIRM, OTHER_OWNER, "OWNER"],
    ] as const) {
      await prisma.firmMembership.create({
        data: { firmId, userId, role, status: "ACTIVE", acceptedAt: new Date() },
      });
    }
    const session = async (userId: string) => {
      const token = randomBytes(32).toString("base64url");
      await prisma.deviceSession.create({
        data: {
          id: randomUUID(),
          userId,
          refreshTokenHash: sha256(token),
          familyId: randomUUID(),
          rotationCounter: 0,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      return token;
    };
    ownerToken = await session(OWNER);
    auditorToken = await session(AUDITOR);
    otherToken = await session(OTHER_OWNER);
  });

  afterAll(async () => {
    try {
      await prisma.deviceSession.deleteMany({
        where: { userId: { in: [OWNER, AUDITOR, OTHER_OWNER] } },
      });
      await prisma.firmMembership.deleteMany({ where: { firmId: { in: [FIRM, OTHER_FIRM] } } });
    } finally {
      await runtimePrisma?.$disconnect();
      await app?.close();
      app = null;
    }
  });

  it("B y C de compras no dan crédito fiscal; A y las ventas sí (decide la tabla de ARCA, no solo la letra)", () => {
    const compra = (type: string, letter: string | null) =>
      voucherGivesIvaCredit({ direction: "PURCHASE", type, letter });
    expect(compra("1", "A")).toBe(true);
    expect(compra("51", "M")).toBe(true);
    expect(compra("6", "B")).toBe(false);
    expect(compra("FACTURA", "C")).toBe(false);
    // Notas: el importador guarda «NC»/«ND» en la letra; el código dice B o C.
    expect(compra("8", "NC")).toBe(false);
    expect(compra("7", "ND")).toBe(false);
    expect(compra("13", "NC")).toBe(false);
    expect(compra("3", "NC")).toBe(true);
    expect(voucherGivesIvaCredit({ direction: "SALE", type: "11", letter: "C" })).toBe(true);
  });

  it("con una sola actividad, las ventas se asignan solas y no cuentan como pendientes", async () => {
    Object.assign(unaActividad, await armarLegajo("una", false));
    await cargarVentas(unaActividad, [
      facturaC("03/10/2026", 1, cuitX, 100000),
      facturaC("04/10/2026", 2, cuitY, 25000),
    ]);
    const coverage = await clasificaciones(unaActividad);
    expect(coverage).toMatchObject({ total: 2, classified: 2, pending: 0, excluded: 0, ready: true });
    for (const item of coverage.items) {
      expect(item).toMatchObject({
        status: "CLASSIFIED",
        activityCode: "SERVICIOS",
        origin: "SINGLE_CLIENT_ACTIVITY",
      });
    }
  });

  it("con dos actividades, las ventas llegan pendientes y el mes no está listo", async () => {
    Object.assign(dosActividades, await armarLegajo("dos", true));
    await cargarVentas(dosActividades, [
      facturaC("03/10/2026", 1, cuitX, 100000),
      facturaC("04/10/2026", 2, cuitX, 40000),
      facturaC("05/10/2026", 3, cuitY, 25000),
    ]);
    const coverage = await clasificaciones(dosActividades);
    expect(coverage).toMatchObject({ total: 3, classified: 0, pending: 3, excluded: 0, ready: false });
    expect(coverage.items.every((item) => item.status === "PENDING")).toBe(true);
  });

  it("clasificar en bloque: una actividad para varios comprobantes; «recordar» guarda la regla del CUIT", async () => {
    const legajo = dosActividades;
    const coverage = await clasificaciones(legajo);
    const ids = [1, 2].map((numero) => porNumero(coverage, numero).id);
    const response = await request("POST", `${legajo.sourceBase}/classifications/bulk`, {
      classificationIds: ids,
      activityCode: "COMERCIO",
      rememberRule: true,
    });
    ok(response, 200, "clasificación en bloque");
    const after = data<Coverage>(response);
    expect(after).toMatchObject({ classified: 2, pending: 1, ready: false });
    for (const numero of [1, 2]) {
      expect(porNumero(after, numero)).toMatchObject({
        status: "CLASSIFIED",
        activityCode: "COMERCIO",
        origin: "MANUAL",
      });
    }

    const rules = data<Rule[]>(await request("GET", `${legajo.sourceBase}/classification-rules`));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      direction: "SALE",
      counterpartyCuit: cuitX,
      activityCode: "COMERCIO",
      categoryCode: null,
      createdByName: OWNER_NAME,
    });
  });

  it("un comprobante nuevo del mismo CUIT llega clasificado «por regla»; otro CUIT sigue pendiente", async () => {
    const legajo = dosActividades;
    await cargarVentas(legajo, [facturaC("12/10/2026", 4, cuitX, 10000)]);
    const coverage = await clasificaciones(legajo);
    expect(porNumero(coverage, 4)).toMatchObject({
      status: "CLASSIFIED",
      activityCode: "COMERCIO",
      origin: "RULE",
    });
    expect(porNumero(coverage, 3)).toMatchObject({ status: "PENDING", origin: null });
  });

  it("cambiar el destino de una regla deja una sola vigente; borrarla no toca lo ya clasificado", async () => {
    const legajo = dosActividades;
    const coverage = await clasificaciones(legajo);
    // Venta 3 (otro CUIT) con regla nueva.
    ok(
      await request("PATCH", `${legajo.sourceBase}/classifications/${porNumero(coverage, 3).id}`, {
        activityCode: "SERVICIOS",
        rememberRule: true,
      }),
      200,
      "clasificar con regla",
    );
    // Cambiar la regla de X a SERVICIOS: queda una sola vigente por CUIT.
    ok(
      await request("PATCH", `${legajo.sourceBase}/classifications/${porNumero(coverage, 1).id}`, {
        activityCode: "SERVICIOS",
        rememberRule: true,
      }),
      200,
      "cambiar la regla",
    );
    const rules = data<Rule[]>(await request("GET", `${legajo.sourceBase}/classification-rules`));
    expect(rules.map((rule) => [rule.counterpartyCuit, rule.activityCode]).sort()).toEqual(
      [
        [cuitX, "SERVICIOS"],
        [cuitY, "SERVICIOS"],
      ].sort(),
    );
    const history = await prisma.classificationRule.findMany({
      where: { clientId: legajo.clientId, counterpartyCuit: cuitX },
    });
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.revokedAt === null)).toHaveLength(1);

    // Borrar la regla de Y: se revoca (queda el historial) y la venta 3 conserva su clasificación.
    const ruleY = rules.find((rule) => rule.counterpartyCuit === cuitY)!;
    ok(await request("DELETE", `${legajo.sourceBase}/classification-rules/${ruleY.id}`), 200, "borrar la regla");
    const left = data<Rule[]>(await request("GET", `${legajo.sourceBase}/classification-rules`));
    expect(left.map((rule) => rule.counterpartyCuit)).toEqual([cuitX]);
    expect(porNumero(await clasificaciones(legajo), 3)).toMatchObject({
      status: "CLASSIFIED",
      activityCode: "SERVICIOS",
    });
    const gone = await request("DELETE", `${legajo.sourceBase}/classification-rules/${ruleY.id}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ error: { code: "CLASSIFICATION_RULE_NOT_FOUND" } });
  });

  it("compras: B y C quedan marcadas «sin crédito» solas; el bloque exige un solo sentido y un rubro", async () => {
    const legajo = dosActividades;
    const wp = await prisma.monthlyTaxWorkpaper.findUniqueOrThrow({ where: { id: legajo.workpaperId } });
    const compra = (
      number: number,
      type: string,
      letter: string,
      issuerCuit: string,
    ) => ({
      firmId: FIRM,
      clientId: legajo.clientId,
      direction: "PURCHASE" as const,
      type,
      letter,
      pointOfSale: 7,
      number,
      issuerCuit,
      receiverCuit: legajo.cuit,
      issuedOn: new Date("2026-10-08T00:00:00.000Z"),
      total: 12100,
      status: "APPROVED" as const,
    });
    const vouchers = await Promise.all(
      [
        compra(1, "1", "A", proveedorA),
        compra(2, "6", "B", proveedorB),
        compra(3, "FACTURA", "C", proveedorB),
        compra(4, "8", "NC", proveedorB),
      ].map((voucher) => prisma.fiscalVoucher.create({ data: voucher })),
    );
    await prisma.$transaction(async (tx) => {
      await materializeWorkpaperClassifications(tx, wp, vouchers.map((voucher) => voucher.id));
    });

    const coverage = await clasificaciones(legajo);
    const compras = coverage.items.filter((item) => item.direction === "PURCHASE");
    expect(compras).toHaveLength(4);
    const credito = Object.fromEntries(compras.map((item) => [item.voucher.number, item.ivaCredit]));
    expect(credito).toEqual({ 1: true, 2: false, 3: false, 4: false });
    expect(compras.every((item) => item.status === "PENDING")).toBe(true);

    const idsCompras = compras.map((item) => item.id);
    const ventaId = porNumero(coverage, 1).id;
    const mixed = await request("POST", `${legajo.sourceBase}/classifications/bulk`, {
      classificationIds: [idsCompras[0]!, ventaId],
      categoryCode: "SUPER",
    });
    expect(mixed.statusCode).toBe(422);
    const sinRubro = await request("POST", `${legajo.sourceBase}/classifications/bulk`, {
      classificationIds: idsCompras,
    });
    expect(sinRubro.statusCode).toBe(422);
    expect(sinRubro.json()).toMatchObject({ error: { code: "CLASSIFICATION_INCOMPLETE" } });

    const bulk = await request("POST", `${legajo.sourceBase}/classifications/bulk`, {
      classificationIds: idsCompras,
      categoryCode: "SUPER",
      rememberRule: true,
    });
    ok(bulk, 200, "rubro en bloque");
    const after = data<Coverage>(bulk).items.filter((item) => item.direction === "PURCHASE");
    expect(after.every((item) => item.status === "CLASSIFIED" && item.categoryCode === "SUPER")).toBe(true);
    // Clasificar no cambia la marca de crédito.
    expect(Object.fromEntries(after.map((item) => [item.voucher.number, item.ivaCredit]))).toEqual(credito);

    // Una compra nueva del proveedor B llega por regla y también sin crédito.
    const nueva = await prisma.fiscalVoucher.create({ data: compra(5, "11", "C", proveedorB) });
    await prisma.$transaction(async (tx) => {
      await materializeWorkpaperClassifications(tx, wp, [nueva.id]);
    });
    const nuevaFila = (await clasificaciones(legajo)).items.find((item) => item.voucherId === nueva.id)!;
    expect(nuevaFila).toMatchObject({ status: "CLASSIFIED", categoryCode: "SUPER", origin: "RULE", ivaCredit: false });
  });

  it("excluir exige motivo; el comprobante queda «Excluido» con quién, cuándo y motivo y deja de ser pendiente", async () => {
    const legajo = dosActividades;
    const coverage = await clasificaciones(legajo);
    const venta4 = porNumero(coverage, 4);
    // Se deja pendiente la venta 3 para excluirla: no hace falta clasificar lo que no se calcula.
    const sinMotivo = await request("POST", `${legajo.sourceBase}/classifications/exclude`, {
      classificationIds: [venta4.id],
      reason: "   ",
    });
    expect(sinMotivo.statusCode).toBe(400);
    expect(sinMotivo.body).toContain("Indicá el motivo de la exclusión");
    expect(porNumero(await clasificaciones(legajo), 4).excludedAt).toBeNull();

    const response = await request("POST", `${legajo.sourceBase}/classifications/exclude`, {
      classificationIds: [venta4.id],
      reason: "Factura duplicada de prueba",
    });
    ok(response, 200, "excluir con motivo");
    const after = data<Coverage>(response);
    expect(after.excluded).toBe(1);
    expect(porNumero(after, 4)).toMatchObject({
      excludedReason: "Factura duplicada de prueba",
      excludedBy: { id: OWNER, name: OWNER_NAME },
    });
    expect(porNumero(after, 4).excludedAt).not.toBeNull();

    // Un excluido no se clasifica: hay que reincluirlo.
    const bloqueado = await request("PATCH", `${legajo.sourceBase}/classifications/${venta4.id}`, {
      activityCode: "COMERCIO",
    });
    expect(bloqueado.statusCode).toBe(409);
    expect(bloqueado.json()).toMatchObject({ error: { code: "CLASSIFICATION_EXCLUDED" } });
  });

  it("el cálculo excluye el comprobante con sus importes; reincluirlo lo devuelve y el mes vuelve a preparación", async () => {
    const legajo = dosActividades;
    // Ventas 1+2+3 = 165.000 + venta 4 = 10.000; la 4 está excluida.
    expect(await estadoMes(legajo)).toBe("READY_TO_CALCULATE");
    ok(await request("POST", `${legajo.sourceBase}/calculate`, { cutoff: END }), 200, "cálculo con exclusión");
    expect(await estadoMes(legajo)).toBe("CALCULATED");
    expect(await baseTotalIibb(legajo)).toBe("165000.00");

    const coverage = await clasificaciones(legajo);
    const venta4 = porNumero(coverage, 4);
    // Reincluir en un mes calculado: misma invalidación que cambiar fuentes.
    const response = await request("POST", `${legajo.sourceBase}/classifications/include`, {
      classificationIds: [venta4.id],
    });
    ok(response, 200, "reincluir");
    expect(porNumero(data<Coverage>(response), 4)).toMatchObject({
      excludedAt: null,
      excludedReason: null,
      excludedBy: null,
    });
    expect(await estadoMes(legajo)).toBe("READY_TO_CALCULATE");

    ok(await request("POST", `${legajo.sourceBase}/calculate`, { cutoff: END }), 200, "cálculo con todo");
    expect(await baseTotalIibb(legajo)).toBe("175000.00");
  });

  it("cambiar una clasificación en un mes calculado lo devuelve a preparación", async () => {
    const legajo = dosActividades;
    expect(await estadoMes(legajo)).toBe("CALCULATED");
    const coverage = await clasificaciones(legajo);
    ok(
      await request("POST", `${legajo.sourceBase}/classifications/bulk`, {
        classificationIds: [porNumero(coverage, 3).id],
        activityCode: "COMERCIO",
      }),
      200,
      "reclasificar en mes calculado",
    );
    expect(await estadoMes(legajo)).toBe("READY_TO_CALCULATE");
    // Excluir también invalida: se recalcula y baja la base.
    ok(await request("POST", `${legajo.sourceBase}/calculate`, { cutoff: END }), 200, "recálculo");
    ok(
      await request("POST", `${legajo.sourceBase}/classifications/exclude`, {
        classificationIds: [porNumero(coverage, 3).id],
        reason: "No corresponde al período",
      }),
      200,
      "excluir en mes calculado",
    );
    expect(await estadoMes(legajo)).toBe("READY_TO_CALCULATE");
    ok(await request("POST", `${legajo.sourceBase}/calculate`, { cutoff: END }), 200, "recálculo sin la venta 3");
    expect(await baseTotalIibb(legajo)).toBe("150000.00");
  });

  it("mes en revisión pide cambios primero; mes finalizado se rechaza con guía de rectificación", async () => {
    const legajo = dosActividades;
    const coverage = await clasificaciones(legajo);
    const ids = [porNumero(coverage, 1).id];
    await prisma.monthlyTaxWorkpaper.update({ where: { id: legajo.workpaperId }, data: { status: "IN_REVIEW" } });
    const enRevision = await request("POST", `${legajo.sourceBase}/classifications/exclude`, {
      classificationIds: ids,
      reason: "Prueba",
    });
    expect(enRevision.statusCode).toBe(409);
    expect(enRevision.json()).toMatchObject({ error: { code: "WORKPAPER_IMMUTABLE" } });

    await prisma.monthlyTaxWorkpaper.update({ where: { id: legajo.workpaperId }, data: { status: "FINALIZED" } });
    for (const [url, payload] of [
      [`${legajo.sourceBase}/classifications/bulk`, { classificationIds: ids, activityCode: "COMERCIO" }],
      [`${legajo.sourceBase}/classifications/exclude`, { classificationIds: ids, reason: "Prueba" }],
      [`${legajo.sourceBase}/classifications/include`, { classificationIds: ids }],
      [`${legajo.sourceBase}/classifications/${ids[0]}`, { activityCode: "COMERCIO" }],
    ] as const) {
      const method = url.endsWith(ids[0]!) ? "PATCH" : "POST";
      const rejected = await request(method, url, payload);
      expect(rejected.statusCode, url).toBe(409);
      expect(rejected.json(), url).toMatchObject({
        error: {
          code: "WORKPAPER_FINALIZED",
          message: "Para cambiar un mes cerrado, rectificá la liquidación",
        },
      });
    }
    expect(porNumero(await clasificaciones(legajo), 1).excludedAt).toBeNull();
  });

  it("sin el permiso de preparar (rol solo lectura) responde 403 y la lectura sigue disponible", async () => {
    const legajo = dosActividades;
    await prisma.clientAssignment.create({
      data: { firmId: FIRM, userId: AUDITOR, clientId: legajo.clientId, capabilities: [] },
    });
    ok(await requestAs(auditorToken, "GET", `${legajo.sourceBase}/classifications`), 200, "lectura");
    ok(await requestAs(auditorToken, "GET", `${legajo.sourceBase}/classification-rules`), 200, "lectura de reglas");
    const ids = [porNumero(await clasificaciones(legajo), 1).id];
    const rules = data<Rule[]>(await request("GET", `${legajo.sourceBase}/classification-rules`));
    for (const [method, url, payload] of [
      ["POST", `${legajo.sourceBase}/classifications/bulk`, { classificationIds: ids, activityCode: "COMERCIO" }],
      ["POST", `${legajo.sourceBase}/classifications/exclude`, { classificationIds: ids, reason: "Prueba" }],
      ["POST", `${legajo.sourceBase}/classifications/include`, { classificationIds: ids }],
      ["DELETE", `${legajo.sourceBase}/classification-rules/${rules[0]!.id}`, undefined],
    ] as const) {
      const response = await requestAs(auditorToken, method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(data<Rule[]>(await request("GET", `${legajo.sourceBase}/classification-rules`))).toHaveLength(rules.length);
  });

  it("RLS: otra firma no ve clasificaciones ni reglas; el rol runtime no borra reglas ni cambia exclusiones ajenas", async () => {
    const legajo = dosActividades;
    // Por la API, otra firma no encuentra el legajo.
    const foreign = await requestAs(otherToken, "GET", `${legajo.sourceBase}/classification-rules`);
    expect(foreign.statusCode).toBeGreaterThanOrEqual(403);
    expect(foreign.statusCode).toBeLessThan(500);

    const asRuntime = <T>(
      firmId: string,
      userId: string,
      fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
    ) =>
      runtimePrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
        return fn(tx);
      });
    const ruleId = (await prisma.classificationRule.findFirstOrThrow({ where: { clientId: legajo.clientId } })).id;

    expect(
      await asRuntime(FIRM, OWNER, (tx) => tx.classificationRule.count({ where: { clientId: legajo.clientId } })),
    ).toBeGreaterThan(0);
    expect(
      await asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
        tx.classificationRule.count({ where: { clientId: legajo.clientId } }),
      ),
    ).toBe(0);
    expect(
      await asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
        tx.workpaperVoucherClassification.count({ where: { workpaperId: legajo.workpaperId } }),
      ),
    ).toBe(0);
    const foreignUpdate = await asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
      tx.classificationRule.updateMany({
        where: { id: ruleId },
        data: { revokedAt: new Date(), revokedByUserId: OTHER_OWNER },
      }),
    );
    expect(foreignUpdate.count).toBe(0);
    await expect(
      asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
        tx.classificationRule.create({
          data: {
            firmId: FIRM,
            clientId: legajo.clientId,
            direction: "SALE",
            counterpartyCuit: cuitY,
            activityCode: "COMERCIO",
            createdByUserId: OTHER_OWNER,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asRuntime(FIRM, OWNER, (tx) => tx.$executeRaw`DELETE FROM classification_rules WHERE id = ${ruleId}`),
    ).rejects.toThrow(/permission denied/);

    // La exclusión sin motivo no entra ni por SQL: las tres columnas van juntas.
    await expect(
      prisma.workpaperVoucherClassification.updateMany({
        where: { workpaperId: legajo.workpaperId },
        data: { excludedAt: new Date(), excludedByUserId: OWNER, excludedReason: "  " },
      }),
    ).rejects.toThrow();
  });
});
