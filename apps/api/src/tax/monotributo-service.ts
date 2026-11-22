import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import {
  MONOTRIBUTO_ACTIVITIES,
  MONOTRIBUTO_CATEGORIES,
  MONOTRIBUTO_FAMILY_KEY,
  categoriaVigente,
  cuotaVigente,
  dueDateOf,
  estadoCuota,
  isPositiveAmount,
  isoDay,
  monthKey,
  monthStartFromKey,
  parseIsoDate,
  type EstadoCuota,
  type MonotributoActivity,
} from "./monotributo-cuota.js";

/**
 * Servicio de la cuota fija mensual del Monotributo (corte 3F).
 *
 * Categoría y tipo de actividad por vigencia (`client_monotributo_categories`), escala oficial
 * (`monotributo_cuotas`) y pagos de la cuota (`client_monotributo_payments`). No crea liquidación
 * ni declaración: el Legajo solo muestra la cuota del mes, su vencimiento y si está pagada.
 */

export type MonotributoErrorCode =
  | "MONOTRIBUTO_MONTH_INVALID"
  | "MONOTRIBUTO_CATEGORY_UNKNOWN"
  | "MONOTRIBUTO_ACTIVITY_UNKNOWN"
  | "MONOTRIBUTO_NOT_REGISTERED"
  | "MONOTRIBUTO_DATE_INVALID"
  | "MONOTRIBUTO_AMOUNT_INVALID";

/** Error con el campo y el motivo (P4): la ruta lo devuelve como `details.path`. */
export class MonotributoError extends Error {
  readonly code: MonotributoErrorCode;
  readonly path: string[];
  readonly httpStatus = 422;
  constructor(code: MonotributoErrorCode, message: string, path: string[]) {
    super(message);
    this.name = "MonotributoError";
    this.code = code;
    this.path = path;
  }
}

export interface MonotributoCategoryView {
  id: string;
  validFrom: string;
  category: string;
  activity: MonotributoActivity;
}

export interface MonotributoPaymentView {
  id: string;
  paidAt: string;
  amount: string;
  comprobante: string | null;
}

export interface MonotributoCatalogView {
  category: string;
  activity: MonotributoActivity;
  amount: string;
}

export interface MonotributoState {
  /** Mes de la cuota, «AAAA-MM». */
  month: string;
  /** ¿El cliente tiene inscripto el Monotributo nacional? Si no, la tarjeta no aparece. */
  applies: boolean;
  /** Regímenes con inscripción activa del Monotributo nacional (por id): la pestaña Regímenes los marca. */
  regimeIds: string[];
  status: EstadoCuota;
  /** Categoría y tipo que rigen el mes (por vigencia). */
  category: MonotributoCategoryView | null;
  /** Cuota total mensual del mes, con dos decimales. */
  fee: string | null;
  feeSource: string | null;
  dueDate: string;
  paid: string;
  pending: string | null;
  payments: MonotributoPaymentView[];
  /** Todas las vigencias del cliente, de la más reciente a la más antigua. */
  history: MonotributoCategoryView[];
  /** Escala vigente en el mes: categoría, tipo e importe (para elegir). */
  catalog: MonotributoCatalogView[];
}

type Tx = Prisma.TransactionClient;

const ACTIVITY_ORDER: readonly string[] = MONOTRIBUTO_ACTIVITIES;

/** Mes obligatorio «AAAA-MM» → primer día del mes, o error con el campo. */
function requireMonth(value: string): Date {
  const monthStart = monthStartFromKey(value);
  if (!monthStart) {
    throw new MonotributoError("MONOTRIBUTO_MONTH_INVALID", "Elegí el mes con formato AAAA-MM.", ["month"]);
  }
  return monthStart;
}

/**
 * ¿El cliente tiene inscripto el Monotributo nacional? Se resuelve por la familia de cálculo del
 * tipo de impuesto (catálogo de sistema), no por el código que escribió el usuario. El régimen
 * «Monotributo» de IIBB tiene su propio tipo de impuesto (IIBB) y no cuenta aquí.
 */
async function registrationsOfMonotributo(tx: Tx, firmId: string, clientId: string): Promise<string[]> {
  const registrations = await tx.taxRegistration.findMany({
    where: { firmId, clientId, status: "ACTIVE" },
    select: { regime: { select: { id: true, taxType: { select: { defaultFamily: { select: { key: true } } } } } } },
  });
  const ids = registrations
    .filter((row) => row.regime.taxType.defaultFamily?.key === MONOTRIBUTO_FAMILY_KEY)
    .map((row) => row.regime.id);
  return [...new Set(ids)];
}

async function stateWithTransaction(tx: Tx, firmId: string, clientId: string, monthStart: Date): Promise<MonotributoState> {
  const regimeIds = await registrationsOfMonotributo(tx, firmId, clientId);
  const applies = regimeIds.length > 0;
  const categories = await tx.clientMonotributoCategory.findMany({
    where: { firmId, clientId },
    orderBy: { validFrom: "desc" },
  });
  const escala = await tx.monotributoCuota.findMany({ where: { validFrom: { lte: monthStart } } });
  const payments = await tx.clientMonotributoPayment.findMany({
    where: { firmId, clientId, period: monthStart },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });

  const vigente = categoriaVigente(categories, monthStart);
  const cuota = vigente ? cuotaVigente(escala, vigente.category, vigente.activity, monthStart) : null;
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const status = estadoCuota({
    applies,
    hasCategory: Boolean(vigente),
    fee: cuota?.amount ?? null,
    paid,
  });
  const catalog = escala
    .filter((row) => !row.validTo || row.validTo.getTime() >= monthStart.getTime())
    .sort((a, b) => a.category.localeCompare(b.category) || ACTIVITY_ORDER.indexOf(a.activity) - ACTIVITY_ORDER.indexOf(b.activity))
    .map((row) => ({ category: row.category, activity: row.activity as MonotributoActivity, amount: row.amount.toFixed(2) }));

  return {
    month: monthKey(monthStart),
    applies,
    regimeIds,
    status,
    category: vigente
      ? { id: vigente.id, validFrom: isoDay(vigente.validFrom), category: vigente.category, activity: vigente.activity as MonotributoActivity }
      : null,
    fee: cuota ? cuota.amount.toFixed(2) : null,
    feeSource: cuota?.source ?? null,
    dueDate: dueDateOf(monthStart),
    paid: paid.toFixed(2),
    pending: cuota ? Prisma.Decimal.max(cuota.amount.minus(paid), 0).toFixed(2) : null,
    payments: payments.map((payment) => ({
      id: payment.id,
      paidAt: isoDay(payment.paidAt),
      amount: payment.amount.toFixed(2),
      comprobante: payment.comprobante,
    })),
    history: categories.map((row) => ({
      id: row.id,
      validFrom: isoDay(row.validFrom),
      category: row.category,
      activity: row.activity as MonotributoActivity,
    })),
    catalog,
  };
}

export class MonotributoService {
  /** Cuota del mes: categoría, importe, vencimiento, pagos e historial de vigencias. */
  async get(ctx: TenantContext, input: { clientId: string; month: string }): Promise<MonotributoState> {
    const monthStart = requireMonth(input.month);
    return withTenantContext(ctx, (tx) => stateWithTransaction(tx, ctx.firmId, input.clientId, monthStart));
  }

  /** Elige la categoría y el tipo de actividad desde un mes (una fila por cliente y mes de inicio). */
  async setCategory(
    ctx: TenantContext,
    input: { clientId: string; month: string; category: string; activity: string },
  ): Promise<MonotributoState> {
    const monthStart = requireMonth(input.month);
    const category = input.category.trim().toUpperCase();
    if (!(MONOTRIBUTO_CATEGORIES as readonly string[]).includes(category)) {
      throw new MonotributoError(
        "MONOTRIBUTO_CATEGORY_UNKNOWN",
        `La categoría "${input.category.trim()}" no existe. Elegí una de la A a la K.`,
        ["category"],
      );
    }
    if (!(MONOTRIBUTO_ACTIVITIES as readonly string[]).includes(input.activity)) {
      throw new MonotributoError("MONOTRIBUTO_ACTIVITY_UNKNOWN", "Elegí si la actividad es de servicios o de venta de bienes.", ["activity"]);
    }
    const activity = input.activity as MonotributoActivity;
    return withTenantContext(ctx, async (tx) => {
      if ((await registrationsOfMonotributo(tx, ctx.firmId, input.clientId)).length === 0) {
        throw new MonotributoError(
          "MONOTRIBUTO_NOT_REGISTERED",
          "El cliente no tiene inscripto el Monotributo. Inscribilo en Regímenes para elegir la categoría.",
          ["category"],
        );
      }
      await tx.clientMonotributoCategory.upsert({
        where: { firmId_clientId_validFrom: { firmId: ctx.firmId, clientId: input.clientId, validFrom: monthStart } },
        update: { category, activity },
        create: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          validFrom: monthStart,
          category,
          activity,
          ...(ctx.userId ? { createdByUserId: ctx.userId } : {}),
        },
      });
      return stateWithTransaction(tx, ctx.firmId, input.clientId, monthStart);
    });
  }

  /** Registra un pago de la cuota del mes (fecha, importe y comprobante opcional). */
  async recordPayment(
    ctx: TenantContext,
    input: { clientId: string; month: string; paidAt: string; amount: string; comprobante?: string | undefined },
  ): Promise<MonotributoState> {
    const monthStart = requireMonth(input.month);
    const paidAt = parseIsoDate(input.paidAt);
    if (!paidAt) {
      throw new MonotributoError("MONOTRIBUTO_DATE_INVALID", "Ingresá la fecha del pago como día, mes y año.", ["paidAt"]);
    }
    if (!isPositiveAmount(input.amount.trim())) {
      throw new MonotributoError("MONOTRIBUTO_AMOUNT_INVALID", "El importe debe ser mayor que cero, con hasta dos decimales.", ["amount"]);
    }
    const comprobante = input.comprobante?.trim() ? input.comprobante.trim() : null;
    return withTenantContext(ctx, async (tx) => {
      if ((await registrationsOfMonotributo(tx, ctx.firmId, input.clientId)).length === 0) {
        throw new MonotributoError(
          "MONOTRIBUTO_NOT_REGISTERED",
          "El cliente no tiene inscripto el Monotributo. Inscribilo en Regímenes para registrar pagos.",
          [],
        );
      }
      await tx.clientMonotributoPayment.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          period: monthStart,
          paidAt,
          amount: new Prisma.Decimal(input.amount.trim()),
          comprobante,
          ...(ctx.userId ? { createdByUserId: ctx.userId } : {}),
        },
      });
      return stateWithTransaction(tx, ctx.firmId, input.clientId, monthStart);
    });
  }
}
