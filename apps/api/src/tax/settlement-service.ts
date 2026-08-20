import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  calculateCm03,
  calculateIIbbTuc,
  calculateMonotributo,
  calculateTemSmt,
  calculateVat,
  CM03_ENGINE_VERSION,
  dec,
  IIBB_TUC_ENGINE_VERSION,
  MONOTRIBUTO_ENGINE_VERSION,
  TEM_SMT_ENGINE_VERSION,
  VAT_ENGINE_VERSION,
} from "@contable/tax-engine";
import type { TaxEngineResult, TaxFact } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { ObjectStorage, BUCKETS } from "../storage/object-storage.js";
import { exportReport, type ExportReportResult } from "../reporting/report-export.js";

/**
 * Servicio de liquidaciones fiscales (Puerta 3).
 *
 * Ciclo completo de una TaxSettlement sobre el motor determinista de
 * packages/tax-engine, sin depender del mayor contable.
 *
 * Invariantes (PLAN §9, §6.3–6.6, docs/invariantes.md):
 * - V-001: diferencias bloqueantes visibles y con resolución.
 * - V-002: finalizar exige revisor distinto del preparador (maker-checker).
 * - V-003: una liquidación FINALIZED es inmutable; corregirla crea una
 *   versión nueva (rectificativa) que referencia la anterior.
 * - V-004: misma entrada + misma regla + mismo motor → mismo hash.
 * - V-005: un cambio de regla no altera liquidaciones finalizadas
 *   (se conservan engineVersion y rulesHash).
 *
 * Reglas de negocio:
 * - Se calcula sólo con hechos APPROVED dentro del período y del cutoff.
 * - No se revisa con diferencias BLOCKING abiertas.
 * - No se finaliza sin revisión completada ni por el propio preparador.
 * - Retenciones, percepciones y saldo disponible provienen de los
 *   subledger aprobados y del ledger de créditos.
 */

export type SettlementErrorCode =
  | "SETTLEMENT_NOT_FOUND"
  | "SETTLEMENT_IMMUTABLE"
  | "INVALID_TRANSITION"
  | "MAKER_CHECKER_VIOLATION"
  | "NO_ACTIVE_RULES"
  | "RULE_VERSION_NOT_FOUND"
  | "PERIOD_NOT_FOUND"
  | "OBLIGATION_NOT_FOUND"
  | "BLOCKING_DIFFERENCES"
  | "FINALIZE_REQUIRES_REVIEW"
  | "CREDIT_NOT_FOUND"
  | "CREDIT_INSUFFICIENT"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_REVERSED"
  | "FILING_REQUIRES_EVIDENCE"
  | "EVIDENCE_NOT_FOUND";

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  constructor(code: SettlementErrorCode, message: string) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
  }
}

type Tx = Prisma.TransactionClient;

function availableFromLots(
  lots: Array<{ originalAmount: Prisma.Decimal; movements: Array<{ amount: Prisma.Decimal }> }>,
) {
  return lots.reduce(
    (sum, lot) =>
      sum.plus(
        lot.originalAmount.minus(
          lot.movements.reduce((movementSum, movement) => movementSum.plus(movement.amount), new Prisma.Decimal(0)),
        ),
      ),
    new Prisma.Decimal(0),
  );
}

/** Hecho fiscal normalizado para el motor (base en ARS). */
interface EngineFact {
  id: string;
  direction: "PURCHASE" | "SALE";
  date: string;
  concept: "VENTAS" | "COMPRAS" | "EXENTO" | "NO_GRAVADO";
  base: Prisma.Decimal;
}

/** Entrada persistida en settlement_inputs (snapshot trazable, V-004). */
interface SettlementInputRow {
  kind: "VOUCHER_COMPONENT" | "ADJUSTMENT" | "WITHHOLDING" | "PERCEPTION" | "CREDIT";
  sourceId: string;
  sourceVersion?: number;
  snapshot: Record<string, unknown>;
}

export class SettlementService {
  private readonly storage: ObjectStorage;

  constructor(storage?: ObjectStorage) {
    this.storage = storage ?? new ObjectStorage();
  }

  // ------------------------------------------------------------------
  // G3-03: Cobertura — entradas disponibles para el período
  // ------------------------------------------------------------------

  async coverage(
    ctx: TenantContext,
    input: { clientId: string; periodId: string; regimeId?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const period = await tx.taxPeriod.findUnique({ where: { id: input.periodId } });
      if (!period) throw new SettlementError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      const periodFilter = {
        firmId: ctx.firmId,
        clientId: input.clientId,
        issuedOn: { gte: period.startDate, lte: period.endDate },
      };
      const [vouchersApproved, vouchersPending, withholdings, perceptions, adjustments, creditLots] =
        await Promise.all([
          tx.fiscalVoucher.count({ where: { ...periodFilter, status: "APPROVED" } }),
          tx.fiscalVoucher.count({
            where: { ...periodFilter, status: { in: ["DRAFT", "IN_REVIEW"] } },
          }),
          tx.withholdingCertificate.count({ where: { firmId: ctx.firmId, clientId: input.clientId } }),
          tx.perceptionCertificate.count({ where: { firmId: ctx.firmId, clientId: input.clientId } }),
          tx.taxAdjustment.count({ where: { firmId: ctx.firmId, clientId: input.clientId } }),
          tx.taxCreditLot.findMany({
            where: { firmId: ctx.firmId, clientId: input.clientId },
            include: { movements: true },
          }),
        ]);

      const missing: string[] = [];
      if (vouchersPending > 0) missing.push(`${vouchersPending} comprobante(s) sin revisar`);
      if (vouchersApproved === 0) missing.push("No hay comprobantes aprobados en el período");
      const obligation = input.regimeId
        ? await tx.taxObligation.findFirst({
            where: {
              firmId: ctx.firmId,
              clientId: input.clientId,
              regimeId: input.regimeId,
              periodId: input.periodId,
            },
          })
        : null;
      if (obligation && obligation.status === "WAITING_INPUTS") {
        missing.push("La obligación está esperando entradas");
      }
      const status = missing.length > 0 ? "WAITING_INPUTS" : "READY";

      return {
        vouchersApproved,
        vouchersPending,
        withholdings,
        perceptions,
        adjustments,
        creditsAvailable: availableFromLots(creditLots).toFixed(4),
        ...(obligation ? { obligationId: obligation.id } : {}),
        status: status as "READY" | "WAITING_INPUTS",
        missing,
      };
    });
  }

  // ------------------------------------------------------------------
  // G3-03: Cálculo determinista (motor puro)
  // ------------------------------------------------------------------

  async calculate(
    ctx: TenantContext,
    input: {
      clientId: string;
      taxTypeId: string;
      regimeId: string;
      jurisdictionId: string;
      periodId: string;
      cutoff: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const period = await tx.taxPeriod.findUnique({ where: { id: input.periodId } });
      if (!period) throw new SettlementError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      // --- Versión ACTIVE del rule pack del régimen (V-005: se congela) ---
      const pack = await tx.taxRulePack.findFirst({ where: { regimeId: input.regimeId } });
      if (!pack) throw new SettlementError("RULE_VERSION_NOT_FOUND", "No existe rule pack para el régimen");
      const activeVersion = await tx.taxRuleVersion.findFirst({
        where: { packId: pack.id, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (!activeVersion) {
        throw new SettlementError("NO_ACTIVE_RULES", "No hay versión ACTIVE del rule pack; no se puede calcular");
      }
      const rateRules = await tx.taxRateRule.findMany({
        where: { ruleVersionId: activeVersion.id },
      });

      // --- Hechos aprobados dentro del período y del cutoff ---
      const cutoff = input.cutoff;
      const vouchers = await tx.fiscalVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          status: "APPROVED",
          issuedOn: { gte: period.startDate, lte: period.endDate },
        },
        include: { components: true, lines: true },
      });
      const adjustments = await tx.taxAdjustment.findMany({
        where: { firmId: ctx.firmId, clientId: input.clientId, reviewedAt: { not: null } },
      });
      // F0.5: sólo certificados APROBADOS (revisados) entran al cálculo. Si un
      // certificado declara período, debe coincidir con el del cálculo; un
      // certificado sin período se conserva (atribución completa por régimen/
      // jurisdicción es Fase 1 con TaxInputAllocation).
      const withholdings = await tx.withholdingCertificate.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          status: "APPROVED",
          ...(period ? { OR: [{ taxPeriodId: null }, { taxPeriodId: input.periodId }] } : {}),
        },
      });
      const perceptions = await tx.perceptionCertificate.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          status: "APPROVED",
          ...(period ? { OR: [{ taxPeriodId: null }, { taxPeriodId: input.periodId }] } : {}),
        },
      });
      // F1.7: los lotes inmutables son la fuente de verdad. Sólo durante la
      // migración se admite un fallback legacy si todavía no se cargó ningún
      // lote del alcance fiscal; así nunca se suman ambos libros.
      const creditLots = await tx.taxCreditLot.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          OR: [
            { regimeId: input.regimeId, jurisdictionId: input.jurisdictionId },
            { regimeId: input.regimeId, jurisdictionId: null },
          ],
        },
        include: { movements: true },
      });
      const legacyCredits = creditLots.length === 0
        ? await tx.taxCreditLedgerEntry.aggregate({
            where: { firmId: ctx.firmId, clientId: input.clientId, taxTypeId: input.taxTypeId },
            _sum: { balanceAfter: true },
          })
        : null;
      const availableLots = creditLots
        .map((lot) => ({ lot, available: lot.originalAmount.minus(lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0))) }))
        .filter((entry) => entry.available.isPositive());
      const technicalPrevious = availableLots
        .filter((entry) => entry.lot.kind === "IVA_TECNICO")
        .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const freePrevious = availableLots
        .filter((entry) => entry.lot.kind === "IVA_LIBRE")
        .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const genericPrevious = availableLots
        .filter((entry) => entry.lot.kind === "SALDO_A_FAVOR")
        .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const previousFree = creditLots.length > 0
        ? genericPrevious.plus(freePrevious)
        : legacyCredits?._sum.balanceAfter ?? new Prisma.Decimal(0);

      // --- Reglas del motor (tasas por concepto). La DB guarda la alícuota
      //     en puntos porcentuales (p.ej. 21.0000); el motor espera decimal
      //     (0.21). Se normaliza dividiendo por 100. rate es opcional (las
      //     cuotas de monotributo van en minAmount). ---
      const rules = rateRules.map((r) => {
        const rate = r.rate !== null ? dec(r.rate.toString()) : undefined;
        const normalized = rate !== undefined && rate.greaterThan(1) ? rate.div(100) : rate;
        const min = r.minAmount !== null ? dec(r.minAmount.toString()) : undefined;
        return {
          id: r.id,
          concept: r.concept,
          code: r.concept,
          ...(normalized !== undefined ? { rate: normalized } : {}),
          ...(min !== undefined ? { minimum: min } : {}),
          validFrom: r.validFrom.toISOString().slice(0, 10),
        };
      });

      // --- Hechos e inputs ---
      const facts: EngineFact[] = [];
      const inputs: SettlementInputRow[] = [];

      for (const entry of availableLots) {
        inputs.push({
          kind: "CREDIT",
          sourceId: entry.lot.id,
          snapshot: {
            kind: entry.lot.kind,
            available: entry.available.toFixed(4),
            regimeId: entry.lot.regimeId,
            jurisdictionId: entry.lot.jurisdictionId,
            periodId: entry.lot.periodId,
          },
        });
      }

      for (const v of vouchers) {
        const concept = v.direction === "SALE" ? "VENTAS" : "COMPRAS";
        for (const c of v.components) {
          if (c.concept === "NETO" || c.concept === "EXENTO" || c.concept === "NO_GRAVADO") {
            const factConcept =
              c.concept === "NETO" ? concept : (c.concept as "EXENTO" | "NO_GRAVADO");
            facts.push({
              id: `${v.id}:${c.id}`,
              direction: v.direction,
              date: v.issuedOn.toISOString().slice(0, 10),
              concept: factConcept,
              base: c.base,
            });
            inputs.push({
              kind: "VOUCHER_COMPONENT",
              sourceId: `${v.id}:${c.id}`,
              sourceVersion: v.version,
              snapshot: {
                voucherId: v.id,
                type: v.type,
                letter: v.letter,
                pointOfSale: v.pointOfSale,
                number: v.number,
                issuedOn: v.issuedOn.toISOString().slice(0, 10),
                component: c.concept,
                base: c.base.toString(),
              },
            });
          }
        }
      }
      for (const a of adjustments) {
        if (a.reviewedAt && a.amount.isPositive() && a.concept === "GASTO_GERENCIAL_COMPUTABLE") {
          facts.push({
            id: `adj:${a.id}`,
            direction: "PURCHASE",
            date: a.createdAt.toISOString().slice(0, 10),
            concept: "COMPRAS",
            base: a.amount,
          });
          inputs.push({
            kind: "ADJUSTMENT",
            sourceId: a.id,
            snapshot: {
              adjustmentId: a.id,
              concept: a.concept,
              amount: a.amount.toString(),
              reason: a.reason,
            },
          });
        }
      }

      const withholdingTotal = withholdings.reduce(
        (acc, w) => acc.plus(w.amount),
        new Prisma.Decimal(0),
      );
      const perceptionTotal = perceptions.reduce(
        (acc, p) => acc.plus(p.amount),
        new Prisma.Decimal(0),
      );

      // --- Dispatch por motor (determinista, V-004) ---
      // El rule pack ACTIVE declara su engineVersion; cada régimen usa su
      // motor puro. IVA usa hechos por concepto; IIBB usa ingresos por
      // actividad (líneas del voucher) + créditos RPI.
      const periodRange = {
        startDate: period.startDate.toISOString().slice(0, 10),
        endDate: period.endDate.toISOString().slice(0, 10),
        cutoff,
      };

      // --- Ingresos por actividad (IIBB/TEM/CM) desde líneas de ventas ---
      // El cutoff se aplica aquí (hechos con fecha > cutoff se excluyen).
      const cutoffDate = `${cutoff}T23:59:59.999Z`;
      const incomeByActivity: Record<string, string> = {};
      for (const v of vouchers) {
        if (v.direction !== "SALE") continue;
        if (v.issuedOn.toISOString() > cutoffDate) continue;
        for (const line of v.lines) {
          const activity = line.activityCode ?? "DEFAULT";
          const net = line.netAmount ?? new Prisma.Decimal(0);
          incomeByActivity[activity] = dec(incomeByActivity[activity] ?? "0")
            .plus(net)
            .toString();
          inputs.push({
            kind: "VOUCHER_COMPONENT",
            sourceId: `${v.id}:${line.id}`,
            sourceVersion: v.version,
            snapshot: {
              voucherId: v.id,
              type: v.type,
              letter: v.letter,
              pointOfSale: v.pointOfSale,
              number: v.number,
              issuedOn: v.issuedOn.toISOString().slice(0, 10),
              activityCode: activity,
              netAmount: net.toString(),
            },
          });
        }
      }

      const minimumRules = await tx.taxMinimumRule.findMany({
        where: { ruleVersionId: activeVersion.id },
      });
      const minimum = minimumRules[0]?.amount
        ? dec(minimumRules[0].amount.toString())
        : undefined;

      let result: TaxEngineResult;
      switch (activeVersion.engineVersion) {
        case IIBB_TUC_ENGINE_VERSION: {
          // --- IIBB Tucumán local: ingresos por actividad + créditos RPI ---
          result = calculateIIbbTuc({
            engineVersion: IIBB_TUC_ENGINE_VERSION,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            incomeByActivity,
            ...(minimum !== undefined ? { minimum } : {}),
            credits: {
              withholding: withholdingTotal,
              perception: perceptionTotal,
              collected: new Prisma.Decimal(0),
            },
            balances: { previousCredit: previousFree.toString() },
          });
          break;
        }
        case TEM_SMT_ENGINE_VERSION: {
          // --- TEM San Miguel de Tucumán ---
          result = calculateTemSmt({
            engineVersion: TEM_SMT_ENGINE_VERSION,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            incomeByActivity,
            ...(minimum !== undefined ? { minimum } : {}),
            credits: {
              withholding: withholdingTotal,
              perception: perceptionTotal,
            },
            balances: { previousCredit: previousFree.toString() },
          });
          break;
        }
        case CM03_ENGINE_VERSION: {
          // --- CM03 artículo 2: coeficientes por jurisdicción ---
          // Los coeficientes se toman de las reglas (concept = jurisdicción,
          // rate = coeficiente). Se validan en el motor (suma = 1).
          const coefficients: Record<string, string> = {};
          for (const r of rateRules) {
            if (r.concept.startsWith("COEF_") && r.rate !== null) {
              coefficients[r.concept.slice(5)] = r.rate.toString();
            }
          }
          // F1.4: los créditos se atribuyen por jurisdicción cuando el
          // certificado declara jurisdictionId. Sólo si ningún certificado
          // declara jurisdicción se usa el fallback a la jurisdicción
          // principal (datos legacy), nunca mezclando créditos entre
          // jurisdicciones.
          const withholdingByJurisdiction: Record<string, Prisma.Decimal> = {};
          const perceptionByJurisdiction: Record<string, Prisma.Decimal> = {};
          const previousCreditByJurisdiction: Record<string, string> = {};
          const declaredWithholding = withholdings.filter((w) => w.jurisdictionId);
          const declaredPerception = perceptions.filter((p) => p.jurisdictionId);
          if (declaredWithholding.length > 0 || declaredPerception.length > 0) {
            for (const w of declaredWithholding) {
              const j = w.jurisdictionId!;
              withholdingByJurisdiction[j] = (withholdingByJurisdiction[j] ?? new Prisma.Decimal(0)).plus(w.amount);
            }
            for (const p of declaredPerception) {
              const j = p.jurisdictionId!;
              perceptionByJurisdiction[j] = (perceptionByJurisdiction[j] ?? new Prisma.Decimal(0)).plus(p.amount);
            }
          } else {
            const primaryJurisdiction = Object.keys(coefficients)[0];
            if (primaryJurisdiction) {
              withholdingByJurisdiction[primaryJurisdiction] = withholdingTotal;
              perceptionByJurisdiction[primaryJurisdiction] = perceptionTotal;
              previousCreditByJurisdiction[primaryJurisdiction] = previousFree.toString();
            }
          }
          result = calculateCm03({
            engineVersion: CM03_ENGINE_VERSION,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            incomeByActivity,
            coefficients,
            credits: {
              withholdingByJurisdiction,
              perceptionByJurisdiction,
            },
            cmBalances: { previousCreditByJurisdiction },
          });
          break;
        }
        case MONOTRIBUTO_ENGINE_VERSION: {
          // --- Monotributo: cuota por categoría ---
          const profile = await tx.taxpayerProfileVersion.findFirst({
            where: { firmId: ctx.firmId, clientId: input.clientId, status: "ACTIVE" },
            orderBy: { version: "desc" },
          });
          const category = profile?.monotributoCategory ?? "A";
          const feeByCategory: Record<string, string> = {};
          for (const r of rateRules) {
            if (r.concept.startsWith("CUOTA_")) {
              // La cuota es un importe; se guarda en minAmount (Decimal(20,4)).
              feeByCategory[r.concept.slice(6)] = (r.minAmount ?? r.rate)?.toString() ?? "0";
            }
          }
          // Pagos ya registrados del período (se deducen de la cuota).
          const periodPayments = await tx.taxPayment.aggregate({
            where: {
              firmId: ctx.firmId,
              clientId: input.clientId,
              status: "PAID",
              paidAt: { gte: period.startDate, lte: period.endDate },
            },
            _sum: { amount: true },
          });
          result = calculateMonotributo({
            engineVersion: MONOTRIBUTO_ENGINE_VERSION,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            category,
            parameters: { monthlyFeeByCategory: feeByCategory },
            payments: {
              paid: periodPayments._sum.amount ?? new Prisma.Decimal(0),
            },
          });
          break;
        }
        default:
          // --- IVA responsable inscripto (default) ---
          result = calculateVat({
            engineVersion: VAT_ENGINE_VERSION,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            credits: {
              withholding: withholdingTotal,
              perception: perceptionTotal,
              technicalPrevious,
              freeAvailabilityPrevious: previousFree,
            },
          });
      }

      const totals: Record<string, string> = { ...result.subtotals };
      const lines = result.lines.map((l, i) => ({
        position: i + 1,
        concept: l.concept,
        formula: l.formula,
        inputs: l.inputs as Prisma.InputJsonValue,
        amount: new Prisma.Decimal(l.result),
      }));

      const core = {
        cutoff: new Date(`${cutoff}T00:00:00.000Z`),
        engineVersion: result.engineVersion,
        rulesHash: activeVersion.rulesHash,
        inputHash: result.inputHash,
        outputHash: result.outputHash,
        totals: totals as unknown as Prisma.InputJsonValue,
        status: "CALCULATED" as const,
      };

      // --- Persistencia: reutiliza la versión en curso o crea v1 ---
      const existing = await tx.taxSettlement.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          regimeId: input.regimeId,
          periodId: input.periodId,
          status: { in: ["DRAFT", "CALCULATED", "IN_REVIEW", "CHANGES_REQUESTED"] },
        },
      });

      // V-003: si ya existe una finalizada (sin rectificativa en curso), el
      // recálculo queda bloqueado y se exige rectificación explícita.
      if (!existing) {
        const finalized = await tx.taxSettlement.findFirst({
          where: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            regimeId: input.regimeId,
            periodId: input.periodId,
            status: "FINALIZED",
          },
        });
        if (finalized) {
          throw new SettlementError(
            "SETTLEMENT_IMMUTABLE",
            "La liquidación ya está finalizada; use rectificación para una corrección",
          );
        }
      }

      const settlement = existing
        ? await tx.taxSettlement.update({ where: { id: existing.id }, data: core })
        : await tx.taxSettlement.create({
            data: {
              firmId: ctx.firmId,
              clientId: input.clientId,
              taxTypeId: input.taxTypeId,
              regimeId: input.regimeId,
              jurisdictionId: input.jurisdictionId,
              periodId: input.periodId,
              preparedByUserId: ctx.userId,
              ...core,
            },
          });

      // --- Snapshot de entradas + líneas (reemplazo atómico) ---
      await tx.settlementInput.deleteMany({ where: { settlementId: settlement.id } });
      await tx.taxSettlementLine.deleteMany({ where: { settlementId: settlement.id } });
      await tx.taxSettlementLine.createMany({
        data: lines.map((l) => ({
          firmId: ctx.firmId,
          clientId: input.clientId,
          settlementId: settlement.id,
          ...l,
        })),
      });
      await tx.settlementInput.createMany({
        data: inputs.map((i) => ({
          settlementId: settlement.id,
          firmId: ctx.firmId,
          clientId: input.clientId,
          kind: i.kind,
          sourceId: i.sourceId,
          ...(i.sourceVersion !== undefined ? { sourceVersion: i.sourceVersion } : {}),
          snapshot: i.snapshot as Prisma.InputJsonValue,
        })),
      });

      // --- Diferencias del motor (V-001) ---
      await tx.taxDifference.deleteMany({ where: { settlementId: settlement.id, status: "OPEN" } });
      for (const w of result.warnings) {
        await tx.taxDifference.create({
          data: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            settlementId: settlement.id,
            severity: "INFO",
            status: "OPEN",
            code: "ENGINE_WARNING",
            message: w,
            context: { kind: "warning" } as Prisma.InputJsonValue,
          },
        });
      }
      for (const b of result.blocks) {
        await tx.taxDifference.create({
          data: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            settlementId: settlement.id,
            severity: "BLOCKING",
            status: "OPEN",
            code: "ENGINE_BLOCK",
            message: b,
            context: { kind: "block" } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        settlement: await tx.taxSettlement.findUniqueOrThrow({ where: { id: settlement.id } }),
        lines,
        inputs,
        result: {
          engineVersion: result.engineVersion,
          totalDue: result.totalDue,
          credits: result.credits,
          warnings: result.warnings,
          blocks: result.blocks,
          inputHash: result.inputHash,
          outputHash: result.outputHash,
        },
      };
    });
  }

  // ------------------------------------------------------------------
  // G3-04: Workflow maker-checker
  // ------------------------------------------------------------------

  /** CALCULATED → IN_REVIEW (sólo desde calculada y sin bloqueos). */
  async submitReview(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "CALCULATED") {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `Sólo una liquidación calculada puede enviarse a revisión (estado: ${s.status})`,
        );
      }
      const blocking = await tx.taxDifference.count({
        where: { settlementId, severity: "BLOCKING", status: "OPEN" },
      });
      if (blocking > 0) {
        throw new SettlementError("BLOCKING_DIFFERENCES", `Hay ${blocking} diferencia(s) bloqueantes abiertas`);
      }
      return tx.taxSettlement.update({ where: { id: settlementId }, data: { status: "IN_REVIEW" } });
    });
  }

  /** IN_REVIEW → CHANGES_REQUESTED (el revisor pide cambios). */
  async requestChanges(ctx: TenantContext, settlementId: string, comment: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "IN_REVIEW") {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `Solo una revisión en curso puede pedir cambios (estado: ${s.status})`,
        );
      }
      if (s.preparedByUserId === ctx.userId) {
        throw new SettlementError("MAKER_CHECKER_VIOLATION", "El preparador no puede revisar su propia liquidación");
      }
      await tx.taxDifference.create({
        data: {
          firmId: s.firmId,
          clientId: s.clientId,
          settlementId: s.id,
          severity: "WARNING",
          status: "OPEN",
          code: "CHANGES_REQUESTED",
          message: comment,
        },
      });
      return tx.taxSettlement.update({
        where: { id: settlementId },
        data: { status: "CHANGES_REQUESTED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** IN_REVIEW → REVIEWED (aprobación del revisor; exige revisor distinto). */
  async review(ctx: TenantContext, settlementId: string, comment?: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "IN_REVIEW") {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `Solo IN_REVIEW puede aprobarse (estado: ${s.status})`,
        );
      }
      if (s.preparedByUserId === ctx.userId) {
        throw new SettlementError("MAKER_CHECKER_VIOLATION", "El preparador no puede revisar su propia liquidación");
      }
      const blocking = await tx.taxDifference.count({
        where: { settlementId, severity: "BLOCKING", status: "OPEN" },
      });
      if (blocking > 0) {
        throw new SettlementError("BLOCKING_DIFFERENCES", `Hay ${blocking} diferencia(s) bloqueante(s) abiertas`);
      }
      if (comment) {
        await tx.taxDifference.create({
          data: {
            firmId: s.firmId,
            clientId: s.clientId,
            settlementId: s.id,
            severity: "INFO",
            status: "RESOLVED",
            code: "REVIEW_COMMENT",
            message: comment,
            resolvedByUserId: ctx.userId,
            resolvedAt: new Date(),
          },
        });
      }
      return tx.taxSettlement.update({
        where: { id: settlementId },
        data: { status: "REVIEWED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** REVIEWED → FINALIZED (V-002: revisor distinto; V-003: inmutable luego). */
  async finalize(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status === "FINALIZED") throw new SettlementError("SETTLEMENT_IMMUTABLE", "La liquidación ya está finalizada");
      if (s.status !== "REVIEWED") {
        throw new SettlementError(
          "FINALIZE_REQUIRES_REVIEW",
          `No se puede finalizar desde ${s.status}; la revisión debe completarse antes`,
        );
      }
      if (s.preparedByUserId === ctx.userId) {
        throw new SettlementError("MAKER_CHECKER_VIOLATION", "El preparador no puede finalizar su propia liquidación");
      }
      const settledStatus = "FINALIZED";
      const finalized = await tx.taxSettlement.update({
        where: { id: settlementId },
        data: { status: settledStatus, finalizedByUserId: ctx.userId, finalizedAt: new Date() },
      });
      await this.rollForwardClosingCredits(tx, finalized, ctx.userId);
      // La obligación vinculada pasa a READY_TO_FILE (no presenta por sí sola).
      await tx.taxObligation.updateMany({
        where: {
          firmId: s.firmId,
          clientId: s.clientId,
          regimeId: s.regimeId,
          periodId: s.periodId,
        },
        data: { status: "READY_TO_FILE" },
      });
      return finalized;
    });
  }

  // ------------------------------------------------------------------
  // G3-09: Rectificación (nueva versión desde FINALIZED)
  // ------------------------------------------------------------------

  async rectify(ctx: TenantContext, settlementId: string, reason: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "FINALIZED") {
        throw new SettlementError("INVALID_TRANSITION", "Solo una liquidación finalizada puede rectificarse");
      }
      if (!reason.trim()) {
        throw new SettlementError("INVALID_TRANSITION", "La rectificación exige un motivo");
      }
      const versionCount = await tx.taxSettlement.count({
        where: { clientId: s.clientId, regimeId: s.regimeId, periodId: s.periodId },
      });
      const next = await tx.taxSettlement.create({
        data: {
          firmId: s.firmId,
          clientId: s.clientId,
          taxTypeId: s.taxTypeId,
          regimeId: s.regimeId,
          jurisdictionId: s.jurisdictionId,
          periodId: s.periodId,
          cutoff: s.cutoff,
          version: versionCount + 1,
          engineVersion: s.engineVersion,
          rulesHash: s.rulesHash,
          inputHash: s.inputHash,
          outputHash: s.outputHash,
          status: "DRAFT",
          totals: s.totals as unknown as Prisma.InputJsonValue,
          preparedByUserId: ctx.userId,
          supersedesId: s.id,
        },
      });
      // La anterior permanece consultable e inmutable; el historial no se borra.
      return next;
    });
  }

  /**
   * G3-09: rectificativa con delta.
   * Crea la nueva versión DRAFT y registra la diferencia por renglón contra
   * la versión anterior (delta visible en la pantalla de liquidación).
   */
  async rectifyWithDelta(ctx: TenantContext, settlementId: string, reason: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "FINALIZED") {
        throw new SettlementError("INVALID_TRANSITION", "Solo una liquidación finalizada puede rectificarse");
      }
      if (!reason.trim()) {
        throw new SettlementError("INVALID_TRANSITION", "La rectificación exige un motivo");
      }
      const versionCount = await tx.taxSettlement.count({
        where: { clientId: s.clientId, regimeId: s.regimeId, periodId: s.periodId },
      });
      const next = await tx.taxSettlement.create({
        data: {
          firmId: s.firmId,
          clientId: s.clientId,
          taxTypeId: s.taxTypeId,
          regimeId: s.regimeId,
          jurisdictionId: s.jurisdictionId,
          periodId: s.periodId,
          cutoff: s.cutoff,
          version: versionCount + 1,
          engineVersion: s.engineVersion,
          rulesHash: s.rulesHash,
          inputHash: s.inputHash,
          outputHash: s.outputHash,
          status: "DRAFT",
          totals: s.totals as unknown as Prisma.InputJsonValue,
          preparedByUserId: ctx.userId,
          supersedesId: s.id,
        },
      });

      // Delta por renglón contra la versión anterior (G3-09).
      const prevLines = await tx.taxSettlementLine.findMany({
        where: { settlementId: s.id },
        orderBy: { position: "asc" },
      });
      const prevByConcept = new Map(prevLines.map((l) => [l.concept, l.amount]));
      const nextLines = await tx.taxSettlementLine.findMany({
        where: { settlementId: next.id },
        orderBy: { position: "asc" },
      });
      const deltas: Array<{ concept: string; previous: string; current: string; delta: string }> = [];
      for (const line of nextLines) {
        const prev = prevByConcept.get(line.concept) ?? new Prisma.Decimal(0);
        const delta = line.amount.minus(prev);
        if (!delta.isZero()) {
          deltas.push({
            concept: line.concept,
            previous: prev.toString(),
            current: line.amount.toString(),
            delta: delta.toString(),
          });
        }
      }
      if (deltas.length > 0) {
        await tx.taxDifference.create({
          data: {
            firmId: s.firmId,
            clientId: s.clientId,
            settlementId: next.id,
            severity: "INFO",
            status: "OPEN",
            code: "RECTIFICATION_DELTA",
            message: `Rectificación: ${deltas.length} renglón(es) con cambio`,
            context: { deltas, reason } as Prisma.InputJsonValue,
          },
        });
      }
      return { settlement: next, deltas };
    });
  }

  // ------------------------------------------------------------------
  // G3-07/08: Presentación, pago, créditos
  // ------------------------------------------------------------------

  /**
   * Registra una presentación FILED. Exige un acuse validado (evidenceDocumentId)
   * de un documento existente del cliente (D-3: la transición a FILED requiere
   * evidencia). El intento sin acuse queda en PENDING vía recordFilingPending.
   */
  async recordFiling(
    ctx: TenantContext,
    input: {
      obligationId: string;
      settlementId: string;
      filedAt: string;
      amountFiled: string;
      externalId?: string;
      evidenceDocumentId: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const o = await tx.taxObligation.findFirst({ where: { id: input.obligationId, firmId: ctx.firmId } });
      if (!o) throw new SettlementError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");
      const s = await tx.taxSettlement.findUnique({ where: { id: input.settlementId } });
      if (!s) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
      if (s.status !== "FINALIZED") {
        throw new SettlementError("SETTLEMENT_IMMUTABLE", "La liquidación debe estar finalizada para presentarse");
      }
      // D-3: la transición a FILED exige un acuse validado del cliente.
      if (!input.evidenceDocumentId) {
        throw new SettlementError("FILING_REQUIRES_EVIDENCE", "La presentación exige un acuse (evidenceDocumentId)");
      }
      const evidence = await tx.document.findFirst({
        where: { id: input.evidenceDocumentId, firmId: ctx.firmId, clientId: o.clientId },
      });
      if (!evidence) {
        throw new SettlementError("EVIDENCE_NOT_FOUND", "El acuse de presentación no existe para este cliente");
      }
      const filing = await tx.taxFiling.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          settlementId: s.id,
          filedAt: new Date(input.filedAt),
          amountFiled: new Prisma.Decimal(input.amountFiled),
          ...(input.externalId ? { externalId: input.externalId } : {}),
          evidenceDocumentId: input.evidenceDocumentId,
          createdByUserId: ctx.userId,
          status: "FILED",
        },
      });
      await tx.taxObligation.update({ where: { id: o.id }, data: { status: "FILED" } });
      return filing;
    });
  }

  /**
   * Registra un intento de presentación NO presentado (PENDING), sin acuse.
   * Permite dejar trazabilidad de un intento fallido sin marcar FILED.
   */
  async recordFilingPending(
    ctx: TenantContext,
    input: {
      obligationId: string;
      settlementId: string;
      filedAt: string;
      amountFiled: string;
      externalId?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const o = await tx.taxObligation.findFirst({ where: { id: input.obligationId, firmId: ctx.firmId } });
      if (!o) throw new SettlementError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");
      const s = await tx.taxSettlement.findUnique({ where: { id: input.settlementId } });
      if (!s) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
      return tx.taxFiling.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          settlementId: s.id,
          filedAt: new Date(input.filedAt),
          amountFiled: new Prisma.Decimal(input.amountFiled),
          ...(input.externalId ? { externalId: input.externalId } : {}),
          createdByUserId: ctx.userId,
          status: "PENDING",
        },
      });
    });
  }

  async recordPayment(
    ctx: TenantContext,
    input: {
      obligationId: string;
      settlementId?: string;
      paidAt: string;
      amount: string;
      method: string;
      reference?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const o = await tx.taxObligation.findFirst({ where: { id: input.obligationId, firmId: ctx.firmId } });
      if (!o) throw new SettlementError("OBLIGATION_NOT_FOUND", "Obligación no encontrada");
      const payment = await tx.taxPayment.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          ...(input.settlementId ? { settlementId: input.settlementId } : {}),
          paidAt: new Date(input.paidAt),
          amount: new Prisma.Decimal(input.amount),
          method: input.method,
          ...(input.reference ? { reference: input.reference } : {}),
          createdByUserId: ctx.userId,
          status: "PAID",
        },
      });

      // Estado de la obligación según lo exigido vs pagado.
      const settlement = input.settlementId
        ? await tx.taxSettlement.findUnique({ where: { id: input.settlementId } })
        : null;
      const totals = settlement?.totals as Record<string, string> | null | undefined;
      const required = totals?.["TOTAL_A_INGRESAR"] ?? totals?.["totalDue"];
      let paidStatus: "PARTIALLY_PAID" | "PAID" = "PARTIALLY_PAID";
      if (required) {
        const paid = await tx.taxPayment.aggregate({
          where: { obligationId: o.id, status: "PAID" },
          _sum: { amount: true },
        });
        const paidSum = paid._sum.amount ?? new Prisma.Decimal(0);
        const owed = new Prisma.Decimal(required).minus(paidSum);
        paidStatus = owed.isZero() || owed.isNegative() ? "PAID" : "PARTIALLY_PAID";
      }
      await tx.taxObligation.update({ where: { id: o.id }, data: { status: paidStatus } });
      return payment;
    });
  }

  async reversePayment(ctx: TenantContext, paymentId: string, reason: string) {
    return withTenantContext(ctx, async (tx) => {
      const p = await tx.taxPayment.findFirst({ where: { id: paymentId, firmId: ctx.firmId } });
      if (!p) throw new SettlementError("PAYMENT_NOT_FOUND", "Pago no encontrado");
      if (p.status === "REVERSED") throw new SettlementError("PAYMENT_REVERSED", "El pago ya está revertido");
      if (p.createdByUserId === ctx.userId) {
        throw new SettlementError("MAKER_CHECKER_VIOLATION", "El creador del pago no puede revertirlo");
      }
      if (!reason.trim()) {
        throw new SettlementError("INVALID_TRANSITION", "La reversión exige un motivo");
      }
      const reversed = await tx.taxPayment.update({
        where: { id: paymentId },
        data: { status: "REVERSED", reversedById: ctx.userId, reversedAt: new Date() },
      });
      const o = await tx.taxObligation.findUnique({ where: { id: reversed.obligationId } });
      if (o) {
        const paid = await tx.taxPayment.aggregate({
          where: { obligationId: o.id, status: "PAID" },
          _sum: { amount: true },
        });
        const paidSum = paid._sum.amount ?? new Prisma.Decimal(0);
        await tx.taxObligation.update({
          where: { id: o.id },
          data: { status: paidSum.isZero() ? "READY_TO_FILE" : "PARTIALLY_PAID" },
        });
      }
      return reversed;
    });
  }

  async allocateCredit(
    ctx: TenantContext,
    input: { creditEntryId: string; settlementId: string; amount: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const credit = await tx.taxCreditLedgerEntry.findFirst({
        where: { id: input.creditEntryId, firmId: ctx.firmId },
      });
      if (!credit) throw new SettlementError("CREDIT_NOT_FOUND", "Crédito no encontrado");
      const amount = new Prisma.Decimal(input.amount);
      if (credit.balanceAfter.lessThan(amount)) {
        throw new SettlementError("CREDIT_INSUFFICIENT", "El crédito disponible es insuficiente");
      }
      const allocation = await tx.taxCreditAllocation.create({
        data: {
          firmId: ctx.firmId,
          clientId: credit.clientId,
          creditEntryId: credit.id,
          settlementId: input.settlementId,
          amount,
        },
      });
      await tx.taxCreditLedgerEntry.update({
        where: { id: credit.id },
        data: { balanceAfter: credit.balanceAfter.minus(amount) },
      });
      return allocation;
    });
  }

  /**
   * Al cerrar se consolida el disponible de la obligación en un lote nuevo
   * con origen en la liquidación. Los lotes anteriores no se modifican: un
   * movimiento firmado deja su disponible en cero y evita doble arrastre.
   */
  private async rollForwardClosingCredits(
    tx: Tx,
    settlement: { id: string; firmId: string; clientId: string; taxTypeId: string; regimeId: string; jurisdictionId: string; periodId: string; engineVersion: string; totals: Prisma.JsonValue | null },
    userId: string,
  ) {
    const existingClosing = await tx.taxCreditLot.findFirst({ where: { sourceSettlementId: settlement.id } });
    if (existingClosing) return;
    const totals = (settlement.totals ?? {}) as Record<string, string>;
    const lots = await tx.taxCreditLot.findMany({
      where: {
        firmId: settlement.firmId,
        clientId: settlement.clientId,
        taxTypeId: settlement.taxTypeId,
        OR: [
          { regimeId: settlement.regimeId, jurisdictionId: settlement.jurisdictionId },
          { regimeId: settlement.regimeId, jurisdictionId: null },
        ],
      },
      include: { movements: true },
    });
    const available = lots
      .map((lot) => ({ lot, available: lot.originalAmount.minus(lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0))) }))
      .filter((entry) => entry.available.isPositive());

    const replaceKind = async (kind: string, closingAmount: string) => {
      const scoped = available.filter((entry) => entry.lot.kind === kind || (kind === "IVA_LIBRE" && entry.lot.kind === "SALDO_A_FAVOR"));
      if (scoped.length > 0) {
        await tx.taxCreditMovement.createMany({
          data: scoped.map((entry) => ({
            firmId: settlement.firmId,
            clientId: settlement.clientId,
            lotId: entry.lot.id,
            kind: "ROLLED_FORWARD",
            amount: entry.available,
            settlementId: settlement.id,
            reference: `Cierre ${settlement.id}`,
            createdByUserId: userId,
          })),
        });
      }
      const amount = new Prisma.Decimal(closingAmount || "0");
      if (amount.isPositive()) {
        await tx.taxCreditLot.create({
          data: {
            firmId: settlement.firmId,
            clientId: settlement.clientId,
            taxTypeId: settlement.taxTypeId,
            regimeId: settlement.regimeId,
            jurisdictionId: settlement.jurisdictionId,
            periodId: settlement.periodId,
            kind,
            originalAmount: amount,
            sourceSettlementId: settlement.id,
            createdByUserId: userId,
          },
        });
      }
    };

    if (settlement.engineVersion === VAT_ENGINE_VERSION) {
      await replaceKind("IVA_TECNICO", totals["SALDO_TECNICO_AFTER"] ?? "0");
      await replaceKind("IVA_LIBRE", totals["SALDO_LIBRE_AFTER"] ?? "0");
      return;
    }
    await replaceKind("SALDO_A_FAVOR", totals["SALDO_A_FAVOR"] ?? "0");
  }

  // ------------------------------------------------------------------
  // Consultas (G3-10)
  // ------------------------------------------------------------------

  /** Worklist de liquidaciones del cliente. */
  async worklist(ctx: TenantContext, clientId?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxSettlement.findMany({
        where: {
          firmId: ctx.firmId,
          ...(clientId ? { clientId } : {}),
        },
        include: {
          period: true,
          regime: { include: { taxType: true, jurisdiction: true } },
          lines: { take: 8, orderBy: { position: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
    );
  }

  async listDifferences(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxDifference.findMany({
        where: { firmId: ctx.firmId, settlementId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  }

  async timeline(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, async (tx) => {
      const s = await tx.taxSettlement.findUnique({ where: { id: settlementId } });
      if (!s) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
      const [differences, filings, payments, allocations] = await Promise.all([
        tx.taxDifference.findMany({ where: { settlementId }, orderBy: { createdAt: "asc" }, take: 200 }),
        tx.taxFiling.findMany({ where: { settlementId }, orderBy: { createdAt: "asc" }, take: 200 }),
        tx.taxPayment.findMany({ where: { settlementId }, orderBy: { createdAt: "asc" }, take: 200 }),
        tx.taxCreditAllocation.findMany({ where: { settlementId }, orderBy: { createdAt: "asc" }, take: 200 }),
      ]);
      return { settlement: s, differences, filings, payments, allocations };
    });
  }

  /**
   * F2.3: lista liquidaciones con filtros paginados de período y cutoff.
   * Devuelve { data, meta } con cursor de paginación (offset/limit).
   */
  async list(
    ctx: TenantContext,
    clientId: string,
    filters: { periodId?: string; accountingPeriodId?: string; cutoffFrom?: string; cutoffTo?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    return withTenantContext(ctx, async (tx) => {
      const accountingPeriod = filters.accountingPeriodId
        ? await tx.accountingPeriod.findFirst({
            where: { id: filters.accountingPeriodId, firmId: ctx.firmId, clientId },
            select: { startDate: true, endDate: true },
          })
        : null;
      if (filters.accountingPeriodId && !accountingPeriod) {
        throw new SettlementError("PERIOD_NOT_FOUND", "Período contable no encontrado");
      }
      const taxPeriodIds = accountingPeriod
        ? await tx.taxPeriod.findMany({
            where: {
              firmId: ctx.firmId,
              clientId,
              startDate: { lte: accountingPeriod.endDate },
              endDate: { gte: accountingPeriod.startDate },
            },
            select: { id: true },
          })
        : [];
      const where: Prisma.TaxSettlementWhereInput = {
        firmId: ctx.firmId,
        clientId,
        ...(filters.periodId ? { periodId: filters.periodId } : {}),
        ...(accountingPeriod ? { periodId: { in: taxPeriodIds.map((period) => period.id) } } : {}),
        ...(filters.cutoffFrom || filters.cutoffTo
          ? {
              cutoff: {
                ...(filters.cutoffFrom ? { gte: new Date(`${filters.cutoffFrom}T00:00:00.000Z`) } : {}),
                ...(filters.cutoffTo ? { lte: new Date(`${filters.cutoffTo}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        tx.taxSettlement.findMany({
          where,
          include: { period: true, regime: { include: { taxType: true, jurisdiction: true } }, lines: true },
          orderBy: [{ period: { startDate: "desc" } }, { version: "desc" }],
          skip: offset,
          take: limit,
        }),
        tx.taxSettlement.count({ where }),
      ]);
      return { data, meta: { total, limit, offset } };
    });
  }

  // ------------------------------------------------------------------
  // G3-06: Papel de trabajo y export (artifacts)
  // ------------------------------------------------------------------

  /**
   * Genera el papel de trabajo de una liquidación FINALIZED y lo persiste
   * como TaxExportArtifact (objeto inmutable en MinIO + checksum).
   * El export se genera SIEMPRE desde el snapshot finalizado (V-003).
   */
  async generateArtifact(
    ctx: TenantContext,
    input: { settlementId: string; format: "csv" | "pdf" },
  ) {
    const storage = this.storage;
    return withTenantContext(ctx, async (tx) => {
      const s = await tx.taxSettlement.findUnique({
        where: { id: input.settlementId },
        include: {
          period: true,
          regime: { include: { taxType: true, jurisdiction: true } },
          lines: { orderBy: { position: "asc" } },
          inputs: true,
          differences: true,
        },
      });
      if (!s) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
      if (s.status !== "FINALIZED") {
        throw new SettlementError(
          "SETTLEMENT_IMMUTABLE",
          "El papel de trabajo sólo se genera desde una liquidación finalizada",
        );
      }

      const totals = (s.totals ?? {}) as Record<string, string>;
      const lines: ExportReportResult["lines"] = [
        { code: "CLIENTE", label: "Cliente", value: s.clientId },
        { code: "PERIODO", label: "Período", value: `${s.period.startDate.toISOString().slice(0, 10)} → ${s.period.endDate.toISOString().slice(0, 10)}` },
        { code: "IMPUESTO", label: "Impuesto", value: s.regime.taxType.name },
        { code: "REGIMEN", label: "Régimen", value: s.regime.name },
        { code: "VERSION", label: "Versión", value: `v${s.version}` },
        { code: "ENGINE", label: "Motor", value: s.engineVersion },
        { code: "RULES_HASH", label: "Hash de reglas", value: s.rulesHash },
        { code: "INPUT_HASH", label: "Hash de entradas", value: s.inputHash },
        { code: "OUTPUT_HASH", label: "Hash de salida", value: s.outputHash },
        { code: "CUTOFF", label: "Corte", value: s.cutoff.toISOString().slice(0, 10) },
        { code: "PREPARADOR", label: "Preparador", value: s.preparedByUserId },
        { code: "REVISOR", label: "Revisor", value: s.reviewedByUserId ?? "—" },
        { code: "FINALIZADO", label: "Finalizado", value: s.finalizedAt?.toISOString() ?? "—" },
        { code: "TOTAL", label: "Total a ingresar", value: totals["TOTAL_A_INGRESAR"] ?? totals["totalDue"] ?? "0", isTotal: true },
      ];
      for (const line of s.lines) {
        lines.push({
          code: line.concept,
          label: line.concept,
          value: line.amount.toString(),
          indent: 1,
        });
      }
      for (const diff of s.differences) {
        lines.push({
          code: diff.code,
          label: `Diferencia ${diff.severity}: ${diff.message}`,
          value: diff.status,
          indent: 1,
        });
      }

      const buffer = await exportReport(
        {
          templateCode: `LIQUIDACION_${s.regime.taxType.code}_${s.period.startDate.toISOString().slice(0, 7)}`,
          templateVersion: s.version,
          cutoff: s.cutoff.toISOString().slice(0, 10),
          generatedAt: new Date().toISOString(),
          lines,
        },
        input.format,
      );

      const checksum = createHash("sha256").update(buffer).digest("hex");
      const objectKey = `settlements/${s.firmId}/${s.clientId}/${s.id}/v${s.version}.${input.format}`;
      await storage.put(BUCKETS.exports, objectKey, buffer, buffer.length);

      const artifact = await tx.taxExportArtifact.create({
        data: {
          firmId: s.firmId,
          clientId: s.clientId,
          settlementId: s.id,
          kind: "PAPEL_DE_TRABAJO",
          format: input.format,
          objectKey,
          checksum,
          generatedByUserId: ctx.userId,
        },
      });
      return { artifact, checksum, objectKey };
    });
  }

  /** Lista artifacts de una liquidación. */
  async listArtifacts(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxExportArtifact.findMany({
        where: { firmId: ctx.firmId, settlementId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async getOwned(ctx: TenantContext, tx: Tx, id: string) {
    const s = await tx.taxSettlement.findFirst({ where: { id, firmId: ctx.firmId } });
    if (!s) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
    return s;
  }
}

/** Instancia única del servicio de liquidaciones. */
export const settlementService = new SettlementService();
