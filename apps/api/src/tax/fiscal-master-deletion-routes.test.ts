// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fiscalDeletionRoutes } from "./fiscal-deletion-routes.js";

type CatalogRow = Record<string, unknown> & { id: string; code: string; name: string };

const state = vi.hoisted(() => ({
  context: {
    userId: "11111111-1111-4111-8111-111111111111",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actorKind: "USER" as const,
  },
  jurisdiction: {
    id: "55555555-6666-4777-8888-bbbbbbbbbbbb",
    code: "AR-UI-M",
    name: "Municipio UI",
    kind: "MUNICIPAL",
    origin: "UI",
    createdByFirmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parent: { code: "AR-UI-P", name: "Provincia UI", kind: "PROVINCIAL" },
  } as CatalogRow,
  taxType: {
    id: "66666666-7777-4888-8999-cccccccccccc",
    code: "UI-TAX",
    name: "Impuesto propio",
    origin: "UI",
    createdByFirmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  } as CatalogRow,
  impact: {} as Record<string, number>,
  deleteError: null as Error | null,
  audit: [] as Array<Record<string, unknown>>,
}));

function makeTransaction() {
  return {
    jurisdiction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === state.jurisdiction.id ? state.jurisdiction : null,
    },
    taxType: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === state.taxType.id ? state.taxType : null,
    },
    $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = query.join(" ");
      if (sql.includes("app_tax_master_deletion_preview")) return [{ result: { ...state.impact } }];
      if (sql.includes("app_delete_tax_master_entity")) {
        if (state.deleteError) throw state.deleteError;
        const table = values[0] === "JURISDICTION" ? "jurisdictions" : "tax_types";
        return [{ result: { deletedRows: 1, counts: { [table]: 1 } } }];
      }
      throw new Error("Unexpected raw SQL in fiscal master deletion test");
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.audit.push(data);
        return { id: `audit-${state.audit.length}` };
      },
    },
  };
}

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => state.context,
  withTenantContext: (_ctx: unknown, operation: (tx: unknown) => Promise<unknown>) =>
    operation(makeTransaction()),
}));

let app: FastifyInstance;

beforeEach(async () => {
  state.impact = {};
  state.deleteError = null;
  state.audit.length = 0;
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const typed = error as Error & { statusCode?: number; code?: string };
    return reply.status(typed.statusCode ?? 500).send({
      error: { code: typed.code ?? "INTERNAL_ERROR", message: typed.message },
    });
  });
  fiscalDeletionRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("baja titular de jurisdicciones y tipos de impuesto", () => {
  it("muestra dependencias de jurisdicción y bloquea la baja", async () => {
    state.impact = { tax_authorities: 2, children: 1 };
    state.deleteError = Object.assign(new Error("CATALOG_IN_USE"), { code: "P0001" });

    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/firms/${state.context.firmId}/tax/jurisdictions/${state.jurisdiction.id}/deletion-preview`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toMatchObject({ canDelete: false, totals: { rows: 3 } });
    expect(preview.json().data.items).toEqual(expect.arrayContaining([
      { key: "tax_authorities", label: "Organismos recaudadores", count: 2 },
      { key: "children", label: "Jurisdicciones dependientes", count: 1 },
    ]));

    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/v1/firms/${state.context.firmId}/tax/jurisdictions/${state.jurisdiction.id}`,
      payload: { confirmation: state.jurisdiction.code },
    });
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json().error.code).toBe("CATALOG_IN_USE");
    expect(state.audit).toHaveLength(0);
  });

  it("elimina una jurisdicción UI sin dependencias y registra auditoría", async () => {
    const preview = await app.inject({
      method: "GET",
      url: `/api/v1/firms/${state.context.firmId}/tax/jurisdictions/${state.jurisdiction.id}/deletion-preview`,
    });
    expect(preview.json().data).toMatchObject({ canDelete: true, items: [], confirmation: { expected: state.jurisdiction.code } });

    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/v1/firms/${state.context.firmId}/tax/jurisdictions/${state.jurisdiction.id}`,
      payload: { confirmation: state.jurisdiction.code },
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json().data).toMatchObject({ id: state.jurisdiction.id, deletedRows: 1 });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "tax.catalog.delete", entityType: "Jurisdiction", entityId: state.jurisdiction.id });
  });

  it("bloquea un tipo de impuesto en uso y elimina uno libre", async () => {
    state.impact = { tax_regimes: 1 };
    state.deleteError = Object.assign(new Error("CATALOG_IN_USE"), { code: "P0001" });
    const blockedPreview = await app.inject({
      method: "GET",
      url: `/api/v1/firms/${state.context.firmId}/tax/types/${state.taxType.id}/deletion-preview`,
    });
    expect(blockedPreview.json().data).toMatchObject({ canDelete: false, items: [{ key: "tax_regimes", count: 1 }] });
    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/firms/${state.context.firmId}/tax/types/${state.taxType.id}`,
      payload: { confirmation: state.taxType.code },
    });
    expect(blockedDelete.statusCode).toBe(409);

    state.impact = {};
    state.deleteError = null;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/firms/${state.context.firmId}/tax/types/${state.taxType.id}`,
      payload: { confirmation: state.taxType.code },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({ id: state.taxType.id, deletedRows: 1 });
    expect(state.audit.at(-1)).toMatchObject({ action: "tax.catalog.delete", entityType: "TaxType", entityId: state.taxType.id });
  });
});