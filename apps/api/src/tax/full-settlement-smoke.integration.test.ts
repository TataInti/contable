import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const OWNER = randomUUID();
const ADMIN = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-b8-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;
const OCTOBER_START = "2026-10-01";
const OCTOBER_END = "2026-10-31";

let app: FastifyInstance | null = null;
let ownerToken = "";
let adminToken = "";
let originalRuleVersionId: string | null = null;
let testRuleVersionId: string | null = null;
let testRuleVersionActivated = false;

type ApiResponse = {
  statusCode: number;
  body: string;
  json(): unknown;
};

type ApiEnvelope<T> = { data: T };

function expectB8<T>(actual: T, assertion: string) {
  return expect(actual, `B8 — ${assertion}`);
}

function expectStatus(response: ApiResponse, status: number, assertion: string) {
  expectB8(response.statusCode, `${assertion}; respuesta: ${response.body}`).toBe(status);
}

function responseData<T>(response: ApiResponse): T {
  return (response.json() as ApiEnvelope<T>).data;
}

async function request(
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
  token = ownerToken,
) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
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

async function createSession(userId: string) {
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
}

async function resolveMaster(path: string, code: string) {
  const response = await request("GET", path);
  expectStatus(response, 200, `catálogo fiscal disponible para ${code}`);
  const rows = responseData<Array<{ id: string; code: string }>>(response);
  const row = rows.find((candidate) => candidate.code === code);
  expectB8(row, `el maestro ${code} está sembrado en CI`).toBeTruthy();
  return row!.id;
}

async function ensureActivity(code: string, name: string, jurisdictionId: string) {
  const existing = await prisma.economicActivity.findUnique({
    where: { code_jurisdictionId: { code, jurisdictionId } },
  });
  if (existing) {
    expectB8(existing.isActive, `actividad ${code} activa para el cálculo`).toBe(true);
    return existing.id;
  }

  const response = await request("POST", "/api/v1/tax/activities", {
    code,
    name,
    jurisdictionId,
    validFrom: "2026-01-01",
    source: `T-B8 ${RUN}`,
  });
  expectStatus(response, 201, `alta de actividad fiscal ${code}`);
  const activity = responseData<{ id: string; isActive: boolean }>(response);
  expectB8(activity.isActive, `actividad ${code} activa`).toBe(true);
  return activity.id;
}

/**
 * Los controles sólo validan que la evidencia pertenezca al cliente y esté
 * READY. Reproduce el helper de fixture createControlEvidence de
 * apps/api/src/tax/workpaper.test.ts:59-70: persistir Document evita depender
 * de storage/worker externos en esta integración API.
 */
async function createReadyControlEvidence(clientId: string) {
  return prisma.document.create({
    data: {
      firmId: FIRM,
      clientId,
      category: "AUDIT_SUPPORT",
      status: "READY",
      uploadedByUserId: OWNER,
      uploadOrigin: "FIRM",
      requestId: null,
    },
  });
}

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
      legalName: `T-Estudio B8 ${RUN}`,
      displayName: `T-Estudio B8 ${RUN}`,
      allowSelfReview: false,
    },
  });

  for (const [userId, email, name, role, assignToken] of [
    [OWNER, `t-b8-owner-${RUN}@example.invalid`, `T-Titular B8 ${RUN}`, "OWNER", (token: string) => (ownerToken = token)],
    [ADMIN, `t-b8-admin-${RUN}@example.invalid`, `T-Admin B8 ${RUN}`, "ADMIN", (token: string) => (adminToken = token)],
  ] as const) {
    await prisma.user.create({
      data: { id: userId, emailNormalized: email, name, passwordHash: "-" },
    });
    await prisma.firmMembership.create({
      data: { firmId: FIRM, userId, role, status: "ACTIVE", acceptedAt: new Date() },
    });
    assignToken(await createSession(userId));
  }
});

afterAll(async () => {
  try {
    if (testRuleVersionId && testRuleVersionActivated) {
      await prisma.taxRuleVersion.updateMany({
        where: { id: testRuleVersionId },
        data: { status: "DRAFT" },
      });
      const testVersionAfterReset = await prisma.taxRuleVersion.findUnique({ where: { id: testRuleVersionId } });
      expectB8(testVersionAfterReset?.status, "la versión temporal vuelve a DRAFT para aislar futuras liquidaciones").toBe("DRAFT");
    }
    if (originalRuleVersionId) {
      await prisma.taxRuleVersion.updateMany({
        where: { id: originalRuleVersionId },
        data: { status: "ACTIVE" },
      });
      const originalAfterReset = await prisma.taxRuleVersion.findUnique({ where: { id: originalRuleVersionId } });
      expectB8(originalAfterReset?.status, "la versión oficial sembrada vuelve a ACTIVE").toBe("ACTIVE");
    }

    // La liquidación finalizada es inmutable por diseño. Sus fixtures T- quedan
    // aislados por UUID en la base desechable de CI, que se destruye al terminar.
    await prisma.deviceSession.deleteMany({ where: { userId: { in: [OWNER, ADMIN] } } });
    await prisma.firmMembership.deleteMany({ where: { firmId: FIRM } });
  } finally {
    await app?.close();
    app = null;
  }
});

describe("B8 — humo de liquidación completa por API", () => {
  it("recorre alta, reglas, expediente, importación, cálculo, controles y cierre", async () => {
    // 1. El estudio arranca con autorrevisión apagada; sólo OWNER puede cambiarla.
    const initialSetting = await request("GET", `${BASE}/settings/self-review`);
    expectStatus(initialSetting, 200, "lectura de la configuración del estudio");
    expectB8(responseData<{ allowSelfReview: boolean }>(initialSetting).allowSelfReview, "autorrevisión inicia apagada").toBe(false);

    const adminAttempt = await request(
      "PATCH",
      `${BASE}/settings/self-review`,
      { allowSelfReview: true },
      adminToken,
    );
    expectStatus(adminAttempt, 403, "ADMIN no puede cambiar la opción de autorrevisión");
    expectB8((adminAttempt.json() as { error: { code: string } }).error.code, "el rechazo del ADMIN identifica el permiso").toBe("CAPABILITY_REQUIRED");
    const settingAfterAdminAttempt = await request("GET", `${BASE}/settings/self-review`);
    expectStatus(settingAfterAdminAttempt, 200, "lectura de configuración tras el intento del ADMIN");
    expectB8(responseData<{ allowSelfReview: boolean }>(settingAfterAdminAttempt).allowSelfReview, "el intento del ADMIN deja autorrevisión apagada").toBe(false);

    // 2. Alta T- de cliente con correo y domicilio fiscal, y perfil activado.
    const jurisdictionId = await resolveMaster("/api/v1/tax/jurisdictions", "AR-T");
    const taxTypeId = await resolveMaster("/api/v1/tax/types", "IIBB");
    const regimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
    const authorityId = await resolveMaster("/api/v1/tax/authorities", "DGR-TUC");
    const cuit = validTestCuit();

    const clientResponse = await request("POST", `${BASE}/clients`, {
      legalName: `T-Cliente B8 ${RUN}`,
      tradeName: `T-Cliente B8 ${RUN}`,
      cuit,
    });
    expectStatus(clientResponse, 201, "alta del cliente de prueba T-");
    const client = responseData<{ id: string; legalName: string }>(clientResponse);
    const clientBase = `${BASE}/clients/${client.id}`;
    expectB8(client.legalName, "el cliente creado conserva el prefijo sintético T-").toContain("T-");

    const contactResponse = await request("POST", `${clientBase}/contacts`, {
      name: `T-Contacto B8 ${RUN}`,
      email: `t-b8-client-${RUN}@example.invalid`,
      isPrimary: true,
    });
    expectStatus(contactResponse, 201, "correo de contacto del cliente B4");
    expectB8(responseData<{ email: string }>(contactResponse).email, "el correo fiscal de contacto queda persistido").toContain("@example.invalid");

    const profileResponse = await request("POST", `${clientBase}/tax-profile-versions`, {
      legalName: `T-Cliente B8 ${RUN}`,
      cuit,
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      fiscalAddress: `T-Domicilio fiscal ${RUN}, San Miguel de Tucumán`,
      validFrom: "2026-01-01",
    });
    expectStatus(profileResponse, 201, "creación del perfil fiscal del cliente");
    const profile = responseData<{ id: string; status: string; fiscalAddress: string }>(profileResponse);
    expectB8(profile.fiscalAddress, "el perfil conserva el domicilio fiscal B4").toContain("T-Domicilio fiscal");
    expectB8(profile.status, "el perfil se crea como borrador antes de su activación").toBe("DRAFT");

    const profileReview = await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`);
    expectStatus(profileReview, 200, "envío del perfil fiscal a revisión");
    const profileActivation = await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`);
    expectStatus(profileActivation, 200, "activación del perfil fiscal para adhesión");
    expectB8(responseData<{ status: string }>(profileActivation).status, "perfil fiscal activo para el régimen").toBe("ACTIVE");

    const primaryActivityId = await ensureActivity("DEMO123", `T-Actividad principal ${RUN}`, jurisdictionId);
    const secondaryActivityCode = `T-DEMO2-${RUN.slice(0, 8).toUpperCase()}`;
    const secondaryActivityId = await ensureActivity(secondaryActivityCode, `T-Actividad secundaria ${RUN}`, jurisdictionId);

    const primaryActivity = await request("POST", `${clientBase}/activities`, {
      profileVersionId: profile.id,
      activityId: primaryActivityId,
      isPrimary: true,
      validFrom: "2026-01-01",
    });
    expectStatus(primaryActivity, 201, "vinculación de DEMO123 como actividad principal");
    const secondaryActivity = await request("POST", `${clientBase}/activities`, {
      profileVersionId: profile.id,
      activityId: secondaryActivityId,
      isPrimary: false,
      validFrom: "2026-01-01",
    });
    expectStatus(secondaryActivity, 201, "vinculación de la segunda actividad fiscal");

    const registrationResponse = await request("POST", `${clientBase}/tax-registrations`, {
      profileVersionId: profile.id,
      regimeId,
      validFrom: "2026-01-01",
      registrationNumber: `T-REG-${RUN.slice(0, 12)}`,
    });
    expectStatus(registrationResponse, 201, "adhesión del cliente al régimen IIBB_LOCAL_TUC");
    expectB8(responseData<{ status: string }>(registrationResponse).status, "adhesión fiscal activa").toBe("ACTIVE");

    // 3. El catálogo oficial de CI provee el régimen y su paquete canónico. Se
    // crea/activa una nueva versión por API en ese paquete, y afterAll restaura
    // la versión sembrada para aislar el resto de la suite.
    const packsResponse = await request("GET", "/api/v1/tax/rule-packs");
    expectStatus(packsResponse, 200, "lectura del paquete de reglas fiscal de CI");
    const packs = responseData<Array<{
      id: string;
      code: string;
      regime: { code: string };
      versions: Array<{ id: string; status: string }>;
    }>>(packsResponse);
    const rulePack = packs.find((pack) => pack.code === "AR_IIBB_TUC_LOCAL_V1" && pack.regime.code === "IIBB_LOCAL_TUC");
    expectB8(rulePack, "el paquete canónico de IIBB Tucumán está sembrado en CI").toBeTruthy();
    const originalActive = rulePack!.versions.find((version) => version.status === "ACTIVE");
    expectB8(originalActive, "el paquete parte de una versión activa que permite restauración").toBeTruthy();
    originalRuleVersionId = originalActive!.id;

    const newVersionResponse = await request("POST", `/api/v1/tax/rule-packs/${rulePack!.id}/versions`, {
      validFrom: "2026-01-01",
      engineVersion: "ar-iibb-tuc-local-v1.1.0",
      rulesHash: `T-B8-${RUN}`,
    });
    expectStatus(newVersionResponse, 201, "creación de una versión con motor ar-iibb-tuc-local-v1.1.0");
    const newVersion = responseData<{ id: string; status: string }>(newVersionResponse);
    testRuleVersionId = newVersion.id;
    expectB8(newVersion.status, "la nueva versión comienza en borrador").toBe("DRAFT");

    for (const rule of [
      { activityCode: "DEMO123", rate: "3.5", minAmount: "5000.00" },
      { activityCode: secondaryActivityCode, rate: "2.5", minAmount: "10000.00" },
    ]) {
      const rateRule = await request("POST", `/api/v1/tax/rule-versions/${newVersion.id}/rate-rules`, {
        concept: rule.activityCode,
        jurisdictionId,
        activityCode: rule.activityCode,
        rate: rule.rate,
        minAmount: rule.minAmount,
        validFrom: "2026-01-01",
      });
      expectStatus(rateRule, 201, `regla de alícuota y mínimo para ${rule.activityCode}`);
    }

    const credentialResponse = await request("POST", "/api/v1/tax/credentials", {
      userId: OWNER,
      jurisdictionId,
      authorityId,
      registrationNumber: `T-MATRICULA-${RUN.slice(0, 12)}`,
      validFrom: "2026-01-01",
    });
    expectStatus(credentialResponse, 201, "matrícula profesional T- del titular para validar el paquete");
    const credential = responseData<{ id: string; userId: string; status: string }>(credentialResponse);
    expectB8(credential.userId, "la credencial pertenece al titular único que ejecuta el flujo").toBe(OWNER);
    expectB8(credential.status, "la credencial del titular queda activa").toBe("ACTIVE");

    const ruleReviewResponse = await request("POST", `/api/v1/tax/rule-versions/${newVersion.id}/submit-review`);
    expectStatus(ruleReviewResponse, 200, "envío de la versión fiscal a revisión profesional");
    expectB8(responseData<{ status: string }>(ruleReviewResponse).status, "la versión fiscal queda en revisión").toBe("IN_REVIEW");
    const approvalResponse = await request(
      "POST",
      `/api/v1/tax/rule-versions/${newVersion.id}/approve`,
      { credentialId: credential.id, comment: `T-Aprobación B8 ${RUN}` },
    );
    expectStatus(approvalResponse, 200, "aprobación de reglas por el titular matriculado");
    expectB8(responseData<{ approvedByUserId: string }>(approvalResponse).approvedByUserId, "la aprobación queda atribuida al titular").toBe(OWNER);

    const activationResponse = await request("POST", `/api/v1/tax/rule-versions/${newVersion.id}/activate`);
    testRuleVersionActivated = activationResponse.statusCode === 200;
    expectStatus(activationResponse, 200, "activación explícita de reglas fiscales por endpoint");
    expectB8(responseData<{ status: string }>(activationResponse).status, "la versión con mínimos queda activa").toBe("ACTIVE");

    // 4. Período fiscal con límites exactos, obligación y expediente fiscal sin
    // vínculo a período contable.
    const periodResponse = await request("POST", `${clientBase}/tax-periods`, {
      taxTypeId,
      startDate: OCTOBER_START,
      endDate: OCTOBER_END,
      label: "T-Octubre 2026",
    });
    expectStatus(periodResponse, 201, "creación del período fiscal octubre 2026");
    const period = responseData<{ id: string; startDate: string; endDate: string }>(periodResponse);
    expectB8(period.startDate.slice(0, 10), "B2/B3 conservan la fecha inicial fiscal tal cual").toBe(OCTOBER_START);
    expectB8(period.endDate.slice(0, 10), "B2/B3 conservan la fecha final fiscal tal cual").toBe(OCTOBER_END);

    const obligationResponse = await request("POST", `${clientBase}/tax-obligations`, {
      profileVersionId: profile.id,
      regimeId,
      periodId: period.id,
      dueDate: "2026-11-20",
    });
    expectStatus(obligationResponse, 201, "materialización de la obligación mensual IIBB");
    const obligation = responseData<{ id: string; status: string }>(obligationResponse);
    expectB8(obligation.status, "la obligación inicia pendiente antes del cálculo").toBe("PENDING");

    const workpaperResponse = await request("POST", `${clientBase}/monthly-tax-workpapers`, {
      periodStart: OCTOBER_START,
      periodEnd: OCTOBER_END,
    });
    expectStatus(workpaperResponse, 201, "creación de expediente por período fiscal sin período contable");
    const workpaper = responseData<{
      id: string;
      status: string;
      periodStart: string;
      periodEnd: string;
      settlements: Array<{ obligationId: string; required: boolean }>;
      accountingPeriodId?: string;
    }>(workpaperResponse);
    expectB8(workpaper.periodStart.slice(0, 10), "el expediente usa el inicio del período fiscal").toBe(OCTOBER_START);
    expectB8(workpaper.periodEnd.slice(0, 10), "el expediente usa el fin del período fiscal").toBe(OCTOBER_END);
    expectB8(workpaper.accountingPeriodId, "el expediente mensual no depende de un período contable").toBeUndefined();
    expectB8(workpaper.settlements.map((link) => link.obligationId), "el expediente se vincula con la obligación creada").toEqual([obligation.id]);

    // 5. Libro DGR realista: cuatro filas, $100.000 DEMO123 y $500.000 en la
    // segunda actividad, con rate/minimum declarados compatibles con las reglas.
    const batchResponse = await request("POST", `${clientBase}/import-batches`, {
      origin: "DGR_IIBB",
      taxTypeId,
      periodId: period.id,
      adapterVersion: "DGR_IIBB_V1",
      fileHash: `sha256:T-B8-${RUN}`,
      fileName: `T-Libro-DGR-${RUN}.csv`,
      workpaperId: workpaper.id,
      sourceCode: "DGR_IIBB_TUC",
    });
    expectStatus(batchResponse, 201, "alta del libro DGR_IIBB_TUC");
    const batch = responseData<{ id: string }>(batchResponse);

    const rows = [
      { activityCode: "DEMO123", description: "T-Venta DEMO123 1", income: "50000.00", rate: "3.5", minimum: "5000.00", exemption: "0" },
      { activityCode: "DEMO123", description: "T-Venta DEMO123 2", income: "50000.00", rate: "3.5", minimum: "5000.00", exemption: "0" },
      { activityCode: secondaryActivityCode, description: "T-Venta segunda actividad 1", income: "250000.00", rate: "2.5", minimum: "10000.00", exemption: "0" },
      { activityCode: secondaryActivityCode, description: "T-Venta segunda actividad 2", income: "250000.00", rate: "2.5", minimum: "10000.00", exemption: "0" },
    ];
    const validationResponse = await request("POST", `${clientBase}/import-batches/${batch.id}/validate`, { rows });
    expectStatus(validationResponse, 200, "validación de cuatro filas del adaptador DGR IIBB");
    const validation = responseData<{ totals: { validRows: number; errorRows: number; net: string } }>(validationResponse);
    expectB8(validation.totals.validRows, "las cuatro filas del libro normalizan correctamente").toBe(4);
    expectB8(validation.totals.errorRows, "el libro no descarta filas fiscales").toBe(0);
    expectB8(validation.totals.net, "la base importada suma $600.000,00").toBe("600000.0000");

    const commitResponse = await request("POST", `${clientBase}/import-batches/${batch.id}/commit`, { clientCuit: cuit });
    expectStatus(commitResponse, 200, "persistencia atómica de las cuatro filas DGR");
    const committedRowsResponse = await request("GET", `${clientBase}/import-batches/${batch.id}/rows`);
    expectStatus(committedRowsResponse, 200, "lectura de vuelta de filas importadas");
    const committedRows = responseData<Array<{ status: string }>>(committedRowsResponse);
    expectB8(committedRows, "el libro persistido conserva sus cuatro filas").toHaveLength(4);
    expectB8(committedRows.every((row) => row.status === "COMMITTED"), "las cuatro filas persisten confirmadas en el lote").toBe(true);

    // 6. Revisión de fuente: rechaza la autorrevisión con la opción apagada;
    // luego permite al titular y deja evidencia de auditoría SELF_REVIEW.
    const sourceBase = `${clientBase}/monthly-tax-workpapers/${workpaper.id}`;
    const coverageBeforeReviewResponse = await request("GET", `${sourceBase}/coverage`);
    expectStatus(coverageBeforeReviewResponse, 200, "lectura de cobertura del expediente antes de revisar fuente");
    const coverageBeforeReview = responseData<{
      sources: Array<{ code: string; present: boolean; batches: Array<{ id: string; reviewStatus: string; validRows: number }> }>;
    }>(coverageBeforeReviewResponse);
    const source = coverageBeforeReview.sources.find((candidate) => candidate.code === "DGR_IIBB_TUC");
    expectB8(source, "la política requiere la fuente DGR_IIBB_TUC en el expediente").toBeTruthy();
    expectB8(source!.batches, "la importación se asocia al expediente mensual").toHaveLength(1);
    expectB8(source!.batches[0]!.validRows, "la cobertura reconoce las cuatro filas del libro").toBe(4);
    const sourceLinkId = source!.batches[0]!.id;

    const deniedReview = await request("POST", `${sourceBase}/sources/${sourceLinkId}/review`);
    expectStatus(deniedReview, 409, "la opción apagada impide revisar la propia fuente");
    expectB8((deniedReview.json() as { error: { code: string } }).error.code, "el rechazo identifica maker-checker").toBe("MAKER_CHECKER_VIOLATION");

    const enableSelfReview = await request("PATCH", `${BASE}/settings/self-review`, { allowSelfReview: true });
    expectStatus(enableSelfReview, 200, "OWNER enciende autorrevisión antes de repetir la revisión");
    expectB8(responseData<{ allowSelfReview: boolean }>(enableSelfReview).allowSelfReview, "autorrevisión queda habilitada para la revisión de fuente").toBe(true);
    const selfReview = await request("POST", `${sourceBase}/sources/${sourceLinkId}/review`);
    expectStatus(selfReview, 200, "la opción encendida habilita la revisión de la fuente");
    expectB8(responseData<{ status: string }>(selfReview).status, "la fuente queda revisada").toBe("REVIEWED");
    const selfReviewAudit = await prisma.auditEvent.findFirst({
      where: {
        firmId: FIRM,
        userId: OWNER,
        action: "SELF_REVIEW",
        entityType: "WorkpaperImportBatch",
        entityId: sourceLinkId,
      },
    });
    expectB8(selfReviewAudit, "la revisión de fuente escribe un evento SELF_REVIEW").toBeTruthy();
    expectB8(selfReviewAudit?.after, "la auditoría identifica el alcance SOURCE_REVIEW").toMatchObject({ type: "SELF_REVIEW", scope: "SOURCE_REVIEW" });

    const coverageAfterReviewResponse = await request("GET", `${sourceBase}/coverage`);
    expectStatus(coverageAfterReviewResponse, 200, "lectura de cobertura tras revisión de fuente");
    const coverageAfterReview = responseData<{ sources: Array<{ code: string; present: boolean }> }>(coverageAfterReviewResponse);
    expectB8(coverageAfterReview.sources.find((candidate) => candidate.code === "DGR_IIBB_TUC")?.present, "la fuente revisada habilita el cálculo").toBe(true);

    // reviewSource aprueba atómicamente los vouchers que produjo el lote.
    const vouchersResponse = await request("GET", `${clientBase}/vouchers`);
    expectStatus(vouchersResponse, 200, "lectura de comprobantes creados por el libro DGR");
    const vouchers = responseData<Array<{ id: string; status: string }>>(vouchersResponse);
    expectB8(vouchers, "el libro DGR genera cuatro comprobantes para revisar").toHaveLength(4);
    expectB8(vouchers.every((voucher) => voucher.status === "APPROVED"), "la revisión de fuente aprueba los cuatro comprobantes para el motor").toBe(true);

    // 7. Cálculo y controles bloqueantes.
    const calculateResponse = await request("POST", `${sourceBase}/calculate`, { cutoff: OCTOBER_END });
    expectStatus(calculateResponse, 200, "cálculo fiscal desde el expediente completo");
    expectB8(responseData<{ workpaper: { status: string } }>(calculateResponse).workpaper.status, "el expediente completa su cálculo").toBe("CALCULATED");

    const calculationResponse = await request("GET", `${sourceBase}/calculation`);
    expectStatus(calculationResponse, 200, "lectura del resultado calculado por actividad");
    const calculation = responseData<Array<{ settlement: { id: string; ruleVersionId: string; totals: Record<string, string> } }>>(calculationResponse);
    expectB8(calculation, "el expediente contiene una liquidación IIBB").toHaveLength(1);
    const totals = calculation[0]!.settlement.totals;
    expectB8(calculation[0]!.settlement.ruleVersionId, "el cálculo usa la versión recién activada por este flujo").toBe(testRuleVersionId);
    expectB8(totals["BASE_TOTAL"], "el cálculo suma $600.000,00 de base").toBe("600000.00");
    expectB8(totals["IMPUESTO_POR_ACTIVIDAD"], "el impuesto directo por actividad es $16.000,00").toBe("16000.00");
    expectB8(totals["IMPUESTO_DETERMINADO"], "los mínimos llevan el impuesto determinado a $17.500,00").toBe("17500.00");
    expectB8(totals["TOTAL_A_INGRESAR"], "el total a ingresar es $17.500,00").toBe("17500.00");
    expectB8(totals["SALDO_A_FAVOR"], "el saldo a favor inicial es $0,00").toBe("0.00");

    const controlsResponse = await request("GET", `${sourceBase}/controls`);
    expectStatus(controlsResponse, 200, "lectura de controles de cierre del expediente");
    const controls = responseData<Array<{ id: string; code: string; severity: string; status: string }>>(controlsResponse);
    const blockingControls = controls.filter((control) => control.severity === "BLOCKING");
    expectB8(blockingControls.map((control) => control.code).sort(), "nacen los dos controles bloqueantes esperados").toEqual([
      "BANK_CREDIT_RECONCILIATION",
      "CASH_ALLOCATION_RECONCILIATION",
    ]);
    expectB8(blockingControls.every((control) => control.status === "OPEN"), "ambos controles bloqueantes nacen abiertos").toBe(true);

    const submitted = await request("POST", `${sourceBase}/submit-review`);
    expectStatus(submitted, 200, "envío del cálculo a revisión de cierre");
    const reviewed = await request("POST", `${sourceBase}/review`, { approved: true, comment: "T-Revisión B8" });
    expectStatus(reviewed, 200, "aprobación del cálculo previo al cierre");

    const blockedFinalize = await request("POST", `${sourceBase}/finalize`);
    expectStatus(blockedFinalize, 422, "el cierre rechaza controles bloqueantes abiertos");
    const blockedError = (blockedFinalize.json() as { error: { message: string } }).error;
    expectB8(blockedError.message, "el cierre explica que quedan dos controles sin resolver").toBe("2 control(es) bloqueante(s) sin resolver");

    // 8. READY se crea mediante el fixture de repositorio documentado arriba;
    // las resoluciones siguen usando el endpoint público de controles.
    const bankEvidence = await createReadyControlEvidence(client.id);
    const cashEvidence = await createReadyControlEvidence(client.id);
    for (const control of blockingControls) {
      const evidence = control.code === "BANK_CREDIT_RECONCILIATION" ? bankEvidence : cashEvidence;
      const resolution = await request("POST", `${sourceBase}/controls/${control.id}/resolve`, {
        resolution: `T-Resuelto con documento READY ${evidence.id}`,
        status: "RESOLVED",
        evidenceDocumentId: evidence.id,
      });
      expectStatus(resolution, 200, `resolución de ${control.code} con documento del cliente READY`);
      const resolved = responseData<{ status: string; evidenceDocumentId: string }>(resolution);
      expectB8(resolved.status, `${control.code} queda resuelto`).toBe("RESOLVED");
      expectB8(resolved.evidenceDocumentId, `${control.code} conserva el documento de evidencia`).toBe(evidence.id);
    }

    const finalizationResponse = await request("POST", `${sourceBase}/finalize`);
    expectStatus(finalizationResponse, 200, "cierre del expediente tras resolver controles con evidencia READY");
    const finalization = responseData<{ status: string; outputHash: string }>(finalizationResponse);
    expectB8(finalization.status, "el expediente finaliza").toBe("FINALIZED");
    expectB8(finalization.outputHash, "el cierre persiste el outputHash inmutable").toMatch(/^[a-f0-9]{64}$/);

    const closedWorkpaperResponse = await request("GET", sourceBase);
    expectStatus(closedWorkpaperResponse, 200, "lectura de vuelta del expediente finalizado");
    const closedWorkpaper = responseData<{ status: string; outputHash: string }>(closedWorkpaperResponse);
    expectB8(closedWorkpaper.status, "el estado final persiste en el expediente").toBe("FINALIZED");
    expectB8(closedWorkpaper.outputHash, "el outputHash leído coincide con el calculado").toBe(finalization.outputHash);

    const obligationsResponse = await request("GET", `${clientBase}/tax-obligations`);
    expectStatus(obligationsResponse, 200, "lectura de obligaciones tras finalizar expediente");
    const obligations = responseData<Array<{ id: string; status: string }>>(obligationsResponse);
    expectB8(obligations.find((item) => item.id === obligation.id)?.status, "la obligación queda READY_TO_FILE al cerrar").toBe("READY_TO_FILE");

    const creditLedgerResponse = await request("GET", `${clientBase}/tax-credit-ledger`);
    expectStatus(creditLedgerResponse, 200, "lectura del libro de créditos de cierre");
    const lots = responseData<Array<{ sourceSettlementId: string | null; kind: string; originalAmount: string }>>(creditLedgerResponse);
    const closingBalance = lots.find((lot) => lot.sourceSettlementId === calculation[0]!.settlement.id && lot.kind === "SALDO_A_FAVOR");
    expectB8(closingBalance?.originalAmount, "el saldo de cierre conserva $0,00 a favor").toBe("0.0000");
  });
});
