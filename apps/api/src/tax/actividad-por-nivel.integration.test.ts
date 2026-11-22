import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import { computeRulesHashV3 } from "./rules-hash.js";

/**
 * Corte 4F: cada impuesto resuelve la actividad de SU nivel.
 *
 * Caso de producción (22-11-2026): el cliente tiene REST-TUC en AR-T (Ingresos Brutos Tucumán) y
 * REST-SMT en AR-SMT (TEM San Miguel de Tucumán). Un libro de ventas de ARCA alimenta los dos impuestos y
 * cada venta quedó clasificada con la actividad provincial REST-TUC. Antes del corte, el TEM buscaba
 * REST-TUC dentro de AR-SMT y fallaba con ACTIVITY_RULE_UNRESOLVED.
 *
 * Esperado (la alícuota de cada nivel con la actividad de su nivel, nunca mezclada):
 *   Base del mes (Factura A 65.000 + Factura C 55.000 − nota de crédito C 5.000) = 115.000
 *   IIBB: REST-TUC 4,5 % → 5.175,00
 *   TEM: REST-SMT 3 % → 3.450,00; el mínimo de la categoría B (10.028,00) rige.
 *
 * Las alícuotas de prueba se cargan como reglas tipadas (V3) con activityId en las versiones activas de
 * IIBB y TEM y se restauran al terminar. Datos inventados.
 */

const OWNER = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-4f-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const START = "2026-10-01";
const END = "2026-10-31";
const RATES = { iibb: "4.5", tem: "3" } as const;

let app: FastifyInstance | null = null;
let ownerToken = "";
const restore: Array<() => Promise<void>> = [];

type ApiResponse = { statusCode: number; body: string; json(): unknown };

function data<T>(response: ApiResponse): T {
  return (response.json() as { data: T }).data;
}

function ok(response: ApiResponse, status: number, what: string) {
  expect(response.statusCode, `${what}; respuesta: ${response.body}`).toBe(status);
}

async function request(method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: Record<string, unknown>) {
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

function libroEmitidos(cuitTitulo: string, encabezados: string[], filas: Array<Record<string, Celda>>): Uint8Array {
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

/** Actividad sintética por nivel, creada si no existe (no depende de otras pruebas). */
async function ensureActivity(code: string, jurisdictionCode: string) {
  const jurisdiction = await prisma.jurisdiction.findFirstOrThrow({ where: { code: jurisdictionCode } });
  return prisma.economicActivity.upsert({
    where: { code_jurisdictionId: { code, jurisdictionId: jurisdiction.id } },
    update: { isActive: true },
    create: {
      code,
      name: `Actividad sintética ${code}`,
      jurisdictionId: jurisdiction.id,
      validFrom: new Date("2026-01-01"),
      source: "Prueba 4F",
    },
  });
}

/**
 * Pasa la versión activa del régimen a reglas tipadas con una sola alícuota por actividad del nivel.
 * Guarda las reglas y los campos de versión originales para restaurarlos en afterAll.
 */
async function typeActiveVersion(regimeKey: string, jurisdictionCode: string, engineKey: string, activityId: string, activityCode: string, rate: string) {
  const regime = await prisma.taxRegime.findFirstOrThrow({ where: { code: regimeKey } });
  const version = await prisma.taxRuleVersion.findFirstOrThrow({
    where: { status: "ACTIVE", pack: { regimeId: regime.id } },
  });
  const originalRules = await prisma.taxRateRule.findMany({ where: { ruleVersionId: version.id } });
  const originalVersion = await prisma.taxRuleVersion.findUniqueOrThrow({ where: { id: version.id } });
  const originalFamilyId = regime.calcFamilyId;
  const originalJurisdictionId = regime.jurisdictionId;
  // Jurisdicción del régimen como en producción: el TEM vive en AR-SMT (la base sembrada lo deja en AR-T).
  const jurisdiction = await prisma.jurisdiction.findFirstOrThrow({ where: { code: jurisdictionCode } });
  // El motor que lee reglas tipadas con actividad por nivel es el de la clave indicada (su familia debe coincidir).
  const engine = await prisma.taxEngine.findUniqueOrThrow({ where: { engineKey } });
  restore.push(async () => {
    await prisma.taxRateRule.deleteMany({ where: { ruleVersionId: version.id } });
    if (originalRules.length > 0) await prisma.taxRateRule.createMany({ data: originalRules });
    await prisma.taxRuleVersion.update({
      where: { id: version.id },
      data: {
        engineVersion: originalVersion.engineVersion,
        rulesHashSchemaVersion: originalVersion.rulesHashSchemaVersion,
        rulesHash: originalVersion.rulesHash,
      },
    });
    await prisma.taxRegime.update({
      where: { id: regime.id },
      data: { calcFamilyId: originalFamilyId, jurisdictionId: originalJurisdictionId },
    });
  });

  const kind = await prisma.taxRuleKind.findUniqueOrThrow({ where: { key: "RATE" } });
  await prisma.taxRegime.update({
    where: { id: regime.id },
    data: { calcFamilyId: engine.familyId, jurisdictionId: jurisdiction.id },
  });
  await prisma.taxRuleVersion.update({ where: { id: version.id }, data: { engineVersion: engine.engineVersion } });
  await prisma.taxRateRule.deleteMany({ where: { ruleVersionId: version.id } });
  await prisma.taxRateRule.create({
    data: {
      ruleVersionId: version.id,
      concept: `ALICUOTA_${activityCode}`,
      activityId,
      activityCode,
      kindId: kind.id,
      rate: new Prisma.Decimal(rate),
      isDefault: false,
      validFrom: new Date("2026-01-01"),
    },
  });
  const typed = await prisma.taxRuleVersion.findUniqueOrThrow({
    where: { id: version.id },
    include: {
      rateRules: { include: { kind: true } },
      minimumRules: true,
      bracketRules: true,
      dueDateRules: true,
      roundingRules: true,
    },
  });
  await prisma.taxRuleVersion.update({
    where: { id: version.id },
    data: { rulesHashSchemaVersion: 3, rulesHash: computeRulesHashV3(typed) },
  });
}

describe("4F — cada impuesto calcula con la actividad de su nivel (REST-TUC en AR-T, REST-SMT en AR-SMT)", () => {
  beforeAll(async () => {
    app = await buildServer({
      postgres: async () => true,
      valkey: async () => true,
      minio: async () => true,
      ai: async () => true,
    });
    await app.ready();
    await prisma.firm.create({
      data: { id: FIRM, legalName: `T-Estudio 4F ${RUN}`, displayName: `T-Estudio 4F ${RUN}`, allowSelfReview: true },
    });
    await prisma.user.create({
      data: { id: OWNER, emailNormalized: `t-4f-owner-${RUN}@example.invalid`, name: `T-Titular 4F ${RUN}`, passwordHash: "-" },
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

    const tucuman = await ensureActivity("REST-TUC", "AR-T");
    const santiago = await ensureActivity("REST-SMT", "AR-SMT");
    await typeActiveVersion("IIBB_LOCAL_TUC", "AR-T", "iibb-local-tuc", tucuman.id, "REST-TUC", RATES.iibb);
    await typeActiveVersion("TEM_SMT", "AR-SMT", "tem-smt", santiago.id, "REST-SMT", RATES.tem);
  });

  afterAll(async () => {
    try {
      for (const undo of restore.reverse()) await undo();
      await prisma.deviceSession.deleteMany({ where: { userId: OWNER } });
      await prisma.firmMembership.deleteMany({ where: { firmId: FIRM } });
    } finally {
      await app?.close();
      app = null;
    }
  });

  it.each([
    { caso: "monotributista", condicion: "MONOTRIBUTISTA" },
    { caso: "responsable inscripto", condicion: "RESPONSABLE_INSCRIPTO" },
  ])("$caso: IIBB toma REST-TUC y TEM toma REST-SMT aunque las ventas digan REST-TUC", async ({ condicion }) => {
    const iibbRegimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
    const temRegimeId = await resolveMaster("/api/v1/tax/regimes", "TEM_SMT");
    const iibbTypeId = await resolveMaster("/api/v1/tax/types", "IIBB");
    const temTypeId = await resolveMaster("/api/v1/tax/types", "TEM");
    const tucuman = await prisma.economicActivity.findFirstOrThrow({ where: { code: "REST-TUC", jurisdiction: { code: "AR-T" } } });
    const santiago = await prisma.economicActivity.findFirstOrThrow({ where: { code: "REST-SMT", jurisdiction: { code: "AR-SMT" } } });
    const cuit = validTestCuit();

    const clientResponse = await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente 4F ${RUN}`,
      tradeName: `T-Cliente 4F ${RUN}`,
      cuit,
    });
    ok(clientResponse, 201, "alta del cliente");
    const client = data<{ id: string }>(clientResponse);
    const clientBase = `${BASE}/clients/${client.id}`;
    const profile = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-profile-versions`, {
        legalName: `T-Cliente 4F ${RUN}`,
        cuit,
        personType: "FISICA",
        nationalCondition: condicion,
        fiscalAddress: `T-Domicilio ${RUN}, San Miguel de Tucumán`,
        validFrom: "2026-01-01",
      }),
    );
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`), 200, "perfil a revisión");
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`), 200, "perfil activo");
    ok(await request("PUT", `${clientBase}/tem-categories/2026`, { category: "B" }), 200, "categoría TEM 2026");

    // Una actividad por nivel, como en producción.
    for (const [activityId, isPrimary] of [[tucuman.id, true], [santiago.id, false]] as const) {
      ok(
        await request("POST", `${clientBase}/activities`, {
          profileVersionId: profile.id,
          activityId,
          isPrimary,
          validFrom: "2026-01-01",
        }),
        201,
        "vínculo de actividad",
      );
    }

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
          registrationNumber: `T-4F-${RUN.slice(0, 8)}-${regimeId.slice(0, 4)}`,
        }),
        201,
        "adhesión",
      );
      const period = data<{ id: string }>(
        await request("POST", `${clientBase}/tax-periods`, { taxTypeId, startDate: START, endDate: END, label: "T-Octubre 2026" }),
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

    const workpaper = data<{ id: string; settlements: Array<{ obligationId: string }> }>(
      await request("POST", `${clientBase}/monthly-tax-workpapers`, { periodStart: START, periodEnd: END }),
    );
    expect(workpaper.settlements.map((link) => link.obligationId).sort()).toEqual(obligations.map((o) => o.id).sort());
    const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;

    type Coverage = {
      sources: Array<{ code: string; required: boolean; present: boolean; taxTypeId: string | null; periodId: string | null; batches: Array<{ id: string }> }>;
    };
    const before = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const book = before.sources.find((source) => source.code === "ARCA_IVA_SALES")!;
    expect(book).toMatchObject({ required: true, present: false, taxTypeId: iibbTypeId });

    const libro = libroEmitidos(cuit, ENCABEZADOS, [
      { ...CLIENTE, "Fecha": "03/10/2026", "Tipo": "1 - Factura A", "Punto de Venta": 1, "Número Desde": 1, "Número Hasta": 1, "Neto Gravado Total": 50000, "Neto No Gravado": 10000, "Op. Exentas": 5000, "Otros Tributos": 1500, "Total IVA": 10500, "Imp. Total": 77000 },
      { ...CLIENTE, "Fecha": "10/10/2026", "Tipo": "11 - Factura C", "Punto de Venta": 2, "Número Desde": 1, "Número Hasta": 1, "Imp. Total": 55000 },
      { ...CLIENTE, "Fecha": "24/10/2026", "Tipo": "13 - Nota de Crédito C", "Punto de Venta": 2, "Número Desde": 2, "Número Hasta": 2, "Imp. Total": 5000 },
    ]);
    const imported = await request("POST", `${clientBase}/sifere/import`, {
      direction: "SALE",
      base64: Buffer.from(libro).toString("base64"),
      fileName: `T-4F-${RUN}-${condicion}.xlsx`,
      fileHash: `sha256:T-4F-${RUN}-${condicion}`,
      taxTypeId: book.taxTypeId,
      periodId: book.periodId,
      clientCuit: cuit,
      workpaperId: workpaper.id,
    });
    ok(imported, 201, "importación del libro de ventas desde Ingresos Brutos");
    const afterImport = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const linkId = afterImport.sources.find((source) => source.code === "ARCA_IVA_SALES")!.batches[0]!.id;
    ok(await request("POST", `${sourceBase}/sources/${linkId}/review`), 200, "revisión del libro");

    // Las ventas quedan clasificadas con la actividad provincial, como en producción.
    const classifications = data<{ items: Array<{ id: string; direction: string }> }>(
      await request("GET", `${sourceBase}/classifications`),
    );
    const sales = classifications.items.filter((row) => row.direction === "SALE");
    expect(sales).toHaveLength(3);
    for (const sale of sales) {
      ok(
        await request("PATCH", `${sourceBase}/classifications/${sale.id}`, { activityCode: "REST-TUC" }),
        200,
        "clasificación de la venta como REST-TUC",
      );
    }

    const calculated = await request("POST", `${sourceBase}/calculate`, { cutoff: END });
    ok(calculated, 200, "cálculo de IIBB y TEM con la actividad de cada nivel");

    const calculation = data<
      Array<{ obligation: { taxTypeCode: string }; settlement: { totals: Record<string, string> } }>
    >(await request("GET", `${sourceBase}/calculation`));
    expect(calculation).toHaveLength(2);
    const iibb = calculation.find((item) => item.obligation.taxTypeCode === "IIBB")!.settlement.totals;
    const tem = calculation.find((item) => item.obligation.taxTypeCode === "TEM")!.settlement.totals;
    expect(iibb["BASE_TOTAL"]).toBe("115000.00");
    expect(tem["BASE_TOTAL"]).toBe("115000.00");
    // IIBB: REST-TUC 4,5 %
    expect(iibb["IMPUESTO_DETERMINADO"]).toBe("5175.00");
    // TEM: REST-SMT 3 % (no la provincial), y el mínimo de la categoría B rige.
    expect(tem["IMPUESTO_POR_ACTIVIDAD"]).toBe("3450.00");
    expect(tem["IMPUESTO_DETERMINADO"]).toBe("10028.00");
  });
});
