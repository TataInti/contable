/**
 * Terminación de CUIT: último dígito del CUIT del cliente (supuesto S2 del plan
 * de calendarios). Es un dato derivado: no se guarda ni se edita.
 *
 * Acepta el CUIT con guiones o sin ellos ("20-12345678-9" o "20123456789").
 * Devuelve null cuando no hay CUIT. Para todo CUIT que valida `cuit` (11
 * dígitos) coincide con el último carácter que usa el motor en
 * apps/api/src/tax/fiscal-foundation-service.ts.
 */
export type CuitEnding = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export function cuitEnding(cuit: string | null | undefined): CuitEnding | null {
  const digits = (cuit ?? "").replace(/\D/g, "");
  return digits.length > 0 ? (digits.slice(-1) as CuitEnding) : null;
}
