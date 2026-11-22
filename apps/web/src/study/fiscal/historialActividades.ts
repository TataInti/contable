import type { ClientActivityLink } from "./utilidades";

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
];

/** «2026-10-01» → «octubre 2026» (mismo formato que los mensajes de la API). */
export function mesYAnio(fecha: string): string {
  const [anio, mes] = fecha.slice(0, 10).split("-").map(Number);
  return `${MESES[(mes ?? 1) - 1]} ${anio}`;
}

const diaAnterior = (fecha: string) =>
  new Date(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export type EntradaHistorial = { fecha: string; texto: string };

/**
 * Línea de tiempo simple de las actividades del cliente (brief 4L): vinculaciones, cambios de actividad
 * con su motivo y los cortes («Hasta»). Orden cronológico ascendente.
 */
export function lineaDeTiempoActividades(links: ClientActivityLink[]): EntradaHistorial[] {
  const entradas: EntradaHistorial[] = [];
  for (const link of links) {
    const nombre = link.activity.name;
    if (link.isChange) {
      const motivo = link.changeReason ? ` · ${link.changeReason}` : "";
      entradas.push({
        fecha: link.validFrom.slice(0, 10),
        texto: `Desde ${mesYAnio(link.validFrom)} rige ${nombre} (cambio de actividad)${motivo}`,
      });
    } else {
      entradas.push({ fecha: link.validFrom.slice(0, 10), texto: `Vinculada: ${nombre}` });
    }
    if (link.validTo) {
      entradas.push({ fecha: link.validTo.slice(0, 10), texto: `Hasta ${mesYAnio(link.validTo)}: ${nombre}` });
    }
  }
  return entradas.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export type CambioDeActividad = { desde: string; de: string; a: string };

/**
 * Cambios de actividad que empiezan en el mes del período (brief 4L). Alimentan el aviso informativo
 * del legajo: no bloquean el cálculo.
 */
export function cambiosDeActividadDelMes(links: ClientActivityLink[], periodoInicio: string): CambioDeActividad[] {
  const mes = periodoInicio.slice(0, 7);
  return links
    .filter((link) => link.isChange && link.validFrom.slice(0, 7) === mes)
    .map((link) => {
      const anterior = links.find(
        (otro) =>
          otro.id !== link.id &&
          otro.validTo !== null &&
          otro.validTo.slice(0, 10) === diaAnterior(link.validFrom) &&
          otro.activity.jurisdiction.name === link.activity.jurisdiction.name,
      );
      return {
        desde: mesYAnio(link.validFrom),
        de: anterior?.activity.name ?? "la actividad anterior",
        a: link.activity.name,
      };
    });
}
