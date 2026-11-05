import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";

/**
 * Primer corte backend del catálogo de actividades económicas.
 *
 * Cobertura:
 * - GET sólo activo por defecto (selectores) + includeInactive para admin.
 * - Alta con normalización de código, unicidad y vigencia.
 * - PATCH de atributos/vigencia con code y jurisdictionId inmutables.
 * - Activación/desactivación explícitas, sin borrado (historial intacto).
 * - Auditoría (auditEvent) en toda mutación del catálogo.
 * - Vínculo código-regla validado en servidor (altas y reemplazos DRAFT).
 * - Compatibilidad: reemplazo con códigos históricos desactivados sigue OK;
 *   vínculo de ficha (client_activity) exige actividad existente y activa.
 */

type TestContext = {
  userId: string;
  firmId: string;
  clientId: string;
  actorKind: "USER";
};

const mockState = vi.hoisted(() => ({
  context: {
    userId: "11111111-1111-4111-8111-111111111111",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "11111111-2222-4333-8444-777777777777",
    actorKind: "USER" as const,
  },
  jurisdictions: [] as Array<Record<string, unknown>>,
  activities: [] as Array<Record<string, unknown>>,
  clientActivities: [] as Array<Record<string, unknown>>,
  ruleVersions: [] as Array<Record<string, unknown>>,
  rateRules: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  idCounter: 0,
  withTenantContext: null as unknown as (
    ctx: TestContext,
    fn: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
}));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => mockState.context,
  withTenantContext: (ctx: TestContext, fn: (tx: unknown) => Promise<unknown>) =>
    mockState.withTenantContext(ctx, fn),
}));

const FIRM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JURISDICTION_ID = "55555555-6666-4777-8888-bbbbbbbbbbbb";
const OTHER_JURISDICTION_ID = "77777777-8888-4999-8000-dddddddddddd";
const PROFILE_ID = "33333333-4444-4555-8666-999999999999";

function nextUuid() {
  return `00000000-0000-4000-8000-${String(++mockState.idCounter).padStart(12, "0")}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function seedActivity(overrides: Record<string, unknown> = {}) {
  const row = {
    id: nextUuid(),
    code: "COMERCIO",
    name: "Comercio",
    jurisdictionId: JURISDICTION_ID,
    source: "DGR Tucumán / SMT",
    validFrom: new Date("2026-01-01"),
    validTo: null,
    isActive: true,
    ...overrides,
  };
  mockState.activities.push(row);
  return row;
}

function seedRuleVersion(status: string) {
  const row = {
    id: nextUuid(),
    packId: nextUuid(),
    status,
    engineVersion: "ar-iibb-tuc-local-v1.1.0",
  };
  mockState.ruleVersions.push(row);
  return row;
}

function duplicateCodeError() {
  return Object.assign(new Error("duplicate"), { code: "P2002" });
}

function makeTransaction() {
  return {
    jurisdiction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.jurisdictions.find((row) => row.id === where.id) ?? null,
    },
    economicActivity: {
      findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
        mockState.activities
          .filter((row) => matches(row, where))
          .sort((a, b) => String(a.code).localeCompare(String(b.code))),
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.activities.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (
          mockState.activities.some(
            (row) => row.code === data.code && row.jurisdictionId === data.jurisdictionId,
          )
        ) {
          throw duplicateCodeError();
        }
        const row = {
          id: nextUuid(),
          validTo: null,
          isActive: true,
          ...data,
        };
        mockState.activities.push(row);
        return row;
      },
      // Copia antes de mutar: Prisma nunca devuelve el mismo objeto mutado, y
      // el servicio captura `before` para auditoría desde la fila previa.
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = mockState.activities.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("not found");
        const updated = { ...mockState.activities[index], ...data };
        mockState.activities[index] = updated;
        return updated;
      },
    },
    clientActivity: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.clientActivities.filter((row) => matches(row, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextUuid(), ...data };
        mockState.clientActivities.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.clientActivities.find((row) => matches(row, where)) ?? null,
    },
    taxRuleVersion: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = mockState.ruleVersions.find((item) => item.id === where.id);
        if (!row) return null;
        return {
          ...row,
          pack: {
            regime: {
              code: "IIBB_LOCAL",
              taxType: { code: "IIBB" },
              jurisdiction: { code: "AR-T" },
            },
          },
          rateRules: mockState.rateRules.filter((rule) => rule.ruleVersionId === row.id),
          minimumRules: [],
          dueDateRules: [],
          roundingRules: [],
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = mockState.ruleVersions.find((item) => item.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    },
    taxRateRule: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextUuid(), ...data };
        mockState.rateRules.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = mockState.rateRules.length;
        mockState.rateRules = mockState.rateRules.filter(
          (row) => !matches(row, where),
        );
        return { count: before - mockState.rateRules.length };
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) mockState.rateRules.push({ id: nextUuid(), ...row });
        return { count: data.length };
      },
      findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
        mockState.rateRules.filter((row) => matches(row, where)),
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextUuid(), ...data };
        mockState.auditEvents.push(row);
        return row;
      },
    },
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  mockState.jurisdictions.splice(
    0,
    mockState.jurisdictions.length,
    { id: JURISDICTION_ID, code: "TUC", name: "Tucumán", kind: "PROVINCIAL" },
    { id: OTHER_JURISDICTION_ID, code: "CBA", name: "Córdoba", kind: "PROVINCIAL" },
  );
  mockState.activities.length = 0;
  mockState.clientActivities.length = 0;
  mockState.ruleVersions.length = 0;
  mockState.rateRules.length = 0;
  mockState.auditEvents.length = 0;
  mockState.idCounter = 0;
  mockState.withTenantContext = async (_ctx, fn) => fn(makeTransaction());

  app = Fastify({ logger: false });
  fiscalFoundationRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("catálogo de actividades: alta con validación y auditoría", () => {
  it("crea la actividad con código normalizado y registra auditoría", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/activities",
      payload: {
        code: "  comercio  ",
        name: "Comercio al por menor",
        jurisdictionId: JURISDICTION_ID,
        source: "DGR Tucumán",
        validFrom: "2026-01-01",
      },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json().data;
    expect(created).toMatchObject({
      code: "COMERCIO",
      name: "Comercio al por menor",
      jurisdictionId: JURISDICTION_ID,
      isActive: true,
    });
    expect(mockState.auditEvents).toHaveLength(1);
    expect(mockState.auditEvents[0]).toMatchObject({
      action: "tax.activity.created",
      entityType: "EconomicActivity",
      actorKind: "USER",
      after: { code: "COMERCIO" },
    });
  });

  it("rechaza un código con formato inválido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/activities",
      payload: {
        code: "IVA;21",
        name: "Inválido",
        jurisdictionId: JURISDICTION_ID,
        validFrom: "2026-01-01",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(mockState.activities).toHaveLength(0);
  });

  it("rechaza jurisdicción inexistente (404) y vigencia invertida (409)", async () => {
    const missingJurisdiction = await app.inject({
      method: "POST",
      url: "/api/v1/tax/activities",
      payload: {
        code: "SERVICIOS",
        name: "Servicios",
        jurisdictionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        validFrom: "2026-01-01",
      },
    });
    expect(missingJurisdiction.statusCode).toBe(404);
    expect(missingJurisdiction.json().error.code).toBe("JURISDICTION_NOT_FOUND");

    const invertedValidity = await app.inject({
      method: "POST",
      url: "/api/v1/tax/activities",
      payload: {
        code: "SERVICIOS",
        name: "Servicios",
        jurisdictionId: JURISDICTION_ID,
        validFrom: "2026-06-01",
        validTo: "2026-01-01",
      },
    });
    expect(invertedValidity.statusCode).toBe(409);
    expect(invertedValidity.json().error.code).toBe("ACTIVITY_VALIDITY_INVALID");
    expect(mockState.activities).toHaveLength(0);
  });

  it("rechaza código duplicado en la misma jurisdicción (409 CATALOG_CODE_CONFLICT)", async () => {
    seedActivity({ code: "COMERCIO" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tax/activities",
      payload: {
        code: "COMERCIO",
        name: "Otro comercio",
        jurisdictionId: JURISDICTION_ID,
        validFrom: "2026-01-01",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CATALOG_CODE_CONFLICT");
  });
});

describe("catálogo de actividades: lectura para selectores y administración", () => {
  it("lista sólo activas por defecto; includeInactive=true expone el catálogo completo", async () => {
    const active = seedActivity({ code: "COMERCIO" });
    seedActivity({ code: "SERVICIOS", isActive: false });
    seedActivity({ code: "AGRO", jurisdictionId: OTHER_JURISDICTION_ID });

    const selector = await app.inject({ method: "GET", url: "/api/v1/tax/activities" });
    expect(selector.statusCode).toBe(200);
    expect(selector.json().data.map((row: { code: string }) => row.code)).toEqual(["AGRO", "COMERCIO"]);
    expect(selector.json().data.find((row: { code: string }) => row.code === "COMERCIO").id).toBe(active.id);

    const admin = await app.inject({
      method: "GET",
      url: "/api/v1/tax/activities?includeInactive=true",
    });
    expect(admin.json().data).toHaveLength(3);

    const byJurisdiction = await app.inject({
      method: "GET",
      url: `/api/v1/tax/activities?jurisdictionId=${OTHER_JURISDICTION_ID}`,
    });
    expect(byJurisdiction.json().data.map((row: { code: string }) => row.code)).toEqual(["AGRO"]);
  });
});

describe("catálogo de actividades: edición y estado", () => {
  it("edita nombre, fuente y vigencia, y reporta vínculos vigentes", async () => {
    const activity = seedActivity({ code: "COMERCIO" });
    mockState.clientActivities.push({ id: nextUuid(), activityId: activity.id, validTo: null });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/tax/activities/${activity.id}`,
      payload: { name: "Comercio minorista", source: null, validTo: "2027-12-31" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: activity.id,
      name: "Comercio minorista",
      source: null,
      validTo: "2027-12-31T00:00:00.000Z",
      activeClientLinks: 1,
    });
    expect(mockState.auditEvents[0]).toMatchObject({ action: "tax.activity.updated" });
    expect(mockState.auditEvents[0]!.before).toMatchObject({ name: "Comercio" });
    expect(mockState.auditEvents[0]!.after).toMatchObject({ name: "Comercio minorista" });
  });

  it("rechaza editar code (vínculo de reglas) y actividad inexistente", async () => {
    const activity = seedActivity({ code: "COMERCIO" });
    const codeChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/tax/activities/${activity.id}`,
      payload: { code: "OTRO" },
    });
    expect(codeChange.statusCode).toBe(400);

    const missing = await app.inject({
      method: "PATCH",
      url: `/api/v1/tax/activities/00000000-0000-4000-8000-999999999999`,
      payload: { name: "X" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("ACTIVITY_NOT_FOUND");
  });

  it("desactiva y reactiva con auditoría; nunca borra la fila", async () => {
    const activity = seedActivity({ code: "COMERCIO" });

    const deactivate = await app.inject({
      method: "POST",
      url: `/api/v1/tax/activities/${activity.id}/deactivate`,
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().data).toMatchObject({ isActive: false, activeClientLinks: 0 });
    expect(mockState.activities.find((row) => row.id === activity.id)?.code).toBe("COMERCIO");
    expect(mockState.auditEvents[0]).toMatchObject({ action: "tax.activity.deactivated" });

    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/tax/activities/${activity.id}/deactivate`,
    });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().error.code).toBe("ACTIVITY_STATE_UNCHANGED");

    const reactivate = await app.inject({
      method: "POST",
      url: `/api/v1/tax/activities/${activity.id}/activate`,
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().data.isActive).toBe(true);
    expect(mockState.auditEvents[1]).toMatchObject({ action: "tax.activity.activated" });
  });
});

describe("vínculo código-regla validado en servidor", () => {
  it("rechaza alta de regla con código fantasma y guarda normalizado el válido", async () => {
    const activity = seedActivity({ code: "COMERCIO" });
    const draft = seedRuleVersion("DRAFT");

    const ghost = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: { concept: "IIBB", rate: "3", activityCode: "FANTASMA", validFrom: "2026-01-01" },
    });
    expect(ghost.statusCode).toBe(409);
    expect(ghost.json().error.code).toBe("ACTIVITY_CODE_UNKNOWN");
    expect(mockState.rateRules).toHaveLength(0);

    const inactive = seedActivity({ code: "VIEJA", isActive: false });
    const inactiveRule = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: { concept: "IIBB", rate: "3", activityCode: "vieja", validFrom: "2026-01-01" },
    });
    expect(inactiveRule.statusCode).toBe(409);
    expect(inactiveRule.json().error.code).toBe("ACTIVITY_CODE_INACTIVE");
    expect(inactive.id).toBeTruthy();

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: { concept: "IIBB", rate: "3", activityCode: "  comercio  ", validFrom: "2026-01-01" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.activityCode).toBe("COMERCIO");
    expect(activity.id).toBeTruthy();
  });

  it("exige la jurisdicción de la regla cuando la declara", async () => {
    seedActivity({ code: "COMERCIO", jurisdictionId: JURISDICTION_ID });
    const draft = seedRuleVersion("DRAFT");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: {
        concept: "IIBB",
        rate: "3",
        activityCode: "COMERCIO",
        jurisdictionId: OTHER_JURISDICTION_ID,
        validFrom: "2026-01-01",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACTIVITY_CODE_JURISDICTION_MISMATCH");
  });

  it("reemplazo DRAFT valida el lote ANTES de borrar y admite códigos históricos desactivados", async () => {
    seedActivity({ code: "COMERCIO" });
    const draft = seedRuleVersion("DRAFT");
    mockState.rateRules.push({
      id: nextUuid(),
      ruleVersionId: draft.id,
      concept: "IIBB",
      activityCode: "COMERCIO",
    });

    const ghostBatch = await app.inject({
      method: "PUT",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: {
        rules: [
          { concept: "IIBB", rate: "3", activityCode: "FANTASMA", validFrom: "2026-01-01" },
        ],
      },
    });
    expect(ghostBatch.statusCode).toBe(409);
    expect(ghostBatch.json().error.code).toBe("ACTIVITY_CODE_UNKNOWN");
    // El borrador conserva sus reglas: la validación corre antes del deleteMany.
    expect(mockState.rateRules.filter((row) => row.ruleVersionId === draft.id)).toHaveLength(1);

    seedActivity({ code: "VIEJA", isActive: false });
    const legacyBatch = await app.inject({
      method: "PUT",
      url: `/api/v1/tax/rule-versions/${draft.id}/rate-rules`,
      payload: {
        rules: [
          { concept: "IIBB", rate: "3", activityCode: "COMERCIO", validFrom: "2026-01-01" },
          { concept: "IIBB_VIEJA", rate: "2", activityCode: "VIEJA", validFrom: "2026-01-01" },
        ],
      },
    });
    expect(legacyBatch.statusCode).toBe(200);
    const stored = mockState.rateRules.filter((row) => row.ruleVersionId === draft.id);
    expect(stored.map((row) => row.activityCode).sort()).toEqual(["COMERCIO", "VIEJA"]);
  });

  it("las reglas de versiones no DRAFT siguen inmutables (compatibilidad histórica)", async () => {
    const activeVersion = seedRuleVersion("ACTIVE");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${activeVersion.id}/rate-rules`,
      payload: { concept: "IIBB", rate: "3", activityCode: "COMERCIO", validFrom: "2026-01-01" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("RULE_VERSION_IMMUTABLE");
    expect(mockState.rateRules).toHaveLength(0);
  });
});

describe("coherencia ficha ↔ catálogo", () => {
  it("el vínculo de cliente exige actividad existente y activa", async () => {
    const inactive = seedActivity({ code: "VIEJA", isActive: false });

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/firms/${FIRM_ID}/clients/${mockState.context.clientId}/activities`,
      payload: { profileVersionId: PROFILE_ID, activityId: nextUuid(), validFrom: "2026-01-01" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("ACTIVITY_NOT_FOUND");

    const inactiveLink = await app.inject({
      method: "POST",
      url: `/api/v1/firms/${FIRM_ID}/clients/${mockState.context.clientId}/activities`,
      payload: { profileVersionId: PROFILE_ID, activityId: inactive.id, validFrom: "2026-01-01" },
    });
    expect(inactiveLink.statusCode).toBe(409);
    expect(inactiveLink.json().error.code).toBe("ACTIVITY_INACTIVE");
    expect(mockState.clientActivities).toHaveLength(0);
  });
});
