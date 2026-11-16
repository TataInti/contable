import { Prisma } from "@prisma/client";
import type { CreditLotOrigin, DeclarationCreditLotResult } from "@contable/contracts";

/**
 * Saldos del libro que nacen de la declaración jurada (corte 6a).
 *
 * Un solo lugar para: el origen de cada lote (P3), la planificación pura de lo que una DJ debe
 * dejar en el libro, la aplicación dentro de la transacción de la DJ y la cascada cuando una
 * liquidación queda reemplazada por otra versión. Reglas: S-6.1 a S-6.10 (ver el PR).
 */

/** Error de negocio de los lotes; el servicio de la DJ lo traduce a su propio error (P4: campo y motivo). */
export class CreditLotError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly path: string[];

  constructor(code: string, message: string, httpStatus: number, path: string[]) {
    super(message);
    this.name = "CreditLotError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.path = path;
  }
}

export interface EntradaPlanificacion {
  obligacion: { taxTypeId: string; regimeId: string; jurisdictionId: string; esIva: boolean };
  /** Alcance de la liquidación (igual que el cierre); null si la presentación no tiene liquidación. */
  liquidacion: { regimeId: string; jurisdictionId: string } | null;
  saldoFavorTecnico: string;
  saldoLibreDisponibilidad: string;
  /** undefined: la DJ no informa detalle; array (aun vacío): informa el detalle completo. */
  saldosFavorDetalle?:
    | ReadonlyArray<{
        taxTypeId: string;
        regimeId?: string | undefined;
        jurisdictionId?: string | undefined;
        amount: string;
      }>
    | undefined;
  /** La liquidación tiene una versión posterior (supersedesId) o está SUPERSEDED. */
  reemplazada: boolean;
}

export interface LoteDeseado {
  kind: string;
  taxTypeId: string;
  regimeId: string;
  jurisdictionId: string | null;
  amount: string;
}

export interface NoCreado {
  kind: string;
  taxTypeId: string;
  regimeId: string | null;
  jurisdictionId: string | null;
  amount: string;
  motivo: string;
}

export interface PlanLotes {
  lotes: LoteDeseado[];
  noCreados: NoCreado[];
  /** Qué clases de cierre quedan reemplazadas por la DJ (S-6.2). */
  cubre: { ivaTecnicoLibre: boolean; saldoAFavor: boolean };
}

const MOTIVO_REEMPLAZADA =
  "la liquidación fue reemplazada por una versión posterior: su declaración no crea saldos en el libro";
const MOTIVO_CERO = "saldo en cero: la DJ queda registrada y no crea lote";
const MOTIVO_NO_IVA =
  "solo IVA: el saldo técnico y el libre se declaran en la DJ de IVA; esta obligación no los genera";
const MOTIVO_OTRO =
  "el saldo es de otro impuesto o régimen: se carga en la obligación de ese impuesto y régimen";

/**
 * Qué debe quedar en el libro por esta DJ. Función pura: no lee ni escribe la base.
 * - IVA: técnico y libre con el alcance de la liquidación (régimen y jurisdicción, como el cierre).
 * - Detalle: solo los saldos del impuesto y régimen de la propia obligación (S-6.4).
 * - Liquidación reemplazada: no crea lotes (S-6.x, cascada de rectificativas).
 */
export function planificarLotesDeclaracion(e: EntradaPlanificacion): PlanLotes {
  const lotes: LoteDeseado[] = [];
  const noCreados: NoCreado[] = [];
  const regimeId = e.liquidacion?.regimeId ?? e.obligacion.regimeId;
  const jurisdictionId = e.liquidacion?.jurisdictionId ?? e.obligacion.jurisdictionId;
  const cubre = {
    ivaTecnicoLibre: e.obligacion.esIva && !e.reemplazada,
    saldoAFavor: e.saldosFavorDetalle !== undefined && !e.reemplazada,
  };

  const saldosIva = [
    { kind: "IVA_TECNICO", amount: new Prisma.Decimal(e.saldoFavorTecnico).toFixed(4) },
    { kind: "IVA_LIBRE", amount: new Prisma.Decimal(e.saldoLibreDisponibilidad).toFixed(4) },
  ];
  for (const { kind, amount } of saldosIva) {
    const base = { kind, taxTypeId: e.obligacion.taxTypeId, regimeId, jurisdictionId, amount };
    const positivo = new Prisma.Decimal(amount).greaterThan(0);
    if (e.reemplazada) {
      noCreados.push({ ...base, motivo: MOTIVO_REEMPLAZADA });
      continue;
    }
    if (!e.obligacion.esIva) {
      if (positivo) noCreados.push({ ...base, motivo: MOTIVO_NO_IVA });
      continue;
    }
    if (!positivo) {
      noCreados.push({ ...base, motivo: MOTIVO_CERO });
      continue;
    }
    lotes.push(base);
  }

  for (const item of e.saldosFavorDetalle ?? []) {
    const amount = new Prisma.Decimal(item.amount).toFixed(4);
    const itemRegimeId = item.regimeId ?? e.obligacion.regimeId;
    const base = {
      kind: "SALDO_A_FAVOR",
      taxTypeId: item.taxTypeId,
      regimeId: itemRegimeId,
      jurisdictionId: item.jurisdictionId ?? null,
      amount,
    };
    if (e.reemplazada) {
      noCreados.push({ ...base, motivo: MOTIVO_REEMPLAZADA });
      continue;
    }
    const propio =
      item.taxTypeId === e.obligacion.taxTypeId && itemRegimeId === e.obligacion.regimeId;
    if (!propio) {
      noCreados.push({ ...base, motivo: MOTIVO_OTRO });
      continue;
    }
    lotes.push(base);
  }

  return { lotes, noCreados, cubre };
}

/** Origen de un lote en el libro (un único lugar que lo calcula, P3). */
export function origenDelLote(lote: {
  sourceFilingId: string | null;
  sourceSettlementId: string | null;
}): CreditLotOrigin {
  if (lote.sourceFilingId) return "DJ";
  if (lote.sourceSettlementId) return "CIERRE";
  return "MANUAL";
}

/** Etiqueta del período: el nombre cargado o, si falta, MM/AAAA. */
export function etiquetaPeriodo(periodo: { label: string | null; startDate: Date }): string {
  if (periodo.label) return periodo.label;
  const mes = String(periodo.startDate.getUTCMonth() + 1).padStart(2, "0");
  return `${mes}/${periodo.startDate.getUTCFullYear()}`;
}

/** Motivo en lenguaje llano para un saldo que ya se usó en un cierre posterior (S-6.6). */
export function mensajeSaldoYaUsado(periodoPropio: string, periodoSiguiente: string): string {
  return `El saldo de ${periodoPropio} ya se usó en el cierre de ${periodoSiguiente}: rectificá ese cierre primero`;
}

/** Devuelve el motivo si el lote ya fue consumido por un cierre (movimiento ROLLED_FORWARD); si no, null. */
export async function motivoSiLoteUsado(
  tx: Prisma.TransactionClient,
  lote: { id: string; periodId: string | null },
): Promise<string | null> {
  const movimiento = await tx.taxCreditMovement.findFirst({
    where: { lotId: lote.id, kind: "ROLLED_FORWARD" },
    orderBy: { createdAt: "asc" },
    select: { settlementId: true },
  });
  if (!movimiento) return null;
  const propio = lote.periodId
    ? await tx.taxPeriod.findUnique({
        where: { id: lote.periodId },
        select: { label: true, startDate: true },
      })
    : null;
  const siguiente = movimiento.settlementId
    ? await tx.taxSettlement.findUnique({
        where: { id: movimiento.settlementId },
        select: { period: { select: { label: true, startDate: true } } },
      })
    : null;
  return mensajeSaldoYaUsado(
    propio ? etiquetaPeriodo(propio) : "el período del saldo",
    siguiente ? etiquetaPeriodo(siguiente.period) : "el período siguiente",
  );
}

export interface AplicarDeclaracionArgs {
  firmId: string;
  clientId: string;
  userId: string;
  actorKind: string;
  filingId: string;
  settlementId: string | null;
  periodId: string;
  plan: PlanLotes;
}

const claveDeLote = (l: { kind: string; regimeId: string | null; jurisdictionId: string | null }) =>
  `${l.kind}|${l.regimeId ?? ""}|${l.jurisdictionId ?? ""}`;

function resultado(
  status: DeclarationCreditLotResult["status"],
  base: {
    kind: string;
    taxTypeId: string;
    regimeId: string | null;
    jurisdictionId: string | null;
    amount: string;
  },
  lotId: string | null,
  reemplazaLotId: string | null,
  motivo: string | null = null,
): DeclarationCreditLotResult {
  return {
    status,
    kind: base.kind,
    taxTypeId: base.taxTypeId,
    regimeId: base.regimeId,
    jurisdictionId: base.jurisdictionId,
    amount: base.amount,
    lotId,
    reemplazaLotId,
    motivo,
  };
}

/**
 * Aplica la planificación dentro de la transacción de la DJ. Primero verifica si algún lote que
 * habría que reemplazar ya fue consumido por un cierre (S-6.6 y DJ tardía): en ese caso no escribe
 * nada y lanza CreditLotError. Después marca SUPERSEDED (con historial), crea los lotes VERIFIED
 * nuevos (con historial y auditoría) y devuelve el resultado por saldo.
 */
export async function aplicarLotesDeclaracion(
  tx: Prisma.TransactionClient,
  a: AplicarDeclaracionArgs,
): Promise<DeclarationCreditLotResult[]> {
  const clasesDeCierre = [
    ...(a.plan.cubre.ivaTecnicoLibre ? ["IVA_TECNICO", "IVA_LIBRE"] : []),
    ...(a.plan.cubre.saldoAFavor ? ["SALDO_A_FAVOR"] : []),
  ];
  const vigentes = await tx.taxCreditLot.findMany({
    where: {
      firmId: a.firmId,
      sourceFilingId: a.filingId,
      verificationStatus: { not: "SUPERSEDED" },
    },
    orderBy: { createdAt: "asc" },
  });
  const cierres =
    a.settlementId && clasesDeCierre.length > 0
      ? await tx.taxCreditLot.findMany({
          where: {
            firmId: a.firmId,
            sourceSettlementId: a.settlementId,
            verificationStatus: { not: "SUPERSEDED" },
            kind: { in: clasesDeCierre },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

  const deseados = new Map(a.plan.lotes.map((lote) => [claveDeLote(lote), lote] as const));
  const sinCambios = new Map<string, string>();
  const reemplazan = new Map<string, string>();
  const retirar: typeof vigentes = [];
  for (const lote of vigentes) {
    const clave = claveDeLote(lote);
    const deseado = deseados.get(clave);
    if (deseado && deseado.amount === lote.originalAmount.toFixed(4)) {
      sinCambios.set(clave, lote.id);
      continue;
    }
    retirar.push(lote);
    if (deseado) reemplazan.set(clave, lote.id);
  }

  const aSuperseder = [...retirar, ...cierres];
  if (aSuperseder.length > 0) {
    const usado = await tx.taxCreditMovement.findFirst({
      where: { lotId: { in: aSuperseder.map((l) => l.id) }, kind: "ROLLED_FORWARD" },
      select: { lotId: true },
    });
    if (usado) {
      const lote = aSuperseder.find((l) => l.id === usado.lotId);
      const motivo = lote ? await motivoSiLoteUsado(tx, lote) : null;
      throw new CreditLotError(
        "DECLARATION_CREDIT_ALREADY_USED",
        motivo ?? mensajeSaldoYaUsado("el período del saldo", "el período siguiente"),
        409,
        ["filingId"],
      );
    }
    await tx.taxCreditLot.updateMany({
      where: { id: { in: aSuperseder.map((l) => l.id) } },
      data: { verificationStatus: "SUPERSEDED" },
    });
    await tx.taxCreditLotHistory.createMany({
      data: aSuperseder.map((l) => ({
        lotId: l.id,
        firmId: a.firmId,
        clientId: a.clientId,
        createdByUserId: a.userId,
        changes: {
          verificationStatus: { from: l.verificationStatus, to: "SUPERSEDED" },
          motivo: l.sourceFilingId
            ? "La declaración jurada corrigió este saldo"
            : "La declaración jurada reemplaza el saldo de cierre de esta liquidación",
        } as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  const resultados: DeclarationCreditLotResult[] = [];
  for (const deseado of a.plan.lotes) {
    const clave = claveDeLote(deseado);
    const existente = sinCambios.get(clave);
    if (existente) {
      resultados.push(resultado("SIN_CAMBIOS", deseado, existente, null));
      continue;
    }
    const creado = await tx.taxCreditLot.create({
      data: {
        firmId: a.firmId,
        clientId: a.clientId,
        taxTypeId: deseado.taxTypeId,
        regimeId: deseado.regimeId,
        jurisdictionId: deseado.jurisdictionId,
        periodId: a.periodId,
        kind: deseado.kind,
        originalAmount: new Prisma.Decimal(deseado.amount),
        sourceFilingId: a.filingId,
        reference: "Declaración jurada",
        verificationStatus: "VERIFIED",
        verifiedByUserId: a.userId,
        verifiedAt: new Date(),
        createdByUserId: a.userId,
        carryForward: true,
      },
    });
    await tx.taxCreditLotHistory.create({
      data: {
        lotId: creado.id,
        firmId: a.firmId,
        clientId: a.clientId,
        createdByUserId: a.userId,
        changes: {
          origen: { from: null, to: "DJ" },
          verificationStatus: { from: null, to: "VERIFIED" },
          originalAmount: { from: null, to: deseado.amount },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditEvent.create({
      data: {
        firmId: a.firmId,
        clientId: a.clientId,
        userId: a.userId,
        actorKind: a.actorKind,
        action: "CREDIT_LOT_FROM_DECLARATION",
        entityType: "TaxCreditLot",
        entityId: creado.id,
        after: {
          kind: deseado.kind,
          amount: deseado.amount,
          sourceFilingId: a.filingId,
          verificationStatus: "VERIFIED",
          reemplaza: reemplazan.get(clave) ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    resultados.push(
      resultado(
        reemplazan.has(clave) ? "REEMPLAZADO" : "CREADO",
        deseado,
        creado.id,
        reemplazan.get(clave) ?? null,
      ),
    );
  }

  for (const lote of retirar) {
    if (deseados.has(claveDeLote(lote))) continue;
    resultados.push(
      resultado(
        "RETIRADO",
        { ...lote, amount: lote.originalAmount.toFixed(4) },
        lote.id,
        null,
        "la declaración ya no informa este saldo",
      ),
    );
  }
  for (const item of a.plan.noCreados) {
    resultados.push(resultado("NO_CREADO", item, null, null, item.motivo));
  }
  return resultados;
}

/**
 * Cascada de rectificativas: al finalizar la versión que reemplaza a una liquidación, los lotes
 * de la declaración jurada de la versión anterior dejan de contar (SUPERSEDED, con historial).
 */
export async function retirarLotesDeLaLiquidacionReemplazada(
  tx: Prisma.TransactionClient,
  a: { firmId: string; settlementId: string; userId: string },
): Promise<number> {
  const declaraciones = await tx.taxFiling.findMany({
    where: { firmId: a.firmId, settlementId: a.settlementId },
    select: { id: true },
  });
  if (declaraciones.length === 0) return 0;
  const lotes = await tx.taxCreditLot.findMany({
    where: {
      firmId: a.firmId,
      sourceFilingId: { in: declaraciones.map((d) => d.id) },
      verificationStatus: { not: "SUPERSEDED" },
    },
  });
  if (lotes.length === 0) return 0;
  await tx.taxCreditLot.updateMany({
    where: { id: { in: lotes.map((l) => l.id) } },
    data: { verificationStatus: "SUPERSEDED" },
  });
  await tx.taxCreditLotHistory.createMany({
    data: lotes.map((l) => ({
      lotId: l.id,
      firmId: a.firmId,
      clientId: l.clientId,
      createdByUserId: a.userId,
      changes: {
        verificationStatus: { from: l.verificationStatus, to: "SUPERSEDED" },
        motivo:
          "La liquidación fue reemplazada por una versión nueva: su declaración jurada deja de contar",
      } as unknown as Prisma.InputJsonValue,
    })),
  });
  return lotes.length;
}
