import { Prisma } from "@prisma/client";

/**
 * Saldos vigentes: el único lugar que define qué lotes de crédito cuentan y cuánto queda
 * disponible en cada uno (P3, P5). Lo usan el cálculo de la liquidación, la posición fiscal
 * («Disponible») y la lista de la etapa Saldos, para que las tres pantallas muestren la misma cifra.
 *
 * Un lote es vigente para una obligación cuando está VERIFIED, arrastra (carryForward), es del
 * mismo impuesto, comparte régimen y jurisdicción (o no los fija) y su período es el de la
 * obligación o uno anterior (o no tiene período). B1 (§3.1): un saldo no verificado nunca reduce
 * un impuesto.
 */

type Tx = Prisma.TransactionClient;

export interface AlcanceSaldosVigentes {
  firmId: string;
  clientId: string;
  taxTypeId: string;
  regimeId: string;
  jurisdictionId: string | null;
  /** Períodos elegibles: ver `periodosElegibles`. */
  periodIds: string[];
  /** Familias que cierran por jurisdicción (CM03): el saldo se acota por régimen, no por jurisdicción. */
  ignorarJurisdiccion?: boolean;
}

/** Períodos del mismo impuesto cuyo fin es anterior o igual al del período que se calcula. */
export async function periodosElegibles(
  tx: Tx,
  alcance: { firmId: string; clientId: string; taxTypeId: string; hasta: Date },
): Promise<string[]> {
  const periods = await tx.taxPeriod.findMany({
    where: {
      firmId: alcance.firmId,
      clientId: alcance.clientId,
      taxTypeId: alcance.taxTypeId,
      endDate: { lte: alcance.hasta },
    },
    select: { id: true },
  });
  return periods.map((item) => item.id);
}

/** Filtro `where` de los lotes vigentes del alcance. */
export function filtroSaldosVigentes(
  alcance: AlcanceSaldosVigentes,
): Prisma.TaxCreditLotWhereInput {
  return {
    firmId: alcance.firmId,
    clientId: alcance.clientId,
    taxTypeId: alcance.taxTypeId,
    // B1 (§3.1): un saldo no verificado nunca reduce un impuesto.
    verificationStatus: "VERIFIED",
    // Corte 6a: un saldo que no se arrastra (carryForward = false) no entra al cálculo.
    carryForward: true,
    OR: [{ periodId: null }, { periodId: { in: alcance.periodIds } }],
    AND: {
      OR: alcance.ignorarJurisdiccion
        ? [{ regimeId: alcance.regimeId }, { regimeId: null }]
        : [
            { regimeId: alcance.regimeId, jurisdictionId: alcance.jurisdictionId },
            { regimeId: alcance.regimeId, jurisdictionId: null },
            { regimeId: null, jurisdictionId: alcance.jurisdictionId },
            { regimeId: null, jurisdictionId: null },
          ],
    },
  };
}

/** Lo que queda de un lote: el original menos sus movimientos confirmados. */
export function disponibleDelLote(lot: {
  originalAmount: Prisma.Decimal;
  movements: Array<{ amount: Prisma.Decimal }>;
}): Prisma.Decimal {
  return lot.originalAmount.minus(
    lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0)),
  );
}

/** Lotes con disponible positivo y su disponible: los únicos que el cálculo aplica. */
export function lotesConDisponible<
  T extends { originalAmount: Prisma.Decimal; movements: Array<{ amount: Prisma.Decimal }> },
>(lots: T[]): Array<{ lot: T; available: Prisma.Decimal }> {
  return lots
    .map((lot) => ({ lot, available: disponibleDelLote(lot) }))
    .filter((entry) => entry.available.isPositive());
}

/** Suma del disponible de los lotes con saldo (lo que muestra «Disponible»). */
export function sumaDisponible(
  lots: Array<{ originalAmount: Prisma.Decimal; movements: Array<{ amount: Prisma.Decimal }> }>,
): Prisma.Decimal {
  return lotesConDisponible(lots).reduce(
    (sum, entry) => sum.plus(entry.available),
    new Prisma.Decimal(0),
  );
}

/**
 * Lista de la etapa Saldos: oculta los lotes reemplazados (SUPERSEDED). Su historial queda en el
 * lote que los reemplazó y en `tax_credit_lot_history`. Un lote sin verificar sigue apareciendo.
 */
export const FILTRO_SALDOS_SIN_REEMPLAZADOS: Prisma.TaxCreditLotWhereInput = {
  verificationStatus: { not: "SUPERSEDED" },
};
