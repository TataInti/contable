// Saldos que vienen de meses anteriores al del legajo, con la frase de su origen (corte 3E, etapa Saldos).
import { formatearMes } from "../../lib/formatoFechas";
import { formatMoney } from "./formato";
import type { CreditLot } from "./tipos";

const ORIGEN: Record<NonNullable<CreditLot["origin"]>, string> = {
  CIERRE: "del cierre",
  DJ: "de la declaración jurada",
  MANUAL: "de la carga manual",
};

/** Saldos con disponible que nacieron en un período anterior al inicio del legajo. */
export function saldosDeMesesAnteriores(lots: CreditLot[], periodoInicio: string): CreditLot[] {
  const inicio = periodoInicio.slice(0, 10);
  return lots.filter(
    (lot) =>
      lot.period !== null &&
      lot.period !== undefined &&
      lot.period.startDate.slice(0, 10) < inicio &&
      Number(lot.available) > 0,
  );
}

/** Rango (desde y hasta, ISO) del mes calendario anterior al inicio del legajo. */
export function rangoMesAnterior(periodoInicio: string): { desde: string; hasta: string } {
  const [anio = 1970, mes = 1] = periodoInicio.slice(0, 7).split("-").map(Number);
  const primero = new Date(Date.UTC(anio, mes - 2, 1));
  const ultimo = new Date(Date.UTC(anio, mes - 1, 0));
  return { desde: primero.toISOString().slice(0, 10), hasta: ultimo.toISOString().slice(0, 10) };
}

/**
 * Frase de origen de un saldo arrastrado. Dice de dónde viene, cuánto queda y si el cálculo lo toma:
 * solo un saldo verificado y que se arrastra se aplica (B1: un saldo sin verificar no reduce el impuesto).
 */
export function fraseDeArrastre(lot: CreditLot): string {
  const mes = lot.period ? formatearMes(lot.period.startDate.slice(0, 10)) : "período anterior";
  const origen = ORIGEN[lot.origin ?? "MANUAL"];
  const impuesto = lot.taxType?.name ?? "Impuesto";
  const cabecera = `Viene ${origen} de ${mes}, ${impuesto}: ${formatMoney(lot.available)}`;
  if (lot.carryForward === false) return `${cabecera}; no se arrastra al calcular`;
  if (lot.verificationStatus !== "VERIFIED") {
    return `${cabecera}; falta verificarlo: no se aplica hasta entonces`;
  }
  return `${cabecera}; se aplica solo al calcular`;
}
