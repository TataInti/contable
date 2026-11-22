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
 * Brief 4H: actividades vigentes en el período.
 *
 * Caso del E2E de producción (22-11-2026): inscripciones IIBB Tucumán (AR-T) y TEM San Miguel (AR-SMT) desde
 * 01/10/2026; actividades vinculadas el 22/11/2026 (validFrom posterior al período); ventas de octubre
 * clasificadas con la actividad de su nivel. El cálculo tiene que decir que la actividad no está vigente en el
 * período (y desde cuándo), no «otro nivel». Con la fecha «Desde» corregida a 01/10, el cálculo termina normal.
 *
 * Datos inventados: CUIT sintético, razones sociales y actividades de prueba. Las alícuotas se cargan como
 * reglas tipadas (V3) en las versiones activas y se restauran al terminar.
 */

const OWNER = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-4h-${RUN}`;
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
  const row = data<Array<{ id: string; code: string }>>(response).find((item) => item.code === code);
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
  const jurisdiction = await prisma.jurisdiction.findFirstOrThrow({ where: { code: jurisdictionCode } });
  return prisma.economicActivity.upsert({
    where: { code_jurisdictionId: { code, jurisdictionId: jurisdiction.id } },
    update: { isActive: true },
    create: {
      code,
      name: `Actividad sintética ${code}`,
      jurisdictionId: jurisdiction.id,
      validFrom: new Date("2026-01-01"),
      source: "Prueba 4H",
    },
  });
}

/** Pasa la versión activa del régimen a reglas tipadas con una alícuota para la actividad. Restaura en afterAll. */
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
  const originalVersion = await prisma.taxRuleVersion.findUniqueOrThrow({ where: { id: version.id } });
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
    await prisma.taxRegime.update({ where: { id: regime.id }, data: { calcFamilyId: originalFamilyId } });
  });

  const kind = await prisma.taxRuleKind.findUniqueOrThrow({ where: { key: "RATE" } });
  await prisma.taxRegime.update({ where: { id: regime.id }, data: { calcFamilyId: engine.familyId } });
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

type Escenario = {
  caso: string;
  /** Actividades vinculadas: código, nivel (jurisdicción) y fecha «Desde» de cada vínculo. */
  vinculos: Array<{ code: string; jurisdictionCode: "AR-T" | "AR-SMT"; validFrom: string }>;
  /** Fecha «Desde» de las inscripciones IIBB Tucumán y TEM San Miguel. */
  inscripcionDesde: string;
  /** Actividad con que se clasifican todas las ventas tras revisar el libro. */
  actividadVentas: string;
};

const IMPUESTOS = [
  { taxTypeCode: "IIBB", regimeCode: "IIBB_LOCAL_TUC" },
  { taxTypeCode: "TEM", regimeCode: "TEM_SMT" },
] as const;

type Preparado = { clientBase: string; ruta: string; lectura: string; vinculoIds: Record<string, string> };

/**
 * Cliente monotributista con IIBB Tucumán y TEM San Miguel, actividades vinculadas, un libro de ventas de
 * octubre importado para cada impuesto y todas las ventas clasificadas con actividadVentas.
 */
async function prepararLibro(escenario: Escenario): Promise<Preparado> {
  const cuit = validTestCuit();
  const client = data<{ id: string }>(
    await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente 4H ${escenario.caso} ${RUN}`,
      tradeName: `T-Cliente 4H ${escenario.caso} ${RUN}`,
      cuit,
    }),
  );
  const clientBase = `${BASE}/clients/${client.id}`;
  const profile = data<{ id: string }>(
    await request("POST", `${clientBase}/tax-profile-versions`, {
      legalName: `T-Cliente 4H ${escenario.caso} ${RUN}`,
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

  const vinculoIds: Record<string, string> = {};
  for (const [index, vinculo] of escenario.vinculos.entries()) {
    const activity = await ensureActivity(vinculo.code, vinculo.jurisdictionCode);
    const creado = await request("POST", `${clientBase}/activities`, {
      profileVersionId: profile.id,
      activityId: activity.id,
      isPrimary: index === 0,
      validFrom: vinculo.validFrom,
    });
    ok(creado, 201, `vínculo de la actividad ${vinculo.code}`);
    vinculoIds[vinculo.code] = data<{ id: string }>(creado).id;
  }

  const periods: Record<string, string> = {};
  const obligations: string[] = [];
  const taxTypeIds: Record<string, string> = {};
  for (const impuesto of IMPUESTOS) {
    const taxTypeId = await resolveMaster("/api/v1/tax/types", impuesto.taxTypeCode);
    const regimeId = await resolveMaster("/api/v1/tax/regimes", impuesto.regimeCode);
    taxTypeIds[impuesto.taxTypeCode] = taxTypeId;
    ok(
      await request("POST", `${clientBase}/tax-registrations`, {
        profileVersionId: profile.id,
        regimeId,
        validFrom: escenario.inscripcionDesde,
        registrationNumber: `T-4H-${RUN.slice(0, 8)}-${impuesto.taxTypeCode}-${escenario.caso.slice(0, 4)}`,
      }),
      201,
      `inscripción ${impuesto.regimeCode}`,
    );
    const period = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-periods`, {
        taxTypeId,
        startDate: START,
        endDate: END,
        label: "T-Octubre 2026",
      }),
    );
    periods[impuesto.taxTypeCode] = period.id;
    const obligation = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-obligations`, {
        profileVersionId: profile.id,
        regimeId,
        periodId: period.id,
        dueDate: "2026-11-20",
      }),
    );
    obligations.push(obligation.id);
  }
  const workpaper = data<{ id: string; settlements: Array<{ obligationId: string }> }>(
    await request("POST", `${clientBase}/monthly-tax-workpapers`, { periodStart: START, periodEnd: END }),
  );
  expect(workpaper.settlements.map((link) => link.obligationId).sort()).toEqual([...obligations].sort());
  const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;

  type Coverage = {
    sources: Array<{ code: string; taxTypeId: string | null; periodId: string | null; batches: Array<{ id: string }> }>;
  };
  // Un solo libro de ventas por workpaper: la cobertura expone ARCA_IVA_SALES una vez y ambos impuestos
  // liquidan sobre esas ventas (como en la corrida de producción del 22-11).
  for (const impuesto of IMPUESTOS.slice(0, 1)) {
    const taxTypeId = taxTypeIds[impuesto.taxTypeCode]!;
    const coverage = await request("GET", `${sourceBase}/coverage`);
    ok(coverage, 200, "cobertura de fuentes");
    const book = data<Coverage>(coverage).sources.find(
      (source) => source.code === "ARCA_IVA_SALES" && source.taxTypeId === taxTypeId,
    );
    expect(book, `el libro de ventas figura como fuente de ${impuesto.taxTypeCode}; fuentes: ${JSON.stringify(data<Coverage>(coverage).sources.map((s) => [s.code, s.taxTypeId, taxTypeId]))}`).toBeTruthy();
    const libro = libroEmitidos(cuit, ENCABEZADOS, [
      { ...CLIENTE, Fecha: "03/10/2026", Tipo: "1 - Factura A", "Punto de Venta": 1, "Número Desde": 1, "Número Hasta": 1, "Neto Gravado Total": 50000, "Total IVA": 10500, "Imp. Total": 60500 },
      { ...CLIENTE, Fecha: "10/10/2026", Tipo: "11 - Factura C", "Punto de Venta": 2, "Número Desde": 1, "Número Hasta": 1, "Imp. Total": 30000 },
      { ...CLIENTE, Fecha: "17/10/2026", Tipo: "11 - Factura C", "Punto de Venta": 2, "Número Desde": 2, "Número Hasta": 2, "Imp. Total": 35000 },
    ]);
    ok(
      await request("POST", `${clientBase}/sifere/import`, {
        direction: "SALE",
        base64: Buffer.from(libro).toString("base64"),
        fileName: `T-4H-${RUN}-${escenario.caso}-${impuesto.taxTypeCode}.xlsx`,
        fileHash: `sha256:T-4H-${RUN}-${escenario.caso}-${impuesto.taxTypeCode}`,
        taxTypeId,
        periodId: book!.periodId,
        clientCuit: cuit,
        workpaperId: workpaper.id,
      }),
      201,
      `importación del libro de ventas de ${impuesto.taxTypeCode}`,
    );
    const after = data<Coverage>(await request("GET", `${sourceBase}/coverage`));
    const linkId = after.sources.find((source) => source.code === "ARCA_IVA_SALES" && source.taxTypeId === taxTypeId)!.batches[0]!.id;
    ok(await request("POST", `${sourceBase}/sources/${linkId}/review`), 200, "revisión del libro");
  }
  const clasificaciones = data<{ items: Array<{ id: string; direction: string }> }>(
    await request("GET", `${sourceBase}/classifications`),
  );
  const ventas = clasificaciones.items.filter((row) => row.direction === "SALE");
  expect(ventas.length).toBeGreaterThan(0);
  for (const venta of ventas) {
    ok(
      await request("PATCH", `${sourceBase}/classifications/${venta.id}`, { activityCode: escenario.actividadVentas }),
      200,
      `clasificación de la venta como ${escenario.actividadVentas}`,
    );
  }
  return { clientBase, ruta: `${sourceBase}/calculate`, lectura: `${sourceBase}/calculation`, vinculoIds };
}

describe("4H — actividades vigentes en el período", () => {
  beforeAll(async () => {
    app = await buildServer({
      postgres: async () => true,
      valkey: async () => true,
      minio: async () => true,
      ai: async () => true,
    });
    await app.ready();
    await prisma.firm.create({
      data: { id: FIRM, legalName: `T-Estudio 4H ${RUN}`, displayName: `T-Estudio 4H ${RUN}`, allowSelfReview: true },
    });
    await prisma.user.create({
      data: { id: OWNER, emailNormalized: `t-4h-owner-${RUN}@example.invalid`, name: `T-Titular 4H ${RUN}`, passwordHash: "-" },
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
    const sanMiguel = await ensureActivity("REST-SMT", "AR-SMT");
    await typeActiveVersion("IIBB_LOCAL_TUC", "iibb-local-tuc", tucuman.id, "REST-TUC", "4.5");
    await typeActiveVersion("TEM_SMT", "tem-smt", sanMiguel.id, "REST-SMT", "3");
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

  it("caso E2E: actividades vinculadas desde 22/11 y ventas de octubre en REST-TUC → ACTIVITY_NOT_IN_FORCE con el mensaje de vigencia", async () => {
    const { ruta, vinculoIds } = await prepararLibro({
      caso: "vigencia-22nov",
      vinculos: [
        { code: "REST-TUC", jurisdictionCode: "AR-T", validFrom: "2026-11-22" },
        { code: "REST-SMT", jurisdictionCode: "AR-SMT", validFrom: "2026-11-22" },
      ],
      inscripcionDesde: "2026-10-01",
      actividadVentas: "REST-TUC",
    });
    expect(Object.keys(vinculoIds)).toEqual(["REST-TUC", "REST-SMT"]);
    const response = await request("POST", ruta, { cutoff: END });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const error = (response.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe("ACTIVITY_NOT_IN_FORCE");
    expect(error.message).toMatch(/^La actividad Actividad sintética REST-(TUC|SMT) no está vigente en octubre 2026 para este cliente \(vigente desde 22\/11\/2026\)\. Corregí la fecha «Desde» en Configuración fiscal → Actividades\.$/);
    expect(error.message).not.toMatch(/otro nivel|más de una/);
  });

  it("con la fecha «Desde» corregida a 01/10 por el endpoint nuevo, IIBB y TEM calculan con base 115.000", async () => {
    const { clientBase, ruta, lectura, vinculoIds } = await prepararLibro({
      caso: "vigencia-corregida",
      vinculos: [
        { code: "REST-TUC", jurisdictionCode: "AR-T", validFrom: "2026-11-22" },
        { code: "REST-SMT", jurisdictionCode: "AR-SMT", validFrom: "2026-11-22" },
      ],
      inscripcionDesde: "2026-10-01",
      actividadVentas: "REST-TUC",
    });
    for (const id of Object.values(vinculoIds)) {
      ok(
        await request("PATCH", `${clientBase}/activities/${id}`, { validFrom: "2026-10-01" }),
        200,
        "corrección de la fecha «Desde» de la actividad",
      );
    }
    const calculo = await request("POST", ruta, { cutoff: END });
    ok(calculo, 200, "cálculo de IIBB y TEM con actividades vigentes");
    const componentes = data<Array<{ settlement: { totals: Record<string, string> } }>>(await request("GET", lectura));
    expect(componentes).toHaveLength(2);
    for (const componente of componentes) {
      expect(componente.settlement.totals["BASE_TOTAL"]).toBe("115000.00");
    }
  });

  it("4J — la clasificación marca como pendientes las ventas con actividad no vigente, con el texto del cálculo", async () => {
    const { ruta } = await prepararLibro({
      caso: "clasificacion-pendiente",
      vinculos: [
        { code: "REST-TUC", jurisdictionCode: "AR-T", validFrom: "2026-11-22" },
        { code: "REST-SMT", jurisdictionCode: "AR-SMT", validFrom: "2026-11-22" },
      ],
      inscripcionDesde: "2026-10-01",
      actividadVentas: "REST-TUC",
    });
    const clasificaciones = ruta.replace(/\/calculate$/, "/classifications");
    const cobertura = data<ClasificacionCobertura>(await request("GET", clasificaciones));
    const pendientes = cobertura.items.filter((item) => item.activityIssue);
    expect(pendientes.length).toBeGreaterThan(0);
    expect(cobertura.activityPending).toBe(pendientes.length);
    expect(cobertura.classified + cobertura.pending + cobertura.excluded + cobertura.activityPending).toBe(
      cobertura.total,
    );
    for (const item of pendientes) {
      expect(item.activityIssue!.code).toBe("ACTIVITY_NOT_IN_FORCE");
      expect(item.activityIssue!.message).toMatch(
        /^La actividad Actividad sintética REST-(TUC|SMT) no está vigente en octubre 2026 para este cliente \(vigente desde 22\/11\/2026\)\. Corregí la fecha «Desde» en Configuración fiscal → Actividades\.$/,
      );
    }
    const calculo = await request("POST", ruta, { cutoff: END });
    const error = (calculo.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe("ACTIVITY_NOT_IN_FORCE");
    expect(pendientes.map((item) => item.activityIssue!.message)).toContain(error.message);
  });

  it("4J — con la «Desde» corregida, la clasificación deja de marcar pendientes y el cálculo corre", async () => {
    const { clientBase, ruta, vinculoIds } = await prepararLibro({
      caso: "clasificacion-corregida",
      vinculos: [
        { code: "REST-TUC", jurisdictionCode: "AR-T", validFrom: "2026-11-22" },
        { code: "REST-SMT", jurisdictionCode: "AR-SMT", validFrom: "2026-11-22" },
      ],
      inscripcionDesde: "2026-10-01",
      actividadVentas: "REST-TUC",
    });
    for (const id of Object.values(vinculoIds)) {
      ok(
        await request("PATCH", `${clientBase}/activities/${id}`, { validFrom: "2026-10-01" }),
        200,
        "corrección de la fecha «Desde» de la actividad",
      );
    }
    const cobertura = data<ClasificacionCobertura>(
      await request("GET", ruta.replace(/\/calculate$/, "/classifications")),
    );
    expect(cobertura.activityPending).toBe(0);
    expect(cobertura.items.every((item) => item.activityIssue === null)).toBe(true);
    ok(await request("POST", ruta, { cutoff: END }), 200, "cálculo con actividades vigentes");
  });

  it("4J — corregir la «Desde» de una actividad usada en un período finalizado responde ACTIVITY_IN_USE", async () => {
    const { clientBase, ruta, vinculoIds } = await prepararLibro({
      caso: "actividad-en-uso",
      vinculos: [
        { code: "REST-TUC", jurisdictionCode: "AR-T", validFrom: "2026-11-22" },
        { code: "REST-SMT", jurisdictionCode: "AR-SMT", validFrom: "2026-11-22" },
      ],
      inscripcionDesde: "2026-10-01",
      actividadVentas: "REST-TUC",
    });
    for (const id of Object.values(vinculoIds)) {
      ok(
        await request("PATCH", `${clientBase}/activities/${id}`, { validFrom: "2026-10-01" }),
        200,
        "corrección de la fecha «Desde» de la actividad",
      );
    }
    ok(await request("POST", ruta, { cutoff: END }), 200, "cálculo de octubre");
    await prisma.taxSettlement.updateMany({
      where: { clientId: clientBase.split("/").pop()! },
      data: { status: "FINALIZED" },
    });
    const response = await request("PATCH", `${clientBase}/activities/${vinculoIds["REST-TUC"]}`, {
      validFrom: "2026-10-15",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe("ACTIVITY_IN_USE");
  });
});

type ClasificacionCobertura = {
  total: number;
  classified: number;
  pending: number;
  excluded: number;
  activityPending: number;
  items: Array<{
    id: string;
    activityIssue: { code: string; message: string } | null;
  }>;
};
