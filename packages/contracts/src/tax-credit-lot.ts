import { z } from "zod";

/**
 * Libro de créditos fiscales (corte 6a): origen de cada lote, resultado de la declaración jurada
 * por saldo y el interruptor de arrastre. Los lotes nacen de un cierre (CIERRE), de una DJ (DJ)
 * o de un saldo inicial cargado a mano (MANUAL).
 */

export const CREDIT_LOT_ORIGINS = ["CIERRE", "DJ", "MANUAL"] as const;
export type CreditLotOrigin = (typeof CREDIT_LOT_ORIGINS)[number];

/** Qué pasó con cada saldo al cargar la DJ (saldosGenerados). Los que no se crean traen su motivo (P4). */
export const DECLARATION_CREDIT_LOT_STATUSES = [
  "CREADO",
  "REEMPLAZADO",
  "SIN_CAMBIOS",
  "RETIRADO",
  "NO_CREADO",
] as const;
export type DeclarationCreditLotStatus = (typeof DECLARATION_CREDIT_LOT_STATUSES)[number];

export interface DeclarationCreditLotResult {
  status: DeclarationCreditLotStatus;
  kind: string;
  taxTypeId: string;
  regimeId: string | null;
  jurisdictionId: string | null;
  amount: string;
  lotId: string | null;
  reemplazaLotId: string | null;
  motivo: string | null;
}

/** Corrección del arrastre de un lote: «no arrastrar este saldo» (decisión D13-5 a; el dato y la API). */
export const creditLotCarryForwardSchema = z.boolean();
