import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import { voucherDocumentKind } from "./workpaper-classification.js";
import {
  isSourceRequired,
  obligationForPolicy,
  policiesForObligations,
  sourceCodesForCalculation,
  getWorkpaperSourcePolicy,
} from "./workpaper-source-policy.js";

/**
 * Corte 2C: las ventas de «Mis Comprobantes Emitidos» (un solo Excel) alimentan Ingresos Brutos y TEM
 * de un monotributista que solo emite Factura C, con una nota de crédito que resta.
 *
 * Expectativa armada a mano con caso-testigo/calculadora.py (base_ventas, modo A):
 *   Factura A (neto 50.000 + no gravado 10.000 + exentas 5.000; IVA 10.500 y otros 1.500 no entran) = 65.000
 *   Factura C solo «Imp. Total» 55.000                                                            = 55.000
 *   Nota de crédito C solo «Imp. Total» 5.000 (resta)                                              = -5.000
 *   Base del mes                                                                                  = 115.000
 * Alícuotas del catálogo sembrado para la actividad «SERVICIOS»: Ingresos Brutos 4,5 % → 5.175,00; TEM 3 % → 3.450,00.
 * Datos inventados.
 */

const OWNER = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-2c-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const START = "2026-10-01";
const END = "2026-10-31";

let app: FastifyInstance | null = null;
let ownerToken = "";

type ApiResponse = { statusCode: number; body: string; json(): unknown };

function data<T>(response: ApiResponse): T {
  return (response.json() as { data: T }).data;
}

function ok(response: ApiResponse, status: number, what: string) {
  expect(response.statusCode, `${what}; respuesta: ${response.body}`).toBe(status);
}

async function request(method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: ownerToken, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  });
}

function validTestCuit() {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = [...base].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
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

/** «Mis Comprobantes Emitidos»: título en la fila 1, encabezados en la fila 2, datos desde la fila 3. */
function libroEmitidos(encabezados: string[], filas: Array<Record<string, Celda>>): Uint8Array {
  const celda = (ref: string, valor: Celda) =>
    typeof valor === "number"
      ? `<c r="${ref}"><v>${valor}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${valor}</t></is></c>`;
  const matriz: Celda[][] = [
    ["Mis Comprobantes Emitidos - CUIT 20000000001"],
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
  "Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta",
  "Tipo Doc. Receptor", "Nro. Doc. Receptor", "Denominación Receptor", "Tipo Cambio", "Moneda",
  "Neto Gravado Total", "Neto No Gravado", "Op. Exentas", "Otros Tributos", "Total IVA", "Imp. Total",
];
const CLIENTE = {
  "Tipo Doc. Receptor": "CUIT",
  "Nro. Doc. Receptor": 30111111119,
  "Denominación Receptor": "CLIENTE FICTICIO",
  "Tipo Cambio": 1,
  "Moneda": "$",
};

describe("2C — un libro de ventas de ARCA alimenta Ingresos Brutos y TEM", () => {
  beforeAll(async () => {
    app = await buildServer({
      postgres: async () => true,
      valkey: async () => true,
      minio: async () => true,
      ai: async () => true,
    });
    await app.ready();
    await prisma.firm.create({
      data: { id: FIRM, legalName: `T-Estudio 2C ${RUN}`, displayName: `T-Estudio 2C ${RUN}`, allowSelfReview: true },
    });
    await prisma.user.create({
      data: { id: OWNER, emailNormalized: `t-2c-owner-${RUN}@example.invalid`, name: `T-Titular 2C ${RUN}`, passwordHash: "-" },
    });
    await prisma.firmMembership.create({
      data: { firmId: FIRM, userId: OWNER, role: "OWNER", status: "ACTIVE", acceptedAt: new Date() },
    });
    ownerToken = randomBytes(32).toString("base64url");
    await prisma.deviceSession.create({
      data: {
        id: randomUUID(),
        userId: OWNER,
        refreshTokenHash: sha256(ownerToken),
        familyId: randomUUID(),
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.deviceSession.deleteMany({ where: { userId: OWNER } });
      await prisma.firmMembership.deleteMany({ where: { firmId: FIRM } });
    } finally {
      await app?.close();
      app = null;
    }
  });

  it.each([
    { caso: "una actividad", actividadMunicipal: false },
    { caso: "una actividad provincial y otra municipal", actividadMunicipal: true },
  ])("monotributista con Factura A, Factura C y nota de crédito C ($caso): la base de IIBB y TEM sale del mismo libro", async ({ actividadMunicipal }) => {
    const jurisdictionId = await resolveMaster("/api/v1/tax/jurisdictions", "AR-T");
    const iibbTypeId = await resolveMaster("/api/v1/tax/types", "IIBB");
    const temTypeId = await resolveMaster("/api/v1/tax/types", "TEM");
    const iibbRegimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
    const temRegimeId = await resolveMaster("/api/v1/tax/regimes", "TEM_SMT");
    const cuit = validTestCuit();

    const clientResponse = await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente 2C ${RUN}`,
      tradeName: `T-Cliente 2C ${RUN}`,
      cuit,
    });
    ok(clientResponse, 201, "alta del cliente");
    const client = data<{ id: string }>(clientResponse);
    const clientBase = `${BASE}/clients/${client.id}`;
    const profileResponse = await request("POST", `${clientBase}/tax-profile-versions`, {
      legalName: `T-Cliente 2C ${RUN}`,
      cuit,
      personType: "FISICA",
      nationalCondition: "MONOTRIBUTISTA",
      fiscalAddress: `T-Domicilio ${RUN}, San Miguel de Tucumán`,
      validFrom: "2026-01-01",
    });
    ok(profileResponse, 201, "perfil fiscal");
    const profile = data<{ id: string }>(profileResponse);
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`), 200, "perfil a revisión");
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`), 200, "perfil activo");

    // Una sola actividad: todas las ventas del libro se asignan a ella sin clasificarlas una por una.
    const activity = await prisma.economicActivity.findFirstOrThrow({ where: { code: "SERVICIOS", jurisdictionId } });
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
    if (actividadMunicipal) {
      // Una por nivel: no hace falta clasificar ninguna venta, cada impuesto toma la de su nivel.
      const municipal = await prisma.economicActivity.findFirstOrThrow({
        where: { code: "COMERCIO", jurisdiction: { code: "AR-SMT" } },
      });
      ok(
        await request("POST", `${clientBase}/activities`, {
          profileVersionId: profile.id,
          activityId: municipal.id,
          isPrimary: false,
          validFrom: "2026-01-01",
        }),
        201,
        "actividad municipal",
      );
    }

    const obligations: Array<{ id: string; regimeId: string; periodId: string }> = [];
    for (const [taxTypeId, regimeId] of [
      [iibbTypeId, iibbRegimeId],
      [temTypeId, temRegimeId],
    ] as const) {
      ok(
        await request("POST", `${clientBase}/tax-registrations`, {
          profileVersionId: profile.id,
          regimeId,
          validFrom: "2026-01-01",
          registrationNumber: `T-REG-${RUN.slice(0, 8)}-${regimeId.slice(0, 4)}`,
        }),
        201,
        "adhesión",
      );
      const period = data<{ id: string }>(
        await request("POST", `${clientBase}/tax-periods`, { taxTypeId, startDate: START, endDate: END, label: "T-Octubre 2026" }),
      );
      const obligation = data<{ id: string }>(
        await request("POST", `${clientBase}/tax-obligations`, {
          profileVersionId: profile.id,
          regimeId,
          periodId: period.id,
          dueDate: "2026-11-20",
        }),
      );
      obligations.push({ id: obligation.id, regimeId, periodId: period.id });
    }

    const workpaper = data<{ id: string; settlements: Array<{ obligationId: string }> }>(
      await request("POST", `${clientBase}/monthly-tax-workpapers`, { periodStart: START, periodEnd: END }),
    );
    expect(workpaper.settlements.map((link) => link.obligationId).sort()).toEqual(obligations.map((o) => o.id).sort());
    const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;

    // Antes de cargar nada: la fuente que falta es el libro de ventas, y se carga desde Ingresos Brutos.
    type Coverage = {
      sources: Array<{ code: string; required: boolean; present: boolean; taxTypeId: string | null; periodId: string | null; batches: Array<{ id: string }> }>;
    };
    const before = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const bookBefore = before.sources.find((source) => source.code === "ARCA_IVA_SALES");
    expect(bookBefore, "el libro de ventas figura como fuente de Ingresos Brutos y TEM").toBeTruthy();
    expect(bookBefore).toMatchObject({ required: true, present: false, taxTypeId: iibbTypeId });
    expect(before.sources.some((source) => source.code === "ARCA_IVA_PURCHASES")).toBe(false);

    const libro = libroEmitidos(ENCABEZADOS, [
      { ...CLIENTE, "Fecha": "03/10/2026", "Tipo": "1 - Factura A", "Punto de Venta": 1, "Número Desde": 1, "Número Hasta": 1, "Neto Gravado Total": 50000, "Neto No Gravado": 10000, "Op. Exentas": 5000, "Otros Tributos": 1500, "Total IVA": 10500, "Imp. Total": 77000 },
      { ...CLIENTE, "Fecha": "10/10/2026", "Tipo": "11 - Factura C", "Punto de Venta": 2, "Número Desde": 1, "Número Hasta": 1, "Imp. Total": 55000 },
      { ...CLIENTE, "Fecha": "24/10/2026", "Tipo": "13 - Nota de Crédito C", "Punto de Venta": 2, "Número Desde": 2, "Número Hasta": 2, "Imp. Total": 5000 },
    ]);
    const imported = await request("POST", `${clientBase}/sifere/import`, {
      direction: "SALE",
      base64: Buffer.from(libro).toString("base64"),
      fileName: `T-Emitidos-${RUN}.xlsx`,
      fileHash: `sha256:T-2C-${RUN}`,
      taxTypeId: bookBefore!.taxTypeId,
      periodId: bookBefore!.periodId,
      clientCuit: cuit,
      workpaperId: workpaper.id,
    });
    ok(imported, 201, "importación del libro de ventas desde Ingresos Brutos");
    expect(data<{ analysis: { validRows: number; errorRows: number } }>(imported).analysis).toMatchObject({ validRows: 3, errorRows: 0 });

    const afterImport = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const linkId = afterImport.sources.find((source) => source.code === "ARCA_IVA_SALES")!.batches[0]!.id;
    ok(await request("POST", `${sourceBase}/sources/${linkId}/review`), 200, "revisión del libro");

    // Revisado el libro, no queda ninguna fuente obligatoria pendiente: el cálculo está habilitado.
    const reviewed = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    expect(reviewed.sources.filter((source) => source.required && !source.present)).toEqual([]);
    expect(reviewed.sources.find((source) => source.code === "DGR_IIBB_TUC")).toMatchObject({ required: false, present: false });
    expect(reviewed.sources.find((source) => source.code === "SMT_TEM")).toMatchObject({ required: false, present: false });

    const calculated = await request("POST", `${sourceBase}/calculate`, { cutoff: END });
    ok(calculated, 200, "cálculo de IIBB y TEM desde el libro");

    const calculation = data<
      Array<{ obligation: { taxTypeCode: string }; settlement: { totals: Record<string, string> } }>
    >(
      await request("GET", `${sourceBase}/calculation`),
    );
    expect(calculation).toHaveLength(2);
    const iibb = calculation.find((item) => item.obligation.taxTypeCode === "IIBB")!.settlement.totals;
    const tem = calculation.find((item) => item.obligation.taxTypeCode === "TEM")!.settlement.totals;
    // calculadora.py, base_ventas modo A: 65.000 + 55.000 − 5.000 = 115.000 para los dos impuestos.
    expect(iibb["BASE_TOTAL"]).toBe("115000.00");
    expect(tem["BASE_TOTAL"]).toBe("115000.00");
    // Alícuotas de la regla «SERVICIOS» del catálogo sembrado: IIBB 4,5 % y TEM 3 %.
    expect(iibb["IMPUESTO_DETERMINADO"]).toBe("5175.00");
    expect(tem["TRIBUTO_DETERMINADO"] ?? tem["IMPUESTO_DETERMINADO"]).toBe("3450.00");
  });
});

describe("2C — política de fuentes y clase de documento", () => {
  const iibb = { taxTypeCode: "IIBB", regimeCode: "IIBB_LOCAL_TUC" };
  const tem = { taxTypeCode: "TEM", regimeCode: "TEM_SMT" };
  const iva = { taxTypeCode: "IVA", regimeCode: "RI" };
  const book = getWorkpaperSourcePolicy("ARCA_IVA_SALES")!;
  const manualIibb = getWorkpaperSourcePolicy("DGR_IIBB_TUC")!;

  it("el libro de ventas sirve a IVA, Ingresos Brutos y TEM; las compras solo a IVA", () => {
    expect(policiesForObligations([iibb, tem]).map((policy) => policy.code)).toContain("ARCA_IVA_SALES");
    expect(policiesForObligations([iibb]).map((policy) => policy.code)).not.toContain("ARCA_IVA_PURCHASES");
    expect(obligationForPolicy(book, [iibb, tem])).toBe(iibb);
  });

  it("la tabla manual y el libro se cubren entre sí; con IVA, el libro es obligatorio como siempre", () => {
    const none = new Set<string>();
    expect(isSourceRequired(book, [iibb, tem], none)).toBe(true);
    expect(isSourceRequired(manualIibb, [iibb], none)).toBe(true);
    expect(isSourceRequired(manualIibb, [iibb], new Set(["ARCA_IVA_SALES"]))).toBe(false);
    expect(isSourceRequired(book, [iibb], new Set(["DGR_IIBB_TUC"]))).toBe(false);
    expect(isSourceRequired(book, [iibb, tem], new Set(["DGR_IIBB_TUC"]))).toBe(true); // TEM sigue sin base
    expect(isSourceRequired(book, [iva, iibb], new Set(["DGR_IIBB_TUC"]))).toBe(true);
  });

  it("si la tabla manual está revisada, manda: el libro no se suma a la base de esa obligación", () => {
    expect(sourceCodesForCalculation(iibb, new Set(["ARCA_IVA_SALES"]))).toContain("ARCA_IVA_SALES");
    const withManual = sourceCodesForCalculation(iibb, new Set(["ARCA_IVA_SALES", "DGR_IIBB_TUC"]));
    expect(withManual).toContain("DGR_IIBB_TUC");
    expect(withManual).not.toContain("ARCA_IVA_SALES");
    expect(sourceCodesForCalculation(iva, new Set(["ARCA_IVA_SALES", "DGR_IIBB_TUC"]))).toContain("ARCA_IVA_SALES");
  });

  it("voucherDocumentKind decide por la tabla oficial: el código 6 es Factura B, no nota de crédito", () => {
    expect(voucherDocumentKind({ type: "6", letter: null })).toBe("INVOICE");
    expect(voucherDocumentKind({ type: "B", letter: "B" })).toBe("INVOICE");
    for (const code of ["3", "8", "13", "203", "208", "213", "21", "90"]) {
      expect(voucherDocumentKind({ type: code, letter: null }), `código ${code}`).toBe("CREDIT_NOTE");
    }
    expect(voucherDocumentKind({ type: "NC", letter: "NC" })).toBe("CREDIT_NOTE");
    expect(voucherDocumentKind({ type: "12", letter: null })).toBe("DEBIT_NOTE");
    expect(voucherDocumentKind({ type: "ND", letter: "ND" })).toBe("DEBIT_NOTE");
  });
});
