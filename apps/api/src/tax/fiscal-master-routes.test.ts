import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";

type CatalogRow = Record<string, unknown> & { id: string; code: string; name: string };

const state = vi.hoisted(() => ({
  context: {
    userId: "11111111-1111-4111-8111-111111111111",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "11111111-2222-4333-8444-777777777777",
    actorKind: "USER" as const,
  },
  jurisdictions: [] as CatalogRow[],
  taxTypes: [] as CatalogRow[],
  dependencies: {} as Record<string, number>,
  auditEvents: [] as Array<Record<string, unknown>>,
  idCounter: 0,
}));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => state.context,
  withTenantContext: (_ctx: unknown, operation: (tx: unknown) => Promise<unknown>) =>
    operation(makeTransaction()),
}));

function nextId() {
  return `00000000-0000-4000-8000-${String(++state.idCounter).padStart(12, "0")}`;
}

function duplicateCode(rows: CatalogRow[], code: unknown) {
  if (rows.some((row) => row.code === code)) {
    throw Object.assign(new Error("duplicate code"), { code: "P2002" });
  }
}

function countFor(key: string) {
  return async () => state.dependencies[key] ?? 0;
}

function makeTransaction() {
  return {
    jurisdiction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.jurisdictions.find((row) => row.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = state.jurisdictions.find((item) => item.id === where.id);
        if (!row) throw new Error("jurisdiction not found in mock");
        return row;
      },
      findMany: async () =>
        state.jurisdictions
          .slice()
          .sort((a, b) => String(a.code).localeCompare(String(b.code)))
          .map((row) => ({
            ...row,
            parent: state.jurisdictions.find((parent) => parent.id === row.parentId) ?? null,
          })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        duplicateCode(state.jurisdictions, data.code);
        const row = { id: nextId(), isActive: true, parentId: null, ...data } as unknown as CatalogRow;
        state.jurisdictions.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.jurisdictions.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("jurisdiction not found in mock");
        const updated = { ...state.jurisdictions[index]!, ...data } as CatalogRow;
        state.jurisdictions[index] = updated;
        return updated;
      },
      count: countFor("children"),
    },
    taxType: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.taxTypes.find((row) => row.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = state.taxTypes.find((item) => item.id === where.id);
        if (!row) throw new Error("tax type not found in mock");
        return row;
      },
      findMany: async () => state.taxTypes.slice().sort((a, b) => String(a.code).localeCompare(String(b.code))),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        duplicateCode(state.taxTypes, data.code);
        const row = { id: nextId(), isActive: true, ...data } as unknown as CatalogRow;
        state.taxTypes.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.taxTypes.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("tax type not found in mock");
        const updated = { ...state.taxTypes[index]!, ...data } as CatalogRow;
        state.taxTypes[index] = updated;
        return updated;
      },
      count: countFor("taxType"),
    },
    taxAuthority: { count: countFor("authorities") },
    taxRegime: { count: countFor("regimes") },
    economicActivity: { count: countFor("activities") },
    taxRateRule: { count: countFor("rateRules") },
    taxMinimumRule: { count: countFor("minimumRules") },
    dueDateRule: { count: countFor("dueDateRules") },
    holiday: { count: countFor("holidays") },
    professionalCredential: { count: countFor("credentials") },
    taxSettlement: { count: countFor("settlements") },
    taxCreditLedgerEntry: { count: countFor("creditLedgerEntries") },
    withholdingCertificate: { count: countFor("withholdingCertificates") },
    perceptionCertificate: { count: countFor("perceptionCertificates") },
    taxInputAllocation: { count: countFor("inputAllocations") },
    supplierTaxProfile: { count: countFor("supplierProfiles") },
    taxCreditLot: { count: countFor("creditLots") },
    taxPeriod: { count: countFor("periods") },
    importBatch: { count: countFor("importBatches") },
    importAdapter: { count: countFor("importAdapters") },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `audit-${state.auditEvents.length + 1}`, ...data };
        state.auditEvents.push(event);
        return event;
      },
    },
  };
}

const FIRM_ID = state.context.firmId;
const NATIONAL_ID = "55555555-6666-4777-8888-bbbbbbbbbbbb";
const PROVINCIAL_ID = "66666666-7777-4888-8999-cccccccccccc";

let app: FastifyInstance;

beforeEach(async () => {
  state.jurisdictions.length = 0;
  state.taxTypes.length = 0;
  state.dependencies = {};
  state.auditEvents.length = 0;
  state.idCounter = 0;
  app = Fastify({ logger: false });
  fiscalFoundationRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("catálogos iniciables: jurisdicciones y tipos de impuesto", () => {
  it("crea Nación → Provincia → Municipio y conserva origen y estudio creador", async () => {
    const national = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI", name: "Argentina", kind: "NATIONAL" },
    });
    expect(national.statusCode).toBe(201);
    expect(national.json().data).toMatchObject({ origin: "UI", createdByFirmId: FIRM_ID, parentId: null });

    const provincial = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI-P", name: "Provincia UI", kind: "PROVINCIAL", parentId: national.json().data.id },
    });
    expect(provincial.statusCode).toBe(201);
    expect(provincial.json().data).toMatchObject({ origin: "UI", createdByFirmId: FIRM_ID, parentId: national.json().data.id });

    const municipal = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI-M", name: "Municipio UI", kind: "MUNICIPAL", parentId: provincial.json().data.id },
    });
    expect(municipal.statusCode).toBe(201);
    expect(municipal.json().data).toMatchObject({ origin: "UI", createdByFirmId: FIRM_ID, parentId: provincial.json().data.id });

    const readback = await app.inject({ method: "GET", url: "/api/v1/tax/jurisdictions" });
    expect(readback.json().data.find((row: CatalogRow) => row.id === municipal.json().data.id).parent)
      .toMatchObject({ id: provincial.json().data.id, name: "Provincia UI", kind: "PROVINCIAL" });
  });

  it("rechaza padres ausentes e incompatibles con mensajes explícitos", async () => {
    state.jurisdictions.push(
      { id: NATIONAL_ID, code: "AR-REF", name: "Nación de referencia", kind: "NATIONAL", isActive: true, origin: "REFERENCE", createdByFirmId: null },
      { id: PROVINCIAL_ID, code: "AR-REF-P", name: "Provincia de referencia", kind: "PROVINCIAL", parentId: NATIONAL_ID, isActive: true, origin: "REFERENCE", createdByFirmId: null },
    );
    const missingParent = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI-P", name: "Provincia", kind: "PROVINCIAL" },
    });
    expect(missingParent.statusCode).toBe(409);
    expect(missingParent.json().error).toMatchObject({ code: "JURISDICTION_PARENT_REQUIRED" });

    const nationalWithParent = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI-N", name: "Nación", kind: "NATIONAL", parentId: NATIONAL_ID },
    });
    expect(nationalWithParent.statusCode).toBe(409);
    expect(nationalWithParent.json().error).toMatchObject({ code: "JURISDICTION_PARENT_INVALID" });

    const municipalityWithNational = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-UI-M", name: "Municipio", kind: "MUNICIPAL", parentId: NATIONAL_ID },
    });
    expect(municipalityWithNational.statusCode).toBe(409);
    expect(municipalityWithNational.json().error).toMatchObject({ code: "JURISDICTION_PARENT_INVALID" });
  });

  it("rechaza códigos duplicados y guarda tipos nuevos como UI", async () => {
    const firstJurisdiction = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-DUP", name: "Jurisdicción", kind: "NATIONAL" },
    });
    expect(firstJurisdiction.statusCode).toBe(201);
    const duplicateJurisdiction = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-DUP", name: "Duplicada", kind: "NATIONAL" },
    });
    expect(duplicateJurisdiction.statusCode).toBe(409);
    expect(duplicateJurisdiction.json().error.code).toBe("CATALOG_CODE_CONFLICT");

    const taxType = await app.inject({
      method: "POST",
      url: "/api/v1/tax/types",
      payload: { code: "UI-IVA", name: "Impuesto propio" },
    });
    expect(taxType.statusCode).toBe(201);
    expect(taxType.json().data).toMatchObject({ origin: "UI", createdByFirmId: FIRM_ID });
    const duplicateTaxType = await app.inject({
      method: "POST",
      url: "/api/v1/tax/types",
      payload: { code: "UI-IVA", name: "Duplicado" },
    });
    expect(duplicateTaxType.statusCode).toBe(409);
    expect(duplicateTaxType.json().error.code).toBe("CATALOG_CODE_CONFLICT");
  });

  it("edita, desactiva y reactiva registros UI por PATCH", async () => {
    const jurisdiction = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-EDIT", name: "Nombre anterior", kind: "NATIONAL" },
    });
    const type = await app.inject({
      method: "POST",
      url: "/api/v1/tax/types",
      payload: { code: "TYPE-EDIT", name: "Tipo anterior" },
    });

    const renameJurisdiction = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${jurisdiction.json().data.id}`, payload: { name: "Nombre nuevo" } });
    expect(renameJurisdiction.statusCode).toBe(200);
    expect(renameJurisdiction.json().data.name).toBe("Nombre nuevo");
    const disableJurisdiction = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${jurisdiction.json().data.id}`, payload: { isActive: false } });
    expect(disableJurisdiction.json().data.isActive).toBe(false);
    const enableJurisdiction = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${jurisdiction.json().data.id}`, payload: { isActive: true } });
    expect(enableJurisdiction.json().data.isActive).toBe(true);

    const renameType = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${type.json().data.id}`, payload: { name: "Tipo nuevo" } });
    expect(renameType.statusCode).toBe(200);
    expect(renameType.json().data.name).toBe("Tipo nuevo");
    const disableType = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${type.json().data.id}`, payload: { isActive: false } });
    expect(disableType.json().data.isActive).toBe(false);
    const enableType = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${type.json().data.id}`, payload: { isActive: true } });
    expect(enableType.json().data.isActive).toBe(true);
  });

  it("edita, duplica, oculta y muestra referencias en uso; permite varias activas", async () => {
    state.jurisdictions.push({ id: NATIONAL_ID, code: "AR-REF", name: "Nación", kind: "NATIONAL", isActive: true, origin: "REFERENCE", createdByFirmId: null });
    state.taxTypes.push({ id: PROVINCIAL_ID, code: "TYPE-REF", name: "Tipo", isActive: true, origin: "REFERENCE", createdByFirmId: null });
    state.dependencies.authorities = 1;
    state.dependencies.regimes = 1;

    const jurisdictionEdit = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${NATIONAL_ID}`, payload: { code: "AR-REF-EDIT", name: "Nación editada" } });
    expect(jurisdictionEdit.statusCode).toBe(200);
    expect(jurisdictionEdit.json().data).toMatchObject({ code: "AR-REF-EDIT", name: "Nación editada" });
    const jurisdictionHide = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${NATIONAL_ID}`, payload: { isActive: false } });
    expect(jurisdictionHide.statusCode).toBe(200);
    expect(jurisdictionHide.json().data.isActive).toBe(false);
    const jurisdictionShow = await app.inject({ method: "PATCH", url: `/api/v1/tax/jurisdictions/${NATIONAL_ID}`, payload: { isActive: true } });
    expect(jurisdictionShow.statusCode).toBe(200);
    expect(jurisdictionShow.json().data.isActive).toBe(true);

    const typeEdit = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${PROVINCIAL_ID}`, payload: { code: "TYPE-REF-EDIT", name: "Tipo editado" } });
    expect(typeEdit.statusCode).toBe(200);
    expect(typeEdit.json().data).toMatchObject({ code: "TYPE-REF-EDIT", name: "Tipo editado" });
    const typeHide = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${PROVINCIAL_ID}`, payload: { isActive: false } });
    expect(typeHide.statusCode).toBe(200);
    const typeShow = await app.inject({ method: "PATCH", url: `/api/v1/tax/types/${PROVINCIAL_ID}`, payload: { isActive: true } });
    expect(typeShow.statusCode).toBe(200);
    expect(typeShow.json().data.isActive).toBe(true);

    const jurisdictionDuplicate = await app.inject({
      method: "POST",
      url: "/api/v1/tax/jurisdictions",
      payload: { code: "AR-REF-COPY", name: "Nación copiada", kind: "NATIONAL", duplicateOfId: NATIONAL_ID },
    });
    expect(jurisdictionDuplicate.statusCode).toBe(201);
    expect(state.jurisdictions.filter((row) => row.isActive === true)).toHaveLength(2);
    const typeDuplicate = await app.inject({
      method: "POST",
      url: "/api/v1/tax/types",
      payload: { code: "TYPE-REF-COPY", name: "Tipo copiado", duplicateOfId: PROVINCIAL_ID },
    });
    expect(typeDuplicate.statusCode).toBe(201);
    expect(state.taxTypes.filter((row) => row.isActive === true)).toHaveLength(2);
    expect(state.auditEvents).toHaveLength(8);
    expect(state.auditEvents.every((event) => event.userId === state.context.userId)).toBe(true);
    expect(state.auditEvents[6]).toMatchObject({
      action: "tax.jurisdiction.duplicated",
      before: { code: "AR-REF-EDIT", name: "Nación editada" },
    });
    expect(state.auditEvents[7]).toMatchObject({
      action: "tax.type.duplicated",
      before: { code: "TYPE-REF-EDIT", name: "Tipo editado" },
    });
  });
});
