import { Prisma } from "@prisma/client";
import {
  FISCAL_BOOK_TITLES,
  type FiscalBookColumnKey,
  type FiscalBookFormat,
  type FiscalBookKind,
  type FiscalBookSortBy,
  type FiscalBookSortDir,
} from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { REPORT_CONTENT_TYPES, tableCsv, tableXlsx } from "../reporting/report-export.js";
import {
  bookFilename,
  buildBookTable,
  duplicateKey,
  selectBookVouchers,
  summarizeSelection,
  type BookSummary,
  type BookVoucher,
} from "./fiscal-books-core.js";

export class FiscalBooksError extends Error {
  constructor(
    readonly code: "CLIENT_NOT_FOUND" | "PERIOD_NOT_FOUND",
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "FiscalBooksError";
  }
}

export interface FiscalBookExportInput {
  clientId: string;
  periodId: string;
  book: FiscalBookKind;
  format: FiscalBookFormat;
  columns: readonly FiscalBookColumnKey[];
  sortBy: FiscalBookSortBy;
  sortDir: FiscalBookSortDir;
}

export interface FiscalBooksSummary {
  period: { id: string; label: string | null; startDate: string; endDate: string };
  books: Record<FiscalBookKind, BookSummary>;
}

type Tx = Prisma.TransactionClient;

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Carga el cliente, el período, sus comprobantes (todos los estados, para poder
 * informar exclusiones) y el conteo de comprobantes vivos por clave de duplicado.
 * El periodo filtra por fecha de emisión, como el motor (settlement-service.ts:496).
 */
async function loadBookData(tx: Tx, firmId: string, clientId: string, periodId: string) {
  const client = await tx.client.findFirst({ where: { id: clientId, firmId }, select: { legalName: true } });
  if (!client) throw new FiscalBooksError("CLIENT_NOT_FOUND", "Cliente no encontrado");
  const period = await tx.taxPeriod.findFirst({
    where: { id: periodId, firmId, clientId },
    select: { id: true, label: true, startDate: true, endDate: true },
  });
  if (!period) throw new FiscalBooksError("PERIOD_NOT_FOUND", "Período fiscal no encontrado", "periodId");

  const vouchers: BookVoucher[] = await tx.fiscalVoucher.findMany({
    where: { firmId, clientId, issuedOn: { gte: period.startDate, lte: period.endDate } },
    select: {
      id: true,
      direction: true,
      status: true,
      type: true,
      letter: true,
      pointOfSale: true,
      number: true,
      issuerCuit: true,
      receiverCuit: true,
      issuedOn: true,
      accountingOn: true,
      currency: true,
      exchangeRate: true,
      total: true,
      components: { select: { concept: true, amount: true } },
    },
    orderBy: [{ issuedOn: "asc" }, { pointOfSale: "asc" }, { number: "asc" }, { id: "asc" }],
  });

  const live = await tx.fiscalVoucher.findMany({
    where: { firmId, clientId, status: { notIn: ["REJECTED", "SUPERSEDED"] } },
    select: { direction: true, issuerCuit: true, type: true, pointOfSale: true, number: true },
  });
  const liveDuplicateCounts = new Map<string, number>();
  for (const voucher of live) {
    const key = duplicateKey(voucher);
    liveDuplicateCounts.set(key, (liveDuplicateCounts.get(key) ?? 0) + 1);
  }
  return { clientName: client.legalName, period, vouchers, liveDuplicateCounts };
}

/** Servicio de libros de compras y ventas: resumen por cliente y período, y exportación xlsx o csv. */
export class FiscalBooksService {
  async summary(ctx: TenantContext, input: { clientId: string; periodId: string }): Promise<FiscalBooksSummary> {
    return withTenantContext({ ...ctx, clientId: input.clientId }, async (tx) => {
      const data = await loadBookData(tx, ctx.firmId, input.clientId, input.periodId);
      const options = { liveDuplicateCounts: data.liveDuplicateCounts, sortBy: "issuedOn" as const, sortDir: "asc" as const };
      return {
        period: {
          id: data.period.id,
          label: data.period.label,
          startDate: isoDay(data.period.startDate),
          endDate: isoDay(data.period.endDate),
        },
        books: {
          purchases: summarizeSelection(selectBookVouchers(data.vouchers, { ...options, kind: "purchases" })),
          sales: summarizeSelection(selectBookVouchers(data.vouchers, { ...options, kind: "sales" })),
        },
      };
    });
  }

  async export(
    ctx: TenantContext,
    input: FiscalBookExportInput,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    return withTenantContext({ ...ctx, clientId: input.clientId }, async (tx) => {
      const data = await loadBookData(tx, ctx.firmId, input.clientId, input.periodId);
      const selection = selectBookVouchers(data.vouchers, {
        kind: input.book,
        liveDuplicateCounts: data.liveDuplicateCounts,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
      });
      const table = buildBookTable(selection, input.columns);
      const options = { sheetName: FISCAL_BOOK_TITLES[input.book], totals: table.totals };
      const body =
        input.format === "csv"
          ? tableCsv(table.columns, table.rows, options)
          : tableXlsx(table.columns, table.rows, options);
      const periodLabel = data.period.label ?? isoDay(data.period.startDate).slice(0, 7);
      return {
        body,
        contentType: REPORT_CONTENT_TYPES[input.format],
        filename: bookFilename(input.book, data.clientName, periodLabel, input.format),
      };
    });
  }
}
