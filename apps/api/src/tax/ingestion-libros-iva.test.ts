import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSifereTemplate } from "@contable/tax-engine";

/**
 * A27-1 a nivel de servicio: la transacción se simula en memoria (mismo esquema
 * que ingestion-adapter-dispatch.test.ts). El parser, el mapeo CSV y los
 * normalizadores son los reales de @contable/tax-engine. Datos ficticios.
 */

const state = vi.hoisted(() => ({
  batch: null as Record<string, unknown> | null,
  link: null as { sourceCode: string } | null,
  writes: [] as string[],
  rows: [] as Array<{ normalized: Record<string, unknown> | null; status: string; errors: string[] }>,
}));

vi.mock("../auth/tenant.js", () => {
  const tx = {
    importBatch: {
      findFirst: async () => state.batch,
      update: async () => {
        state.writes.push("importBatch.update");
        return {};
      },
      create: async () => {
        state.writes.push("importBatch.create");
        return { id: "batch-1" };
      },
    },
    workpaperImportBatch: {
      findFirst: async () => state.link,
      create: async () => {
        state.writes.push("workpaperImportBatch.create");
        return {};
      },
    },
    importRow: {
      create: async (args: { data: { normalized: unknown; status: string; errors: string[] } }) => {
        state.writes.push("importRow.create");
        const normalized = args.data.normalized;
        state.rows.push({
          normalized: normalized !== null && typeof normalized === "object" && !("_getName" in normalized)
            ? (normalized as Record<string, unknown>)
            : null,
          status: args.data.status,
          errors: args.data.errors,
        });
        return {};
      },
    },
  };
  return {
    withTenantContext: async (_ctx: unknown, fn: (transaction: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { IngestionService } from "./ingestion-service.js";

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientId: "11111111-2222-4333-8444-999999999999",
  actorKind: "USER" as const,
};

const service = new IngestionService();

// Fila tal como llega del CSV o del JSON con encabezados de ARCA: la ruta la pasa sin tipar y el servicio la mapea antes de normalizar.
type FilaDeEntrada = Parameters<IngestionService["validateBatch"]>[2][number];
const comoEntrada = (fila: Record<string, string>) => fila as unknown as FilaDeEntrada;

function loteDeOctubre(sourceCode: string) {
  state.link = { sourceCode };
  state.batch = {
    id: "batch-1",
    firmId: ctx.firmId,
    adapterVersion: "ARCA_LIBRO_IVA_V1",
    status: "UPLOADED",
    errorRows: 0,
    period: { startDate: new Date("2026-10-01"), endDate: new Date("2026-10-31") },
  };
}

const VENTA_ARCA = {
  "Fecha": "04/10/2026",
  "Tipo": "6 - Factura B",
  "Punto de Venta": "3",
  "Número Desde": "461",
  "Número Hasta": "461",
  "Tipo Doc. Receptor": "DNI",
  "Nro. Doc. Receptor": "12345678",
  "Denominación Receptor": "CLIENTE FICTICIO 001",
  "Tipo Cambio": "1",
  "Moneda": "$",
  "Neto Grav. IVA 21%": "1000",
  "IVA 21%": "210",
  "Neto Gravado Total": "1000",
  "Neto No Gravado": "0",
  "Op. Exentas": "0",
  "Otros Tributos": "0",
  "Total IVA": "210",
  "Imp. Total": "1210",
};

const COMPRA_ARCA = {
  "Fecha": "10/10/2026",
  "Tipo": "1 - Factura A",
  "Punto de Venta": "12",
  "Número Desde": "345",
  "Número Hasta": "345",
  "Tipo Doc. Emisor": "CUIT",
  "Nro. Doc. Emisor": "30111111119",
  "Denominación Emisor": "PROVEEDOR FICTICIO 001",
  "Tipo Doc. Receptor": "CUIT",
  "Nro. Doc. Receptor": "30222222223",
  "Tipo Cambio": "1",
  "Moneda": "$",
  "Neto Grav. IVA 10,5%": "2000",
  "IVA 10,5%": "210",
  "Neto Gravado Total": "2000",
  "Neto No Gravado": "0",
  "Op. Exentas": "0",
  "Otros Tributos": "0",
  "Total IVA": "210",
  "Imp. Total": "2210",
};

beforeEach(() => {
  state.writes.length = 0;
  state.rows.length = 0;
  state.link = null;
  state.batch = null;
});

describe("A27-1 — libros IVA de ARCA a nivel de servicio", () => {
  it("un libro de ventas cargado en Compras se rechaza antes de crear el lote: no se escribe nada", async () => {
    await expect(
      service.importSifereWorkbook(ctx, {
        clientId: ctx.clientId,
        clientCuit: "30000000001",
        direction: "PURCHASE",
        raw: buildSifereTemplate("SALE"),
        fileName: "ventas.xlsx",
        fileHash: "sha256:ficticio",
        taxTypeId: "22222222-2222-4222-8222-222222222222",
        periodId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de ventas (hoja «Ventas»). Cargalo en la sección Ventas.",
    });
    expect(state.writes).toEqual([]);
  });

  it("un libro de compras cargado en Ventas se rechaza con el motivo", async () => {
    await expect(
      service.importSifereWorkbook(ctx, {
        clientId: ctx.clientId,
        clientCuit: "30000000001",
        direction: "SALE",
        raw: buildSifereTemplate("PURCHASE"),
        fileName: "compras.xlsx",
        fileHash: "sha256:ficticio",
        taxTypeId: "22222222-2222-4222-8222-222222222222",
        periodId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de compras (hoja «Compras»). Cargalo en la sección Compras.",
    });
    expect(state.writes).toEqual([]);
  });

  it("una venta con encabezados de ARCA en un lote de ventas queda clasificada como venta", async () => {
    loteDeOctubre("ARCA_IVA_SALES");
    const result = await service.validateBatch(ctx, "batch-1", [comoEntrada(VENTA_ARCA)]);
    expect(result.totals.validRows).toBe(1);
    expect(state.rows[0]!.normalized).toMatchObject({ direction: "SALE", letter: "B", counterpartyCuit: "00012345678" });
  });

  it("una compra con encabezados de ARCA en un lote de compras queda como compra y toma la contraparte del emisor", async () => {
    loteDeOctubre("ARCA_IVA_PURCHASES");
    const result = await service.validateBatch(ctx, "batch-1", [comoEntrada(COMPRA_ARCA)]);
    expect(result.totals.validRows).toBe(1);
    expect(state.rows[0]!.normalized).toMatchObject({ direction: "PURCHASE", letter: "A", counterpartyCuit: "30111111119" });
  });

  it("una fila con IVA a 5% queda con error de fila y no se marca como válida", async () => {
    loteDeOctubre("ARCA_IVA_SALES");
    const result = await service.validateBatch(ctx, "batch-1", [comoEntrada({ ...VENTA_ARCA, "IVA 5%": "50", "Neto Grav. IVA 5%": "1000" })]);
    expect(result.totals.errorRows).toBe(1);
    expect(state.rows[0]!.status).toBe("ERROR");
    expect(state.rows[0]!.errors).toContain("ALICUOTA_NO_SOPORTADA");
  });
});

// A27-1 · servicio con los libros de demo (fixtures anonimizados del paquete tax-engine).
describe("A27-1 · importación de libros de ARCA en el servicio", () => {
  const libro = (nombre: string) =>
    new Uint8Array(readFileSync(new URL(`../../../../packages/tax-engine/src/fixtures/arca/${nombre}`, import.meta.url)));
  const entrada = (direction: "SALE" | "PURCHASE", raw: Uint8Array) => ({
    clientId: "cliente-1",
    clientCuit: "20454274831",
    direction,
    raw,
    fileName: "libro.xlsx",
    fileHash: "hash-a27",
    taxTypeId: "iva",
    periodId: "2026-10",
  });

  it("un libro de ventas cargado en Compras se rechaza con SHEET_DIRECTION_MISMATCH y no escribe nada", async () => {
    await expect(
      service.importSifereWorkbook(ctx, entrada("PURCHASE", libro("mis-comprobantes-emitidos.xlsx"))),
    ).rejects.toMatchObject({
      code: "SHEET_DIRECTION_MISMATCH",
      message: expect.stringContaining("Cargalo en la sección Ventas"),
    });
    expect(state.writes).toEqual([]);
  });

  it("un libro cuyo CUIT no es el del cliente se rechaza con CUIT_DISTINTO y no escribe nada", async () => {
    await expect(
      service.importSifereWorkbook(ctx, { ...entrada("SALE", libro("mis-comprobantes-emitidos.xlsx")), clientCuit: "30111111119" }),
    ).rejects.toMatchObject({
      code: "CUIT_DISTINTO",
      message: "Este archivo es del CUIT 20-45427483-1, no del cliente (CUIT 30-11111111-9).",
    });
    expect(state.writes).toEqual([]);
  });

  it("un libro de compras cargado en Ventas se rechaza con SHEET_DIRECTION_MISMATCH y no escribe nada", async () => {
    await expect(
      service.importSifereWorkbook(ctx, entrada("SALE", libro("mis-comprobantes-recibidos.xlsx"))),
    ).rejects.toMatchObject({
      code: "SHEET_DIRECTION_MISMATCH",
      message: expect.stringContaining("Cargalo en la sección Compras"),
    });
    expect(state.writes).toEqual([]);
  });
});
