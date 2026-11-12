import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  FiscalError,
  FiscalMasterService,
  TaxpayerProfileService,
  TaxRuleService,
} from "./fiscal-foundation-service.js";
import { createRulePackVersionSchema, fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";
import { computeLegacyRulesHashSchemaV1, computeRulesHashV2, computeRulesHashV3 } from "./rules-hash.js";

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
  taxTypes: [] as Array<{ id: string; defaultFamilyId?: string | null }>,
  calcFamilies: [] as Array<{
    id: string;
    key: string;
    isActive: boolean;
    sortOrder: number;
    allowedRuleKinds?: Array<{ kindId: string }>;
  }>,
  taxEngines: [] as Array<{
    id: string;
    engineKey: string;
    engineVersion: string;
    familyId: string;
    label: string;
    isActive: boolean;
    sortOrder: number;
  }>,
  jurisdictions: [] as Array<{ id: string }>,
  taxAuthorities: [] as Array<{ id: string; jurisdictionId: string }>,
  taxRegimes: [] as Array<Record<string, unknown>>,
  taxRulePacks: [] as Array<{
    id: string;
    regimeCode: string;
    taxTypeCode: string;
    jurisdictionCode: string;
    calcFamilyId?: string | null;
  }>,
  ruleVersions: [] as Array<{
    id: string;
    packId: string;
    version: number;
    status: string;
    validFrom: Date;
    validTo?: Date | null;
    engineVersion: string;
    engineId?: string | null;
    rulesHash: string;
    rulesHashSchemaVersion?: number;
    activatedByUserId?: string | null;
    activatedAt?: Date | null;
  }>,
  rateRules: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
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
const VAT_FAMILY_ID = "f1000000-0000-4000-8000-000000000001";
const IIBB_FAMILY_ID = "f1000000-0000-4000-8000-000000000002";
const VAT_ENGINE_ID = "e1000000-0000-4000-8000-000000000001";
const IIBB_ENGINE_ID = "e1000000-0000-4000-8000-000000000003";
const EMPTY_FAMILY_REGIME_ID = "77777777-8888-4999-8000-dddddddddddd";

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

function seedActivatableRuleVersion(options: {
  status?: string;
  engineVersion?: string;
  validFrom?: Date;
  validTo?: Date | null;
  rulesHash?: string;
  empty?: boolean;
} = {}) {
  const packId = "pack-ri-activation";
  const versionId = `version-${mockState.ruleVersions.length + 1}`;
  if (!mockState.taxRulePacks.some((pack: (typeof mockState.taxRulePacks)[number]) => pack.id === packId)) {
    mockState.taxRulePacks.push({
      id: packId,
      regimeCode: "RI",
      taxTypeCode: "IVA",
      jurisdictionCode: "AR",
    });
  }
  const engineVersion = options.engineVersion ?? "ar-vat-ri-v2.1.0";
  const validFrom = options.validFrom ?? new Date("2026-01-01T00:00:00.000Z");
  const rateRules = options.empty
    ? []
    : [{
        ruleVersionId: versionId,
        concept: "VENTAS",
        activityCode: null,
        jurisdictionId: null,
        rate: "21.000000",
        minAmount: null,
        validFrom,
        validTo: null,
      }];
  mockState.rateRules.push(...rateRules);
  const version = {
    id: versionId,
    packId,
    version: 1,
    status: options.status ?? "DRAFT",
    validFrom,
    validTo: options.validTo ?? null,
    engineVersion,
    rulesHash: options.rulesHash ?? computeRulesHashV2({ engineVersion, rateRules }),
    rulesHashSchemaVersion: 2,
  };
  mockState.ruleVersions.push(version);
  return version;
}

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
    calcFamily: {
      findFirst: async ({ where }: { where: { id: string; isActive?: boolean } }) =>
        mockState.calcFamilies.find((item) => item.id === where.id &&
          (where.isActive === undefined || item.isActive === where.isActive)) ?? null,
      findMany: async ({ where }: { where?: { isActive?: boolean } } = {}) =>
        mockState.calcFamilies.filter((item) => where?.isActive === undefined || item.isActive === where.isActive),
    },
    taxEngine: {
      findFirst: async ({ where }: { where: { id: string; isActive?: boolean } }) =>
        mockState.taxEngines.find((item) => item.id === where.id &&
          (where.isActive === undefined || item.isActive === where.isActive)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.taxEngines
          .filter((item) => Object.entries(where).every(([key, value]) => item[key as keyof typeof item] === value))
          .map((item) => ({
            ...item,
            family: { key: mockState.calcFamilies.find((family) => family.id === item.familyId)?.key ?? "" },
          })),
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
          ? {
              id: pack.id,
              regime: {
                code: pack.regimeCode,
                calcFamilyId: pack.calcFamilyId ?? null,
                calcFamily: pack.calcFamilyId
                  ? {
                      key: mockState.calcFamilies.find((family) => family.id === pack.calcFamilyId)?.key ?? "",
                      allowedRuleKinds: mockState.calcFamilies.find((family) => family.id === pack.calcFamilyId)?.allowedRuleKinds ?? [],
                    }
                  : null,
                taxType: { code: pack.taxTypeCode },
                jurisdiction: { code: pack.jurisdictionCode },
              },
            }
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
              rateRules: mockState.rateRules
                .filter((rule: Record<string, unknown>) => rule.ruleVersionId === version.id)
                .map((rule: Record<string, unknown>) => ({ ...rule, kind: rule.kind ?? null })),
              minimumRules: [],
              bracketRules: [],
              dueDateRules: [],
              roundingRules: [],
              pack: {
                regime: {
                  code: pack.regimeCode,
                  calcFamilyId: pack.calcFamilyId ?? null,
                  calcFamily: pack.calcFamilyId
                    ? {
                        key: mockState.calcFamilies.find((family) => family.id === pack.calcFamilyId)?.key ?? "",
                        allowedRuleKinds: mockState.calcFamilies.find((family) => family.id === pack.calcFamilyId)?.allowedRuleKinds ?? [],
                      }
                    : null,
                  taxType: { code: pack.taxTypeCode },
                  jurisdiction: { code: pack.jurisdictionCode },
                },
              },
            }
          : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = mockState.ruleVersions.filter((version: (typeof mockState.ruleVersions)[number]) =>
          Object.entries(where).every(([key, value]) => version[key as keyof typeof version] === value),
        );
        rows.forEach((version: (typeof mockState.ruleVersions)[number]) => Object.assign(version, data));
        return { count: rows.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const version = mockState.ruleVersions.find((item: (typeof mockState.ruleVersions)[number]) => item.id === where.id);
        if (!version) throw new Error("Missing rule version in in-memory transaction");
        Object.assign(version, data);
        return version;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        mockState.ruleVersions.filter((version: (typeof mockState.ruleVersions)[number]) =>
          Object.entries(where).every(([key, value]) => version[key as keyof typeof version] === value),
        ),
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `audit-${mockState.auditEvents.length + 1}`, ...data };
        mockState.auditEvents.push(event);
        return event;
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
      findUnique: async ({ where }: { where: { id: string } }) => {
        mockState.regimeFindUniqueCalls += 1;
        return mockState.taxRegimes.find((regime) => regime.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (mockState.regimeCreateError) throw mockState.regimeCreateError;
        const regime = { id: `regime-${++mockState.idCounter}`, ...data };
        mockState.taxRegimes.push(regime);
        return regime;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const regime = mockState.taxRegimes.find((item) => item.id === where.id);
        if (!regime) throw new Error("Missing regime in in-memory transaction");
        Object.assign(regime, data);
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
  mockState.calcFamilies.length = 0;
  mockState.taxEngines.length = 0;
  mockState.jurisdictions.length = 0;
  mockState.taxAuthorities.length = 0;
  mockState.taxRegimes.length = 0;
  mockState.taxRulePacks.length = 0;
  mockState.ruleVersions.length = 0;
  mockState.rateRules.length = 0;
  mockState.auditEvents.length = 0;
  mockState.lockQueues.clear();
  mockState.idCounter = 0;
  mockState.regimeFindUniqueCalls = 0;
  mockState.regimeCreateError = null;
  mockState.calcFamilies.push(
    { id: VAT_FAMILY_ID, key: "VAT_RI", isActive: true, sortOrder: 10 },
    { id: IIBB_FAMILY_ID, key: "IIBB_LOCAL", isActive: true, sortOrder: 20 },
  );
  mockState.taxEngines.push(
    {
      id: VAT_ENGINE_ID,
      engineKey: "vat-ri",
      engineVersion: "ar-vat-ri-v2.1.0",
      familyId: VAT_FAMILY_ID,
      label: "IVA RI por alícuota",
      isActive: true,
      sortOrder: 10,
    },
    {
      id: "e1000000-0000-4000-8000-000000000002",
      engineKey: "vat-ri-legacy",
      engineVersion: "ar-vat-ri-v1.0.0",
      familyId: VAT_FAMILY_ID,
      label: "IVA RI legacy",
      isActive: true,
      sortOrder: 20,
    },
    {
      id: IIBB_ENGINE_ID,
      engineKey: "iibb-local-tuc",
      engineVersion: "ar-iibb-tuc-local-v1.1.0",
      familyId: IIBB_FAMILY_ID,
      label: "IIBB local Tucumán",
      isActive: true,
      sortOrder: 10,
    },
    {
      id: "e1000000-0000-4000-8000-000000000004",
      engineKey: "iibb-local-tuc-legacy",
      engineVersion: "ar-iibb-tuc-local-v1.0.0",
      familyId: IIBB_FAMILY_ID,
      label: "IIBB local Tucumán legacy",
      isActive: true,
      sortOrder: 20,
    },
  );
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
  it("activa un borrador sin matrícula y registra actor, fecha y auditoría", async () => {
    const version = seedActivatableRuleVersion();

    const activated = await rules.activate(ctxOwner, version.id);

    expect(activated).toMatchObject({
      id: version.id,
      status: "ACTIVE",
      activatedByUserId: OWNER_ID,
      activatedAt: expect.any(Date),
    });
    expect(mockState.auditEvents).toHaveLength(1);
    expect(mockState.auditEvents[0]).toMatchObject({
      firmId: FIRM_ID,
      userId: OWNER_ID,
      action: "tax_rule_version.activated",
      entityType: "TaxRuleVersion",
      entityId: version.id,
    });
  });

  it.each(["IN_REVIEW", "APPROVED"])("activa directamente una versión histórica %s", async (status: string) => {
    const version = seedActivatableRuleVersion({ status });

    await expect(rules.activate(ctxOwner, version.id)).resolves.toMatchObject({
      status: "ACTIVE",
      activatedByUserId: OWNER_ID,
    });
  });

  it("activa una versión histórica con hash legacy v1 sin reescribirlo", async () => {
    const version = seedActivatableRuleVersion({ status: "IN_REVIEW" });
    const rateRules = mockState.rateRules.filter(
      (rule: Record<string, unknown>) => rule.ruleVersionId === version.id,
    );
    version.rulesHashSchemaVersion = 1;
    version.rulesHash = computeLegacyRulesHashSchemaV1({
      rateRules: rateRules as Array<{
        concept: string;
        activityCode: string | null;
        jurisdictionId: string | null;
        rate: string | null;
        minAmount: string | null;
      }>,
      minimumRules: [],
      bracketRules: [],
      dueDateRules: [],
    });

    const activated = await rules.activate(ctxOwner, version.id);

    expect(activated).toMatchObject({ status: "ACTIVE", rulesHashSchemaVersion: 1 });
  });

  it("activa reglas IIBB tipadas con el hash canónico v3", async () => {
    const version = seedActivatableRuleVersion({ engineVersion: "ar-iibb-tuc-local-v1.1.0" });
    const pack = mockState.taxRulePacks.find((item) => item.id === version.packId)!;
    Object.assign(pack, {
      regimeCode: "IIBB_LOCAL_TUC",
      taxTypeCode: "IIBB",
      jurisdictionCode: "AR-T",
      calcFamilyId: IIBB_FAMILY_ID,
    });
    const kindId = "kind-rate";
    mockState.calcFamilies.find((family) => family.id === IIBB_FAMILY_ID)!.allowedRuleKinds = [
      { kindId },
    ];
    const rule = mockState.rateRules.find((item) => item.ruleVersionId === version.id)!;
    Object.assign(rule, {
      kindId,
      kind: { key: "RATE" },
      activityId: "activity-1",
      categoryCode: null,
      isDefault: false,
    });
    version.rulesHashSchemaVersion = 3;
    version.rulesHash = computeRulesHashV3({
      engineVersion: version.engineVersion,
      rateRules: [{
        concept: "VENTAS",
        activityCode: null,
        jurisdictionId: null,
        kind: { key: "RATE" },
        activityId: "activity-1",
        categoryCode: null,
        isDefault: false,
        rate: "21.000000",
        minAmount: null,
        validFrom: version.validFrom,
        validTo: null,
      }],
      minimumRules: [],
      bracketRules: [],
      dueDateRules: [],
      roundingRules: [],
    });

    const activated = await rules.activate(ctxOwner, version.id);

    expect(activated).toMatchObject({ status: "ACTIVE", rulesHashSchemaVersion: 3 });

    const unresolved = seedActivatableRuleVersion({ engineVersion: "ar-iibb-tuc-local-v1.1.0" });
    const unresolvedRule = mockState.rateRules.find(
      (rule: Record<string, unknown>) => rule.ruleVersionId === unresolved.id,
    )!;
    Object.assign(unresolvedRule, {
      kindId,
      kind: { key: "RATE" },
      activityId: null,
      categoryCode: null,
      isDefault: false,
    });
    unresolved.rulesHashSchemaVersion = 3;
    unresolved.rulesHash = computeRulesHashV3({
      engineVersion: unresolved.engineVersion,
      rateRules: [{
        concept: "VENTAS",
        activityCode: null,
        jurisdictionId: null,
        kind: { key: "RATE" },
        activityId: null,
        categoryCode: null,
        isDefault: false,
        rate: "21.000000",
        minAmount: null,
        validFrom: unresolved.validFrom,
        validTo: null,
      }],
      minimumRules: [],
      bracketRules: [],
      dueDateRules: [],
      roundingRules: [],
    });
    await expect(rules.activate(ctxOwner, unresolved.id)).rejects.toMatchObject({
      code: "RULE_VERSION_INVALID",
      message: expect.stringContaining("sujeto requerido"),
    });
  });

  it("rechaza hash inconsistente, vigencia inválida, versión vacía y motor incompatible", async () => {
    const badHash = seedActivatableRuleVersion({ rulesHash: "hash-incorrecto" });
    await expect(rules.activate(ctxOwner, badHash.id)).rejects.toMatchObject({
      code: "RULES_HASH_MISMATCH",
      message: expect.stringContaining("hash no coincide"),
    });

    const badValidity = seedActivatableRuleVersion({
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: new Date("2026-07-31T00:00:00.000Z"),
    });
    await expect(rules.activate(ctxOwner, badValidity.id)).rejects.toMatchObject({
      code: "RULE_VERSION_INVALID",
      message: expect.stringContaining("vigencia inválidos"),
    });

    const empty = seedActivatableRuleVersion({ empty: true });
    await expect(rules.activate(ctxOwner, empty.id)).rejects.toMatchObject({
      code: "RULE_VERSION_EMPTY",
      message: expect.stringContaining("no contiene reglas"),
    });

    const incompatible = seedActivatableRuleVersion({ engineVersion: "tax-engine-v1" });
    await expect(rules.activate(ctxOwner, incompatible.id)).rejects.toMatchObject({
      code: "UNSUPPORTED_TAX_ENGINE_VERSION",
      message: expect.stringContaining("tax-engine-v1"),
    });
    expect(mockState.ruleVersions.map((item: (typeof mockState.ruleVersions)[number]) => item.status)).toEqual([
      "DRAFT",
      "DRAFT",
      "DRAFT",
      "DRAFT",
    ]);
  });

  it("mantiene inmutable una versión activa", async () => {
    const version = seedActivatableRuleVersion();
    await rules.activate(ctxOwner, version.id);

    await expect(
      rules.addRateRule(ctxOwner, {
        ruleVersionId: version.id,
        concept: "COMPRAS",
        rate: "10.5",
        validFrom: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "RULE_VERSION_IMMUTABLE" });
  });

  it("valida el schema de creación de versión y devuelve los campos con error", async () => {
    mockState.taxRulePacks.push({
      id: "pack-ri",
      regimeCode: "RI",
      taxTypeCode: "IVA",
      jurisdictionCode: "AR",
    });
    expect(createRulePackVersionSchema.safeParse({
      validFrom: "2026-10-01",
      engineVersion: "ar-vat-ri-v1.0.0",
      rulesHash: "PENDING_DRAFT",
    }).success).toBe(true);
    const futureValidFrom = createRulePackVersionSchema.safeParse({
      validFrom: "2101-01-01",
      engineVersion: "ar-vat-ri-v1.0.0",
      rulesHash: "PENDING_DRAFT",
    });
    expect(futureValidFrom.success).toBe(false);
    if (!futureValidFrom.success) {
      expect(futureValidFrom.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["validFrom"],
          message: "El año de vigencia debe estar entre 1900 y 2100.",
        }),
      ]));
    }
    const futureValidTo = createRulePackVersionSchema.safeParse({
      validFrom: "2026-10-01",
      validTo: "2101-01-01",
      engineVersion: "ar-vat-ri-v1.0.0",
      rulesHash: "PENDING_DRAFT",
    });
    expect(futureValidTo.success).toBe(false);
    if (!futureValidTo.success) {
      expect(futureValidTo.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["validTo"],
          message: "El año de vigencia debe estar entre 1900 y 2100.",
        }),
      ]));
    }

    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const valid = await app.inject({
        method: "POST",
        url: "/api/v1/tax/rule-packs/pack-ri/versions",
        payload: {
          validFrom: "2026-10-01",
          engineVersion: "ar-vat-ri-v1.0.0",
          rulesHash: "PENDING_DRAFT",
        },
      });
      expect(valid.statusCode).toBe(201);

      const invalidDate = await app.inject({
        method: "POST",
        url: "/api/v1/tax/rule-packs/pack-ri/versions",
        payload: {
          validFrom: "61001-02-02",
          engineVersion: "ar-vat-ri-v1.0.0",
          rulesHash: "PENDING_DRAFT",
        },
      });
      expect(invalidDate.statusCode).toBe(400);
      expect(invalidDate.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: expect.arrayContaining([expect.objectContaining({ path: ["validFrom"] })]),
        },
      });

      const missingEngine = await app.inject({
        method: "POST",
        url: "/api/v1/tax/rule-packs/pack-ri/versions",
        payload: { validFrom: "2026-10-01", rulesHash: "PENDING_DRAFT" },
      });
      expect(missingEngine.statusCode).toBe(400);
      expect(missingEngine.json()).toMatchObject({
        error: {
          details: expect.arrayContaining([expect.objectContaining({ path: ["engineId"] })]),
        },
      });

      const invertedRange = await app.inject({
        method: "POST",
        url: "/api/v1/tax/rule-packs/pack-ri/versions",
        payload: {
          validFrom: "2026-10-01",
          validTo: "2026-09-30",
          engineVersion: "ar-vat-ri-v1.0.0",
          rulesHash: "PENDING_DRAFT",
        },
      });
      expect(invertedRange.statusCode).toBe(400);
      expect(invertedRange.json()).toMatchObject({
        error: {
          details: expect.arrayContaining([
            expect.objectContaining({
              path: ["validTo"],
              message: "La vigencia hasta debe ser igual o posterior a la vigencia desde.",
            }),
          ]),
        },
      });
    } finally {
      await app.close();
    }
  });

  it("expone un error claro del hash al intentar activar por API", async () => {
    const version = seedActivatableRuleVersion({ rulesHash: "hash-incorrecto" });
    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/tax/rule-versions/${version.id}/activate`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: "RULES_HASH_MISMATCH",
          message: expect.stringContaining("hash no coincide"),
        },
      });
    } finally {
      await app.close();
    }
  });

  it("rechaza motores desconocidos al crear y configurar reglas antes de escribir", async () => {
    mockState.taxRulePacks.push({
      id: "pack-ri",
      regimeCode: "RI",
      taxTypeCode: "IVA",
      jurisdictionCode: "AR",
    });

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
    mockState.taxRulePacks.push({
      id: "pack-ri",
      regimeCode: "RI",
      taxTypeCode: "IVA",
      jurisdictionCode: "AR",
    });
    const version = await rules.createVersion(ctxOwner, {
      packId: "pack-ri",
      validFrom: "2026-01-01",
      engineVersion: "ar-vat-ri-v1.0.0",
      rulesHash: "legacy-rules",
    });

    expect(version.engineVersion).toBe("ar-vat-ri-v1.0.0");
    expect(version.status).toBe("DRAFT");
  });

  it("acepta un régimen con código propio del estudio según su impuesto", async () => {
    mockState.taxRulePacks.push({
      id: "pack-propio",
      regimeCode: "RI_ESTUDIO_2026",
      taxTypeCode: "IVA",
      jurisdictionCode: "AR",
    });

    const version = await rules.createVersion(ctxOwner, {
      packId: "pack-propio",
      validFrom: "2026-01-01",
      engineVersion: "ar-vat-ri-v2.1.0",
      rulesHash: "reglas-propias",
    });

    expect(version.engineVersion).toBe("ar-vat-ri-v2.1.0");
    expect(mockState.ruleVersions).toHaveLength(1);
  });

  it("rechaza motores de otra familia y códigos de régimen engañosos", async () => {
    mockState.taxRulePacks.push({
      id: "pack-iibb",
      regimeCode: "RI-FALSO",
      taxTypeCode: "IIBB",
      jurisdictionCode: "AR-T",
    });

    await expect(
      rules.createVersion(ctxOwner, {
        packId: "pack-iibb",
        validFrom: "2026-01-01",
        engineVersion: "ar-iibb-cm-art2-v1.1.0",
        rulesHash: "cruzado",
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_TAX_ENGINE_VERSION",
      message: expect.stringContaining("ar-iibb-cm-art2-v1.1.0"),
    });
    await expect(
      rules.createVersion(ctxOwner, {
        packId: "pack-iibb",
        validFrom: "2026-01-01",
        engineVersion: "ar-vat-ri-v2.1.0",
        rulesHash: "cruzado",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TAX_ENGINE_VERSION" });
    expect(mockState.ruleVersions).toHaveLength(0);
  });

  it("filtra motores por la familia elegida aunque el régimen use un código propio", async () => {
    mockState.taxRegimes.push({ id: EMPTY_FAMILY_REGIME_ID, calcFamilyId: IIBB_FAMILY_ID });
    const engines = await masters.listEnginesForRegime(ctxOwner, EMPTY_FAMILY_REGIME_ID);

    expect(engines.map((engine) => engine.engineVersion)).toEqual([
      "ar-iibb-tuc-local-v1.1.0",
      "ar-iibb-tuc-local-v1.0.0",
    ]);
    expect(engines.every((engine) => engine.familyKey === "IIBB_LOCAL")).toBe(true);
  });

  it("guía a elegir familia cuando el régimen no tiene una", async () => {
    mockState.taxRegimes.push({ id: EMPTY_FAMILY_REGIME_ID, calcFamilyId: null });
    const app = Fastify({ logger: false });
    fiscalFoundationRoutes(app);
    await app.ready();
    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tax/regimes/${EMPTY_FAMILY_REGIME_ID}/engines`,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "REGIME_FAMILY_REQUIRED",
          message: "Elegí la familia de cálculo del régimen",
          details: { path: ["calcFamilyId"] },
        },
      });
    } finally {
      await app.close();
    }
  });

  it("guarda el motor por id y rechaza un id de otra familia", async () => {
    mockState.taxRulePacks.push({
      id: "pack-iibb-propio",
      regimeCode: "MI_IIBB_PROPIO",
      taxTypeCode: "CODIGO_LIBRE",
      jurisdictionCode: "AR-X",
      calcFamilyId: IIBB_FAMILY_ID,
    });

    await expect(rules.createVersion(ctxOwner, {
      packId: "pack-iibb-propio",
      validFrom: "2026-01-01",
      engineId: VAT_ENGINE_ID,
      rulesHash: "ignored-caller-value",
    })).rejects.toMatchObject({ code: "ENGINE_FAMILY_MISMATCH", path: ["engineId"] });
    expect(mockState.ruleVersions).toHaveLength(0);

    const version = await rules.createVersion(ctxOwner, {
      packId: "pack-iibb-propio",
      validFrom: "2026-01-01",
      engineId: IIBB_ENGINE_ID,
      engineVersion: "texto-no-autoritativo",
      rulesHash: "ignored-caller-value",
    });
    expect(version).toMatchObject({
      engineId: IIBB_ENGINE_ID,
      engineVersion: "ar-iibb-tuc-local-v1.1.0",
      status: "DRAFT",
    });
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
