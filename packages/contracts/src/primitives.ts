import { z } from "zod";

/** Identificador UUIDv7 */
export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

/** Fecha contable sin zona horaria (YYYY-MM-DD) */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD");
export type IsoDate = z.infer<typeof isoDate>;

/** Importe monetario en NUMERIC(20,4) como string decimal */
export const money = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "Importe decimal de hasta 4 posiciones");
export type Money = z.infer<typeof money>;

/** Tipo de cambio / coeficiente en NUMERIC(20,8) como string decimal */
export const decimalRate = z
  .string()
  .regex(/^-?\d+(\.\d{1,8})?$/, "Decimal de hasta 8 posiciones");
export type DecimalRate = z.infer<typeof decimalRate>;

/** Moneda ISO 4217 */
export const currency = z.string().length(3).toUpperCase();
export type Currency = z.infer<typeof currency>;

/** CUIT argentino: 11 dígitos con dígito verificador válido */
export const cuit = z
  .string()
  .regex(/^\d{11}$/, "El CUIT debe tener 11 dígitos")
  .refine((v) => {
    const digits = v.split("").map(Number);
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + digits[i]! * w, 0);
    const check = (11 - (sum % 11)) % 11;
    const expected = check === 11 ? 0 : check;
    return digits[10] === expected;
  }, "Dígito verificador de CUIT inválido");
export type Cuit = z.infer<typeof cuit>;