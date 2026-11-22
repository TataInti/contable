import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Corte 4F (segundo defecto): «Abrir mes» con un régimen sin rule pack.
 *
 * En producción el Monotributo no tiene liquidación mensual en el sistema: no tiene rule pack. Antes del corte,
 * «Abrir mes» creaba su período y después fallaba con «No existe rule pack para el régimen», dejando un período
 * sin obligación. Esperado: «Abrir mes» abre los regímenes con paquete (IIBB), no crea nada para los demás,
 * no muestra error y lo informa en la respuesta en español llano.
 *
 * El régimen sin paquete es sintético (mismo tipo de impuesto, jurisdicción y autoridad que MONOTRIBUTO).
 * Datos inventados.
 */

const OWNER = randomUUID();
const FIRM = randomUUID();
const RUN = randomUUID();
const CSRF = `csrf-4f-mes-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;

let app: FastifyInstance | null = null;
let ownerToken = "";

type ApiResponse = { statusCode: number; body: string; json(): unknown };

function data<T>(response: ApiResponse): T {
  return (response.json() as { data: T }).data;
}

function ok(response: ApiResponse, status: number, what: string) {
  expect(response.statusCode, `${what}; respuesta: ${response.body}`).toBe(status);
}

async function request(method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>) {
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

let monoTaxTypeId = "";
let sinPaqueteId = "";

describe("4F — abrir mes con un régimen sin rule pack", () => {
  beforeAll(async () => {
    app = await buildServer({
      postgres: async () => true,
      valkey: async () => true,
      minio: async () => true,
      ai: async () => true,
    });
    await app.ready();
    await prisma.firm.create({
      data: { id: FIRM, legalName: `T-Estudio 4F mes ${RUN}`, displayName: `T-Estudio 4F mes ${RUN}`, allowSelfReview: true },
    });
    await prisma.user.create({
      data: { id: OWNER, emailNormalized: `t-4f-mes-owner-${RUN}@example.invalid`, name: `T-Titular 4F mes ${RUN}`, passwordHash: "-" },
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

    // Régimen de Monotributo sin rule pack (en producción, el Monotributo no tiene liquidación mensual).
    const mono = await prisma.taxRegime.findFirstOrThrow({ where: { code: "MONOTRIBUTO" } });
    monoTaxTypeId = mono.taxTypeId;
    const sinPaquete = await prisma.taxRegime.upsert({
      where: { code: `MONO-SIN-PAQUETE-${RUN.slice(0, 8)}` },
      update: {},
      create: {
        code: `MONO-SIN-PAQUETE-${RUN.slice(0, 8)}`,
        name: "Monotributo sin paquete (prueba 4F)",
        taxTypeId: mono.taxTypeId,
        jurisdictionId: mono.jurisdictionId,
        authorityId: mono.authorityId,
        moduleId: mono.moduleId,
      },
    });
    sinPaqueteId = sinPaquete.id;
    expect(await prisma.taxRulePack.count({ where: { regimeId: sinPaqueteId } })).toBe(0);
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

  it("abre IIBB, no crea período ni obligación para el régimen sin paquete y lo informa sin error", async () => {
    const iibbRegimeId = await resolveMaster("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
    const cuit = validTestCuit();
    const client = data<{ id: string }>(
      await request("POST", `${BASE}/clients`, { legalName: `T-Cliente 4F mes ${RUN}`, tradeName: `T-Cliente 4F mes ${RUN}`, cuit }),
    );
    const clientBase = `${BASE}/clients/${client.id}`;
    const profile = data<{ id: string }>(
      await request("POST", `${clientBase}/tax-profile-versions`, {
        legalName: `T-Cliente 4F mes ${RUN}`,
        cuit,
        personType: "FISICA",
        nationalCondition: "MONOTRIBUTISTA",
        fiscalAddress: `T-Domicilio ${RUN}, San Miguel de Tucumán`,
        validFrom: "2026-01-01",
      }),
    );
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/submit-review`), 200, "perfil a revisión");
    ok(await request("POST", `${clientBase}/tax-profile-versions/${profile.id}/activate`), 200, "perfil activo");

    for (const regimeId of [sinPaqueteId, iibbRegimeId]) {
      ok(
        await request("POST", `${clientBase}/tax-registrations`, {
          profileVersionId: profile.id,
          regimeId,
          validFrom: "2026-01-01",
          registrationNumber: `T-4F-MES-${RUN.slice(0, 8)}-${regimeId.slice(0, 4)}`,
        }),
        201,
        "inscripción",
      );
    }

    const response = await request("POST", `${clientBase}/tax-periods/open-month`, { month: "2026-10" });
    ok(response, 200, "abrir mes sin error");
    const opened = data<{
      regimes: number;
      periodsCreated: number;
      obligationsCreated: number;
      calendarNotices: string[];
    }>(response);
    expect(opened).toMatchObject({ regimes: 1, periodsCreated: 1, obligationsCreated: 1 });
    // Nota informativa en español llano, con el nombre del régimen.
    expect(opened.calendarNotices.join(" ")).toContain("Monotributo sin paquete (prueba 4F)");
    expect(opened.calendarNotices.join(" ")).toMatch(/no se abrió período/);

    // Ni período ni obligación del régimen sin paquete: ningún período huérfano del impuesto.
    expect(await prisma.taxPeriod.count({ where: { clientId: client.id, taxTypeId: monoTaxTypeId } })).toBe(0);
    expect(await prisma.taxObligation.count({ where: { clientId: client.id, regimeId: sinPaqueteId } })).toBe(0);
  });
});
