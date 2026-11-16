import type { FiscalYear } from "../../lib/api";

/**
 * «Abrir cliente» del Panel de trabajo (corte 4b, S4-12). Replica la lógica de `openSettlement`
 * de Inicio (StudyDashboard.tsx), sin tocarla: el destino es el Legajo del período contable
 * equivalente o, si no hay período contable, el Resumen del cliente. El corte 4d unifica ambas.
 */

export const RUTA_EXPEDIENTE = "/expediente-mensual";
export const RUTA_RESUMEN = "/resumen-cliente";

export interface RangoFiscal {
  periodStart: string;
  periodEnd: string;
}

/** Primer período contable que se superpone con el período fiscal de la obligación. */
export function periodoContableEquivalente(
  anios: readonly FiscalYear[],
  rango: RangoFiscal,
): string | null {
  const inicio = new Date(rango.periodStart).getTime();
  const fin = new Date(rango.periodEnd).getTime();
  for (const anio of anios) {
    for (const periodo of anio.periods) {
      const desde = new Date(periodo.startDate).getTime();
      const hasta = new Date(periodo.endDate).getTime();
      if (desde <= fin && hasta >= inicio) return periodo.id;
    }
  }
  return null;
}

export interface AbrirClienteDelPanel {
  firmId: string;
  clientId: string;
  rango: RangoFiscal;
  cargarAnios: (firmId: string, clientId: string) => Promise<FiscalYear[]>;
  setClientId: (clientId: string | null) => void;
  setPeriodId: (periodId: string | null) => void;
  navigate: (to: string) => void;
}

/** Elige el cliente en el contexto, resuelve el período y navega. Devuelve la ruta de destino. */
export async function abrirClienteDelPanel(opciones: AbrirClienteDelPanel): Promise<string> {
  opciones.setClientId(opciones.clientId);
  let destino = RUTA_RESUMEN;
  try {
    const anios = await opciones.cargarAnios(opciones.firmId, opciones.clientId);
    const periodoId = periodoContableEquivalente(anios, opciones.rango);
    if (periodoId !== null) {
      opciones.setPeriodId(periodoId);
      destino = RUTA_EXPEDIENTE;
    }
  } catch {
    // Sin período resuelto por un error de lectura: el resumen del cliente es el destino recuperable.
  }
  opciones.navigate(destino);
  return destino;
}
