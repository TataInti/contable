import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  FiscalError,
  FiscalMasterService,
  TaxpayerProfileService,
  TaxRuleService,
} from "./fiscal-foundation-service.js";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";

type StoredProfile = {
  id: string;
  firmId: string;
  clientId: string;
  version: number;
  legalName: string;
  cuit: string;
  personType: string;
  nationalCondition: string;
  fiscalAddress: string | null;
  fiscalYearEndMonth: number;
  monotributoCategory: string | null;
  validFrom: Date;
  status: string;
  source: string | null;
  createdByUserId: string | null;
  supersedesId: string | null;
  activatedAt: Date | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
};

type TestContext = {
  userId: string;
  firmId: string;
  clientId: string;
  actorKind: "USER";
};

const mockState = vi.hoisted(() => ({
  profiles: [] as StoredProfile[],
  taxTypes: [] as Array<{ id: string }>,
  jurisdictions: [] as Array<{ id: string }>,
  taxAuthorities: [] as Array<{ id: string; jurisdictionId: string }>,
  taxRegimes: [] as Array<Record<string, unknown>>,
  taxRulePacks: [] as Array<{ id: string; regimeCode: string; jurisdictionCode: string }>,
  ruleVersions: [] as Array<{
    id: string;
    packId: string;
    version: number;
    status: string;
    validFrom: Date;
    validTo?: Date;
    engineVersion: string;
    rulesHash: string;
  }>,
  rateRules: [] as Array<Record<string, unknown>>,
  lockQueues: new Map<string, Promise<void>>(),
  context: {
    userId: "11111111-1111-4111-8111-111111111111",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "11111111-2222-4333-8444-777777777777",
    actorKind: "USER" as const,
  },
  idCounter: 0,
  regimeFindUniqueCalls: 0,
  regimeCreateError: null as Error | null,
  withTenantContext: null as unknown as (ctx: TestContext, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
}));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => mockState.context,
  withTenantContext: (ctx: TestContext, fn: (tx: unknown) => Promise<unknown>) =>
    mockState.withTenantContext(ctx, fn),
}));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "11111111-2222-4333-8444-777777777777";
const OTHER_CLIENT_ID = "22222222-3333-4444-8555-888888888888";
const PROFILE_ID = "33333333-4444-4555-8666-999999999999";
const TAX_TYPE_ID = "44444444-5555-4666-8777-aaaaaaaaaaaa";
const JURISDICTION_ID = "55555555-6666-4777-8888-bbbbbbbbbbbb";
const AUTHORITY_ID = "66666666-7777-4888-8999-cccccccccccc";

const ctxOwner: TestContext = {
  userId: OWNER_ID,
  firmId: FIRM_ID,
  clientId: CLIENT_ID,
  actorKind: "USER",
};

const profileInput = {
  clientId: CLIENT_ID,
  legalName: "Cliente de prueba SA",
  cuit: "20111111111",
  personType: "JURIDICA" as const,
  nationalCondition: "RESPONSABLE_INSCRIPTO" as const,
  validFrom: "2026-01-01",
};

async function acquireLock(key: string): Promise<() => void> {
  const previous = mockState.lockQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockState.lockQueues.set(key, previous.then(() => current));
  await previous;
  return release;
}

function matches(profile: StoredProfile, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => profile[key as keyof StoredProfile] === value);
}

function makeTransaction(ctx: TestContext) {
  let releaseLock: (() => void) | undefined;
  const scopeKey = `${ctx.firmId}:${ctx.clientId}`;
  return {
    $queryRaw: async () => {
      releaseLock ??= await acquireLock(scopeKey);
      return [];
    },
    release: () => releaseLock?.(),
    taxpayerProfileVersion: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          mockState.profiles
            .filter((profile) => matches(profile, where))
            .sort((a, b) => b.version - a.version)[0] ?? null
        );
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.profiles.find((profile) => profile.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const duplicate = mockState.profiles.some(
          (profile) => profile.clientId === data.clientId && profile.version === data.version,
        );
        if (duplicate) {
          throw Object.assign(new Error("Unique constraint failed on taxpayer_profile_versions"), {
            code: "P2002",
          });
        }
        const profile = {
          id: `profile-${++mockState.idCounter}`,
          firmId: FIRM_ID,
          clientId: CLIENT_ID,
          version: 1,
          legalName: "",
          cuit: "",
          personType: "JURIDICA",
          nationalCondition: "RESPONSABLE_INSCRIPTO",
          fiscalAddress: null,
          fiscalYearEndMonth: 12,
          monotributoCategory: null,
          validFrom: new Date("2026-01-01"),
          status: "DRAFT",
          source: null,
          createdByUserId: null,
          supersedesId: null,
          activatedAt: null,
          reviewedByUserId: null,
          reviewedAt: null,
          ...data,
        } as StoredProfile;
        mockState.profiles.push(profile);
        return profile;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = mockState.profiles.filter((profile) => matches(profile, where));
        found.forEach((profile) => Object.assign(profile, data));
        return { count: found.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const profile = mockState.profiles.find((item) => item.id === where.id);
        if (!profile) throw new Error("Missing profile in in-memory transaction");
        Object.assign(profile, data);
        return profile;
      },
    },
    taxType: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.taxTypes.find((item) => item.id === where.id) ?? null,
    },
    jurisdiction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.jurisdictions.find((item) => item.id === where.id) ?? null,
    },
    taxAuthority: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        mockState.taxAuthorities.find((item) => item.id === where.id) ?? null,
    },
    taxRulePack: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const pack = mockState.taxRulePacks.find((item) => item.id === where.id);
        return pack
          ? { id: pack.id, regime: { code: pack.regimeCode, jurisdiction: { code: pack.jurisdictionCode } } }
          : null;
      },
    },
    taxRuleVersion: {
      count: async ({ where }: { where: { packId: string } }) =>
        mockState.ruleVersions.filter((version) => version.packId === where.packId).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const version = {
          id: `rule-version-${++mockState.idCounter}`,
          ...data,
        } as unknown as (typeof mockState.ruleVersions)[number];
        mockState.ruleVersions.push(version);
        return version;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const version = mockState.ruleVersions.find((item) => item.id === where.id);
        const pack = version
          ? mockState.taxRulePacks.find((item) => item.id === version.packId)
          : null;
        return version && pack
          ? {
              ...version,
              pack: {
                regime: {
                  code: pack.regimeCode,
                  jurisdiction: { code: pack.jurisdictionCode },
                },
              },
            }
          : null;
      },
    },
    taxRateRule: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const rule = { id: `rate-rule-${mockState.rateRules.length + 1}`, ...data };
        mockState.rateRules.push(rule);
        return rule;
      },
    },
    taxRegime: {
      findUnique: async () => {
        mockState.regimeFindUniqueCalls += 1;
        return null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (mockState.regimeCreateError) throw mockState.regimeCreateError;
        const regime = { id: `regime-${++mockState.idCounter}`, ...data };
        mockState.taxRegimes.push(regime);
        return regime;
      },
    },
  };
}

function seedActiveProfile(overrides: Partial<StoredProfile> = {}) {
  const profile: StoredProfile = {
    id: PROFILE_ID,
    firmId: FIRM_ID,
    clientId: CLIENT_ID,
    version: 1,
    legalName: "Cliente de prueba SA",
    cuit: "20111111111",
    personType: "JURIDICA",
    nationalCondition: "RESPONSABLE_INSCRIPTO",
    fiscalAddress: "Av. Ejemplo 123",
    fiscalYearEndMonth: 6,
    monotributoCategory: null,
    validFrom: new Date("2026-01-01"),
    status: "ACTIVE",
    source: null,
    createdByUserId: OWNER_ID,
    supersedesId: null,
    activatedAt: new Date("2026-01-02"),
    reviewedByUserId: OWNER_ID,
    reviewedAt: new Date("2026-01-02"),
    ...overrides,
  };
  mockState.profiles.push(profile);
  return profile;
}

const profiles = new TaxpayerProfileService();
const masters = new FiscalMasterService();
const rules = new TaxRuleService();

beforeEach(() => {
  mockState.profiles.length = 0;
  mockState.taxTypes.length = 0;
  mockState.jurisdictions.length = 0;
  mockState.taxAuthorities.length = 0;
  mockState.taxRegimes.length = 0;
  mockState.taxRulePacks.length = 0;
  mockState.ruleVersions.length = 0;
  mockState.rateRules.length = 0;
  mockState.lockQueues.clear();
  mockState.idCounter = 0;
  mockState.regimeFindUniqueCalls = 0;
  mockState.regimeCreateError = null;
  mockState.context = ctxOwner;
  mockState.withTenantContext = async (ctx, fn) => {
    const tx = makeTransaction(ctx);
    try {
      return await fn(tx);
    } finally {
      tx.release();
    }
  };
});

describe("fundación fiscal: pruebas aisladas sin PostgreSQL", () => {
  it("rechaza motores desconocidos al crear y configurar reglas antes de escribir", async () => {
    mockState.taxRulePacks.push({ id: "pack-ri", regimeCode: "RI", jurisdictionCode: "AR" });

    await expect(
      rules.createVersion(ctxOwner, {
        packId: "pack-ri",
        validFrom: "2026-01-01",
        engineVersion: "tax-engine-v1",
        rulesHash: "pending",
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_TAX_ENGINE_VERSION",
      message: expect.stringContaining("tax-engine-v1"),
    });
    expect(mockState.ruleVersions).toHaveLength(0);

    mockState.ruleVersions.push({
      id: "bad-draft",
      packId: "pack-ri",
      version: 1,
      status: "DRAFT",
      validFrom: new Date("2026-01-01"),
      engineVersion: "tax-engine-v1",
      rulesHash: "pending",
    });
    await expect(
      rules.addRateRule(ctxOwner, {
        ruleVersionId: "bad-draft",
        concept: "VENTAS",
        rate: "21",
        validFrom: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TAX_ENGINE_VERSION" });
    expect(mockState.rateRules).toHaveLength(0);
  });

  it("conserva IVA legacy al crear una versión compatible", async () => {
    mockState.taxRulePacks.push({ id: "pack-ri", regimeCode: "RI", jurisdictionCode: "AR" });
    const version = await rules.createVersion(ctxOwner, {
      packId: "pack-ri",
      validFrom: "2026-01-01",
      engineVersion: "ar-vat-ri-v1.0.0",
      rulesHash: "legacy-rules",
    });

    expect(version.engineVersion).toBe("ar-vat-ri-v1.0.0");
    expect(version.status).toBe("DRAFT");
  });

  it("crea el perfil inicial como versión 1 DRAFT", async () => {
    const profile = await profiles.createProfile(ctxOwner, profileInput);
    expect(profile).toMatchObject({ version: 1, status: "DRAFT", supersedesId: null });
  });

  it("crea una sucesora sin sustituir el perfil ACTIVE hasta su activación", async () => {
    const active = seedActiveProfile();
    const successor = await profiles.createProfile(ctxOwner, {
      ...profileInput,
      legalName: "Cliente actualizado SA",
    });

    expect(successor).toMatchObject({ version: 2, status: "DRAFT", supersedesId: active.id });
    expect(successor.fiscalAddress).toBe(active.fiscalAddress);
    expect(successor.fiscalYearEndMonth).toBe(active.fiscalYearEndMonth);
    expect(active.status).toBe("ACTIVE");

    await profiles.submitReview(ctxOwner, successor.id);
    expect(active.status).toBe("ACTIVE");

    const activated = await profiles.activate(ctxOwner, successor.id);
    expect(activated.status).toBe("ACTIVE");
    expect(active.status).toBe("SUPERSEDED");
  });

  it("serializa creaciones concurrentes y deja una sola versión en curso", async () => {
    const results = await Promise.allSettled([
      profiles.createProfile(ctxOwner, profileInput),
      profiles.createProfile(ctxOwner, profileInput),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(FiscalError);
      expect(rejected.reason.code).toBe("PROFILE_VERSION_CONFLICT");
    }
    expect(mockState.profiles.map((profile) => profile.version)).toEqual([1]);
  });

  it("el endpoint existente de alta crea la sucesora que usa el onboarding", async () => {
    const active = seedActiveProfile();
    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/tax-profile-versions`,
        payload: {
          legalName: "Cliente actualizado SA",
          cuit: "20111111111",
          personType: "JURIDICA",
          nationalCondition: "RESPONSABLE_INSCRIPTO",
          validFrom: "2026-02-01",
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({ version: 2, status: "DRAFT", supersedesId: active.id });
      expect(active.status).toBe("ACTIVE");
    } finally {
      await app.close();
    }
  });

  it("permite crear sucesora vía ruta y restringe el origen al cliente autenticado", async () => {
    const active = seedActiveProfile();
    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM_ID}/clients/${CLIENT_ID}/tax-profile-versions/${PROFILE_ID}/versions`,
        payload: { reason: "Corrección solicitada", changes: { legalName: "Nombre corregido SA" } },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({
        version: 2,
        status: "DRAFT",
        legalName: "Nombre corregido SA",
        supersedesId: active.id,
      });
      expect(active.status).toBe("ACTIVE");
    } finally {
      await app.close();
    }

    await expect(
      profiles.newVersion(
        { ...ctxOwner, clientId: OTHER_CLIENT_ID },
        { profileVersionId: PROFILE_ID, reason: "No autorizado", changes: { legalName: "Intrusión" } },
      ),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_FOUND" });
  });

  it("valida taxTypeId contra impuestos al crear un régimen", async () => {
    mockState.taxTypes.push({ id: TAX_TYPE_ID });
    mockState.jurisdictions.push({ id: JURISDICTION_ID });
    mockState.taxAuthorities.push({ id: AUTHORITY_ID, jurisdictionId: JURISDICTION_ID });
    const regime = await masters.createRegime(ctxOwner, {
      code: "RI-UNIT",
      name: "Responsable Inscripto",
      taxTypeId: TAX_TYPE_ID,
      jurisdictionId: JURISDICTION_ID,
      authorityId: AUTHORITY_ID,
    });
    expect(regime).toMatchObject({ taxTypeId: TAX_TYPE_ID });
    expect(mockState.regimeFindUniqueCalls).toBe(0);

    await expect(
      masters.createRegime(ctxOwner, {
        code: "RI-MISSING",
        name: "Régimen inválido",
        taxTypeId: "77777777-8888-4999-8000-dddddddddddd",
        jurisdictionId: JURISDICTION_ID,
        authorityId: AUTHORITY_ID,
      }),
    ).rejects.toMatchObject({ code: "TAX_TYPE_NOT_FOUND" });
  });

  it("sanitiza errores Prisma de las rutas fiscales", async () => {
    mockState.taxTypes.push({ id: TAX_TYPE_ID });
    mockState.jurisdictions.push({ id: JURISDICTION_ID });
    mockState.taxAuthorities.push({ id: AUTHORITY_ID, jurisdictionId: JURISDICTION_ID });
    mockState.regimeCreateError = Object.assign(
      new Error("P2002 private_table contable_runtime secret detail"),
      { code: "P2002" },
    );
    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tax/regimes",
        payload: {
          code: "RI-ERROR",
          name: "Régimen",
          taxTypeId: TAX_TYPE_ID,
          jurisdictionId: JURISDICTION_ID,
          authorityId: AUTHORITY_ID,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: {
          code: "CATALOG_CODE_CONFLICT",
          message: "Ya existe un registro con ese código en el catálogo fiscal",
        },
      });
      expect(response.body).not.toContain("P2002");
      expect(response.body).not.toContain("private_table");
      expect(response.body).not.toContain("contable_runtime");
    } finally {
      await app.close();
    }
  });
});
