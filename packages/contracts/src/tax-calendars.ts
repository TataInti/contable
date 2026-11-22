import { z } from "zod";

/**
 * Calendarios fiscales del estudio (corte 2a-i): esquemas de petición.
 * Cada mensaje de error indica el campo y el motivo (P4). Las fechas son
 * AAAA-MM-DD; el servidor las guarda como medianoche UTC.
 */

export const TAX_CALENDAR_STATUSES = ["DRAFT", "PUBLISHED", "HIDDEN"] as const;
export const TAX_CALENDAR_ENTRY_GROUPINGS = ["ENDING_DIGITS", "ALL"] as const;
export const TAX_CALENDAR_ENTRY_ADJUSTMENTS = ["NONE", "HOLIDAY", "WEEKEND", "NOTE"] as const;

export type TaxCalendarStatusValue = (typeof TAX_CALENDAR_STATUSES)[number];

/** Una fecha AAAA-MM-DD que existe en el calendario (2026-02-30 no existe). */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isoDate = z
  .string({ message: "La fecha es obligatoria (AAAA-MM-DD)" })
  .refine(isRealIsoDate, { message: "La fecha debe ser una fecha real con formato AAAA-MM-DD" });

const optionalIsoDate = isoDate.nullable().optional();

const calendarYear = z
  .number({ message: "El año es obligatorio" })
  .int("El año debe ser un número entero")
  .min(2000, "El año debe estar entre 2000 y 2100")
  .max(2100, "El año debe estar entre 2000 y 2100");

const calendarTitle = z
  .string({ message: "El título es obligatorio" })
  .trim()
  .min(3, "El título debe tener al menos 3 caracteres")
  .max(120, "El título no puede superar los 120 caracteres");

export const createTaxCalendarSchema = z
  .object({
    taxAuthorityId: z.string({ message: "Indicá el organismo" }).uuid("El organismo no es válido"),
    jurisdictionId: z.string({ message: "Indicá la jurisdicción" }).uuid("La jurisdicción no es válida"),
    year: calendarYear,
    title: calendarTitle,
  })
  .strict();

export const updateTaxCalendarSchema = z.object({ title: calendarTitle }).strict();

const entryBase = z
  .object({
    conceptLabel: z
      .string({ message: "Falta el concepto de la celda" })
      .trim()
      .min(1, "Falta el concepto de la celda")
      .max(200, "El concepto no puede superar los 200 caracteres"),
    taxTypeId: z.string().uuid("El tipo de impuesto no es válido").nullable().optional(),
    regimeId: z.string().uuid("El régimen no es válido").nullable().optional(),
    groupingKind: z.enum(TAX_CALENDAR_ENTRY_GROUPINGS, {
      message: "Elegí la agrupación: terminaciones de CUIT o todos",
    }),
    endingDigits: z
      .string()
      .regex(/^[0-9]{1,10}$/, "Las terminaciones son dígitos de 0 a 9 sin separadores (por ejemplo 0123)")
      .nullable()
      .optional(),
    referencePeriodStart: optionalIsoDate,
    referencePeriodEnd: optionalIsoDate,
    referenceLabel: z.string().trim().max(120, "La referencia no puede superar los 120 caracteres").nullable().optional(),
    dueDate: isoDate,
    dueDateRaw: z.string().max(200, "El texto de la celda no puede superar los 200 caracteres").nullable().optional(),
    adjustment: z.enum(TAX_CALENDAR_ENTRY_ADJUSTMENTS, { message: "El ajuste no es válido" }).optional(),
    noteRef: z.string().trim().max(20, "La nota no puede superar los 20 caracteres").nullable().optional(),
    noteText: z.string().trim().max(500, "La nota no puede superar los 500 caracteres").nullable().optional(),
    sortOrder: z.number().int("El orden debe ser un entero").min(0).max(100000).optional(),
  })
  .strict();

/** Reglas entre campos: terminaciones solo con agrupación por terminación. */
function refineEntry(
  value: { groupingKind?: string; endingDigits?: string | null | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.groupingKind === "ENDING_DIGITS" && !value.endingDigits) {
    ctx.addIssue({
      code: "custom",
      path: ["endingDigits"],
      message: "Indicá las terminaciones de la celda (por ejemplo 0123)",
    });
  }
  if (value.groupingKind === "ALL" && value.endingDigits) {
    ctx.addIssue({
      code: "custom",
      path: ["endingDigits"],
      message: "«Todos» no lleva terminaciones: quitalas o elegí terminaciones",
    });
  }
}

export const taxCalendarEntryInputSchema = entryBase.superRefine(refineEntry);

/** Edición parcial de una celda; el servidor vuelve a validar el resultado combinado. */
export const taxCalendarEntryPatchSchema = entryBase.partial().strict();

export const taxCalendarListQuerySchema = z
  .object({
    year: z.coerce.number().int("El año debe ser un entero").min(2000).max(2100).optional(),
    taxAuthorityId: z.string().uuid("El organismo no es válido").optional(),
    jurisdictionId: z.string().uuid("La jurisdicción no es válida").optional(),
    status: z.enum(TAX_CALENDAR_STATUSES, { message: "El estado no es válido" }).optional(),
  })
  .strict();

export type CreateTaxCalendarInput = z.infer<typeof createTaxCalendarSchema>;
export type UpdateTaxCalendarInput = z.infer<typeof updateTaxCalendarSchema>;
export type TaxCalendarEntryInput = z.infer<typeof taxCalendarEntryInputSchema>;
export type TaxCalendarEntryPatch = z.infer<typeof taxCalendarEntryPatchSchema>;
export type TaxCalendarListQuery = z.infer<typeof taxCalendarListQuerySchema>;

/**
 * Importación de celdas desde un CSV (corte 2b-1). El archivo tiene las 11 columnas
 * de los CSV verificados contra los PDF y se lee por encabezado (en cualquier orden).
 */
export const TAX_CALENDAR_IMPORT_COLUMNS = [
  "calendario",
  "bloque",
  "concepto",
  "periodo_referencia",
  "criterio_agrupacion",
  "digitos",
  "fecha_completa",
  "nota",
  "origen_celda",
  "confianza",
  "verificado_en_imagen",
] as const;

/** Columnas sin las que no se puede crear una celda: si falta alguna, el archivo no se importa. */
export const TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS = [
  "concepto",
  "criterio_agrupacion",
  "digitos",
  "fecha_completa",
  "periodo_referencia",
] as const;

/** Tope del contenido del archivo (texto UTF-8) y de filas de datos por importación. */
export const TAX_CALENDAR_IMPORT_MAX_BYTES = 1024 * 1024;
export const TAX_CALENDAR_IMPORT_MAX_ROWS = 2000;

/** Cuerpo de la importación: con dryRun true valida y no escribe nada. taxTypeId (opcional) asigna el impuesto a todas las celdas que se importan. */
export const importTaxCalendarEntriesSchema = z
  .object({
    csv: z.string({ message: "Falta el contenido del archivo (csv)" }),
    dryRun: z.boolean({
      message: "Indicá si es una prueba (dryRun: true) o una importación real (dryRun: false)",
    }),
    taxTypeId: z.string().uuid("El impuesto no es válido").nullable().optional(),
  })
  .strict();

export type ImportTaxCalendarEntriesInput = z.infer<typeof importTaxCalendarEntriesSchema>;

/** PDF del calendario que lee la IA: tope de tamaño (viaja en base64 dentro del JSON). */
export const TAX_CALENDAR_PDF_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Alta de un calendario desde un PDF: crea el borrador con su fuente, lee el PDF con IA y
 * importa las celdas propuestas con el impuesto elegido. Si la lectura no funciona, el borrador
 * queda vacío y se completa a mano sobre el PDF.
 */
export const createTaxCalendarFromPdfSchema = z
  .object({
    taxAuthorityId: z.string({ message: "Indicá el organismo" }).uuid("El organismo no es válido"),
    jurisdictionId: z.string({ message: "Indicá la jurisdicción" }).uuid("La jurisdicción no es válida"),
    year: calendarYear,
    title: calendarTitle,
    taxTypeId: z
      .string({ message: "Indicá el impuesto al que aplica el calendario" })
      .uuid("El impuesto no es válido"),
    pdfBase64: z.string({ message: "Falta el archivo PDF" }).min(1, "Falta el archivo PDF"),
    originalName: z.string().trim().max(200, "El nombre del archivo no puede superar los 200 caracteres").nullable().optional(),
  })
  .strict();

export type CreateTaxCalendarFromPdfInput = z.infer<typeof createTaxCalendarFromPdfSchema>;

/** Fila que no se importa. `fila` es el número de la hoja (el encabezado es la 1); `columna` null si afecta a toda la fila. */
export interface TaxCalendarImportRejection {
  fila: number;
  columna: string | null;
  motivo: string;
  valorRecibido: string | null;
}

/** Aviso sobre una fila que sí se importa (por ejemplo, queda como dudosa). */
export interface TaxCalendarImportNotice {
  fila: number;
  motivo: string;
}

/** Informe de una importación: el mismo en prueba y en importación real. */
export interface TaxCalendarEntriesImportReport {
  dryRun: boolean;
  totalFilas: number;
  validas: number;
  importadas: number;
  rechazadas: TaxCalendarImportRejection[];
  avisos: TaxCalendarImportNotice[];
  columnasIgnoradas: string[];
  encabezadosFaltantes: string[];
}
