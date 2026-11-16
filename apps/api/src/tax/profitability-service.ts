import { Prisma } from "@prisma/client";
import {
  CAJA_FISCAL_ENGINE_VERSION,
  calculateCajaFiscal,
  calculateProfitability,
  isFiscalExpense,
  type CajaFiscalImpuesto,
  type CajaFiscalLado,
} from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { faltaDeclaracion } from "./period-status.js";
import { voucherDocumentKind } from "./workpaper-classification.js";

/**
 * Servicio de rentabilidad gerencial (Puerta 5, G5-01..G5-05).
 *
 * Produce ProfitabilitySnapshot reproducibles en dos bases:
 * - DEVENGADO: ventas netas − gastos fiscales − gastos de gestión −
 *   impuestos del período → resultado gerencial luego de impuestos.
 * - CAJA: cobros − pagos fiscales − pagos de gestión − pagos impositivos
 *   (incluye efecto de caja del IVA) → flujo neto.
 *
 * Invariantes (PLAN §5.7, §7.7):
 * - G5-01/02: devengado y caja nunca se mezclan (misma entrada, bases
 *   separadas y publicadas por separado).
 * - G5-03: un gasto MANAGEMENT_ONLY afecta la rentabilidad pero no los
 *   impuestos; sólo una decisión profesional FISCAL_COMPUTABLE lo vuelve
 *   computable (derivando TaxAdjustment).
 * - G5-04: los impuestos del período son costo del período; el IVA
 *   trasladado es posición fiscal informativa y sólo su efecto de caja
 *   entra en la vista de caja.
 * - G5-05: publicar crea un snapshot inmutable versionado; un cambio de
 *   entrada genera una nueva versión y nunca reescribe la publicada.
 * - Determinismo: mismo input + misma regla + mismo motor → mismo hash.
 */

export type ProfitabilityErrorCode =
  | "PERIOD_NOT_FOUND"
  | "SNAPSHOT_NOT_FOUND"
  | "ALREADY_PUBLISHED"
  | "INVALID_TRANSITION"
  | "NOT_PUBLISHED"
  | "CLIENT_NOT_FOUND";

export class ProfitabilityError extends Error {
  readonly code: ProfitabilityErrorCode;
  constructor(code: ProfitabilityErrorCode, message: string) {
    super(message);
    this.name = "ProfitabilityError";
    this.code = code;
  }
}

type Tx = Prisma.TransactionClient;
type Basis = "DEVENGADO" | "CAJA";

export interface ProfitabilityParams {
  clientId: string;
  periodId: string;
  basis: Basis;
  cutoff: string;
}

/** Recaudación de las entradas del período para el motor. */
interface ProfitabilityFacts {
  sales: Prisma.Decimal;
  fiscalExpenses: Prisma.Decimal;
  managementExpenses: Prisma.Decimal;
  /** Ingresos gerenciales APPROVED devengados en el período (§7.2). */
  managementIncomeAccrued: Prisma.Decimal;
  /** Ingresos gerenciales APPROVED cobrados en el período (CAJA, §7.2). */
  managementIncomeCollected: Prisma.Decimal;
  /** Deuda devengada del período (DEVENGADO). */
  accruedTaxPayments: Prisma.Decimal;
  /** Pagos efectivos del período (CAJA). */
  paidTaxPayments: Prisma.Decimal;
  vatCashEffect: Prisma.Decimal;
  vatPosition?: {
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    withholding: Prisma.Decimal;
    perception: Prisma.Decimal;
  };
  inputIds: string[];
}

export class ProfitabilityService {
  /** Reúne las entradas del período (hechos aprobados dentro de período+cutoff). */
  private async gatherFacts(
    ctx: TenantContext,
    tx: Tx,
    params: ProfitabilityParams,
  ): Promise<ProfitabilityFacts> {
    const { clientId, periodId, cutoff } = params;
    const period = await tx.taxPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new ProfitabilityError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

    const cutoffDate = `${cutoff}T23:59:59.999Z`;
    const periodFilter = {
      firmId: ctx.firmId,
      clientId,
      issuedOn: { gte: period.startDate, lte: period.endDate },
      status: "APPROVED" as const,
    };

    // --- Ventas netas (base imponible de ventas) ---
    const salesVouchers = await tx.fiscalVoucher.findMany({
      where: { ...periodFilter, direction: "SALE" },
      include: { components: true, lines: true },
    });
    let sales = new Prisma.Decimal(0);
    const inputIds: string[] = [];
    for (const v of salesVouchers) {
      if (v.issuedOn.toISOString() > cutoffDate) continue;
      for (const c of v.components) {
        if (c.concept === "NETO") {
          sales = sales.plus(c.base);
          inputIds.push(`${v.id}:${c.id}`);
        }
      }
    }

    // --- Gastos con respaldo fiscal (compras netas aprobadas) ---
    const purchaseVouchers = await tx.fiscalVoucher.findMany({
      where: { ...periodFilter, direction: "PURCHASE" },
      include: { components: true },
    });
    let fiscalExpenses = new Prisma.Decimal(0);
    for (const v of purchaseVouchers) {
      if (v.issuedOn.toISOString() > cutoffDate) continue;
      for (const c of v.components) {
        if (c.concept === "NETO") {
          fiscalExpenses = fiscalExpenses.plus(c.base);
          inputIds.push(`${v.id}:${c.id}`);
        }
      }
    }

    // --- Gastos gerenciales (con/sin respaldo fiscal, G5-03) ---
    const expenses = await tx.managementExpense.findMany({
      where: {
        firmId: ctx.firmId,
        clientId,
        incurredOn: { gte: period.startDate, lte: period.endDate },
        status: "APPROVED",
      },
    });
    let managementExpenses = new Prisma.Decimal(0);
    for (const e of expenses) {
      // Un gasto con respaldo fiscal o con tratamiento FISCAL_* suma a la
      // columna fiscal; MANAGEMENT_ONLY va a gestión (nunca a impuestos).
      if (isFiscalExpense(e.taxTreatment, e.hasFiscalSupport)) {
        fiscalExpenses = fiscalExpenses.plus(e.amount);
      } else {
        managementExpenses = managementExpenses.plus(e.amount);
      }
      inputIds.push(`exp:${e.id}`);
    }

    // --- C (§7.2): ingresos gerenciales aprobados ---
    // Sólo APPROVED participa. DEVENGADO: fecha devengada en período.
    // CAJA: fecha de cobro en período. Nunca tocan el dominio fiscal.
    const incomes = await tx.managementIncome.findMany({
      where: {
        firmId: ctx.firmId,
        clientId,
        status: "APPROVED",
      },
    });
    let managementIncomeAccrued = new Prisma.Decimal(0);
    let managementIncomeCollected = new Prisma.Decimal(0);
    for (const income of incomes) {
      if (
        income.accruedOn >= period.startDate &&
        income.accruedOn <= period.endDate &&
        income.accruedOn.toISOString() <= cutoffDate
      ) {
        managementIncomeAccrued = managementIncomeAccrued.plus(income.amount);
        inputIds.push(`income:${income.id}`);
      }
      if (
        income.collectedOn &&
        income.collectedOn >= period.startDate &&
        income.collectedOn <= period.endDate
      ) {
        managementIncomeCollected = managementIncomeCollected.plus(income.amount);
      }
    }

    // --- Impuestos del período: liquidaciones FINALIZED del cliente ---
    // En devengado son costo del período; en caja son pagos impositivos.
    // El IVA trasladado NO es gasto económico: se informa como posición.
    const settlements = await tx.taxSettlement.findMany({
      where: {
        firmId: ctx.firmId,
        clientId,
        status: "FINALIZED",
        period: { startDate: { gte: period.startDate }, endDate: { lte: period.endDate } },
      },
    });

    let accruedTaxPayments = new Prisma.Decimal(0);
    let paidTaxPayments = new Prisma.Decimal(0);
    const vatCashEffect = new Prisma.Decimal(0);
    let vatPosition: ProfitabilityFacts["vatPosition"];
    for (const s of settlements) {
      inputIds.push(`settlement:${s.id}`);
      // Deuda devengada del período (costo del período en DEVENGADO).
      const totals = (s.totals ?? {}) as Record<string, string>;
      const due = totals["TOTAL_A_INGRESAR"] ?? totals["totalDue"];
      if (due !== undefined) {
        accruedTaxPayments = accruedTaxPayments.plus(new Prisma.Decimal(due));
      }
      // Pagos registrados sobre liquidaciones del período (CAJA).
      const paid = await tx.taxPayment.aggregate({
        where: {
          firmId: ctx.firmId,
          clientId,
          settlementId: s.id,
          status: "PAID",
          paidAt: { gte: period.startDate, lte: period.endDate },
        },
        _sum: { amount: true },
      });
      const paidAmount = paid._sum.amount ?? new Prisma.Decimal(0);
      paidTaxPayments = paidTaxPayments.plus(paidAmount);

      // Efecto de caja del IVA: la liquidación IVA finalizada es una deuda;
      // su pago efectivo (paidTaxPayments) ES el efecto de caja del IVA.
      // La posición IVA (POSICION_IVA) es informativa y nunca se duplica.
      const debit = totals["DEBITO_FISCAL"];
      const credit = totals["CREDITO_FISCAL"];
      if (debit !== undefined && credit !== undefined) {
        const wh = totals["RETENCIONES"] ?? "0";
        const perc = totals["PERCEPCIONES"] ?? "0";
        const d = new Prisma.Decimal(debit);
        const c = new Prisma.Decimal(credit);
        const w = new Prisma.Decimal(wh);
        const p = new Prisma.Decimal(perc);
        vatPosition = vatPosition
          ? {
              debit: vatPosition.debit.plus(d),
              credit: vatPosition.credit.plus(c),
              withholding: vatPosition.withholding.plus(w),
              perception: vatPosition.perception.plus(p),
            }
          : { debit: d, credit: c, withholding: w, perception: p };
      }
    }

    return {
      sales,
      fiscalExpenses,
      managementExpenses,
      managementIncomeAccrued,
      managementIncomeCollected,
      accruedTaxPayments,
      paidTaxPayments,
      vatCashEffect,
      ...(vatPosition ? { vatPosition } : {}),
      inputIds,
    };
  }

  /**
   * G5-01/02: calcula (o recalcula) el snapshot en la base pedida.
   * Determinista: misma entrada → mismo hash (V-004 extendido).
   */
  async calculate(ctx: TenantContext, params: ProfitabilityParams) {
    return withTenantContext(ctx, async (tx) => {
      const period = await tx.taxPeriod.findUnique({ where: { id: params.periodId } });
      if (!period) throw new ProfitabilityError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      const facts = await this.gatherFacts(ctx, tx, params);
      // §7.2: los ingresos gerenciales aumentan el resultado gerencial;
      // en devengado cuentan por fecha devengada, en caja por fecha de
      // cobro. Se suman a las ventas (columna gerencial) sin tocar el
      // dominio fiscal.
      const sales = params.basis === "CAJA"
        ? facts.sales.plus(facts.managementIncomeCollected)
        : facts.sales.plus(facts.managementIncomeAccrued);
      const result = calculateProfitability({
        engineVersion: "ar-profitability-v1.0.0",
        basis: params.basis,
        period: {
          startDate: period.startDate.toISOString().slice(0, 10),
          endDate: period.endDate.toISOString().slice(0, 10),
          cutoff: params.cutoff,
        },
        sales: sales.toString(),
        fiscalExpenses: facts.fiscalExpenses.toString(),
        managementExpenses: facts.managementExpenses.toString(),
        // DEVENGADO usa la deuda del período; CAJA usa los pagos efectivos.
        taxPayments:
          params.basis === "CAJA"
            ? facts.paidTaxPayments.toString()
            : facts.accruedTaxPayments.toString(),
        // El efecto de caja del IVA ya está en el pago de la liquidación;
        // la posición IVA se informa por separado (nunca como gasto).
        vatCashEffect: "0.00",
        ...(facts.vatPosition
          ? {
              vatPosition: {
                debit: facts.vatPosition.debit.toString(),
                credit: facts.vatPosition.credit.toString(),
                withholding: facts.vatPosition.withholding.toString(),
                perception: facts.vatPosition.perception.toString(),
              },
            }
          : {}),
      });

      const totals = result.subtotals as Record<string, string>;
      const lines = result.lines.map((l) => ({
        concept: l.concept,
        formula: l.formula,
        inputs: l.inputs,
        result: l.result,
      }));

      const existing = await tx.profitabilitySnapshot.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: params.clientId,
          periodId: params.periodId,
          basis: params.basis,
          status: { in: ["DRAFT"] },
        },
      });

      // Versión siguiente: si no hay DRAFT (p.ej. tras publicar), se crea una
      // versión nueva y la publicada queda SUPERSEDED (G5-05).
      const latestVersion = existing
        ? existing.version
        : await tx.profitabilitySnapshot.aggregate({
            where: {
              firmId: ctx.firmId,
              clientId: params.clientId,
              periodId: params.periodId,
              basis: params.basis,
            },
            _max: { version: true },
          }).then((agg) => agg._max.version ?? 0);

      const core = {
        cutoff: new Date(`${params.cutoff}T00:00:00.000Z`),
        engineVersion: result.engineVersion,
        totals: totals as unknown as Prisma.InputJsonValue,
        lines: lines as unknown as Prisma.InputJsonValue,
        inputHash: result.inputHash,
        outputHash: result.outputHash,
        inputIds: facts.inputIds as unknown as Prisma.InputJsonValue,
        status: "DRAFT" as const,
      };

      const snapshot = existing
        ? await tx.profitabilitySnapshot.update({ where: { id: existing.id }, data: core })
        : await tx.profitabilitySnapshot.create({
            data: {
              firmId: ctx.firmId,
              clientId: params.clientId,
              periodId: params.periodId,
              basis: params.basis,
              version: latestVersion + 1,
              ...core,
            },
          });

      return { snapshot, lines, result: { warnings: result.warnings, blocks: result.blocks } };
    });
  }

  /**
   * G5-05: publica la versión en curso. Publicar es irreversible: crea un
   * snapshot PUBLISHED inmutable; recalcular luego crea una versión nueva
   * (SUPERSEDED nunca se reescribe).
   */
  async publish(ctx: TenantContext, input: { clientId: string; periodId: string; basis: Basis }) {
    return withTenantContext(ctx, async (tx) => {
      const snapshot = await tx.profitabilitySnapshot.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          periodId: input.periodId,
          basis: input.basis,
          status: "DRAFT",
        },
        orderBy: { version: "desc" },
      });
      if (!snapshot) {
        // Publicar exige un snapshot calculado primero.
        throw new ProfitabilityError(
          "SNAPSHOT_NOT_FOUND",
          "No existe un snapshot DRAFT para publicar; calculalo primero",
        );
      }

      const published = await tx.profitabilitySnapshot.update({
        where: { id: snapshot.id },
        data: { status: "PUBLISHED", publishedById: ctx.userId, publishedAt: new Date() },
      });

      // Las versiones publicadas anteriores de la misma base quedan
      // SUPERSEDED: se conservan para lectura histórica, nunca se borran.
      await tx.profitabilitySnapshot.updateMany({
        where: {
          firmId: ctx.firmId,
          clientId: published.clientId,
          periodId: published.periodId,
          basis: published.basis,
          status: "PUBLISHED",
          id: { not: published.id },
        },
        data: { status: "SUPERSEDED" },
      });

      return published;
    });
  }

  /**
   * Saldo de caja fiscal del período (corte 8a). Cálculo en vivo y solo lectura: no escribe ni publica.
   * Comprobantes APPROVED con issuedOn en el período (como gatherFacts). Por impuesto, la DJ de la
   * liquidación vigente: la última FINALIZED que no reemplaza otra FINALIZED (supersedesId).
   */
  async cajaFiscal(ctx: TenantContext, params: { clientId: string; periodId: string }) {
    return withTenantContext(ctx, async (tx) => {
      const cliente = await tx.client.findFirst({
        where: { id: params.clientId, firmId: ctx.firmId },
        select: { id: true },
      });
      if (!cliente) {
        throw new ProfitabilityError("CLIENT_NOT_FOUND", "Cliente no encontrado en este estudio");
      }
      const periodo = await tx.taxPeriod.findFirst({
        where: { id: params.periodId, firmId: ctx.firmId, clientId: params.clientId },
      });
      if (!periodo) throw new ProfitabilityError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      const comprobantes = await tx.fiscalVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: params.clientId,
          status: "APPROVED",
          issuedOn: { gte: periodo.startDate, lte: periodo.endDate },
        },
        select: {
          id: true,
          direction: true,
          type: true,
          letter: true,
          total: true,
          currency: true,
          exchangeRate: true,
        },
      });
      const ventas = nuevoLado();
      const compras = nuevoLado();
      for (const v of comprobantes) acumular(v.direction === "SALE" ? ventas : compras, v);

      const obligaciones = await tx.taxObligation.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: params.clientId,
          status: { not: "NOT_APPLICABLE" },
          period: { startDate: { gte: periodo.startDate }, endDate: { lte: periodo.endDate } },
        },
        select: {
          id: true,
          regimeId: true,
          periodId: true,
          regime: { select: { code: true, taxType: { select: { code: true } } } },
          period: { select: { startDate: true } },
        },
      });
      const liquidaciones = await tx.taxSettlement.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: params.clientId,
          status: "FINALIZED",
          period: { startDate: { gte: periodo.startDate }, endDate: { lte: periodo.endDate } },
        },
        select: {
          id: true,
          regimeId: true,
          periodId: true,
          version: true,
          supersedesId: true,
          filings: {
            select: { id: true, obligationId: true, status: true, declaredAt: true, totalAPagar: true },
          },
        },
      });
      // Reemplazada = otra liquidación FINALIZED la tiene como antecesora. No se usa el estado SUPERSEDED:
      // la rectificativa no lo marca y trg_settlement_immutable impide cambiarlo en una FINALIZED.
      const reemplazadas = new Set(
        liquidaciones.map((l) => l.supersedesId).filter((id): id is string => id !== null),
      );
      const vigentes = liquidaciones.filter((l) => !reemplazadas.has(l.id));

      const impuestos: CajaFiscalImpuesto[] = obligaciones
        .map((ob) => {
          const vigente = vigentes
            .filter((l) => l.regimeId === ob.regimeId && l.periodId === ob.periodId)
            .sort((a, b) => b.version - a.version)[0];
          const presentacion = vigente?.filings
            .filter((f) => f.obligationId === ob.id && f.status === "FILED")
            .sort((a, b) => (b.declaredAt?.getTime() ?? 0) - (a.declaredAt?.getTime() ?? 0))[0];
          const facts = presentacion
            ? {
                hasAcuse: true,
                hasDeclaration: presentacion.declaredAt !== null && presentacion.totalAPagar !== null,
              }
            : null;
          const dj =
            presentacion && presentacion.totalAPagar !== null && !faltaDeclaracion(facts)
              ? { id: presentacion.id, totalAPagar: presentacion.totalAPagar.toFixed(4) }
              : null;
          return {
            impuesto: ob.regime.taxType.code,
            periodo: etiquetaMes(ob.period.startDate),
            regimen: ob.regime.code,
            dj,
          };
        })
        .sort((a, b) => `${a.impuesto}|${a.regimen}`.localeCompare(`${b.impuesto}|${b.regimen}`));

      const periodoEtiqueta = etiquetaMes(periodo.startDate);
      const resultado = calculateCajaFiscal({
        periodo: { id: periodo.id, etiqueta: periodoEtiqueta },
        ventas: ladoParaMotor(ventas),
        compras: ladoParaMotor(compras),
        impuestos,
      });
      return {
        data: {
          estado: resultado.estado,
          cifra: resultado.cifra,
          periodo: { id: periodo.id, etiqueta: periodoEtiqueta },
          desglose: resultado.desglose,
          faltantes: resultado.faltantes,
          comprobantes: resultado.comprobantes,
          inputHash: resultado.inputHash,
          outputHash: resultado.outputHash,
        },
        meta: {
          base: "CAJA_FISCAL" as const,
          publicado: false as const,
          moneda: "ARS" as const,
          motor: CAJA_FISCAL_ENGINE_VERSION,
          paginacion: "no aplica: una fila por cliente y período" as const,
        },
      };
    });
  }

  /** Lista snapshots del período (historial versionado). */
  async listForPeriod(ctx: TenantContext, clientId: string, periodId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.profitabilitySnapshot.findMany({
        where: { firmId: ctx.firmId, clientId, periodId },
        orderBy: [{ basis: "asc" }, { version: "desc" }],
        take: 50,
      }),
    );
  }

  /** Lista snapshots del cliente (más recientes primero). */
  async list(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.profitabilitySnapshot.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { period: { select: { label: true, startDate: true, endDate: true } } },
        orderBy: [{ periodId: "desc" }, { basis: "asc" }, { version: "desc" }],
        take: 100,
      }),
    );
  }

  /** Última versión publicada por base (lo que ve el portal). */
  async latestPublished(ctx: TenantContext, clientId: string, periodId: string) {
    const all = await this.listForPeriod(ctx, clientId, periodId);
    return all.filter((s) => s.status === "PUBLISHED");
  }
}

/** Instancia única del servicio de rentabilidad. */
export const profitabilityService = new ProfitabilityService();

interface LadoAcumulado {
  comprobantes: number;
  facturado: Prisma.Decimal;
  notasCredito: Prisma.Decimal;
  sinTipoDeCambio: string[];
}

function nuevoLado(): LadoAcumulado {
  return {
    comprobantes: 0,
    facturado: new Prisma.Decimal(0),
    notasCredito: new Prisma.Decimal(0),
    sinTipoDeCambio: [],
  };
}

/**
 * Suma un comprobante en pesos. ARS tal cual; moneda extranjera = total × tipo de cambio a centavos con
 * mitad hacia arriba (criterio de los libros fiscales). Sin tipo de cambio válido (nulo o cero) queda como
 * bloqueo (L-021, L-022). La clasificación de nota de crédito es la de voucherDocumentKind, en un solo lugar.
 */
function acumular(
  lado: LadoAcumulado,
  v: {
    id: string;
    type: string;
    letter: string | null;
    total: Prisma.Decimal;
    currency: string;
    exchangeRate: Prisma.Decimal | null;
  },
): void {
  lado.comprobantes += 1;
  let pesos: Prisma.Decimal;
  if (v.currency === "ARS") {
    pesos = v.total.abs();
  } else if (v.exchangeRate === null || v.exchangeRate.lte(0)) {
    lado.sinTipoDeCambio.push(v.id);
    return;
  } else {
    pesos = v.total.abs().mul(v.exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  if (voucherDocumentKind(v) === "CREDIT_NOTE") {
    lado.notasCredito = lado.notasCredito.plus(pesos);
  } else {
    lado.facturado = lado.facturado.plus(pesos);
  }
}

function ladoParaMotor(l: LadoAcumulado): CajaFiscalLado {
  return {
    comprobantes: l.comprobantes,
    facturadoConIva: l.facturado.toFixed(4),
    notasCreditoConIva: l.notasCredito.toFixed(4),
    sinTipoDeCambio: l.sinTipoDeCambio,
  };
}

/** Mes y año del período en formato MM/AAAA (UTC), como se muestra en la DJ y en los faltantes. */
function etiquetaMes(fecha: Date): string {
  return `${String(fecha.getUTCMonth() + 1).padStart(2, "0")}/${fecha.getUTCFullYear()}`;
}

