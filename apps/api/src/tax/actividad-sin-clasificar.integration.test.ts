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
 * Arreglos 4G: bloqueo «sin clasificar» (ACTIVITY_UNCLASSIFIED).
 *
 * Caso sintético: un cliente con dos actividades municipales (AR-SMT) liquida TEM con un libro de ventas
 * sin actividad asignada. El cálculo se detiene con un código y un mensaje en español llano que dicen qué
 * hacer. Un cliente con una sola actividad provincial (AR-T) liquida IIBB con el mismo libro sin clasificar:
 * la única actividad del nivel toma las ventas y el cálculo termina normal.
 *
 * Datos inventados: CUIT sintético, razones sociales y actividades de prueba. Las alícuotas se cargan como
 * reglas tipadas (V3) en las versiones activas y se restauran al terminar.
 */

const OWNER = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-4g-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const START = "2026-10-01";
const END = "2026-10-31";

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

async function request(
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
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

/** Actividad sintética en un nivel, creada si no existe (no depende de otras pruebas). */
async function ensureActivity(code: string, jurisdictionCode: string) {
  const jurisdiction = await prisma.jurisdiction.findFirstOrThrow({
    where: { code: jurisdictionCode },
  });
  return prisma.economicActivity.upsert({
    where: { code_jurisdictionId: { code, jurisdictionId: jurisdiction.id } },
    update: { isActive: true },
    create: {
      code,
      name: `Actividad sintética ${code}`,
      jurisdictionId: jurisdiction.id,
      validFrom: new Date("2026-01-01"),
      source: "Prueba 4G",
    },
  });
}

/**
 * Pasa la versión activa del régimen a reglas tipadas con una alícuota por actividad.
 * Guarda reglas y campos de versión originales para restaurarlos en afterAll.
 */
async function typeActiveVersion(
  regimeKey: string,
  engineKey: string,
  activityId: string,
  activityCode: string,
  rate: string,
) {
  const regime = await prisma.taxRegime.findFirstOrThrow({ where: { code: regimeKey } });
  const version = await prisma.taxRuleVersion.findFirstOrThrow({
    where: { status: "ACTIVE", pack: { regimeId: regime.id } },
  });
  const originalRules = await prisma.taxRateRule.findMany({ where: { ruleVersionId: version.id } });
  const originalVersion = await prisma.taxRuleVersion.findUniqueOrThrow({
    where: { id: version.id },
  });
  const originalFamilyId = regime.calcFamilyId;
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
      data: { calcFamilyId: originalFamilyId },
    });
  });

  const kind = await prisma.taxRuleKind.findUniqueOrThrow({ where: { key: "RATE" } });
  await prisma.taxRegime.update({
    where: { id: regime.id },
    data: { calcFamilyId: engine.familyId },
  });
  await prisma.taxRuleVersion.update({
    where: { id: version.id },
    data: { engineVersion: engine.engineVersion },
  });
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

type Escenario = {
  caso: string;
  taxTypeCode: "IIBB" | "TEM";
  regimeCode: "IIBB_LOCAL_TUC" | "TEM_SMT";
  activityCodes: string[];
  /** Actividad con que se clasifican todas las ventas tras revisar el libro. Sin valor, quedan sin clasificar. */
  actividadVentas?: string;
};

/**
 * Crea un cliente con sus actividades vinculadas, una obligación y un libro de ventas revisado.
 * Si el escenario trae actividadVentas, cada venta queda clasificada con ella. Devuelve la ruta del cálculo.
 */
async function prepararLibro(escenario: Escenario) {
  const taxTypeId = await resolveMaster("/api/v1/tax/types", escenario.taxTypeCode);
  const regimeId = await resolveMaster("/api/v1/tax/regimes", escenario.regimeCode);
  const cuit = validTestCuit();
  const client = data<{ id: string }>(
    await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente 4G ${escenario.caso} ${RUN}`,
      tradeName: `T-Cliente 4G ${escenario.caso} ${RUN}`,
      cuit,
    }),
  );
  const clientBase = `${BASE}/clients/${client.id}`;
  const profile = data<{ id: string }>(
    await request("POST", `${clientBase}/tax-profile-versions`, {
      legalName: `T-Cliente 4G ${escenario.caso} ${RUN}`,
      cuit,
      personType: "FISICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
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

  for (const [index, code] of escenario.activityCodes.entries()) {
    const jurisdictionCode = escenario.taxTypeCode === "TEM" ? "AR-SMT" : "AR-T";
    const activity = await ensureActivity(code, jurisdictionCode);
    ok(
      await request("POST", `${clientBase}/activities`, {
        profileVersionId: profile.id,
        activityId: activity.id,
        isPrimary: index === 0,
        validFrom: "2026-01-01",
      }),
      201,
      `vínculo de la actividad ${code}`,
    );
  }

  ok(
    await request("POST", `${clientBase}/tax-registrations`, {
      profileVersionId: profile.id,
      regimeId,
      validFrom: "2026-01-01",
      registrationNumber: `T-4G-${RUN.slice(0, 8)}-${escenario.caso.slice(0, 4)}`,
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
  const obligation = data<{ id: string }>(
    await request("POST", `${clientBase}/tax-obligations`, {
      profileVersionId: profile.id,
      regimeId,
      periodId: period.id,
      dueDate: "2026-11-20",
    }),
  );
  const workpaper = data<{ id: string; settlements: Array<{ obligationId: string }> }>(
    await request("POST", `${clientBase}/monthly-tax-workpapers`, {
      periodStart: START,
      periodEnd: END,
    }),
  );
  expect(workpaper.settlements.map((link) => link.obligationId)).toEqual([obligation.id]);
  const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;

  type Coverage = {
    sources: Array<{
      code: string;
      required: boolean;
      present: boolean;
      taxTypeId: string | null;
      periodId: string | null;
      batches: Array<{ id: string }>;
    }>;
  };
  const before = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
  const book = before.sources.find(
    (source) => source.code === "ARCA_IVA_SALES" && source.taxTypeId === taxTypeId,
  )!;
  expect(book, "el libro de ventas figura como fuente del impuesto").toBeTruthy();

  const libro = libroEmitidos(cuit, ENCABEZADOS, [
    {
      ...CLIENTE,
      Fecha: "03/10/2026",
      Tipo: "1 - Factura A",
      "Punto de Venta": 1,
      "Número Desde": 1,
      "Número Hasta": 1,
      "Neto Gravado Total": 50000,
      "Total IVA": 10500,
      "Imp. Total": 60500,
    },
    {
      ...CLIENTE,
      Fecha: "10/10/2026",
      Tipo: "11 - Factura C",
      "Punto de Venta": 2,
      "Número Desde": 1,
      "Número Hasta": 1,
      "Imp. Total": 30000,
    },
  ]);
  ok(
    await request("POST", `${clientBase}/sifere/import`, {
      direction: "SALE",
      base64: Buffer.from(libro).toString("base64"),
      fileName: `T-4G-${RUN}-${escenario.caso}.xlsx`,
      fileHash: `sha256:T-4G-${RUN}-${escenario.caso}`,
      taxTypeId,
      periodId: book.periodId,
      clientCuit: cuit,
      workpaperId: workpaper.id,
    }),
    201,
    "importación del libro de ventas",
  );
  const afterImport = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
  const linkId = afterImport.sources.find(
    (source) => source.code === "ARCA_IVA_SALES" && source.taxTypeId === taxTypeId,
  )!.batches[0]!.id;
  ok(await request("POST", `${sourceBase}/sources/${linkId}/review`), 200, "revisión del libro");
  if (escenario.actividadVentas) {
    const clasificaciones = data<{ items: Array<{ id: string; direction: string }> }>(
      await request("GET", `${sourceBase}/classifications`),
    );
    const ventas = clasificaciones.items.filter((row) => row.direction === "SALE");
    expect(ventas).toHaveLength(2);
    for (const venta of ventas) {
      ok(
        await request("PATCH", `${sourceBase}/classifications/${venta.id}`, {
          activityCode: escenario.actividadVentas,
        }),
        200,
        `clasificación de la venta como ${escenario.actividadVentas}`,
      );
    }
  }
  return `${sourceBase}/calculate`;
}

describe("4G — ventas sin clasificar: el cálculo se detiene con un mensaje que dice qué hacer", () => {
  beforeAll(async () => {
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
        legalName: `T-Estudio 4G ${RUN}`,
        displayName: `T-Estudio 4G ${RUN}`,
        allowSelfReview: true,
      },
    });
    await prisma.user.create({
      data: {
        id: OWNER,
        emailNormalized: `t-4g-owner-${RUN}@example.invalid`,
        name: `T-Titular 4G ${RUN}`,
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

    // Tipadas: TEM con una actividad de referencia en AR-SMT y IIBB con la suya en AR-T.
    const santiago = await ensureActivity("SERV-SMT-A", "AR-SMT");
    await ensureActivity("COM-SMT-B", "AR-SMT");
    const tucuman = await ensureActivity("REST-TUC", "AR-T");
    await typeActiveVersion("TEM_SMT", "tem-smt", santiago.id, "SERV-SMT-A", "3");
    await typeActiveVersion("IIBB_LOCAL_TUC", "iibb-local-tuc", tucuman.id, "REST-TUC", "4.5");
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

  it("TEM con dos actividades municipales y ventas de otro nivel (REST-TUC): se detiene con ACTIVITY_UNCLASSIFIED y un mensaje en español", async () => {
    const ruta = await prepararLibro({
      caso: "tem-dos-actividades",
      taxTypeCode: "TEM",
      regimeCode: "TEM_SMT",
      activityCodes: ["SERV-SMT-A", "COM-SMT-B"],
      actividadVentas: "REST-TUC",
    });
    const response = await request("POST", ruta, { cutoff: END });
    expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
    const error = (response.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe("ACTIVITY_UNCLASSIFIED");
    expect(error.message).toMatch(/Asigná la actividad/);
    expect(error.message).not.toMatch(/[A-Z_]{6,}/);
  });

  it("IIBB con una sola actividad provincial y el libro sin clasificar: calcula normal con esa actividad", async () => {
    const ruta = await prepararLibro({
      caso: "iibb-una-actividad",
      taxTypeCode: "IIBB",
      regimeCode: "IIBB_LOCAL_TUC",
      activityCodes: ["REST-TUC"],
    });
    const response = await request("POST", ruta, { cutoff: END });
    ok(response, 200, "cálculo de IIBB con una sola actividad provincial");
    const calculo = await request("GET", ruta.replace(/\/calculate$/, "/calculation"));
    ok(calculo, 200, "lectura del cálculo de IIBB");
    const [liquidacion] = data<Array<{ settlement: { totals: Record<string, string> } }>>(calculo);
    // Base = neto de las dos facturas (50.000 + 30.000); IVA y otros tributos quedan afuera.
    expect(liquidacion!.settlement.totals["BASE_TOTAL"]).toBe("80000.00");
    // IIBB: REST-TUC 4,5 % sobre 80.000 = 3.600; el mínimo del régimen (5.000) rige.
    expect(liquidacion!.settlement.totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3600.00");
    expect(liquidacion!.settlement.totals["IMPUESTO_DETERMINADO"]).toBe("5000.00");
  });
});
