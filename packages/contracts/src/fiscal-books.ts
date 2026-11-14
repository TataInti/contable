import { z } from "zod";

/**
 * Libros de compras y ventas (corte 7a). Contrato compartido por la API y, en un
 * corte posterior, por la pantalla del legajo. La lista de columnas es cerrada en
 * esta versión: el orden de FISCAL_BOOK_COLUMNS es el orden del libro y de sus
 * encabezados (P3: un solo nombre por concepto).
 */

export const FISCAL_BOOK_KINDS = ["purchases", "sales"] as const;
export type FiscalBookKind = (typeof FISCAL_BOOK_KINDS)[number];

export const FISCAL_BOOK_TITLES: Record<FiscalBookKind, string> = {
  purchases: "Libro de compras",
  sales: "Libro de ventas",
};

export const FISCAL_BOOK_FORMATS = ["xlsx", "csv"] as const;
export type FiscalBookFormat = (typeof FISCAL_BOOK_FORMATS)[number];

export const FISCAL_BOOK_SORT_BY = ["issuedOn", "number", "total"] as const;
export type FiscalBookSortBy = (typeof FISCAL_BOOK_SORT_BY)[number];

export const FISCAL_BOOK_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type FiscalBookSortDir = (typeof FISCAL_BOOK_SORT_DIRECTIONS)[number];

export const FISCAL_BOOK_COLUMN_KEYS = [
  "issuedOn",
  "accountingOn",
  "type",
  "letter",
  "pointOfSale",
  "number",
  "issuerCuit",
  "receiverCuit",
  "currency",
  "exchangeRate",
  "neto",
  "iva21",
  "iva105",
  "iva27",
  "exento",
  "otrosTributos",
  "total",
] as const;
export type FiscalBookColumnKey = (typeof FISCAL_BOOK_COLUMN_KEYS)[number];

export type FiscalBookColumnKind = "text" | "integer" | "money" | "rate" | "date";

export interface FiscalBookColumn {
  key: FiscalBookColumnKey;
  header: string;
  kind: FiscalBookColumnKind;
  /** Ancho en caracteres de Excel. */
  width: number;
}

export const FISCAL_BOOK_COLUMNS: readonly FiscalBookColumn[] = [
  { key: "issuedOn", header: "Fecha de emisión", kind: "date", width: 14 },
  { key: "accountingOn", header: "Fecha contable", kind: "date", width: 14 },
  { key: "type", header: "Tipo", kind: "text", width: 8 },
  { key: "letter", header: "Letra", kind: "text", width: 8 },
  { key: "pointOfSale", header: "Punto de venta", kind: "integer", width: 14 },
  { key: "number", header: "Número", kind: "integer", width: 14 },
  { key: "issuerCuit", header: "CUIT emisor", kind: "text", width: 16 },
  { key: "receiverCuit", header: "CUIT receptor", kind: "text", width: 16 },
  { key: "currency", header: "Moneda", kind: "text", width: 9 },
  { key: "exchangeRate", header: "Tipo de cambio", kind: "rate", width: 15 },
  { key: "neto", header: "Neto", kind: "money", width: 16 },
  { key: "iva21", header: "IVA 21 %", kind: "money", width: 16 },
  { key: "iva105", header: "IVA 10,5 %", kind: "money", width: 16 },
  { key: "iva27", header: "IVA 27 %", kind: "money", width: 16 },
  { key: "exento", header: "Exento", kind: "money", width: 16 },
  { key: "otrosTributos", header: "Otros tributos", kind: "money", width: 16 },
  { key: "total", header: "Total", kind: "money", width: 18 },
];

const periodIdSchema = z
  .string({ required_error: "periodId: indicá el período fiscal del libro" })
  .uuid({ message: "periodId: el identificador del período no es válido" });

export const fiscalBookSummaryQuerySchema = z.object({
  periodId: periodIdSchema,
});

/** Lista de columnas separada por comas. Vacía significa todas, en el orden del libro. */
export const fiscalBookColumnsParamSchema = z
  .string({ invalid_type_error: "columns: indicá las columnas separadas por coma" })
  .max(400, { message: "columns: la lista de columnas es demasiado larga" })
  .optional()
  .transform((raw, ctx): FiscalBookColumnKey[] => {
    if (raw === undefined) return [...FISCAL_BOOK_COLUMN_KEYS];
    const keys = raw
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    if (keys.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "columns: indicá al menos una columna" });
      return z.NEVER;
    }
    const unknown = keys.filter((key) => !(FISCAL_BOOK_COLUMN_KEYS as readonly string[]).includes(key));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `columns: «${unknown.join("», «")}» no es una columna del libro (disponibles: ${FISCAL_BOOK_COLUMN_KEYS.join(", ")})`,
      });
      return z.NEVER;
    }
    const repeated = keys.find((key, index) => keys.indexOf(key) !== index);
    if (repeated !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `columns: «${repeated}» aparece más de una vez` });
      return z.NEVER;
    }
    return keys as FiscalBookColumnKey[];
  });

export const fiscalBookExportQuerySchema = z.object({
  periodId: periodIdSchema,
  book: z.enum(FISCAL_BOOK_KINDS, {
    errorMap: () => ({ message: "book: indicá «purchases» (libro de compras) o «sales» (libro de ventas)" }),
  }),
  format: z
    .enum(FISCAL_BOOK_FORMATS, { errorMap: () => ({ message: "format: indicá «xlsx» o «csv»" }) })
    .default("xlsx"),
  columns: fiscalBookColumnsParamSchema,
  sortBy: z
    .enum(FISCAL_BOOK_SORT_BY, { errorMap: () => ({ message: "sortBy: indicá «issuedOn», «number» o «total»" }) })
    .default("issuedOn"),
  sortDir: z
    .enum(FISCAL_BOOK_SORT_DIRECTIONS, { errorMap: () => ({ message: "sortDir: indicá «asc» o «desc»" }) })
    .default("asc"),
});

export type FiscalBookExportQuery = z.output<typeof fiscalBookExportQuerySchema>;
