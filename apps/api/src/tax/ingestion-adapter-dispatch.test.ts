import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKPAPER_SOURCE_POLICIES } from "./workpaper-source-policy.js";

/**
 * Corte 0 (P2/P4): el normalizador y la rama de escritura salen de la política
 * de fuente, no del texto de `adapterVersion`. Un adaptador sin política
 * responde UNKNOWN_ADAPTER (409 en la ruta) sin escribir filas.
 *
 * La transacción se simula en memoria: los normalizadores son los reales de
 * `@contable/tax-engine` y se registra cuál se invocó en cada caso.
 */

const state = vi.hoisted(() => ({
  calls: [] as string[],
  batch: null as Record<string, unknown> | null,
  link: null as { sourceCode: string } | null,
  writes: [] as string[],
  normalized: [] as Record<string, unknown>[],
}));

vi.mock("@contable/tax-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@contable/tax-engine")>();
  return {
    ...actual,
    normalizeArcaVoucherBatch: (
      ...args: Parameters<typeof actual.normalizeArcaVoucherBatch>
    ) => {
      state.calls.push("arca");
      return actual.normalizeArcaVoucherBatch(...args);
    },
    normalizeWithholdingBatch: (
      ...args: Parameters<typeof actual.normalizeWithholdingBatch>
    ) => {
      state.calls.push("withholding");
      return actual.normalizeWithholdingBatch(...args);
    },
    normalizeIibbTucBatch: (
      ...args: Parameters<typeof actual.normalizeIibbTucBatch>
    ) => {
      state.calls.push("iibb");
      return actual.normalizeIibbTucBatch(...args);
    },
    normalizeTemSmtBatch: (
      ...args: Parameters<typeof actual.normalizeTemSmtBatch>
    ) => {
      state.calls.push("tem");
      return actual.normalizeTemSmtBatch(...args);
    },
    normalizeCm03Batch: (
      ...args: Parameters<typeof actual.normalizeCm03Batch>
    ) => {
      state.calls.push("cm03");
      return actual.normalizeCm03Batch(...args);
    },
    normalizeF931Batch: (
      ...args: Parameters<typeof actual.normalizeF931Batch>
    ) => {
      state.calls.push("f931");
      return actual.normalizeF931Batch(...args);
    },
  };
});

vi.mock("../auth/tenant.js", () => {
  const tx = {
    importBatch: {
      findFirst: async () => state.batch,
      update: async () => {
        state.writes.push("importBatch.update");
        return {};
      },
    },
    workpaperImportBatch: {
      findFirst: async () => state.link,
    },
    importRow: {
      create: async (args: { data: { normalized: Record<string, unknown> } }) => {
        state.writes.push("importRow.create");
        state.normalized.push(args.data.normalized);
        return {};
      },
    },
  };
  return {
    withTenantContext: async (
      _ctx: unknown,
      fn: (transaction: unknown) => Promise<unknown>,
    ) => fn(tx),
  };
});

import { ImportError, IngestionService } from "./ingestion-service.js";

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientId: "11111111-2222-4333-8444-999999999999",
  actorKind: "USER" as const,
};

const service = new IngestionService();

type AdapterCase = {
  adapterVersion: string;
  expectedCall: string;
  row: Record<string, unknown>;
  dataKey: string;
};

const ARCA_ROW = {
  direction: "SALE",
  letter: "A",
  pointOfSale: "0001",
  numberFrom: "1",
  cuit: "20111111111",
  issuedOn: "2026-01-10",
  net: "1000.00",
  hasIva: true,
  iva21: "210.00",
};

const WITHHOLDING_ROW = {
  kind: "RETENCION",
  cuitResponsable: "20111111111",
  cuitAgente: "20222222223",
  concept: "IVA",
  base: "1000.00",
  amount: "100.00",
  rate: "10.5",
  issuedOn: "2026-01-10",
  certificateNumber: "0001-000001",
};

const ACTIVITY_ROW = {
  activityCode: "ACT-1",
  description: "Actividad principal",
  income: "5000.00",
  rate: "3.0",
  minimum: "0",
  exemption: "0",
};

const CM03_ROW = {
  activityCode: "ACT-1",
  description: "Actividad principal",
  income: "5000.00",
  jurisdiction: "AR-T",
};

const F931_ROW = {
  cuit: "20111111111",
  remuneration: "1000.00",
  deduction: "100.00",
};

const ADAPTER_CASES: readonly AdapterCase[] = [
  { adapterVersion: "ARCA_LIBRO_IVA_V1", expectedCall: "arca", row: ARCA_ROW, dataKey: "counterpartyCuit" },
  { adapterVersion: "ARCA_RET_V1", expectedCall: "withholding", row: WITHHOLDING_ROW, dataKey: "kind" },
  { adapterVersion: "DGR_IIBB_V1", expectedCall: "iibb", row: ACTIVITY_ROW, dataKey: "income" },
  { adapterVersion: "SMT_TEM_V1", expectedCall: "tem", row: ACTIVITY_ROW, dataKey: "income" },
  { adapterVersion: "CM03_V1", expectedCall: "cm03", row: CM03_ROW, dataKey: "jurisdiction" },
  { adapterVersion: "F931_V1", expectedCall: "f931", row: F931_ROW, dataKey: "netRemuneration" },
];

function rowForAdapter(adapterVersion: string): Record<string, unknown> {
  const found = ADAPTER_CASES.find((item) => item.adapterVersion === adapterVersion);
  if (!found) throw new Error(`sin fila de prueba para ${adapterVersion}`);
  return found.row;
}

function setBatch(overrides: Record<string, unknown> = {}) {
  state.batch = {
    id: "batch-1",
    firmId: ctx.firmId,
    adapterVersion: "ARCA_LIBRO_IVA_V1",
    status: "UPLOADED",
    errorRows: 0,
    period: { startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31") },
    ...overrides,
  };
}

beforeEach(() => {
  state.calls.length = 0;
  state.writes.length = 0;
  state.normalized.length = 0;
  state.link = null;
  setBatch();
});

describe("Corte 0 — despacho del adaptador por política de fuente", () => {
  it.each(ADAPTER_CASES)(
    "$adapterVersion llega a su normalizador",
    async ({ adapterVersion, expectedCall, row, dataKey }) => {
      setBatch({ adapterVersion });

      const result = await service.validateBatch(ctx, "batch-1", [row]);

      expect(state.calls).toEqual([expectedCall]);
      expect(result.totals.validRows).toBe(1);
      expect(result.totals.errorRows).toBe(0);
      const written = state.writes.filter((write) => write === "importRow.create");
      expect(written).toHaveLength(1);
      expect(Object.keys(state.normalized[0] ?? {})).toContain(dataKey);
    },
  );

  it("cada política vigente resuelve su adaptador registrado", async () => {
    for (const policy of WORKPAPER_SOURCE_POLICIES) {
      state.calls.length = 0;
      state.writes.length = 0;
      state.link = { sourceCode: policy.code };
      setBatch({ adapterVersion: policy.adapterVersion });

      const result = await service.validateBatch(ctx, "batch-1", [
        rowForAdapter(policy.adapterVersion),
      ]);

      expect(result.totals.validRows, policy.code).toBe(1);
      expect(state.calls, policy.code).toHaveLength(1);
    }
  });

  it("un lote vinculado a una fuente usa la política, no el texto del adaptador", async () => {
    state.link = { sourceCode: "SIFERE_CM03" };
    setBatch({ adapterVersion: "TEXTO_LIBRE_SIN_POLITICA" });

    const result = await service.validateBatch(ctx, "batch-1", [CM03_ROW]);

    expect(state.calls).toEqual(["cm03"]);
    expect(result.totals.validRows).toBe(1);
  });

  it("un adaptador desconocido responde UNKNOWN_ADAPTER y no escribe filas", async () => {
    setBatch({ adapterVersion: "ADAPTADOR_FANTASMA_V9" });

    const error = await service
      .validateBatch(ctx, "batch-1", [ARCA_ROW])
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code: "UNKNOWN_ADAPTER" });
    const message = (error as ImportError).message;
    expect(message).toContain("ADAPTADOR_FANTASMA_V9");
    expect(message).toContain("ARCA_LIBRO_IVA_V1");
    expect(message).toContain("SMT_TEM_V1");
    expect(state.writes).toEqual([]);
    expect(state.batch?.status).toBe("UPLOADED");
  });

  it("commitBatch rechaza un adaptador desconocido sin escribir", async () => {
    setBatch({
      adapterVersion: "ADAPTADOR_FANTASMA_V9",
      status: "VALIDATED",
      rows: [
        {
          id: "row-1",
          position: 0,
          status: "VALID",
          voucherId: null,
          normalized: ARCA_ROW,
          errors: [],
        },
      ],
    });

    const error = await service
      .commitBatch(ctx, "batch-1", "20999999998")
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code: "UNKNOWN_ADAPTER" });
    expect(state.writes).toEqual([]);
  });
});
