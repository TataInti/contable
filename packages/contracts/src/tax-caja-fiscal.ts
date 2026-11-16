import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Saldo de caja fiscal del período (corte 8a). Es un cálculo en vivo: no se publica ni se persiste
 * (S-8.2, S-8.3). Los importes son cadenas decimales en pesos con 2 decimales; pueden ser negativos.
 * Cada faltante nombra impuesto, período y régimen (P1). Cada bloqueo nombra el campo y el motivo (P4).
 */

const importeEnPesos = z.string().regex(/^-?\d+\.\d{2}$/, "Importe en pesos con 2 decimales");

/** COMPLETO (con cifra), PARCIAL (faltan DJ, sin cifra) y SIN_DATOS (no es cero). */
export const cajaFiscalEstado = z.enum(["COMPLETO", "PARCIAL", "SIN_DATOS"]);

export const cajaFiscalFaltanteSchema = z.object({
  impuesto: z.string(),
  periodo: z.string(),
  regimen: z.string(),
});

export const cajaFiscalImpuestoSchema = cajaFiscalFaltanteSchema.extend({
  presentacionId: uuid,
  totalAPagar: importeEnPesos,
  deduccion: importeEnPesos,
});

export const cajaFiscalDataSchema = z.object({
  estado: cajaFiscalEstado,
  cifra: importeEnPesos.nullable(),
  periodo: z.object({ id: uuid, etiqueta: z.string() }),
  desglose: z
    .object({
      ventasConIva: importeEnPesos,
      comprasConIva: importeEnPesos,
      impuestos: z.array(cajaFiscalImpuestoSchema),
      totalImpuestos: importeEnPesos,
    })
    .nullable(),
  faltantes: z.array(cajaFiscalFaltanteSchema),
  comprobantes: z.object({
    ventas: z.number().int().nonnegative(),
    compras: z.number().int().nonnegative(),
  }),
  inputHash: z.string(),
  outputHash: z.string(),
});

export const cajaFiscalMetaSchema = z.object({
  base: z.literal("CAJA_FISCAL"),
  publicado: z.literal(false),
  moneda: z.literal("ARS"),
  motor: z.string(),
  paginacion: z.literal("no aplica: una fila por cliente y período"),
});

export const cajaFiscalResponseSchema = z.object({
  data: cajaFiscalDataSchema,
  meta: cajaFiscalMetaSchema,
});

/** Consulta de GET .../profitability/caja-fiscal. */
export const cajaFiscalQuerySchema = z.object({ periodId: uuid });
