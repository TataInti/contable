import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { artifactFilename } from "./settlement-service.js";

/*
 * Descarga del papel de trabajo de una liquidación finalizada (corte liq-descarga, D7C-2 a),
 * por la ruta real. El almacenamiento de MinIO se simula con un mapa en memoria: no hay
 * MinIO en la prueba. Datos sintéticos («Cliente sintético liq-descarga»); sin credenciales.
 */

const FIRM_A = randomUUID();
const FIRM_B = randomUUID();
const OWNER_A = randomUUID();
const AUDITOR_A = randomUUID();
const OWNER_B = randomUUID();
const CLIENT_A = randomUUID();
const CLIENT_A2 = randomUUID();
const CLIENT_B = randomUUID();
const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

const PDF = Buffer.from("%PDF-1.4\n% Papel de trabajo sintético (liq-descarga)\n", "utf8");
const CSV = Buffer.from("Código;Concepto;Valor\r\nTOTAL;Total a ingresar;1000\r\n", "utf8");
const ALTERADO = Buffer.from("contenido alterado en el almacenamiento", "utf8");

const objects = new Map<string, Buffer>();
const tokens = { owner: "", auditor: "", ownerB: "" };
const sessionIds: string[] = [];
const base = `/api/v1/firms/${FIRM_A}/clients`;

let settlementFinal = "";
let settlementOther = "";
let settlementDraft = "";
let artifactPdf = "";
let artifactCsv = "";
let artifactAlterado = "";
let artifactDraft = "";

function validTestCuit(): string {
  for (;;) {
    const base10 = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = CUIT_WEIGHTS.reduce(
      (total, weight, index) => total + Number(base10[index]) * weight,
      0,
    );
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base10}${check}`;
  }
}

function get(token: string, url: string) {
  return app.inject({ method: "GET", url, cookies: { refresh_token: token } });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  for (const [id, email, name] of [
    [OWNER_A, `owner.${OWNER_A}@test.local`, "Owner liq-descarga A"],
    [AUDITOR_A, `auditor.${AUDITOR_A}@test.local`, "Auditor liq-descarga A"],
    [OWNER_B, `owner.${OWNER_B}@test.local`, "Owner liq-descarga B"],
  ] as const) {
    await prisma.$executeRaw`INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt") VALUES (${id}, ${email}, ${name}, 'x', now())`;
  }
  for (const [id, name] of [
    [FIRM_A, "Estudio liq-descarga A"],
    [FIRM_B, "Estudio liq-descarga B"],
  ] as const) {
    await prisma.$executeRaw`INSERT INTO firms ("id", "legalName", "displayName", "updatedAt") VALUES (${id}, ${name}, ${name}, now())`;
  }
  for (const [id, firmId] of [
    [CLIENT_A, FIRM_A],
    [CLIENT_A2, FIRM_A],
    [CLIENT_B, FIRM_B],
  ] as const) {
    await prisma.$executeRaw`INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt") VALUES (${id}, ${firmId}, ${`Cliente sintético ${id.slice(0, 8)}`}, ${validTestCuit()}, now())`;
  }
  for (const [userId, firmId, role] of [
    [OWNER_A, FIRM_A, "OWNER"],
    [AUDITOR_A, FIRM_A, "AUDITOR_READONLY"],
    [OWNER_B, FIRM_B, "OWNER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${firmId}', '${userId}', '${role}', 'ACTIVE', now())
    `);
  }

  await prisma.clientAssignment.create({
    data: { firmId: FIRM_A, userId: AUDITOR_A, clientId: CLIENT_A, capabilities: [] },
  });

  tokens.owner = randomBytes(32).toString("base64url");
  tokens.auditor = randomBytes(32).toString("base64url");
  tokens.ownerB = randomBytes(32).toString("base64url");
  const sessions = [
    { userId: OWNER_A, token: tokens.owner },
    { userId: AUDITOR_A, token: tokens.auditor },
    { userId: OWNER_B, token: tokens.ownerB },
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

  const iva = await prisma.taxType.findFirst({ where: { code: "IVA" }, select: { id: true } });
  if (!iva) throw new Error("seed-maestros-fiscales no cargado: falta el impuesto IVA");
  const regime = await prisma.taxRegime.findFirst({
    where: { taxTypeId: iva.id },
    select: { id: true, jurisdictionId: true },
  });
  if (!regime) throw new Error("seed-maestros-fiscales no cargado: falta un régimen de IVA");

  const periodA = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM_A,
      clientId: CLIENT_A,
      taxTypeId: iva.id,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-31T00:00:00.000Z"),
      label: "Octubre 2026",
    },
  });
  const periodB = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM_B,
      clientId: CLIENT_B,
      taxTypeId: iva.id,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-31T00:00:00.000Z"),
      label: "Octubre 2026",
    },
  });

  const common = {
    taxTypeId: iva.id,
    regimeId: regime.id,
    jurisdictionId: regime.jurisdictionId,
    cutoff: new Date("2026-11-01T00:00:00.000Z"),
    engineVersion: "test-engine",
    rulesHash: "rules-test",
    inputHash: "input-test",
    outputHash: "output-test",
    totals: { TOTAL_A_INGRESAR: "1000" },
  };
  const finalized = {
    status: "FINALIZED" as const,
    reviewedAt: new Date(),
    finalizedAt: new Date(),
  };

  const settlementA = await prisma.taxSettlement.create({
    data: {
      ...common,
      ...finalized,
      firmId: FIRM_A,
      clientId: CLIENT_A,
      periodId: periodA.id,
      version: 1,
      preparedByUserId: OWNER_A,
      reviewedByUserId: OWNER_A,
      finalizedByUserId: OWNER_A,
    },
  });
  settlementFinal = settlementA.id;
  const otherA = await prisma.taxSettlement.create({
    data: {
      ...common,
      ...finalized,
      firmId: FIRM_A,
      clientId: CLIENT_A,
      periodId: periodA.id,
      version: 3,
      preparedByUserId: OWNER_A,
      reviewedByUserId: OWNER_A,
      finalizedByUserId: OWNER_A,
    },
  });
  settlementOther = otherA.id;
  const draftA = await prisma.taxSettlement.create({
    data: {
      ...common,
      firmId: FIRM_A,
      clientId: CLIENT_A,
      periodId: periodA.id,
      version: 2,
      status: "CALCULATED",
      preparedByUserId: OWNER_A,
    },
  });
  settlementDraft = draftA.id;
  await prisma.taxSettlement.create({
    data: {
      ...common,
      ...finalized,
      firmId: FIRM_B,
      clientId: CLIENT_B,
      periodId: periodB.id,
      version: 1,
      preparedByUserId: OWNER_B,
      reviewedByUserId: OWNER_B,
      finalizedByUserId: OWNER_B,
    },
  });

  const keyPdf = `settlements/${FIRM_A}/${CLIENT_A}/${settlementFinal}/v1.pdf`;
  const keyCsv = `settlements/${FIRM_A}/${CLIENT_A}/${settlementFinal}/v1.csv`;
  const keyAlterado = `settlements/${FIRM_A}/${CLIENT_A}/${settlementFinal}/v1-alterado.pdf`;
  const keyDraft = `settlements/${FIRM_A}/${CLIENT_A}/${settlementDraft}/v2.pdf`;
  objects.set(keyPdf, PDF);
  objects.set(keyCsv, CSV);
  objects.set(keyAlterado, ALTERADO);
  objects.set(keyDraft, PDF);

  const artifactBase = {
    kind: "PAPEL_DE_TRABAJO",
    generatedByUserId: OWNER_A,
    firmId: FIRM_A,
    clientId: CLIENT_A,
  };
  artifactPdf = (
    await prisma.taxExportArtifact.create({
      data: {
        ...artifactBase,
        settlementId: settlementFinal,
        format: "pdf",
        objectKey: keyPdf,
        checksum: sha256Hex(PDF),
      },
    })
  ).id;
  artifactCsv = (
    await prisma.taxExportArtifact.create({
      data: {
        ...artifactBase,
        settlementId: settlementFinal,
        format: "csv",
        objectKey: keyCsv,
        checksum: sha256Hex(CSV),
      },
    })
  ).id;
  artifactAlterado = (
    await prisma.taxExportArtifact.create({
      data: {
        ...artifactBase,
        settlementId: settlementFinal,
        format: "pdf",
        objectKey: keyAlterado,
        checksum: sha256Hex(PDF),
      },
    })
  ).id;
  artifactDraft = (
    await prisma.taxExportArtifact.create({
      data: {
        ...artifactBase,
        settlementId: settlementDraft,
        format: "pdf",
        objectKey: keyDraft,
        checksum: sha256Hex(PDF),
      },
    })
  ).id;

  // Almacenamiento simulado: el objeto se lee del mapa, como lo haría MinIO.
  vi.spyOn(ObjectStorage.prototype, "get").mockImplementation(async (_bucket, key) => {
    const body = objects.get(key);
    if (!body) throw new Error(`objeto inexistente en la prueba: ${key}`);
    return body;
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (sessionIds.length > 0)
    await prisma.deviceSession.deleteMany({ where: { id: { in: sessionIds } } });
  await app?.close();
});

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("descarga del papel de trabajo (liq-descarga)", () => {
  it("el dueño recibe el PDF con su tipo, su nombre, su checksum y el cuerpo guardado", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="liquidacion-iva-2026-10-v1.pdf"',
    );
    expect(res.headers["x-checksum-sha256"]).toBe(sha256Hex(PDF));
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.rawPayload.equals(PDF)).toBe(true);
  });

  it("el CSV sale como text/csv en UTF-8 con su nombre y su cuerpo", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${artifactCsv}/download`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="liquidacion-iva-2026-10-v1.csv"',
    );
    expect(res.headers["x-checksum-sha256"]).toBe(sha256Hex(CSV));
    expect(res.rawPayload.equals(CSV)).toBe(true);
  });

  it("sin la capacidad tax.settlements.export (auditor de solo lectura) responde 403 y no entrega el archivo", async () => {
    const res = await get(
      tokens.auditor,
      `${base}/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("un artefacto pedido por otro cliente del mismo estudio responde 404 y no entrega el archivo", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A2}/tax-settlements/${settlementFinal}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("SETTLEMENT_NOT_FOUND");
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("un artefacto de otro estudio responde 404 aunque su dueño tenga sesión en ese estudio", async () => {
    const res = await get(
      tokens.ownerB,
      `/api/v1/firms/${FIRM_B}/clients/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("SETTLEMENT_NOT_FOUND");
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("un artefacto de otra liquidación del mismo cliente responde 404 (el artefacto debe ser de la liquidación de la ruta)", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementOther}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("ARTIFACT_NOT_FOUND");
  });

  it("una liquidación que no está finalizada no entrega su papel de trabajo (409)", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementDraft}/artifacts/${artifactDraft}/download`,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SETTLEMENT_IMMUTABLE");
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("un artefacto inexistente responde 404", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${randomUUID()}/download`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("ARTIFACT_NOT_FOUND");
  });

  it("una liquidación inexistente responde 404", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${randomUUID()}/artifacts/${artifactPdf}/download`,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("SETTLEMENT_NOT_FOUND");
  });

  it("si el objeto guardado no coincide con su checksum, no se entrega el archivo (409)", async () => {
    const res = await get(
      tokens.owner,
      `${base}/${CLIENT_A}/tax-settlements/${settlementFinal}/artifacts/${artifactAlterado}/download`,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ARTIFACT_CHECKSUM_MISMATCH");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.rawPayload.equals(ALTERADO)).toBe(false);
  });

  it("el nombre del archivo sale en minúsculas, con el año y mes del período y la versión", () => {
    expect(
      artifactFilename({
        taxTypeCode: "IVA",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        version: 2,
        format: "csv",
      }),
    ).toBe("liquidacion-iva-2026-10-v2.csv");
  });
});
