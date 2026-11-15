import type { ClientWithProfile } from "./tipos";

/** Dígitos de terminación de CUIT, en el orden en que se muestran y se filtran. */
export const CUIT_ENDINGS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Lee el filtro de la URL (?terminacion=0,9): solo dígitos válidos, siempre en orden. */
export function parseEndingFilter(value: string | null): string[] {
  const picked = (value ?? "").split(",");
  return CUIT_ENDINGS.filter((digit) => picked.includes(digit));
}

/** Grupo de la tabla: un encabezado por dígito y «Sin CUIT» al final. */
export function endingGroup(row: ClientWithProfile) {
  if (row.cuitEnding == null) return { key: "sin-cuit", label: "Sin CUIT", order: 10 };
  return { key: row.cuitEnding, label: `Terminación de CUIT ${row.cuitEnding}`, order: Number(row.cuitEnding) };
}
