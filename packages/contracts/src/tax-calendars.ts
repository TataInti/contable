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

function isRealIsoDate(value: string): boolean {
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
