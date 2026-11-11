import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";

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
  taxTypes: [] as Array<Record<string, unknown>>,
  authorities: [] as Array<Record<string, unknown>>,
  regimes: [] as Array<Record<string, unknown>>,
  obligations: [] as Array<Record<string, unknown>>,
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
const CLIENT_ID = "11111111-2222-4333-8444-777777777777";
const JURISDICTION_ID = "55555555-6666-4777-8888-bbbbbbbbbbbb";
const OTHER_JURISDICTION_ID = "77777777-8888-4999-8000-dddddddddddd";
const TAX_TYPE_ID = "44444444-5555-4666-8777-aaaaaaaaaaaa";
const PROFILE_ID = "33333333-4444-4555-8666-999999999999";
const PERIOD_ID = "88888888-9999-4000-8111-eeeeeeeeeeee";

function nextUuid() {
  return `00000000-0000-4000-8000-${String(++mockState.idCounter).padStart(12, "0")}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function makeTransaction() {
  return {
    jurisdiction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.jurisdictions.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
        mockState.jurisdictions.filter((row) => matches(row, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextUuid(), isActive: true, ...data };
        mockState.jurisdictions.push(row);
        return row;
      },
    },
    taxType: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.taxTypes.find((row) => row.id === where.id) ?? null,
    },
    taxAuthority: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.authorities.find((row) => row.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = mockState.authorities.find((item) => item.id === where.id);
        if (!row) throw new Error("authority not found in mock");
        return row;
      },
      findMany: async ({ where = {}, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> }) =>
        mockState.authorities
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            ...(include?.jurisdiction
              ? { jurisdiction: mockState.jurisdictions.find((item) => item.id === row.jurisdictionId) }
              : {}),
          })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (mockState.authorities.some((row) => row.code === data.code)) {
          throw Object.assign(new Error("duplicate code"), { code: "P2002" });
        }
        const row = {
          id: nextUuid(),
          isActive: true,
          ...data,
        };
        mockState.authorities.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = mockState.authorities.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("authority not found in mock");
        const updated = { ...mockState.authorities[index], ...data };
        mockState.authorities[index] = updated;
        return updated;
      },
    },
    taxRegime: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.regimes.find((row) => row.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = mockState.regimes.find((item) => item.id === where.id);
        if (!row) throw new Error("regime not found in mock");
        return row;
      },
      findMany: async () =>
        mockState.regimes.map((row) => ({
          ...row,
          taxType: mockState.taxTypes.find((item) => item.id === row.taxTypeId),
          jurisdiction: mockState.jurisdictions.find((item) => item.id === row.jurisdictionId),
          authority: mockState.authorities.find((item) => item.id === row.authorityId),
        })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (mockState.regimes.some((row) => row.code === data.code)) {
          throw Object.assign(new Error("duplicate code"), { code: "P2002" });
        }
        const row = {
          id: nextUuid(),
          isActive: true,
          ...data,
        };
        mockState.regimes.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = mockState.regimes.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("regime not found in mock");
        const updated = { ...mockState.regimes[index], ...data };
        mockState.regimes[index] = updated;
        return updated;
      },
    },
    taxObligation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.obligations.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextUuid(),
          status: "PENDING",
          dueDate: null,
          ...data,
        };
        mockState.obligations.push(row);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.obligations.filter((row) => matches(row, where)).map((row) => ({
          ...row,
          regime: mockState.regimes.find((item) => item.id === row.regimeId),
          period: { id: row.periodId, label: "Período sintético E2E" },
        })),
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: nextUuid(), ...data };
        mockState.auditEvents.push(event);
        return event;
      },
    },
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  mockState.jurisdictions.splice(
    0,
    mockState.jurisdictions.length,
    { id: JURISDICTION_ID, code: "AR-E2E-SYN", name: "Jurisdicción sintética E2E", kind: "NATIONAL" },
    { id: OTHER_JURISDICTION_ID, code: "AR-E2E-OTHER", name: "Otra jurisdicción sintética", kind: "PROVINCIAL" },
  );
  mockState.taxTypes.splice(0, mockState.taxTypes.length, {
    id: TAX_TYPE_ID,
    code: "E2E_TEST_TAX",
    name: "Impuesto sintético E2E",
  });
  mockState.authorities.length = 0;
  mockState.regimes.length = 0;
  mockState.obligations.length = 0;
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

describe("catálogo fiscal: autoridades, regímenes y obligaciones", () => {
  it("crea autoridad, régimen y obligación sintéticos con lectura de confirmación", async () => {
    const initialAuthorities = await app.inject({ method: "GET", url: "/api/v1/tax/authorities" });
    expect(initialAuthorities.statusCode).toBe(200);
    expect(initialAuthorities.json().data).toEqual([]);

    const authorityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tax/authorities",
      payload: {
        code: "E2E_SYN_AUTH",
        name: "Autoridad sintética E2E — sin validez fiscal",
        jurisdictionId: JURISDICTION_ID,
      },
    });
    expect(authorityResponse.statusCode).toBe(201);
    const authority = authorityResponse.json().data;
    expect(authority).toMatchObject({ code: "E2E_SYN_AUTH", jurisdictionId: JURISDICTION_ID });

    const authoritiesReadback = await app.inject({
      method: "GET",
      url: `/api/v1/tax/authorities?jurisdictionId=${JURISDICTION_ID}`,
    });
    expect(authoritiesReadback.statusCode).toBe(200);
    expect(authoritiesReadback.json().data).toHaveLength(1);
    expect(authoritiesReadback.json().data[0]).toMatchObject({
      id: authority.id,
      jurisdiction: { id: JURISDICTION_ID, code: "AR-E2E-SYN" },
    });

    const regimeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tax/regimes",
      payload: {
        code: "E2E_SYN_REGIME",
        name: "Régimen sintético E2E — sin reglas ni alícuotas",
        taxTypeId: TAX_TYPE_ID,
        jurisdictionId: JURISDICTION_ID,
        authorityId: authority.id,
      },
    });
    expect(regimeResponse.statusCode).toBe(201);
    const regime = regimeResponse.json().data;
    expect(regime).toMatchObject({
      code: "E2E_SYN_REGIME",
      taxTypeId: TAX_TYPE_ID,
      jurisdictionId: JURISDICTION_ID,
      authorityId: authority.id,
    });

    const regimesReadback = await app.inject({ method: "GET", url: "/api/v1/tax/regimes" });
    expect(regimesReadback.statusCode).toBe(200);
    expect(regimesReadback.json().data[0]).toMatchObject({
      id: regime.id,
      taxType: { id: TAX_TYPE_ID },
      jurisdiction: { id: JURISDICTION_ID },
      authority: { id: authority.id },
    });

    const obligationResponse = await app.inject({
      method: "POST",
      url: `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/tax-obligations`,
      payload: { profileVersionId: PROFILE_ID, regimeId: regime.id, periodId: PERIOD_ID },
    });
    expect(obligationResponse.statusCode).toBe(201);
    const obligation = obligationResponse.json().data;
    expect(obligation).toMatchObject({
      firmId: FIRM_ID,
      clientId: CLIENT_ID,
      profileVersionId: PROFILE_ID,
      regimeId: regime.id,
      periodId: PERIOD_ID,
      status: "PENDING",
    });

    const obligationsReadback = await app.inject({
      method: "GET",
      url: `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/tax-obligations`,
    });
    expect(obligationsReadback.statusCode).toBe(200);
    expect(obligationsReadback.json().data).toHaveLength(1);
    expect(obligationsReadback.json().data[0].id).toBe(obligation.id);

    expect(mockState.regimes).toHaveLength(1);
    expect(mockState.obligations).toHaveLength(1);
  });

  it("rechaza autoridad inexistente y evita asociar autoridad de otra jurisdicción", async () => {
    const missingAuthority = await app.inject({
      method: "POST",
      url: "/api/v1/tax/regimes",
      payload: {
        code: "E2E_BAD_REGIME",
        name: "Régimen inválido",
        taxTypeId: TAX_TYPE_ID,
        jurisdictionId: JURISDICTION_ID,
        authorityId: "66666666-7777-4888-8999-cccccccccccc",
      },
    });
    expect(missingAuthority.statusCode).toBe(404);
    expect(missingAuthority.json().error.code).toBe("AUTHORITY_NOT_FOUND");

    const otherAuthorityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tax/authorities",
      payload: {
        code: "E2E_OTHER_AUTH",
        name: "Autoridad sintética de otra jurisdicción",
        jurisdictionId: OTHER_JURISDICTION_ID,
      },
    });
    expect(otherAuthorityResponse.statusCode).toBe(201);

    const mismatchedRegime = await app.inject({
      method: "POST",
      url: "/api/v1/tax/regimes",
      payload: {
        code: "E2E_MISMATCH_REGIME",
        name: "Régimen con jurisdicción incompatible",
        taxTypeId: TAX_TYPE_ID,
        jurisdictionId: JURISDICTION_ID,
        authorityId: otherAuthorityResponse.json().data.id,
      },
    });
    expect(mismatchedRegime.statusCode).toBe(409);
    expect(mismatchedRegime.json().error.code).toBe("AUTHORITY_JURISDICTION_MISMATCH");
    expect(mockState.regimes).toHaveLength(0);
  });

  it("edita, duplica, oculta y muestra organismos y regímenes en uso", async () => {
    const authorityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tax/authorities",
      payload: { code: "AUTH-V1", name: "Organismo V1", jurisdictionId: JURISDICTION_ID },
    });
    expect(authorityResponse.statusCode).toBe(201);
    const authority = authorityResponse.json().data;
    const regimeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tax/regimes",
      payload: {
        code: "REGIME-V1",
        name: "Régimen V1",
        taxTypeId: TAX_TYPE_ID,
        jurisdictionId: JURISDICTION_ID,
        authorityId: authority.id,
      },
    });
    expect(regimeResponse.statusCode).toBe(201);
    const regime = regimeResponse.json().data;
    mockState.obligations.push({ id: nextUuid(), regimeId: regime.id });

    const editAuthority = await app.inject({
      method: "PATCH",
      url: `/api/v1/tax/authorities/${authority.id}`,
      payload: { code: "AUTH-V2", name: "Organismo editado" },
    });
    expect(editAuthority.statusCode).toBe(200);
    expect(editAuthority.json().data).toMatchObject({ code: "AUTH-V2", name: "Organismo editado" });
    const hideAuthority = await app.inject({ method: "PATCH", url: `/api/v1/tax/authorities/${authority.id}`, payload: { isActive: false } });
    expect(hideAuthority.statusCode).toBe(200);
    const showAuthority = await app.inject({ method: "PATCH", url: `/api/v1/tax/authorities/${authority.id}`, payload: { isActive: true } });
    expect(showAuthority.statusCode).toBe(200);

    const editRegime = await app.inject({
      method: "PATCH",
      url: `/api/v1/tax/regimes/${regime.id}`,
      payload: { code: "REGIME-V2", name: "Régimen editado" },
    });
    expect(editRegime.statusCode).toBe(200);
    expect(editRegime.json().data).toMatchObject({ code: "REGIME-V2", name: "Régimen editado" });
    const hideRegime = await app.inject({ method: "PATCH", url: `/api/v1/tax/regimes/${regime.id}`, payload: { isActive: false } });
    expect(hideRegime.statusCode).toBe(200);
    const showRegime = await app.inject({ method: "PATCH", url: `/api/v1/tax/regimes/${regime.id}`, payload: { isActive: true } });
    expect(showRegime.statusCode).toBe(200);

    const duplicateAuthority = await app.inject({
      method: "POST",
      url: "/api/v1/tax/authorities",
      payload: { code: "AUTH-COPY", name: "Organismo copiado", jurisdictionId: JURISDICTION_ID, duplicateOfId: authority.id },
    });
    expect(duplicateAuthority.statusCode).toBe(201);
    const duplicateRegime = await app.inject({
      method: "POST",
      url: "/api/v1/tax/regimes",
      payload: {
        code: "REGIME-COPY",
        name: "Régimen copiado",
        taxTypeId: TAX_TYPE_ID,
        jurisdictionId: JURISDICTION_ID,
        authorityId: authority.id,
        duplicateOfId: regime.id,
      },
    });
    expect(duplicateRegime.statusCode).toBe(201);
    expect(mockState.regimes.filter((row) => row.isActive === true)).toHaveLength(2);
    expect(mockState.auditEvents).toHaveLength(10);
    expect(mockState.auditEvents.every((event) => event.userId === mockState.context.userId)).toBe(true);
    expect(mockState.auditEvents.find((event) => event.action === "tax.authority.updated")).toMatchObject({
      before: { code: "AUTH-V1", name: "Organismo V1" },
      after: { code: "AUTH-V2", name: "Organismo editado" },
    });
    expect(mockState.auditEvents.find((event) => event.action === "tax.regime.updated")).toMatchObject({
      before: { code: "REGIME-V1", name: "Régimen V1" },
      after: { code: "REGIME-V2", name: "Régimen editado" },
    });
  });
});
