/**
 * Formato único de fechas, meses y rangos que ve el equipo (DESIGN.md, «Fechas y períodos»).
 *
 * Solo cambia lo que se muestra: los valores internos (estado, API, URL, `value` de los inputs
 * de fecha y nombres de archivo) siguen en ISO (aaaa-mm-dd).
 *
 * - Fecha: dd/mm/aaaa con ceros («05/07/2026»). Toma el día calendario del ISO sin pasar por
 *   Date, así no corre un día en husos negativos como el de Argentina (UTC−3).
 * - Mes: «julio de 2026».
 * - Rango: «01/07/2026 al 31/07/2026». Sin fin: «Desde 01/07/2026». Sin inicio: «Hasta 31/07/2026».
 * - Fecha y hora: «05/07/2026 14:30», en hora de Argentina y en 24 h.
 *
 * `vacio` es el texto que se muestra cuando no hay valor. Por defecto «—»; cada pantalla puede
 * pedir otro (por ejemplo, la cadena vacía) para conservar su texto actual.
 */

const ZONA_HORARIA_PANTALLA = "America/Argentina/Buenos_Aires";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const MES_ISO = /^(\d{4})-(\d{2})/;

const PARTES_INSTANTE = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_PANTALLA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parteDe(partes: Intl.DateTimeFormatPart[], tipo: Intl.DateTimeFormatPartTypes): string {
  return partes.find((parte) => parte.type === tipo)?.value ?? "";
}

/** Día calendario de un ISO de fecha («05/07/2026»). Un valor que no es ISO se muestra tal cual. */
export function formatearFecha(valor: string | null | undefined, vacio = "—"): string {
  if (!valor) return vacio;
  const partes = DIA_ISO.exec(valor);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
}

/** Mes de un ISO de fecha o de período («julio de 2026»). */
export function formatearMes(valor: string | null | undefined, vacio = "—"): string {
  if (!valor) return vacio;
  const partes = MES_ISO.exec(valor);
  const mes = partes ? MESES[Number(partes[2]) - 1] : undefined;
  return partes && mes ? `${mes} de ${partes[1]}` : valor;
}

/** Rango de fechas («01/07/2026 al 31/07/2026»). Si falta un extremo, se indica desde o hasta. */
export function formatearRango(
  desde: string | null | undefined,
  hasta: string | null | undefined,
  vacio = "—",
): string {
  if (!desde && !hasta) return vacio;
  if (!hasta) return `Desde ${formatearFecha(desde)}`;
  if (!desde) return `Hasta ${formatearFecha(hasta)}`;
  return `${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
}

/** Instante ISO con fecha y hora («05/07/2026 14:30»), en hora de Argentina. */
export function formatearFechaHora(valor: string | null | undefined, vacio = "—"): string {
  if (!valor) return vacio;
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return valor;
  const partes = PARTES_INSTANTE.formatToParts(instante);
  const fecha = `${parteDe(partes, "day")}/${parteDe(partes, "month")}/${parteDe(partes, "year")}`;
  return `${fecha} ${parteDe(partes, "hour")}:${parteDe(partes, "minute")}`;
}
