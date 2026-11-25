import type { FiscalTaxPeriod } from "./tipos";
import { formatearPeriodo } from "../../lib/formatoFechas";

/**
 * El Legajo es uno solo por mes aunque haya un período fiscal por impuesto (IIBB, TEM…):
 * el selector tiene una entrada por mes y los impuestos se ven en Cálculo (hallazgo 09-2).
 */
export interface MesDelLegajo {
  clave: string;
  inicio: string;
  fin: string;
  /** Períodos fiscales del mes, en el orden en que llegaron. El primero representa al mes. */
  periodos: FiscalTaxPeriod[];
}

const dia = (valor: string) => valor.slice(0, 10);

export function agruparPorMes(periodos: readonly FiscalTaxPeriod[]): MesDelLegajo[] {
  const meses = new Map<string, MesDelLegajo>();
  for (const periodo of periodos) {
    const inicio = dia(periodo.startDate);
    const fin = dia(periodo.endDate);
    const clave = `${inicio}/${fin}`;
    const mes = meses.get(clave);
    if (mes) mes.periodos.push(periodo);
    else meses.set(clave, { clave, inicio, fin, periodos: [periodo] });
  }
  return [...meses.values()].sort((a, b) => b.inicio.localeCompare(a.inicio));
}

/** «Octubre de 2026»; un período que no es un mes entero muestra su rango. */
export function rotuloMes(mes: Pick<MesDelLegajo, "inicio" | "fin">) {
  const texto = formatearPeriodo(mes.inicio, mes.fin);
  return `${texto.charAt(0).toLocaleUpperCase("es-AR")}${texto.slice(1)}`;
}

/** «octubre de 2026» a partir de «2026-10», para frases como «Abrir octubre de 2026». */
export function mesEnFrase(mes: string) {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  const inicio = `${anio}-${String(numero).padStart(2, "0")}-01`;
  const fin = new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10);
  return formatearPeriodo(inicio, fin);
}

function sumarMes(anio: number, numero: number, delta: number) {
  const fecha = new Date(Date.UTC(anio, numero - 1 + delta, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Mes que el Legajo ofrece abrir («AAAA-MM»): el siguiente al último mes abierto o, si el cliente
 * todavía no tiene ninguno, el mes anterior al actual (el que se liquida). Nunca un mes futuro:
 * si ya está abierto el mes actual, no hay nada para ofrecer.
 */
export function mesParaAbrir(meses: readonly MesDelLegajo[], hoy: Date): string | null {
  const actual = hoy.getFullYear() * 12 + hoy.getMonth();
  const mensuales = meses.filter((mes) => {
    const [, , diaInicio] = mes.inicio.split("-").map(Number);
    return mes.inicio.slice(0, 7) === mes.fin.slice(0, 7) && diaInicio === 1;
  });
  const ultimo = mensuales[0];
  if (!ultimo) return sumarMes(hoy.getFullYear(), hoy.getMonth() + 1, -1);
  const [anio, numero] = ultimo.inicio.split("-").map(Number) as [number, number];
  const siguiente = sumarMes(anio, numero, 1);
  const [anioSiguiente, numeroSiguiente] = siguiente.split("-").map(Number) as [number, number];
  return anioSiguiente * 12 + (numeroSiguiente - 1) > actual ? null : siguiente;
}
