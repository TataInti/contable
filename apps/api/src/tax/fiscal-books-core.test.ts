import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  bookFilename,
  buildBookTable,
  duplicateKey,
  selectBookVouchers,
  summarizeSelection,
  type BookVoucher,
  type SelectionOptions,
} from "./fiscal-books-core.js";

/** Datos sintéticos rotulados (CUIT y montos ficticios). */
const D = (value: string | number) => new Prisma.Decimal(value);

function voucher(overrides: Partial<BookVoucher> & Pick<BookVoucher, "id">): BookVoucher {
  return {
    direction: "PURCHASE",
    status: "APPROVED",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 1,
    issuerCuit: "30111111116",
    receiverCuit: "30222222223",
    issuedOn: new Date("2026-10-05T00:00:00.000Z"),
    accountingOn: null,
    currency: "ARS",
    exchangeRate: null,
    total: D("1210"),
    components: [
      { concept: "NETO", amount: D("1000") },
      { concept: "IVA_21", amount: D("210") },
    ],
    ...overrides,
  };
}

const baseOptions: Omit<SelectionOptions, "kind"> = {
  liveDuplicateCounts: new Map<string, number>(),
  sortBy: "issuedOn",
  sortDir: "asc",
};

describe("libro: selección y exclusiones (P1)", () => {
  it("excluye borradores, revisiones, rechazados y reemplazados, con su motivo", () => {
    const selection = selectBookVouchers(
      [
        voucher({ id: "ok" }),
        voucher({ id: "draft", status: "DRAFT", number: 2 }),
        voucher({ id: "review", status: "IN_REVIEW", number: 3 }),
        voucher({ id: "rejected", status: "REJECTED", number: 4 }),
        voucher({ id: "superseded", status: "SUPERSEDED", number: 5 }),
      ],
      { ...baseOptions, kind: "purchases" },
    );
    expect(selection.included.map((item) => item.voucher.id)).toEqual(["ok"]);
    expect(selection.excluded).toEqual([
      { voucherId: "draft", reason: "DRAFT" },
      { voucherId: "review", reason: "IN_REVIEW" },
      { voucherId: "rejected", reason: "REJECTED" },
      { voucherId: "superseded", reason: "SUPERSEDED" },
    ]);
    const summary = summarizeSelection(selection);
    expect(summary.included.count).toBe(1);
    expect(summary.excludedCount).toBe(4);
    expect(summary.excluded.map((item) => [item.reason, item.count])).toEqual([
      ["DRAFT", 1],
      ["IN_REVIEW", 1],
      ["REJECTED", 1],
      ["SUPERSEDED", 1],
    ]);
  });

  it("separa compras de ventas y no cuenta en un libro lo que es del otro", () => {
    const vouchers = [voucher({ id: "compra" }), voucher({ id: "venta", direction: "SALE", number: 2 })];
    const purchases = selectBookVouchers(vouchers, { ...baseOptions, kind: "purchases" });
    const sales = selectBookVouchers(vouchers, { ...baseOptions, kind: "sales" });
    expect(purchases.included.map((item) => item.voucher.id)).toEqual(["compra"]);
    expect(purchases.excluded).toEqual([]);
    expect(sales.included.map((item) => item.voucher.id)).toEqual(["venta"]);
  });

  it("marca como posible duplicado los aprobados con la misma clave viva (D-008)", () => {
    const first = voucher({ id: "d1", number: 7 });
    const second = voucher({ id: "d2", number: 7 });
    const counts = new Map([[duplicateKey(first), 2]]);
    const selection = selectBookVouchers([first, second, voucher({ id: "unico", number: 8 })], {
      ...baseOptions,
      liveDuplicateCounts: counts,
      kind: "purchases",
    });
    expect(selection.included.map((item) => item.voucher.id)).toEqual(["unico"]);
    expect(selection.excluded).toEqual([
      { voucherId: "d1", reason: "POSSIBLE_DUPLICATE" },
      { voucherId: "d2", reason: "POSSIBLE_DUPLICATE" },
    ]);
  });
});

describe("libro: signo de las notas de crédito y totales", () => {
  it("resta la nota de crédito en todos sus importes y el total queda en cero", () => {
    const nc = voucher({ id: "nc", type: "NC", letter: "NC", number: 2 });
    const selection = selectBookVouchers([voucher({ id: "fac" }), nc], { ...baseOptions, kind: "purchases" });
    const item = selection.included.find((entry) => entry.voucher.id === "nc");
    expect(item?.documentKind).toBe("CREDIT_NOTE");
    expect(item?.amounts.neto?.toFixed()).toBe("-1000");
    expect(item?.amounts.iva21?.toFixed()).toBe("-210");
    expect(item?.amounts.total?.toFixed()).toBe("-1210");
    const totals = summarizeSelection(selection).included.totals;
    expect(totals.neto).toBe("0");
    expect(totals.iva21).toBe("0");
    expect(totals.total).toBe("0");
  });

  it("ordena por total descendente cuando se pide", () => {
    const selection = selectBookVouchers(
      [
        voucher({ id: "c1", number: 1, total: D("100"), components: [{ concept: "NETO", amount: D("100") }] }),
        voucher({ id: "c2", number: 2, total: D("300"), components: [{ concept: "NETO", amount: D("300") }] }),
        voucher({ id: "c3", number: 3, total: D("200"), components: [{ concept: "NETO", amount: D("200") }] }),
      ],
      { ...baseOptions, kind: "purchases", sortBy: "total", sortDir: "desc" },
    );
    expect(selection.included.map((item) => item.voucher.id)).toEqual(["c2", "c3", "c1"]);
  });
});

describe("libro: moneda extranjera (decisión 4)", () => {
  it("convierte a pesos con el tipo de cambio y bloquea los que no lo tienen", () => {
    const usd = voucher({
      id: "usd",
      currency: "USD",
      exchangeRate: D("1000.25"),
      total: D("10.01"),
      components: [{ concept: "NETO", amount: D("10.01") }],
    });
    const sinTipoDeCambio = voucher({ id: "sin-tc", currency: "USD", exchangeRate: null, number: 9 });
    const selection = selectBookVouchers([usd, sinTipoDeCambio], { ...baseOptions, kind: "purchases" });
    expect(selection.excluded).toEqual([{ voucherId: "sin-tc", reason: "MISSING_EXCHANGE_RATE" }]);
    const item = selection.included[0];
    // 10,01 × 1000,25 = 10012,5025 → 10012,50 (redondeo a 2 decimales)
    expect(item?.amounts.neto?.toFixed()).toBe("10012.5");
    expect(item?.amounts.total?.toFixed()).toBe("10012.5");
  });
});

describe("libro: tabla y nombre de archivo", () => {
  it("arma las columnas pedidas en orden, las filas y la fila de totales", () => {
    const selection = selectBookVouchers(
      [
        voucher({ id: "a" }),
        voucher({ id: "b", number: 2, total: D("500"), components: [{ concept: "NETO", amount: D("500") }] }),
      ],
      { ...baseOptions, kind: "purchases" },
    );
    const table = buildBookTable(selection, ["number", "neto", "iva21", "total"]);
    expect(table.columns.map((column) => column.header)).toEqual(["Número", "Neto", "IVA 21 %", "Total"]);
    expect(table.columns.map((column) => column.kind)).toEqual(["integer", "money", "money", "money"]);
    expect(table.rows).toEqual([
      [1, "1000", "210", "1210"],
      [2, "500", null, "500"],
    ]);
    expect(table.totals.label).toBe("Totales (2 comprobantes)");
    expect(table.totals.values).toEqual([null, "1500", "210", "1710"]);
  });

  it("nombra el archivo con el vocabulario del libro", () => {
    expect(bookFilename("purchases", "Cliente Sintético 7A S.A.", "Octubre 2026", "xlsx")).toBe(
      "libro-compras-cliente-sintetico-7a-s-a-octubre-2026.xlsx",
    );
    expect(bookFilename("sales", "ACME", "2026-10", "csv")).toBe("libro-ventas-acme-2026-10.csv");
  });
});
