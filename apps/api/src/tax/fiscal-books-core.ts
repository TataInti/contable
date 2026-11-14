import { Prisma } from "@prisma/client";
import {
  FISCAL_BOOK_COLUMNS,
  FISCAL_BOOK_TITLES,
  type FiscalBookColumnKey,
  type FiscalBookFormat,
  type FiscalBookKind,
  type FiscalBookSortBy,
  type FiscalBookSortDir,
} from "@contable/contracts";
import type { TableCell, TableColumn } from "../reporting/report-export.js";
import { voucherDocumentKind } from "./workpaper-classification.js";

/**
 * Núcleo puro de los libros de compras y ventas (corte 7a): selección, signo,
 * conversión, totales y tabla. No toca la base; el servicio le pasa los datos.
 */

type MoneyColumnKey = "neto" | "iva21" | "iva105" | "iva27" | "exento" | "otrosTributos" | "total";

const MONEY_KEYS: readonly MoneyColumnKey[] = ["neto", "iva21", "iva105", "iva27", "exento", "otrosTributos", "total"];

/** Concepto de FiscalComponent por columna de importe (ingestion-service.ts:717-737). El total sale del comprobante. */
const MONEY_CONCEPT: Record<MoneyColumnKey, string | null> = {
  neto: "NETO",
  iva21: "IVA_21",
  iva105: "IVA_105",
  iva27: "IVA_27",
  exento: "EXENTO",
  otrosTributos: "OTROS_TRIBUTOS",
  total: null,
};

/** decimal.js: ROUND_HALF_UP = 4. */
const ROUND_HALF_UP = 4 as const;

function isMoneyKey(key: FiscalBookColumnKey): key is MoneyColumnKey {
  return (MONEY_KEYS as readonly string[]).includes(key);
}

/** Motivos por los que un comprobante queda fuera del libro. Cada uno tiene su etiqueta visible. */
export const EXCLUSION_LABELS = {
  DRAFT: "Borrador: falta aprobarlo",
  IN_REVIEW: "En revisión: falta aprobarlo",
  REJECTED: "Rechazado",
  SUPERSEDED: "Reemplazado por otra versión",
  POSSIBLE_DUPLICATE: "Posible duplicado: falta resolver la duplicidad",
  MISSING_EXCHANGE_RATE: "Moneda extranjera sin tipo de cambio cargado",
} as const;
export type ExclusionReason = keyof typeof EXCLUSION_LABELS;

export interface BookVoucher {
  id: string;
  direction: "PURCHASE" | "SALE";
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  type: string;
  letter: string | null;
  pointOfSale: number;
  number: number;
  issuerCuit: string;
  receiverCuit: string;
  issuedOn: Date;
  accountingOn: Date | null;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  total: Prisma.Decimal;
  components: ReadonlyArray<{ concept: string; amount: Prisma.Decimal }>;
}

export interface IncludedVoucher {
  voucher: BookVoucher;
  documentKind: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  /** Importes en pesos con su signo; null cuando el comprobante no trae ese concepto. */
  amounts: Record<MoneyColumnKey, Prisma.Decimal | null>;
}

export interface ExcludedVoucher {
  voucherId: string;
  reason: ExclusionReason;
}

export interface BookSelection {
  kind: FiscalBookKind;
  included: IncludedVoucher[];
  excluded: ExcludedVoucher[];
}

export interface SelectionOptions {
  kind: FiscalBookKind;
  /** Comprobantes vivos (no rechazados ni reemplazados) del cliente por clave de duplicado. */
  liveDuplicateCounts: ReadonlyMap<string, number>;
  sortBy: FiscalBookSortBy;
  sortDir: FiscalBookSortDir;
}

/** Clave de posible duplicado (D-008): misma dirección, emisor, tipo, punto de venta y número. */
export function duplicateKey(
  voucher: Pick<BookVoucher, "direction" | "issuerCuit" | "type" | "pointOfSale" | "number">,
): string {
  return [voucher.direction, voucher.issuerCuit, voucher.type, voucher.pointOfSale, voucher.number].join("|");
}

function exclusionReason(voucher: BookVoucher, counts: ReadonlyMap<string, number>): ExclusionReason | null {
  if (voucher.status !== "APPROVED") return voucher.status;
  if ((counts.get(duplicateKey(voucher)) ?? 0) > 1) return "POSSIBLE_DUPLICATE";
  if (voucher.currency !== "ARS" && (voucher.exchangeRate === null || voucher.exchangeRate.lte(0))) {
    return "MISSING_EXCHANGE_RATE";
  }
  return null;
}

function includeVoucher(voucher: BookVoucher): IncludedVoucher {
  const documentKind = voucherDocumentKind({ type: voucher.type, letter: voucher.letter });
  const sign = documentKind === "CREDIT_NOTE" ? -1 : 1;
  // Moneda extranjera: se convierte a pesos con su tipo de cambio y se redondea a 2 decimales.
  const rate = voucher.currency === "ARS" ? null : voucher.exchangeRate;
  const toPesos = (amount: Prisma.Decimal): Prisma.Decimal => {
    const converted = rate ? amount.abs().mul(rate).toDecimalPlaces(2, ROUND_HALF_UP) : amount.abs();
    return sign === -1 && !converted.isZero() ? converted.neg() : converted;
  };
  const amounts = {} as Record<MoneyColumnKey, Prisma.Decimal | null>;
  for (const key of MONEY_KEYS) {
    const concept = MONEY_CONCEPT[key];
    if (concept === null) {
      amounts[key] = toPesos(voucher.total);
      continue;
    }
    const component = voucher.components.find((item) => item.concept === concept);
    amounts[key] = component ? toPesos(component.amount) : null;
  }
  return { voucher, documentKind, amounts };
}

function totalOf(item: IncludedVoucher): Prisma.Decimal {
  return item.amounts.total ?? new Prisma.Decimal(0);
}

function compareIncluded(sortBy: FiscalBookSortBy, sortDir: FiscalBookSortDir) {
  const factor = sortDir === "desc" ? -1 : 1;
  const byDate = (a: IncludedVoucher, b: IncludedVoucher) =>
    a.voucher.issuedOn.getTime() - b.voucher.issuedOn.getTime();
  const byNumber = (a: IncludedVoucher, b: IncludedVoucher) =>
    a.voucher.pointOfSale - b.voucher.pointOfSale || a.voucher.number - b.voucher.number;
  const byTotal = (a: IncludedVoucher, b: IncludedVoucher) => totalOf(a).comparedTo(totalOf(b));
  const byId = (a: IncludedVoucher, b: IncludedVoucher) =>
    a.voucher.id < b.voucher.id ? -1 : a.voucher.id > b.voucher.id ? 1 : 0;
  const primary = sortBy === "total" ? byTotal : sortBy === "number" ? byNumber : byDate;
  const tiebreakers = [byDate, byNumber, byId];
  return (a: IncludedVoucher, b: IncludedVoucher): number => {
    const first = primary(a, b) * factor;
    if (first !== 0) return first;
    for (const tiebreaker of tiebreakers) {
      const diff = tiebreaker(a, b);
      if (diff !== 0) return diff;
    }
    return 0;
  };
}

/** Separa los comprobantes del libro pedido en incluidos (con importes en pesos) y excluidos con su motivo. */
export function selectBookVouchers(vouchers: readonly BookVoucher[], options: SelectionOptions): BookSelection {
  const direction = options.kind === "purchases" ? "PURCHASE" : "SALE";
  const included: IncludedVoucher[] = [];
  const excluded: ExcludedVoucher[] = [];
  for (const voucher of vouchers) {
    if (voucher.direction !== direction) continue;
    const reason = exclusionReason(voucher, options.liveDuplicateCounts);
    if (reason) excluded.push({ voucherId: voucher.id, reason });
    else included.push(includeVoucher(voucher));
  }
  included.sort(compareIncluded(options.sortBy, options.sortDir));
  return { kind: options.kind, included, excluded };
}

export type BookTotals = Record<MoneyColumnKey, string>;

/** Suma exacta (decimal) de cada importe de los comprobantes incluidos. */
export function sumAmounts(included: readonly IncludedVoucher[]): BookTotals {
  const totals = {} as BookTotals;
  for (const key of MONEY_KEYS) {
    totals[key] = included
      .reduce((sum, item) => sum.plus(item.amounts[key] ?? 0), new Prisma.Decimal(0))
      .toFixed();
  }
  return totals;
}

export interface BookSummary {
  title: string;
  included: { count: number; totals: BookTotals };
  excluded: Array<{ reason: ExclusionReason; label: string; count: number }>;
  excludedCount: number;
}

export function summarizeSelection(selection: BookSelection): BookSummary {
  const excluded = (Object.keys(EXCLUSION_LABELS) as ExclusionReason[]).flatMap((reason) => {
    const count = selection.excluded.filter((item) => item.reason === reason).length;
    return count > 0 ? [{ reason, label: EXCLUSION_LABELS[reason], count }] : [];
  });
  return {
    title: FISCAL_BOOK_TITLES[selection.kind],
    included: { count: selection.included.length, totals: sumAmounts(selection.included) },
    excluded,
    excludedCount: selection.excluded.length,
  };
}

function cellValue(item: IncludedVoucher, key: FiscalBookColumnKey): TableCell {
  const { voucher } = item;
  switch (key) {
    case "issuedOn":
      return voucher.issuedOn;
    case "accountingOn":
      return voucher.accountingOn;
    case "type":
      return voucher.type;
    case "letter":
      return voucher.letter;
    case "pointOfSale":
      return voucher.pointOfSale;
    case "number":
      return voucher.number;
    case "issuerCuit":
      return voucher.issuerCuit;
    case "receiverCuit":
      return voucher.receiverCuit;
    case "currency":
      return voucher.currency;
    case "exchangeRate":
      return voucher.currency === "ARS" || !voucher.exchangeRate ? null : voucher.exchangeRate.toFixed();
    default: {
      if (!isMoneyKey(key)) return null;
      const amount = item.amounts[key];
      return amount ? amount.toFixed() : null;
    }
  }
}

export interface BookTable {
  columns: TableColumn[];
  rows: TableCell[][];
  totals: { label: string; values: TableCell[] };
}

/** Tabla del libro con las columnas pedidas, en ese orden, y su fila de totales. */
export function buildBookTable(selection: BookSelection, keys: readonly FiscalBookColumnKey[]): BookTable {
  const catalog = new Map(FISCAL_BOOK_COLUMNS.map((column) => [column.key, column] as const));
  const columns = keys.map((key): TableColumn => {
    const column = catalog.get(key);
    if (!column) throw new Error(`Columna desconocida del libro: ${key}`);
    return { header: column.header, kind: column.kind, width: column.width };
  });
  const rows = selection.included.map((item) => keys.map((key) => cellValue(item, key)));
  const sums = sumAmounts(selection.included);
  const values = keys.map((key): TableCell => (isMoneyKey(key) ? sums[key] : null));
  return {
    columns,
    rows,
    totals: { label: `Totales (${selection.included.length} comprobantes)`, values },
  };
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "sin-nombre";
}

/** libro-compras-<cliente>-<período>.xlsx (o libro-ventas-…), con el vocabulario de P3. */
export function bookFilename(
  kind: FiscalBookKind,
  clientName: string,
  periodLabel: string,
  format: FiscalBookFormat,
): string {
  const base = kind === "purchases" ? "libro-compras" : "libro-ventas";
  return `${base}-${slugify(clientName)}-${slugify(periodLabel)}.${format}`;
}
