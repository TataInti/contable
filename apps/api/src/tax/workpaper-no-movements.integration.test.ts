import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Corte 2A: «Sin movimientos» por fuente y mes. Una fuente marcada queda cubierta para el cálculo con base cero,
 * sin contar como lote revisado. Un lote revisado manda: limpia la marca con historial.
 * Monotributista de Tucumán con IIBB y TEM; fuente: libro de ventas de ARCA. Datos inventados.
 */

const OWNER = randomUUID();
const AUDITOR = randomUUID();
const OTHER_OWNER = randomUUID();
const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-2a-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const START = "2026-10-01";
const END = "2026-10-31";
const OWNER_NAME = `T-Titular 2A ${RUN}`;

let app: FastifyInstance | null = null;
let ownerToken = "";
let auditorToken = "";
let runtimePrisma: PrismaClient;

type ApiResponse = { statusCode: number; body: string; json(): unknown };

function data<T>(response: ApiResponse): T {
  return (response.json() as { data: T }).data;
}

function ok(response: ApiResponse, status: number, what: string) {
  expect(response.statusCode, `${what}; respuesta: ${response.body}`).toBe(status);
}

async function requestAs(
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
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

const request = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) => requestAs(ownerToken, method, url, payload);

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
  const row = data<Array<{ id: string; code: string }>>(response).find(
    (item) => item.code === code,
  );
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
const CLIENTE = {
  "Tipo Doc. Receptor": "CUIT",
  "Nro. Doc. Receptor": 30111111119,
  "Denominación Receptor": "CLIENTE FICTICIO",
  "Tipo Cambio": 1,
  Moneda: "$",
};

type Coverage = {
  sources: Array<{
    code: string;
    required: boolean;
    present: boolean;
    status: string;
    noMovements: { byUserId: string; byName: string; at: string } | null;
    taxTypeId: string | null;
    periodId: string | null;
    batches: Array<{ id: string; importBatchId: string }>;
  }>;
};

// Estado compartido de la historia: los casos corren en orden dentro del archivo.
let clientId = "";
let clientBase = "";
let workpaperId = "";
let sourceBase = "";
let bookTaxTypeId = "";
let bookPeriodId = "";
let cuit = "";

describe("2A — «Sin movimientos» por fuente y mes", () => {
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

    await prisma.firm.create({
      data: {
        id: FIRM,
        legalName: `T-Estudio 2A ${RUN}`,
        displayName: `T-Estudio 2A ${RUN}`,
        allowSelfReview: true,
      },
    });
    await prisma.firm.create({
      data: {
        id: OTHER_FIRM,
        legalName: `T-Otro 2A ${RUN}`,
        displayName: `T-Otro 2A ${RUN}`,
        allowSelfReview: true,
      },
    });
    await prisma.user.create({
      data: {
        id: OWNER,
        emailNormalized: `t-2a-owner-${RUN}@example.invalid`,
        name: OWNER_NAME,
        passwordHash: "-",
      },
    });
    await prisma.user.create({
      data: {
        id: AUDITOR,
        emailNormalized: `t-2a-auditor-${RUN}@example.invalid`,
        name: `T-Auditor 2A ${RUN}`,
        passwordHash: "-",
      },
    });
    await prisma.user.create({
      data: {
        id: OTHER_OWNER,
        emailNormalized: `t-2a-other-${RUN}@example.invalid`,
        name: `T-Otro titular 2A ${RUN}`,
        passwordHash: "-",
      },
    });
    await prisma.firmMembership.create({
      data: {
        firmId: FIRM,
        userId: OWNER,
        role: "OWNER",
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
    });
    await prisma.firmMembership.create({
      data: {
        firmId: FIRM,
        userId: AUDITOR,
        role: "AUDITOR_READONLY",
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
    });
    await prisma.firmMembership.create({
      data: {
        firmId: OTHER_FIRM,
        userId: OTHER_OWNER,
        role: "OWNER",
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
    });
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

  it("arma el legajo de octubre: monotributista con IIBB y TEM; el libro de ventas es la fuente obligatoria", async () => {
    const jurisdictionId = await resolveMaster("/api/v1/tax/jurisdictions", "AR-T");
    const iibbTypeId = await resolveMaster("/api/v1/tax/types", "IIBB");
    const temTypeId = await resolveMaster("/api/v1/tax/types", "TEM");
    const iibbRegimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
    const temRegimeId = await resolveMaster("/api/v1/tax/regimes", "TEM_SMT");
    cuit = validTestCuit();

    const clientResponse = await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente 2A ${RUN}`,
      tradeName: `T-Cliente 2A ${RUN}`,
      cuit,
    });
    ok(clientResponse, 201, "alta del cliente");
    clientId = data<{ id: string }>(clientResponse).id;
    clientBase = `${BASE}/clients/${clientId}`;

    const profile = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-profile-versions`, {
        legalName: `T-Cliente 2A ${RUN}`,
        cuit,
        personType: "FISICA",
        nationalCondition: "MONOTRIBUTISTA",
        fiscalAddress: `T-Domicilio ${RUN}, San Miguel de Tucumán`,
        validFrom: "2026-01-01",
      }),
    );
    ok(
      await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`),
      200,
      "perfil a revisión",
    );
    ok(
      await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`),
      200,
      "perfil activo",
    );
    ok(
      await request("PUT", `${clientBase}/tem-categories/2026`, { category: "B" }),
      200,
      "categoría TEM 2026",
    );

    const activity = await prisma.economicActivity.findFirstOrThrow({
      where: { code: "SERVICIOS", jurisdictionId },
    });
    ok(
      await request("POST", `${clientBase}/activities`, {
        profileVersionId: profile.id,
        activityId: activity.id,
        isPrimary: true,
        validFrom: "2026-01-01",
      }),
      201,
      "actividad única",
    );

    const obligations: Array<{ id: string }> = [];
    for (const [taxTypeId, regimeId] of [
      [iibbTypeId, iibbRegimeId],
      [temTypeId, temRegimeId],
    ] as const) {
      ok(
        await request("POST", `${clientBase}/tax-registrations`, {
          profileVersionId: profile.id,
          regimeId,
          validFrom: "2026-01-01",
          registrationNumber: `T-REG-2A-${RUN.slice(0, 8)}-${regimeId.slice(0, 4)}`,
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
      obligations.push(
        data<{ id: string }>(
          await request("POST", `${clientBase}/tax-obligations`, {
            profileVersionId: profile.id,
            regimeId,
            periodId: period.id,
            dueDate: "2026-11-20",
          }),
        ),
      );
    }

    const workpaper = data<{
      id: string;
      status: string;
      settlements: Array<{ obligationId: string }>;
    }>(
      await request("POST", `${clientBase}/monthly-tax-workpapers`, {
        periodStart: START,
        periodEnd: END,
      }),
    );
    workpaperId = workpaper.id;
    expect(workpaper.settlements.map((link) => link.obligationId).sort()).toEqual(
      obligations.map((o) => o.id).sort(),
    );
    sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaperId}`;

    const before = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const book = before.sources.find((source) => source.code === "ARCA_IVA_SALES");
    expect(book).toMatchObject({
      required: true,
      present: false,
      status: "PENDING",
      noMovements: null,
    });
    bookTaxTypeId = book!.taxTypeId!;
    bookPeriodId = book!.periodId!;
  });

  it("marcar «Sin movimientos» cubre la fuente: queda marcada, con quién y cuándo; no cuenta como lote revisado", async () => {
    const response = await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    ok(response, 200, "marcar sin movimientos");
    expect(data<Record<string, unknown>>(response)).toMatchObject({
      code: "ARCA_IVA_SALES",
      status: "NO_MOVEMENTS",
      present: false,
      noMovements: { byUserId: OWNER, byName: OWNER_NAME },
    });

    const coverage = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    expect(coverage.sources.find((source) => source.code === "ARCA_IVA_SALES")).toMatchObject({
      present: false,
      status: "NO_MOVEMENTS",
      required: true,
    });
    // El libro «Sin movimientos» cubre también las tablas manuales de IIBB y TEM (satisfiedBy): una sola marca alcanza.
    const pendientes = coverage.sources
      .filter((source) => source.required && !source.present && source.status !== "NO_MOVEMENTS")
      .map((source) => source.code);
    expect(pendientes).toEqual([]);
    for (const code of ["DGR_IIBB_TUC", "SMT_TEM"]) {
      expect(coverage.sources.find((source) => source.code === code)).toMatchObject({
        required: false,
        present: false,
        status: "PENDING",
      });
    }
    // Sin lotes revisados ni marcas en las tablas manuales, el mes ya queda listo para calcular.
    const wp = data<{ status: string }>(await request("GET", sourceBase));
    expect(wp.status).toBe("READY_TO_CALCULATE");
  });

  it("repetir la marca vigente no duplica la fila", async () => {
    ok(
      await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`),
      200,
      "segunda marca",
    );
    const rows = await prisma.workpaperSourceStatus.findMany({
      where: { workpaperId, sourceCode: "ARCA_IVA_SALES" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clearedAt).toBeNull();
  });

  it("calcular con la fuente sin movimientos usa base cero; el TEM paga su mínimo y el IIBB no tiene mínimo", async () => {
    ok(
      await request("POST", `${sourceBase}/calculate`, { cutoff: END }),
      200,
      "cálculo con base cero",
    );
    const calculation = data<
      Array<{ obligation: { taxTypeCode: string }; settlement: { totals: Record<string, string> } }>
    >(await request("GET", `${sourceBase}/calculation`));
    expect(calculation).toHaveLength(2);
    const iibb = calculation.find((item) => item.obligation.taxTypeCode === "IIBB")!.settlement
      .totals;
    const tem = calculation.find((item) => item.obligation.taxTypeCode === "TEM")!.settlement
      .totals;
    expect(iibb["BASE_TOTAL"]).toBe("0.00");
    expect(tem["BASE_TOTAL"]).toBe("0.00");
    // Base cero: ninguna actividad aporta impuesto. El IIBB determina el mínimo vigente de Tucumán
    // Motor activo de producción (v1.1.0): el mínimo IIBB lo declara el contador en el Legajo; sin declararlo no se aplica
    // ninguno (el título de este caso dice «el IIBB no tiene mínimo»). La marca no cambia ese cálculo.
    expect(iibb["IMPUESTO_POR_ACTIVIDAD"]).toBe("0.00");
    expect(iibb["IMPUESTO_DETERMINADO"]).toBe("0.00");
    expect(tem["IMPUESTO_DETERMINADO"]).toBe("10028.00");
    const wp = data<{ status: string }>(await request("GET", sourceBase));
    expect(wp.status).toBe("CALCULATED");
  });

  it("deshacer en un mes calculado devuelve el mes a preparación y el cálculo exige recalcular", async () => {
    const response = await request("DELETE", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    ok(response, 200, "deshacer sin movimientos");
    expect(data<Record<string, unknown>>(response)).toMatchObject({
      status: "PENDING",
      present: false,
      noMovements: null,
    });

    const wp = data<{ status: string }>(await request("GET", sourceBase));
    expect(wp.status).toBe("COLLECTING_INPUTS");
    // Al deshacer, el libro deja de cubrir las tablas manuales: vuelven a ser obligatorias.
    const tras = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    for (const code of ["DGR_IIBB_TUC", "SMT_TEM"]) {
      expect(tras.sources.find((source) => source.code === code)).toMatchObject({
        required: true,
        present: false,
        status: "PENDING",
      });
    }
    const row = await prisma.workpaperSourceStatus.findFirstOrThrow({
      where: { workpaperId, sourceCode: "ARCA_IVA_SALES" },
      orderBy: { markedAt: "desc" },
    });
    expect(row).toMatchObject({
      clearReason: "MANUAL",
      markedByUserId: OWNER,
      clearedByUserId: OWNER,
    });
    expect(row.clearedAt).not.toBeNull();

    const blocked = await request("POST", `${sourceBase}/calculate`, { cutoff: END });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: "SOURCE_NOT_REVIEWED" } });
  });

  it("deshacer sin una marca vigente responde 404 con guía", async () => {
    const response = await request("DELETE", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NO_MOVEMENTS_NOT_FOUND" } });
  });

  it("un lote revisado manda: limpia la marca con historial y después no admite «Sin movimientos»", async () => {
    ok(
      await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`),
      200,
      "marca antes del lote",
    );
    const libro = libroEmitidos(cuit, ENCABEZADOS, [
      {
        ...CLIENTE,
        Fecha: "03/10/2026",
        Tipo: "1 - Factura A",
        "Punto de Venta": 1,
        "Número Desde": 1,
        "Número Hasta": 1,
        "Neto Gravado Total": 50000,
        "Neto No Gravado": 10000,
        "Op. Exentas": 5000,
        "Otros Tributos": 1500,
        "Total IVA": 10500,
        "Imp. Total": 77000,
      },
      {
        ...CLIENTE,
        Fecha: "10/10/2026",
        Tipo: "11 - Factura C",
        "Punto de Venta": 2,
        "Número Desde": 1,
        "Número Hasta": 1,
        "Imp. Total": 55000,
      },
      {
        ...CLIENTE,
        Fecha: "24/10/2026",
        Tipo: "13 - Nota de Crédito C",
        "Punto de Venta": 2,
        "Número Desde": 2,
        "Número Hasta": 2,
        "Imp. Total": 5000,
      },
    ]);
    const imported = await request("POST", `${clientBase}/sifere/import`, {
      direction: "SALE",
      base64: Buffer.from(libro).toString("base64"),
      fileName: `T-Emitidos-2A-${RUN}.xlsx`,
      fileHash: `sha256:T-2A-${RUN}`,
      taxTypeId: bookTaxTypeId,
      periodId: bookPeriodId,
      clientCuit: cuit,
      workpaperId,
    });
    ok(imported, 201, "importación del libro de ventas");

    const afterImport = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const linkId = afterImport.sources.find((source) => source.code === "ARCA_IVA_SALES")!
      .batches[0]!.id;
    ok(await request("POST", `${sourceBase}/sources/${linkId}/review`), 200, "revisión del libro");

    const reviewed = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    expect(reviewed.sources.find((source) => source.code === "ARCA_IVA_SALES")).toMatchObject({
      present: true,
      status: "LOADED",
      noMovements: null,
    });
    const cleared = await prisma.workpaperSourceStatus.findFirstOrThrow({
      where: { workpaperId, sourceCode: "ARCA_IVA_SALES", clearReason: "BATCH_REVIEWED" },
    });
    expect(cleared.clearedAt).not.toBeNull();
    expect(cleared.clearedByUserId).toBe(OWNER);

    const rejected = await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ error: { code: "SOURCE_HAS_REVIEWED_BATCH" } });
  });

  it("con el libro revisado, el cálculo usa la base del libro (65.000 + 55.000 − 5.000)", async () => {
    ok(
      await request("POST", `${sourceBase}/calculate`, { cutoff: END }),
      200,
      "cálculo con el libro",
    );
    const calculation = data<
      Array<{ obligation: { taxTypeCode: string }; settlement: { totals: Record<string, string> } }>
    >(await request("GET", `${sourceBase}/calculation`));
    const iibb = calculation.find((item) => item.obligation.taxTypeCode === "IIBB")!.settlement
      .totals;
    expect(iibb["BASE_TOTAL"]).toBe("115000.00");
  });

  it("retirar el último lote revisado deja la fuente pendiente y permite marcarla sin movimientos", async () => {
    const coverage = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const batch = coverage.sources.find((source) => source.code === "ARCA_IVA_SALES")!.batches[0]!;
    ok(
      await request("POST", `${sourceBase}/batches/${batch.importBatchId}/retire`, {
        reason: "Carga duplicada de prueba",
      }),
      200,
      "retirar el último lote revisado",
    );

    const pending = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    expect(pending.sources.find((source) => source.code === "ARCA_IVA_SALES")).toMatchObject({
      required: true,
      present: false,
      status: "PENDING",
    });
    ok(
      await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`),
      200,
      "marcar fuente pendiente sin movimientos",
    );
    const covered = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    expect(covered.sources.find((source) => source.code === "ARCA_IVA_SALES")).toMatchObject({
      required: true,
      present: false,
      status: "NO_MOVEMENTS",
    });
    ok(await request("POST", `${sourceBase}/calculate`, { cutoff: END }), 200, "recalcular con la marca vigente");
  });

  it("mes en revisión: no se cambia la fuente; mes finalizado: se rechaza con guía de rectificación", async () => {
    await prisma.monthlyTaxWorkpaper.update({
      where: { id: workpaperId },
      data: { status: "IN_REVIEW" },
    });
    const inReview = await request("DELETE", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    expect(inReview.statusCode).toBe(409);
    expect(inReview.json()).toMatchObject({ error: { code: "WORKPAPER_IMMUTABLE" } });

    await prisma.monthlyTaxWorkpaper.update({
      where: { id: workpaperId },
      data: { status: "FINALIZED" },
    });
    const finalized = await request("PUT", `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`);
    expect(finalized.statusCode).toBe(409);
    expect(finalized.json()).toMatchObject({
      error: {
        code: "WORKPAPER_FINALIZED",
        message: "Para cambiar un mes cerrado, rectificá la liquidación",
      },
    });
  });

  it("sin el permiso de cargar archivos (rol solo lectura) responde 403 y la lectura sigue disponible", async () => {
    await prisma.clientAssignment.create({
      data: { firmId: FIRM, userId: AUDITOR, clientId, capabilities: [] },
    });
    const read = await requestAs(auditorToken, "GET", `${sourceBase}/coverage`);
    ok(read, 200, "lectura de la cobertura");
    const write = await requestAs(
      auditorToken,
      "PUT",
      `${sourceBase}/sources/ARCA_IVA_SALES/no-movements`,
    );
    expect(write.statusCode).toBe(403);
  });

  it("RLS: otra firma no ve ni escribe las marcas; el rol runtime no puede borrarlas", async () => {
    const id = (await prisma.workpaperSourceStatus.findFirstOrThrow({ where: { workpaperId } })).id;
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

    const visible = await asRuntime(FIRM, OWNER, (tx) =>
      tx.workpaperSourceStatus.count({ where: { workpaperId } }),
    );
    expect(visible).toBeGreaterThan(0);

    const foreignRead = await asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
      tx.workpaperSourceStatus.count({ where: { workpaperId } }),
    );
    expect(foreignRead).toBe(0);

    const foreignUpdate = await asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
      tx.workpaperSourceStatus.updateMany({
        where: { id },
        data: { clearedAt: new Date(), clearReason: "MANUAL", clearedByUserId: OTHER_OWNER },
      }),
    );
    expect(foreignUpdate.count).toBe(0);

    await expect(
      asRuntime(OTHER_FIRM, OTHER_OWNER, (tx) =>
        tx.workpaperSourceStatus.create({
          data: {
            firmId: FIRM,
            clientId,
            workpaperId,
            sourceCode: "ARCA_IVA_PURCHASES",
            status: "NO_MOVEMENTS",
            markedByUserId: OTHER_OWNER,
            markedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      asRuntime(
        FIRM,
        OWNER,
        (tx) => tx.$executeRaw`DELETE FROM workpaper_source_statuses WHERE id = ${id}`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
