import { z } from "zod";
import type { CuitEnding } from "./cuit-ending.js";

/**
 * Panel de trabajo global por usuario (corte 4a): contrato de lectura de las
 * obligaciones del estudio. Un solo nombre por concepto (P3); los rótulos de
 * pantalla los define el corte 4b. Cada error indica el campo y el motivo (P4).
 */

/** Estados de la DJ y del legajo que el panel verifica hoy (D4-2). «Completo» llega con el corte 5. */
export const TAX_PANEL_DJ_STATES = [
  "SIN_LEGAJO",
  "LEGAJO_EN_CURSO",
  "DJ_PENDIENTE",
  "PRESENTACION_SIN_ACUSE",
  "PRESENTADO",
] as const;
export type TaxPanelDjState = (typeof TAX_PANEL_DJ_STATES)[number];

export const TAX_PANEL_GROUPINGS = [
  "terminacion",
  "vencimiento",
  "responsable",
  "cliente",
] as const;
export type TaxPanelGrouping = (typeof TAX_PANEL_GROUPINGS)[number];

export const TAX_PANEL_SORT_KEYS = ["vencimiento", "cliente", "impuesto", "estado"] as const;
export type TaxPanelSortKey = (typeof TAX_PANEL_SORT_KEYS)[number];

export const TAX_PANEL_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type TaxPanelSortDir = (typeof TAX_PANEL_SORT_DIRECTIONS)[number];

export const TAX_PANEL_DEFAULT_LIMIT = 50;
export const TAX_PANEL_MAX_LIMIT = 200;
/** Días hacia atrás desde hoy para el vencimiento inicial (supuesto S4-5). */
export const TAX_PANEL_DEFAULT_LOOKBACK_DAYS = 30;

export type TaxPanelDueDateSource = "CALENDAR" | "RULE" | "MANUAL";
export type TaxPanelFilingStatus = "PENDING" | "FILED";

const panelUuid = z.string().uuid();
const panelDigit = /^[0-9]$/;

function parseList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const dateParam = (field: string) =>
  z
    .string({ message: `${field}: indicá una fecha AAAA-MM-DD` })
    .refine(isRealIsoDate, {
      message: `${field}: la fecha debe ser real y tener formato AAAA-MM-DD`,
    });

const responsableParam = z
  .string({ message: "responsable: indicá «me» o identificadores de usuario separados por coma" })
  .max(4000, { message: "responsable: la lista es demasiado larga" })
  .transform((raw, ctx) => {
    const items = parseList(raw);
    const invalid = items.find((item) => item !== "me" && !panelUuid.safeParse(item).success);
    if (items.length === 0 || invalid !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          invalid !== undefined
            ? `responsable: «${invalid}» no es «me» ni un identificador de usuario válido`
            : "responsable: indicá «me» o un identificador de usuario",
      });
      return z.NEVER;
    }
    return items;
  });

const terminacionParam = z
  .string({ message: "terminacion: indicá dígitos de 0 a 9 separados por coma" })
  .max(100, { message: "terminacion: la lista es demasiado larga" })
  .transform((raw, ctx) => {
    const items = parseList(raw);
    if (items.length === 0 || items.some((item) => !panelDigit.test(item))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "terminacion: indicá dígitos de 0 a 9 separados por coma (por ejemplo 1,5)",
      });
      return z.NEVER;
    }
    return items as CuitEnding[];
  });

const grupoParam = z
  .string({ message: "grupo: indicá las terminaciones juntas, por ejemplo 0123" })
  .max(20, { message: "grupo: la lista es demasiado larga" })
  .transform((raw, ctx) => {
    const digits = [...new Set(raw.trim().split(""))].sort();
    if (digits.length === 0 || digits.some((digit) => !panelDigit.test(digit))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grupo: indicá las terminaciones juntas, por ejemplo 0123",
      });
      return z.NEVER;
    }
    return digits as CuitEnding[];
  });

const estadoParam = z
  .string({ message: "estado: indicá uno o más estados del panel separados por coma" })
  .transform((raw, ctx) => {
    const items = parseList(raw);
    const invalid = items.find(
      (item) => !(TAX_PANEL_DJ_STATES as readonly string[]).includes(item),
    );
    if (items.length === 0 || invalid !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          invalid !== undefined
            ? `estado: «${invalid}» no es un estado del panel (disponibles: ${TAX_PANEL_DJ_STATES.join(", ")})`
            : "estado: indicá al menos un estado",
      });
      return z.NEVER;
    }
    return items as TaxPanelDjState[];
  });

const uuidParam = (field: string, label: string) =>
  z.string().uuid({ message: `${field}: el identificador de ${label} no es válido` });

const limitParam = z.coerce
  .number({ invalid_type_error: "limit: indicá un número entero" })
  .int({ message: "limit: indicá un número entero" })
  .min(1, { message: "limit: el mínimo es 1" })
  .max(TAX_PANEL_MAX_LIMIT, { message: `limit: el máximo es ${TAX_PANEL_MAX_LIMIT}` })
  .default(TAX_PANEL_DEFAULT_LIMIT);

const offsetParam = z.coerce
  .number({ invalid_type_error: "offset: indicá un número entero" })
  .int({ message: "offset: indicá un número entero" })
  .min(0, { message: "offset: el mínimo es 0" })
  .default(0);

/** Parámetros de GET …/portfolio/tax-worklist/obligations. Valores desconocidos: 400 (strict). */
export const taxPanelQuerySchema = z
  .object({
    responsable: responsableParam.optional(),
    terminacion: terminacionParam.optional(),
    grupo: grupoParam.optional(),
    taxTypeId: uuidParam("taxTypeId", "el impuesto").optional(),
    regimeId: uuidParam("regimeId", "el régimen").optional(),
    estado: estadoParam.optional(),
    periodId: uuidParam("periodId", "el período fiscal").optional(),
    dueFrom: dateParam("dueFrom").optional(),
    dueTo: dateParam("dueTo").optional(),
    agrupar: z
      .enum(TAX_PANEL_GROUPINGS, {
        errorMap: () => ({
          message: "agrupar: indicá terminacion, vencimiento, responsable o cliente",
        }),
      })
      .optional(),
    orden: z
      .enum(TAX_PANEL_SORT_KEYS, {
        errorMap: () => ({ message: "orden: indicá vencimiento, cliente, impuesto o estado" }),
      })
      .default("vencimiento"),
    dir: z
      .enum(TAX_PANEL_SORT_DIRECTIONS, { errorMap: () => ({ message: "dir: indicá asc o desc" }) })
      .default("asc"),
    limit: limitParam,
    offset: offsetParam,
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.dueFrom !== undefined && query.dueTo !== undefined && query.dueFrom > query.dueTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueTo"],
        message: "dueTo: la fecha hasta no puede ser anterior a dueFrom",
      });
    }
  });

export type TaxPanelQuery = z.output<typeof taxPanelQuerySchema>;

/** Responsable de la obligación: asignaciones del cliente (D4-1). `name` es null si la RLS de usuarios no lo deja leer. */
export interface TaxPanelResponsable {
  userId: string;
  name: string | null;
  isSelf: boolean;
}

/** Legajo vinculado (WorkpaperSettlement) o, si no hay vínculo, el que cubre el cierre del período (S4-7). */
export interface TaxPanelLegajo {
  workpaperId: string;
  status: string;
  revision: number;
}

/** Presentación más reciente: FILED si existe; si no, PENDING (intento sin acuse). */
export interface TaxPanelFiling {
  filingId: string;
  status: TaxPanelFilingStatus;
  filedAt: string;
  hasReceipt: boolean;
}

export interface TaxPanelRow {
  obligationId: string;
  clientId: string;
  clientName: string;
  cuit: string;
  cuitEnding: CuitEnding | null;
  taxTypeId: string;
  taxTypeName: string;
  regimeId: string;
  regimeName: string;
  jurisdictionId: string;
  jurisdictionName: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  dueDateSource: TaxPanelDueDateSource;
  calculatedDueDate: string | null;
  /** Días corridos entre meta.asOf y dueDate; negativo = vencida; null sin vencimiento (S4-3). */
  daysUntilDue: number | null;
  legajo: TaxPanelLegajo | null;
  filing: TaxPanelFiling | null;
  djState: TaxPanelDjState;
  assigneeCount: number;
  responsables: TaxPanelResponsable[];
}

export interface TaxPanelGroup {
  key: string;
  label: string;
  order: number;
  count: number;
}

export interface TaxPanelOptions {
  responsables: { userId: string; name: string | null }[];
  taxTypes: { id: string; name: string }[];
  periods: { id: string; label: string }[];
  grupos: { key: string; label: string }[];
}

export interface TaxPanelMeta {
  total: number;
  limit: number;
  offset: number;
  /** Fecha de referencia del servidor (Argentina, UTC−3), AAAA-MM-DD. */
  asOf: string;
  groups: TaxPanelGroup[] | null;
  groupsComplete: boolean;
  options: TaxPanelOptions;
}

export interface TaxPanelResponse {
  data: TaxPanelRow[];
  meta: TaxPanelMeta;
}
