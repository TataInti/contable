import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  calculateCm03,
  calculateIIbbTuc,
  calculateMonotributo,
  calculateTemSmt,
  calculateVat,
  calculateVatRi,
  dec,
  isTaxEngineKey,
  taxEngineKeyForVersion,
  VAT_ENGINE_VERSION,
  VAT_RI_ENGINE_VERSION,
} from "@contable/tax-engine";
import type {
  LocalTaxDeclaredParameter,
  TaxEngineKey,
  TaxEngineResult,
  TaxFact,
  VatRiComponent,
  VatRiRate,
} from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { ObjectStorage, BUCKETS } from "../storage/object-storage.js";
import { exportReport, type ExportReportResult } from "../reporting/report-export.js";
import { voucherDocumentKind } from "./workpaper-classification.js";
import { RULES_HASH_SCHEMA_VERSION_V3 } from "./rules-hash.js";

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
  | "RULE_KIND_UNRESOLVED"
  | "RULE_KIND_NOT_ALLOWED"
  | "RULE_SUBJECT_UNRESOLVED"
  | "ACTIVITY_RULE_UNRESOLVED"
  | "UNSUPPORTED_ENGINE_VERSION"
  | "PERIOD_NOT_FOUND"
  | "OBLIGATION_NOT_FOUND"
  | "BLOCKING_DIFFERENCES"
  | "FINALIZE_REQUIRES_REVIEW"
  | "CREDIT_NOT_FOUND"
  | "CREDIT_INSUFFICIENT"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_REVERSED"
  | "INVALID_AMOUNT"
  | "SETTLEMENT_OBLIGATION_MISMATCH"
  | "DUPLICATE_FILING"
  | "OVERPAYMENT"
  | "INTEREST_SNAPSHOT_REQUIRED"
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

function assertSettlementMatchesObligation(
  settlement: { firmId: string; clientId: string; regimeId: string; periodId: string },
  obligation: { firmId: string; clientId: string; regimeId: string; periodId: string },
) {
  if (
    settlement.firmId !== obligation.firmId ||
    settlement.clientId !== obligation.clientId ||
    settlement.regimeId !== obligation.regimeId ||
    settlement.periodId !== obligation.periodId
  ) {
    throw new SettlementError(
      "SETTLEMENT_OBLIGATION_MISMATCH",
      "La liquidación no corresponde al cliente, régimen y período de la obligación",
    );
  }
}

function settlementAmount(settlement: { totals: Prisma.JsonValue | null }): Prisma.Decimal {
  const totals = (settlement.totals ?? {}) as Record<string, string>;
  return new Prisma.Decimal(totals["TOTAL_A_INGRESAR"] ?? totals["totalDue"] ?? "0");
}

type Tx = Prisma.TransactionClient;

/** Motor del catálogo con las capacidades de su familia (P2, corte 3). */
interface ResolvedTaxEngine {
  engineKey: string;
  engineVersion: string;
  familyId: string;
  family: { allowsAdvancePayment: boolean; closesByJurisdiction: boolean };
}

const resolvedTaxEngineSelect = {
  engineKey: true,
  engineVersion: true,
  familyId: true,
  family: { select: { allowsAdvancePayment: true, closesByJurisdiction: true } },
} as const;

/**
 * Resuelve el motor de una versión de reglas por id (catálogo `tax_engines`).
 * R4: una versión histórica sin `engineId` conserva el respaldo por el texto
 * `engineVersion`; un texto que no identifica motor devuelve `null` y la
 * liquidación bloquea con el 409 actual.
 */
async function resolveTaxEngineForVersion(
  tx: Tx,
  version: { engineId: string | null; engineVersion: string },
): Promise<ResolvedTaxEngine | null> {
  if (version.engineId) {
    const engine = await tx.taxEngine.findUnique({
      where: { id: version.engineId },
      select: resolvedTaxEngineSelect,
    });
    if (engine) return engine;
  }
  const engineKey = taxEngineKeyForVersion(version.engineVersion);
  if (!engineKey) return null;
  return tx.taxEngine.findUnique({
    where: { engineKey },
    select: resolvedTaxEngineSelect,
  });
}

/** Motor que produjo una liquidación, vía su versión de reglas o el texto guardado. */
async function resolveSettlementTaxEngine(
  tx: Tx,
  settlement: { ruleVersionId: string | null; engineVersion: string },
): Promise<ResolvedTaxEngine | null> {
  if (settlement.ruleVersionId) {
    const version = await tx.taxRuleVersion.findUnique({
      where: { id: settlement.ruleVersionId },
      select: { engineId: true, engineVersion: true },
    });
    if (version) return resolveTaxEngineForVersion(tx, version);
  }
  return resolveTaxEngineForVersion(tx, { engineId: null, engineVersion: settlement.engineVersion });
}

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
  kind:
    | "VOUCHER_COMPONENT"
    | "ADJUSTMENT"
    | "WITHHOLDING"
    | "PERCEPTION"
    | "CREDIT"
    | "F931"
    | "CM03_COEFFICIENT";
  sourceId: string;
  sourceVersion?: number;
  snapshot: Record<string, unknown>;
}

export interface SettlementCalculationInput {
  clientId: string;
  taxTypeId: string;
  regimeId: string;
  jurisdictionId: string;
  periodId: string;
  cutoff: string;
  sourceScope?: {
    workpaperId?: string;
    obligationId?: string;
    voucherIds: string[];
    withholdingIds: string[];
    perceptionIds: string[];
    f931RunIds: string[];
    classifications: Array<{
      voucherId: string;
      documentKind: string;
      activityCode: string | null;
      categoryCode: string | null;
      rateBuckets?: Array<{ rate: string; base: string; amount: string }>;
      snapshotHash: string | null;
    }>;
    cm03Coefficients?: Array<{
      sourceId: string;
      jurisdiction: string;
      jurisdictionId?: string;
      coefficient: string;
    }>;
  };
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
    input: SettlementCalculationInput,
  ) {
    return withTenantContext(ctx, (tx) => this.calculateWithTransaction(ctx, tx, input));
  }

  async calculateWithTransaction(
    ctx: TenantContext,
    tx: Tx,
    input: SettlementCalculationInput,
  ) {
      const period = await tx.taxPeriod.findUnique({ where: { id: input.periodId } });
      if (!period) throw new SettlementError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      // --- Versión ACTIVE del rule pack del régimen (V-005: se congela) ---
      const pack = await tx.taxRulePack.findFirst({
        where: { regimeId: input.regimeId },
        include: {
          regime: {
            select: {
              code: true,
              calcFamilyId: true,
              taxType: { select: { code: true } },
              jurisdiction: { select: { code: true } },
            },
          },
        },
      });
      if (!pack) throw new SettlementError("RULE_VERSION_NOT_FOUND", "No existe rule pack para el régimen");
      const activeVersion = await tx.taxRuleVersion.findFirst({
        where: {
          packId: pack.id,
          // Las versiones retiradas siguen siendo la fuente válida para
          // períodos históricos. La versión seleccionada debe cubrir el mes
          // completo; nunca se aplica retroactivamente una regla futura.
          status: { in: ["ACTIVE", "RETIRED"] },
          validFrom: { lte: period.startDate },
          OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
        },
        orderBy: [{ validFrom: "desc" }, { version: "desc" }],
      });
      if (!activeVersion) {
        throw new SettlementError(
          "NO_ACTIVE_RULES",
          "No hay una versión normativa activada que cubra íntegramente el período",
        );
      }
      // El motor se resuelve por id de catálogo (`TaxRuleVersion.engineId`).
      // R4: una versión histórica sin id conserva el respaldo por el texto
      // `engineVersion`; un motor sin calculador mantiene el bloqueo explícito.
      const resolvedEngine = await resolveTaxEngineForVersion(tx, activeVersion);
      if (!resolvedEngine || !isTaxEngineKey(resolvedEngine.engineKey)) {
        throw new SettlementError(
          "UNSUPPORTED_ENGINE_VERSION",
          `No hay despacho implementado para el motor fiscal "${activeVersion.engineVersion}"; no se aplicó un motor alternativo.`,
        );
      }
      const engineKey = resolvedEngine.engineKey;
      if (pack.regime.calcFamilyId && resolvedEngine.familyId !== pack.regime.calcFamilyId) {
        throw new SettlementError(
          "UNSUPPORTED_ENGINE_VERSION",
          `El motor fiscal "${activeVersion.engineVersion}" pertenece a otra familia de cálculo que el régimen; no se aplicó un motor alternativo.`,
        );
      }
      const isCmEngine = engineKey === "iibb-cm-art2" || engineKey === "iibb-cm-art2-legacy";
      const isTypedRuleVersion =
        activeVersion.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V3;
      const rateRules = await tx.taxRateRule.findMany({
        where: {
          ruleVersionId: activeVersion.id,
          validFrom: { lte: period.startDate },
          OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
          ...(isCmEngine
            ? {}
            : {
                AND: {
                  OR: [{ jurisdictionId: input.jurisdictionId }, { jurisdictionId: null }],
                },
              }),
        },
        orderBy: [{ concept: "asc" }, { validFrom: "asc" }, { id: "asc" }],
        include: {
          kind: { include: { familyLinks: { select: { familyId: true } } } },
        },
      });
      if (isTypedRuleVersion) {
        const familyId = pack.regime.calcFamilyId;
        if (!familyId) {
          throw new SettlementError(
            "RULE_KIND_NOT_ALLOWED",
            "La versión tipada no tiene una familia de cálculo para validar sus reglas",
          );
        }
        for (const rule of rateRules) {
          if (!rule.kindId || !rule.kind) {
            throw new SettlementError(
              "RULE_KIND_UNRESOLVED",
              `La regla ${rule.id} no tiene un tipo de regla resuelto`,
            );
          }
          if (!rule.kind.familyLinks.some((link) => link.familyId === familyId)) {
            throw new SettlementError(
              "RULE_KIND_NOT_ALLOWED",
              `El tipo ${rule.kind.key} de la regla ${rule.id} no está permitido por la familia del régimen`,
            );
          }
          const needsActivity = engineKey === "iibb-local-tuc" && rule.kind.key === "RATE";
          const isCm03 = engineKey === "iibb-cm-art2" || engineKey === "iibb-cm-art2-legacy";
          const needsJurisdiction = isCm03 && (
            (rule.kind.key === "RATE" && !rule.isDefault && !rule.jurisdictionId) ||
            (rule.kind.key === "COEFFICIENT" && !rule.jurisdictionId)
          );
          const needsCategory = engineKey === "monotributo" && rule.kind.key === "FEE";
          if (
            (needsActivity && !rule.activityId && !rule.isDefault) ||
            needsJurisdiction ||
            (needsCategory && !rule.categoryCode) ||
            (rule.isDefault && rule.kind.key !== "RATE")
          ) {
            throw new SettlementError(
              needsActivity
                ? "ACTIVITY_RULE_UNRESOLVED"
                : "RULE_SUBJECT_UNRESOLVED",
              `La regla ${rule.id} (${rule.kind.key}) no tiene resuelto el sujeto requerido`,
            );
          }
        }
      }
      const inProgressSettlement = await tx.taxSettlement.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          regimeId: input.regimeId,
          periodId: input.periodId,
          status: { in: ["DRAFT", "CALCULATED", "IN_REVIEW", "CHANGES_REQUESTED"] },
        },
        include: { supersedes: { select: { id: true, totals: true } } },
      });

      // --- Hechos aprobados dentro del período y del cutoff ---
      const cutoff = input.cutoff;
      const vouchers = await tx.fiscalVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          status: "APPROVED",
          issuedOn: { gte: period.startDate, lte: period.endDate },
          ...(input.sourceScope ? { id: { in: input.sourceScope.voucherIds } } : {}),
        },
        include: {
          components: true,
          lines: true,
          importRow: { select: { id: true, normalized: true } },
        },
      });
      const adjustments = await tx.taxAdjustment.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          reviewedAt: { not: null },
          OR: [
            { periodId: input.periodId },
            {
              periodId: null,
              voucher: { issuedOn: { gte: period.startDate, lte: period.endDate } },
            },
            {
              periodId: null,
              decision: {
                expense: { incurredOn: { gte: period.startDate, lte: period.endDate } },
              },
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
          ...(input.sourceScope ? { id: { in: input.sourceScope.withholdingIds } } : {}),
          ...(period ? { OR: [{ taxPeriodId: null }, { taxPeriodId: input.periodId }] } : {}),
        },
      });
      const perceptions = await tx.perceptionCertificate.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          status: "APPROVED",
          ...(input.sourceScope ? { id: { in: input.sourceScope.perceptionIds } } : {}),
          ...(period ? { OR: [{ taxPeriodId: null }, { taxPeriodId: input.periodId }] } : {}),
        },
      });
      const f931Runs = await tx.f931Run.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          periodId: input.periodId,
          status: "REVIEWED",
          ...(input.sourceScope ? { id: { in: input.sourceScope.f931RunIds } } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      const allocationWorkpaperId = input.sourceScope?.workpaperId;
      const allocationObligationId = input.sourceScope?.obligationId;
      const allocationScoped = Boolean(allocationWorkpaperId && allocationObligationId);
      const inputAllocations = allocationScoped
        ? await tx.taxInputAllocation.findMany({
            where: {
              firmId: ctx.firmId,
              clientId: input.clientId,
              workpaperId: allocationWorkpaperId!,
              obligationId: allocationObligationId!,
              status: "ALLOCATED",
              sourceType: { in: ["WITHHOLDING", "PERCEPTION"] },
            },
          })
        : [];
      // F1.7: los lotes inmutables son la fuente de verdad. Sólo durante la
      // migración se admite un fallback legacy si todavía no se cargó ningún
      // lote del alcance fiscal; así nunca se suman ambos libros.
      const eligiblePeriodIds = await tx.taxPeriod.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          endDate: { lte: period.endDate },
        },
        select: { id: true },
      });
      const creditLots = await tx.taxCreditLot.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          // B1 (§3.1): un saldo no verificado nunca reduce un impuesto.
          verificationStatus: "VERIFIED",
          OR: [
            { periodId: null },
            { periodId: { in: eligiblePeriodIds.map((item) => item.id) } },
          ],
          AND: {
            OR:
              isCmEngine
                ? [{ regimeId: input.regimeId }, { regimeId: null }]
                : [
                    { regimeId: input.regimeId, jurisdictionId: input.jurisdictionId },
                    { regimeId: input.regimeId, jurisdictionId: null },
                    { regimeId: null, jurisdictionId: input.jurisdictionId },
                    { regimeId: null, jurisdictionId: null },
                  ],
          },
        },
        include: { movements: true },
      });
      let rectificationOpening = (inProgressSettlement?.supersedes?.totals ?? null) as
        | Record<string, string>
        | null;
      let rectificationOpeningSourceId = inProgressSettlement?.supersedes?.id ?? null;
      if (rectificationOpening) {
        const latestPriorClosing = await tx.taxSettlement.findFirst({
          where: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            regimeId: input.regimeId,
            status: "FINALIZED",
            period: { endDate: { lt: period.startDate } },
          },
          include: { period: true },
          orderBy: [{ period: { endDate: "desc" } }, { version: "desc" }],
        });
        if (latestPriorClosing) {
          const priorTotals = (latestPriorClosing.totals ?? {}) as Record<string, string>;
          rectificationOpening = {
            SALDO_TECNICO_ANTERIOR: priorTotals["SALDO_TECNICO_AFTER"] ?? "0",
            SALDO_LIBRE_ANTERIOR: priorTotals["SALDO_LIBRE_AFTER"] ?? "0",
            SALDO_ANTERIOR: priorTotals["SALDO_A_FAVOR"] ?? "0",
            ...Object.fromEntries(
              Object.entries(priorTotals)
                .filter(([key]) => key.startsWith("SALDO_A_FAVOR_"))
                .map(([key, value]) => [key.replace("SALDO_A_FAVOR_", "SALDO_ANTERIOR_"), value]),
            ),
          };
          rectificationOpeningSourceId = latestPriorClosing.id;
        }
      }
      const legacyCredits = creditLots.length === 0 && !rectificationOpening
        ? await tx.taxCreditLedgerEntry.aggregate({
            where: { firmId: ctx.firmId, clientId: input.clientId, taxTypeId: input.taxTypeId },
            _sum: { balanceAfter: true },
          })
        : null;
      const availableLots = (rectificationOpening ? [] : creditLots)
        .map((lot) => ({ lot, available: lot.originalAmount.minus(lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0))) }))
        .filter((entry) => entry.available.isPositive());
      const technicalPrevious = rectificationOpening
        ? new Prisma.Decimal(rectificationOpening["SALDO_TECNICO_ANTERIOR"] ?? "0")
        : availableLots
            .filter((entry) => entry.lot.kind === "IVA_TECNICO")
            .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const freePrevious = availableLots
        .filter((entry) => entry.lot.kind === "IVA_LIBRE")
        .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const genericPrevious = availableLots
        .filter((entry) => entry.lot.kind === "SALDO_A_FAVOR")
        .reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));
      const previousFree = rectificationOpening
        ? new Prisma.Decimal(
            rectificationOpening["SALDO_LIBRE_ANTERIOR"] ??
              rectificationOpening["SALDO_ANTERIOR"] ??
              "0",
          )
        : creditLots.length > 0
          ? genericPrevious.plus(freePrevious)
          : legacyCredits?._sum.balanceAfter ?? new Prisma.Decimal(0);

      // --- Reglas del motor (tasas por concepto). La DB guarda la alícuota
      //     en puntos porcentuales (p.ej. 21.0000); el motor espera decimal
      //     (0.21). Se normaliza dividiendo por 100. rate es opcional (las
      //     cuotas de monotributo van en minAmount). ---
      const rateRuleJurisdictionIds = [
        ...new Set(rateRules.map((rule) => rule.jurisdictionId).filter(Boolean) as string[]),
      ];
      const rateRuleJurisdictions = await tx.jurisdiction.findMany({
        where: { id: { in: rateRuleJurisdictionIds } },
      });
      const rateRuleJurisdictionCode = new Map(
        rateRuleJurisdictions.map((jurisdiction) => [jurisdiction.id, jurisdiction.code]),
      );
      const effectiveRuleConcept = (rule: (typeof rateRules)[number]) => {
        if (rule.activityCode) return rule.activityCode;
        if (
          rule.jurisdictionId &&
          ["ALICUOTA", "RATE", "JURISDICCION"].includes(rule.concept)
        ) {
          return rateRuleJurisdictionCode.get(rule.jurisdictionId) ?? rule.concept;
        }
        return rule.concept;
      };
      if (!isTypedRuleVersion) {
        const duplicateRuleConcepts = rateRules
          .map(effectiveRuleConcept)
          .filter((concept, index, concepts) => concepts.indexOf(concept) !== index);
        if (duplicateRuleConcepts.length > 0) {
          throw new SettlementError(
            "RULE_VERSION_NOT_FOUND",
            `La versión normativa tiene reglas efectivas duplicadas para ${[
              ...new Set(duplicateRuleConcepts),
            ].join(", ")}`,
          );
        }
      }
      const typedRuleSubjects = new Set<string>();
      const rules = rateRules.map((r) => {
        if (isTypedRuleVersion) {
          const kind = r.kind!.key;
          const subject = r.isDefault
            ? null
            : kind === "RATE" && engineKey === "iibb-local-tuc"
              ? r.activityId ?? null
              : kind === "RATE" || kind === "COEFFICIENT"
                ? r.jurisdictionId ?? null
                : kind === "FEE"
                  ? r.categoryCode ?? null
                  : null;
          if (kind === "RATE" || kind === "COEFFICIENT" || kind === "FEE") {
            const subjectKey = JSON.stringify([kind, subject, r.isDefault]);
            if (typedRuleSubjects.has(subjectKey)) {
              throw new SettlementError(
                "RULE_SUBJECT_UNRESOLVED",
                `La versión normativa repite el sujeto de la regla ${r.id}`,
              );
            }
            typedRuleSubjects.add(subjectKey);
          }
          const storedRate = r.rate !== null ? dec(r.rate.toString()) : undefined;
          const normalized = storedRate === undefined
            ? undefined
            : kind === "RATE"
              ? storedRate.div(100)
              : storedRate;
          return {
            id: r.id,
            concept: r.concept,
            code: r.concept,
            kind,
            activityId: r.activityId,
            jurisdictionId: r.jurisdictionId,
            categoryCode: r.categoryCode,
            isDefault: r.isDefault,
            ...(normalized !== undefined ? { rate: normalized } : {}),
            validFrom: r.validFrom.toISOString().slice(0, 10),
            ...(r.validTo ? { validTo: r.validTo.toISOString().slice(0, 10) } : {}),
          };
        }
        const concept = effectiveRuleConcept(r);
        const rate = r.rate !== null ? dec(r.rate.toString()) : undefined;
        // Compatibilidad v1/v2: sólo los coeficientes CM se guardan como razón 0..1.
        const normalized =
          rate !== undefined
            ? concept.startsWith("COEF_")
              ? rate
              : rate.div(100)
            : undefined;
        const min = r.minAmount !== null ? dec(r.minAmount.toString()) : undefined;
        return {
          id: r.id,
          concept,
          code: r.concept,
          ...(normalized !== undefined ? { rate: normalized } : {}),
          ...(min !== undefined ? { minimum: min } : {}),
          validFrom: r.validFrom.toISOString().slice(0, 10),
          ...(r.validTo ? { validTo: r.validTo.toISOString().slice(0, 10) } : {}),
        };
      });

      // --- Hechos e inputs ---
      const facts: EngineFact[] = [];
      const inputs: SettlementInputRow[] = [];
      const classificationByVoucher = new Map(
        (input.sourceScope?.classifications ?? []).map((classification) => [
          classification.voucherId,
          classification,
        ]),
      );
      const vatRiComponents: VatRiComponent[] = [];
      const missingRateVoucherIds: string[] = [];
      const vatBookDifferences: Array<{ voucherId: string; difference: Prisma.Decimal }> = [];
      const rateFromLabel = (value: string): VatRiRate | null => {
        const normalized = value.trim().toUpperCase().replace("%", "");
        if (normalized === "21" || normalized === "21.0") return "21";
        if (["10.5", "10,5", "105"].includes(normalized)) return "10.5";
        if (normalized === "27" || normalized === "27.0") return "27";
        if (normalized === "EXENTO") return "EXENTO";
        if (normalized === "NO_GRAVADO" || normalized === "NO GRAVADO") return "NO_GRAVADO";
        return null;
      };

      for (const voucher of vouchers) {
        const classification = classificationByVoucher.get(voucher.id);
        const documentKind = classification?.documentKind ?? voucherDocumentKind(voucher);
        const isCreditNote = documentKind === "CREDIT_NOTE";
        const buckets = classification?.rateBuckets
          ? classification.rateBuckets.map((bucket, index) => ({
              id: `${voucher.id}:CLASSIFICATION:${index}:${bucket.rate}`,
              rate: bucket.rate,
              base: bucket.base,
              amount: bucket.amount,
            }))
          : voucher.components.flatMap((component) => {
              const labels: Record<string, string> = {
                IVA_21: "21",
                IVA_105: "10.5",
                IVA_27: "27",
                EXENTO: "EXENTO",
                NO_GRAVADO: "NO_GRAVADO",
              };
              const rate = labels[component.concept];
              return rate
                ? [{
                    id: `${voucher.id}:${component.id}`,
                    rate,
                    base: component.base.abs().toFixed(4),
                    amount: component.amount.abs().toFixed(4),
                  }]
                : [];
            });
        let taxableBucketBase = new Prisma.Decimal(0);
        let taxableBucketCount = 0;
        for (const bucket of buckets) {
          const rate = rateFromLabel(bucket.rate);
          if (!rate) continue;
          if (rate !== "EXENTO" && rate !== "NO_GRAVADO") {
            taxableBucketBase = taxableBucketBase.plus(bucket.base);
            taxableBucketCount += 1;
            inputs.push({
              kind: "VOUCHER_COMPONENT",
              sourceId: bucket.id,
              sourceVersion: voucher.version,
              snapshot: {
                voucherId: voucher.id,
                issuedOn: voucher.issuedOn.toISOString().slice(0, 10),
                direction: voucher.direction,
                documentKind,
                rate,
                base: new Prisma.Decimal(bucket.base).abs().toFixed(4),
                tax: new Prisma.Decimal(bucket.amount).abs().toFixed(4),
                activityCode: classification?.activityCode ?? null,
                classificationHash: classification?.snapshotHash ?? null,
              },
            });
          }
          vatRiComponents.push({
            id: bucket.id,
            direction: voucher.direction,
            date: voucher.issuedOn.toISOString().slice(0, 10),
            rate,
            net: dec(bucket.base).abs(),
            tax: dec(bucket.amount).abs(),
            isCreditNote,
            ...(classification?.activityCode
              ? { activityCode: classification.activityCode }
              : {}),
          });
        }
        const taxableNet = voucher.components
          .filter((component) => component.concept === "NETO")
          .reduce((sum, component) => sum.plus(component.base.abs()), new Prisma.Decimal(0));
        if (taxableNet.isPositive() && taxableBucketCount === 0) {
          missingRateVoucherIds.push(voucher.id);
        } else if (taxableNet.isPositive()) {
          vatBookDifferences.push({
            voucherId: voucher.id,
            difference: taxableNet.minus(taxableBucketBase),
          });
        }
      }

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
      if (rectificationOpening && rectificationOpeningSourceId) {
        inputs.push({
          kind: "CREDIT",
          sourceId: rectificationOpeningSourceId,
          snapshot: {
            kind: "RECTIFICATION_OPENING_SNAPSHOT",
            technicalPrevious: technicalPrevious.toFixed(4),
            freeOrGenericPrevious: previousFree.toFixed(4),
          },
        });
      }
      for (const run of f931Runs) {
        inputs.push({
          kind: "F931",
          sourceId: run.id,
          snapshot: {
            periodId: run.periodId,
            importBatchId: run.importBatchId,
            totalRemuneration: run.totalRemuneration.toFixed(4),
            deduction: run.deduction.toFixed(4),
            netRemuneration: run.netRemuneration.toFixed(4),
            status: run.status,
            reviewedByUserId: run.reviewedByUserId,
            reviewedAt: run.reviewedAt?.toISOString() ?? null,
            hash: run.hash,
          },
        });
      }

      for (const v of vouchers) {
        const concept = v.direction === "SALE" ? "VENTAS" : "COMPRAS";
        const classification = classificationByVoucher.get(v.id);
        const documentKind = classification?.documentKind ?? voucherDocumentKind(v);
        const sign = documentKind === "CREDIT_NOTE" ? -1 : 1;
        for (const c of v.components) {
          if (c.concept === "NETO" || c.concept === "EXENTO" || c.concept === "NO_GRAVADO") {
            const factConcept =
              c.concept === "NETO" ? concept : (c.concept as "EXENTO" | "NO_GRAVADO");
            facts.push({
              id: `${v.id}:${c.id}`,
              direction: v.direction,
              date: v.issuedOn.toISOString().slice(0, 10),
              concept: factConcept,
              base: c.base.abs().times(sign),
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
                sign,
                documentKind,
                categoryCode: classification?.categoryCode ?? null,
                activityCode: classification?.activityCode ?? null,
                classificationHash: classification?.snapshotHash ?? null,
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
        }
        inputs.push({
          kind: "ADJUSTMENT",
          sourceId: a.id,
          snapshot: {
            adjustmentId: a.id,
            periodId: a.periodId,
            voucherId: a.voucherId,
            ruleVersionId: a.ruleVersionId,
            concept: a.concept,
            amount: a.amount.toString(),
            reason: a.reason,
            reviewedByUserId: a.reviewedByUserId,
            reviewedAt: a.reviewedAt?.toISOString() ?? null,
          },
        });
      }

      const withholdingTotal = allocationScoped
        ? inputAllocations
            .filter((allocation) => allocation.sourceType === "WITHHOLDING")
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0))
        : withholdings.reduce((acc, withholding) => acc.plus(withholding.amount), new Prisma.Decimal(0));
      const perceptionTotal = allocationScoped
        ? inputAllocations
            .filter((allocation) => allocation.sourceType === "PERCEPTION")
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0))
        : perceptions.reduce((acc, perception) => acc.plus(perception.amount), new Prisma.Decimal(0));
      const allocationJurisdictionIds = [
        ...new Set(
          [
            ...inputAllocations.map((allocation) => allocation.jurisdictionId),
            ...availableLots.map((entry) => entry.lot.jurisdictionId),
            ...withholdings.map((item) => item.jurisdictionId),
            ...perceptions.map((item) => item.jurisdictionId),
            ...Object.keys(rectificationOpening ?? {})
              .filter((key) => key.startsWith("SALDO_A_FAVOR_"))
              .map((key) => key.slice("SALDO_A_FAVOR_".length)),
          ].filter(Boolean) as string[],
        ),
      ];
      const allocationJurisdictions = await tx.jurisdiction.findMany({
        where: {
          OR: [
            { id: { in: allocationJurisdictionIds } },
            // Compatibilidad con certificados históricos: antes de que el
            // campo quedara normalizado algunos registros guardaban el código
            // fiscal (por ejemplo, "CBA") en jurisdictionId.
            { code: { in: allocationJurisdictionIds } },
          ],
        },
      });
      const allocationJurisdictionById = new Map(
        allocationJurisdictions.flatMap((jurisdiction) => [
          [jurisdiction.id, jurisdiction.code] as const,
          [jurisdiction.code, jurisdiction.code] as const,
        ]),
      );
      const jurisdictionIdByCode = new Map(
        allocationJurisdictions.map((jurisdiction) => [jurisdiction.code, jurisdiction.id]),
      );
      const jurisdictionKeyForCalculation = (idOrCode: string | null | undefined) => {
        if (!idOrCode) return undefined;
        if (!isTypedRuleVersion) return allocationJurisdictionById.get(idOrCode);
        return allocationJurisdictions.some((jurisdiction) => jurisdiction.id === idOrCode)
          ? idOrCode
          : jurisdictionIdByCode.get(idOrCode);
      };
      const withholdingById = new Map(withholdings.map((item) => [item.id, item]));
      const perceptionById = new Map(perceptions.map((item) => [item.id, item]));
      const isBankCollection = (source: { creditKind: string; concept: string }) => {
        const descriptor = `${source.creditKind} ${source.concept}`.toUpperCase();
        return ["SIRCREB", "RECAUDACION", "RECAUDACIÓN", "RETENCION_BANCARIA", "RB_TUC", "RB TUC"].some(
          (marker) => descriptor.includes(marker),
        );
      };
      const collectedTotal = allocationScoped
        ? inputAllocations
            .filter((allocation) => {
              if (allocation.sourceType !== "WITHHOLDING") return false;
              const source = withholdingById.get(allocation.sourceId);
              return source ? isBankCollection(source) : false;
            })
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0))
        : withholdings
            .filter(isBankCollection)
            .reduce((sum, source) => sum.plus(source.amount), new Prisma.Decimal(0));
      const ordinaryWithholdingTotal = withholdingTotal.minus(collectedTotal);
      for (const allocation of inputAllocations) {
        const source =
          allocation.sourceType === "WITHHOLDING"
            ? withholdingById.get(allocation.sourceId)
            : perceptionById.get(allocation.sourceId);
        inputs.push({
          kind: allocation.sourceType as "WITHHOLDING" | "PERCEPTION",
          sourceId: allocation.sourceId,
          snapshot: {
            allocationId: allocation.id,
            workpaperId: allocation.workpaperId,
            obligationId: allocation.obligationId,
            sourceCode: allocation.sourceCode,
            amount: allocation.amount.toFixed(4),
            sourceAmount: source?.amount.toFixed(4) ?? null,
            certificateNumber: source?.certificateNumber ?? null,
            cuitAgent: source?.cuitAgent ?? null,
            concept: source?.concept ?? null,
            creditKind: source?.creditKind ?? null,
            taxTypeId: allocation.taxTypeId,
            regimeId: allocation.regimeId,
            jurisdictionId: allocation.jurisdictionId,
            periodId: allocation.periodId,
            allocationHash: allocation.snapshotHash,
          },
        });
      }

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
      const localTaxDeclaredParameters: LocalTaxDeclaredParameter[] = [];
      const hasExplicitActivityLines = vouchers.some(
        (voucher) =>
          voucher.direction === "SALE" &&
          voucher.lines.some((line) => line.activityCode && line.netAmount),
      );
      const isTypedIibb = isTypedRuleVersion && engineKey === "iibb-local-tuc";
      const activitiesByCode = new Map<string, Array<{ id: string; jurisdictionId: string }>>();
      if (isTypedIibb) {
        const activityCodes = [...new Set(vouchers.flatMap((voucher) => {
          const imported = (voucher.importRow?.normalized ?? null) as Record<string, unknown> | null;
          return [
            ...voucher.lines.map((line) => line.activityCode),
            classificationByVoucher.get(voucher.id)?.activityCode,
            typeof imported?.["activityCode"] === "string" ? imported["activityCode"] : null,
          ];
        }).filter((code): code is string => typeof code === "string" && code.trim().length > 0)
          .map((code) => code.trim().toUpperCase()))];
        const activities = activityCodes.length > 0
          ? await tx.economicActivity.findMany({
              where: { code: { in: activityCodes } },
              select: { id: true, code: true, jurisdictionId: true },
            })
          : [];
        for (const activity of activities) {
          const matches = activitiesByCode.get(activity.code) ?? [];
          matches.push({ id: activity.id, jurisdictionId: activity.jurisdictionId });
          activitiesByCode.set(activity.code, matches);
        }
      }
      const resolveActivityId = (activityCode: string, ruleId?: string): string => {
        const code = activityCode.trim().toUpperCase();
        const matches = (activitiesByCode.get(code) ?? []).filter(
          (activity) => activity.jurisdictionId === input.jurisdictionId,
        );
        if (matches.length !== 1) {
          throw new SettlementError(
            "ACTIVITY_RULE_UNRESOLVED",
            `La actividad ${code} de ${ruleId ? `la regla ${ruleId}` : "los hechos"} no resuelve a una actividad única de la jurisdicción`,
          );
        }
        return matches[0]!.id;
      };
      for (const v of vouchers) {
        if (v.direction !== "SALE") continue;
        if (v.issuedOn.toISOString() > cutoffDate) continue;
        const classification = classificationByVoucher.get(v.id);
        const documentKind = classification?.documentKind ?? voucherDocumentKind(v);
        const sign = documentKind === "CREDIT_NOTE" ? -1 : 1;
        const importedParameters = (v.importRow?.normalized ?? null) as Record<
          string,
          unknown
        > | null;
        const importedActivity =
          typeof importedParameters?.["activityCode"] === "string"
            ? importedParameters["activityCode"].trim().toUpperCase()
            : null;
        if (v.importRow && importedActivity) {
          const declaredRate = importedParameters?.["rate"];
          const declaredMinimum = importedParameters?.["minimum"];
          localTaxDeclaredParameters.push({
            sourceId: v.importRow.id,
            activity: isTypedIibb ? resolveActivityId(importedActivity) : importedActivity,
            ...(typeof declaredRate === "string" && declaredRate.length > 0
              ? { rate: declaredRate }
              : {}),
            ...(typeof declaredMinimum === "string" && declaredMinimum.length > 0
              ? { minimum: declaredMinimum }
              : {}),
          });
        }
        for (const line of v.lines) {
          const activityCode = line.activityCode;
          const legacyActivityCode = activityCode ?? "DEFAULT";
          const activity = isTypedIibb
            ? !activityCode || activityCode.trim().length === 0
              ? ""
              : resolveActivityId(activityCode)
            : legacyActivityCode;
          const net = (line.netAmount ?? new Prisma.Decimal(0)).abs().times(sign);
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
              activityCode: legacyActivityCode,
              netAmount: net.toString(),
              declaredRate:
                importedActivity === legacyActivityCode ? importedParameters?.["rate"] ?? null : null,
              declaredMinimum:
                importedActivity === legacyActivityCode ? importedParameters?.["minimum"] ?? null : null,
              declaredExemption:
                importedActivity === legacyActivityCode ? importedParameters?.["exemption"] ?? null : null,
              documentKind,
              classificationHash: classification?.snapshotHash ?? null,
            },
          });
        }
        if (v.lines.length === 0 && !hasExplicitActivityLines && classification?.activityCode) {
          const activity = isTypedIibb
            ? resolveActivityId(classification.activityCode)
            : classification.activityCode;
          const net = v.components
            .filter((component) => component.concept === "NETO")
            .reduce((sum, component) => sum.plus(component.base.abs()), new Prisma.Decimal(0))
            .times(sign);
          incomeByActivity[activity] = dec(
            incomeByActivity[activity] ?? "0",
          )
            .plus(net)
            .toString();
          inputs.push({
            kind: "VOUCHER_COMPONENT",
            sourceId: `${v.id}:CLASSIFICATION`,
            sourceVersion: v.version,
            snapshot: {
              voucherId: v.id,
              activityCode: classification.activityCode,
              netAmount: net.toString(),
              documentKind,
              classificationHash: classification.snapshotHash,
            },
          });
        }
      }

      const minimumRules = await tx.taxMinimumRule.findMany({
        where: {
          ruleVersionId: activeVersion.id,
          validFrom: { lte: period.startDate },
          OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
          AND: {
            OR: [{ jurisdictionId: input.jurisdictionId }, { jurisdictionId: null }],
          },
        },
        orderBy: [{ jurisdictionId: "desc" }, { concept: "asc" }, { id: "asc" }],
      });
      const scopedMinimums = minimumRules.filter(
        (rule) => rule.jurisdictionId === input.jurisdictionId,
      );
      const applicableMinimums = scopedMinimums.length > 0
        ? scopedMinimums
        : minimumRules.filter((rule) => rule.jurisdictionId === null);
      if (applicableMinimums.length > 1) {
        throw new SettlementError(
          "RULE_VERSION_NOT_FOUND",
          "La versión normativa tiene más de un mínimo global aplicable al período",
        );
      }
      const minimum = applicableMinimums[0]?.amount
        ? dec(applicableMinimums[0].amount.toString())
        : undefined;
      const ivaRestitution = adjustments
        .filter((adjustment) => ["IVA_RESTITUCION", "RESTITUCION"].includes(adjustment.concept))
        .reduce((sum, adjustment) => sum.plus(adjustment.amount), new Prisma.Decimal(0));
      const ivaCompensation = adjustments
        .filter((adjustment) => ["IVA_COMPENSACION", "COMPENSACION"].includes(adjustment.concept))
        .reduce((sum, adjustment) => sum.plus(adjustment.amount), new Prisma.Decimal(0));
      const iibbOtherCredits = adjustments
        .filter((adjustment) =>
          ["IIBB_OTRO_CREDITO", "IIBB_OTROS_CREDITOS", "OTRO_CREDITO"].includes(
            adjustment.concept,
          ),
        )
        .reduce((sum, adjustment) => sum.plus(adjustment.amount), new Prisma.Decimal(0));

      // Registro engineKey → calculador. El tipo `Record<TaxEngineKey, ...>`
      // obliga en compilación a cubrir cada motor declarado: sumar un motor al
      // catálogo sin calculador rompe el typecheck antes de producción.
      const iibbTuc = (includeOtherCredits: boolean) =>
        calculateIIbbTuc({
          engineVersion: activeVersion.engineVersion,
          period: periodRange,
          facts: facts as TaxFact[],
          rules,
          ...(isTypedRuleVersion ? { ruleMode: "TYPED" as const } : {}),
          incomeByActivity,
          ...(minimum !== undefined ? { minimum } : {}),
          credits: {
            withholding: ordinaryWithholdingTotal,
            perception: perceptionTotal,
            collected: collectedTotal,
            ...(includeOtherCredits ? { other: iibbOtherCredits } : {}),
          },
          balances: { previousCredit: previousFree.toString() },
          declaredParameters: localTaxDeclaredParameters,
        });
      const temSmt = () =>
        calculateTemSmt({
          engineVersion: activeVersion.engineVersion,
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
          declaredParameters: localTaxDeclaredParameters,
        });
      const cm03 = () => {
        // --- CM03 artículo 2: coeficientes por jurisdicción ---
        // Los coeficientes se toman de las reglas (concept = jurisdicción,
        // rate = coeficiente). Se validan en el motor (suma = 1).
        const coefficients: Record<string, string> = {};
        const declaredCoefficients = input.sourceScope?.cm03Coefficients ?? [];
        if (declaredCoefficients.length > 0) {
          const seenJurisdictions = new Set<string>();
          for (const coefficient of [...declaredCoefficients].sort((left, right) =>
            (left.jurisdictionId ?? left.jurisdiction).localeCompare(
              right.jurisdictionId ?? right.jurisdiction,
            ),
          )) {
            const jurisdiction = isTypedRuleVersion
              ? coefficient.jurisdictionId
              : coefficient.jurisdiction;
            if (!jurisdiction) {
              throw new SettlementError(
                "RULE_SUBJECT_UNRESOLVED",
                `El coeficiente importado ${coefficient.sourceId} no tiene jurisdicción resuelta por id`,
              );
            }
            if (seenJurisdictions.has(jurisdiction)) {
              throw new SettlementError(
                "INVALID_TRANSITION",
                `La fuente CM03 repite el coeficiente de ${jurisdiction}`,
              );
            }
            seenJurisdictions.add(jurisdiction);
            coefficients[jurisdiction] = coefficient.coefficient;
            inputs.push({
              kind: "CM03_COEFFICIENT",
              sourceId: coefficient.sourceId,
              snapshot: {
                jurisdiction,
                coefficient: coefficient.coefficient,
                origin: "SIFERE_CM03",
              },
            });
          }
        } else {
          if (isTypedRuleVersion) {
            for (const r of rateRules) {
              if (r.kind?.key === "COEFFICIENT" && r.jurisdictionId && r.rate !== null) {
                coefficients[r.jurisdictionId] = r.rate.toString();
              }
            }
          } else {
            for (const r of rateRules) {
              if (r.concept.startsWith("COEF_") && r.rate !== null) {
                coefficients[r.concept.slice(5)] = r.rate.toString();
              }
            }
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
        let unscopedPrevious = new Prisma.Decimal(0);
        if (rectificationOpening) {
          for (const [key, value] of Object.entries(rectificationOpening)) {
            if (key.startsWith("SALDO_ANTERIOR_") && key !== "SALDO_ANTERIOR") {
              const jurisdiction = jurisdictionKeyForCalculation(
                key.slice("SALDO_ANTERIOR_".length),
              );
              if (jurisdiction) previousCreditByJurisdiction[jurisdiction] = value;
              else if (isTypedRuleVersion) {
                throw new SettlementError(
                  "RULE_SUBJECT_UNRESOLVED",
                  `El saldo anterior de ${key.slice("SALDO_ANTERIOR_".length)} no resuelve a una jurisdicción`,
                );
              }
            }
          }
          if (Object.keys(previousCreditByJurisdiction).length === 0) {
            unscopedPrevious = previousFree;
          }
        } else {
          for (const entry of availableLots) {
            if (entry.lot.kind !== "SALDO_A_FAVOR") continue;
            const jurisdiction = jurisdictionKeyForCalculation(entry.lot.jurisdictionId);
            if (jurisdiction) {
              previousCreditByJurisdiction[jurisdiction] = new Prisma.Decimal(
                previousCreditByJurisdiction[jurisdiction] ?? "0",
              )
                .plus(entry.available)
                .toString();
            } else {
              unscopedPrevious = unscopedPrevious.plus(entry.available);
            }
          }
        }
        const primaryJurisdiction = Object.entries(coefficients)
          .sort(([leftCode, leftValue], [rightCode, rightValue]) => {
            const byCoefficient = new Prisma.Decimal(rightValue).comparedTo(leftValue);
            return byCoefficient !== 0 ? byCoefficient : leftCode.localeCompare(rightCode);
          })[0]?.[0];
        if (!rectificationOpening && creditLots.length === 0 && previousFree.isPositive()) {
          // Fallback de migración para el ledger anterior a TaxCreditLot.
          // Se concentra en una única jurisdicción; nunca se distribuye ni
          // compensa contra deudas de las restantes.
          unscopedPrevious = unscopedPrevious.plus(previousFree);
        }
        if (primaryJurisdiction && unscopedPrevious.isPositive()) {
          previousCreditByJurisdiction[primaryJurisdiction] = new Prisma.Decimal(
            previousCreditByJurisdiction[primaryJurisdiction] ?? "0",
          )
            .plus(unscopedPrevious)
            .toString();
        }
        const declaredWithholding = withholdings.filter((w) => w.jurisdictionId);
        const declaredPerception = perceptions.filter((p) => p.jurisdictionId);
        if (allocationScoped) {
          for (const allocation of inputAllocations) {
            if (!allocation.jurisdictionId) continue;
            const jurisdiction = jurisdictionKeyForCalculation(allocation.jurisdictionId);
            if (!jurisdiction) continue;
            if (allocation.sourceType === "WITHHOLDING") {
              withholdingByJurisdiction[jurisdiction] = (
                withholdingByJurisdiction[jurisdiction] ?? new Prisma.Decimal(0)
              ).plus(allocation.amount);
            } else {
              perceptionByJurisdiction[jurisdiction] = (
                perceptionByJurisdiction[jurisdiction] ?? new Prisma.Decimal(0)
              ).plus(allocation.amount);
            }
          }
        } else if (declaredWithholding.length > 0 || declaredPerception.length > 0) {
          for (const w of declaredWithholding) {
            const j = jurisdictionKeyForCalculation(w.jurisdictionId);
            if (!j) continue;
            withholdingByJurisdiction[j] = (withholdingByJurisdiction[j] ?? new Prisma.Decimal(0)).plus(w.amount);
          }
          for (const p of declaredPerception) {
            const j = jurisdictionKeyForCalculation(p.jurisdictionId);
            if (!j) continue;
            perceptionByJurisdiction[j] = (perceptionByJurisdiction[j] ?? new Prisma.Decimal(0)).plus(p.amount);
          }
        } else {
          if (primaryJurisdiction) {
            withholdingByJurisdiction[primaryJurisdiction] = withholdingTotal;
            perceptionByJurisdiction[primaryJurisdiction] = perceptionTotal;
          }
        }
        return calculateCm03({
          engineVersion: activeVersion.engineVersion,
          period: periodRange,
          facts: facts as TaxFact[],
          rules,
          ...(isTypedRuleVersion ? { ruleMode: "TYPED" as const } : {}),
          incomeByActivity,
          coefficients,
          credits: {
            withholdingByJurisdiction,
            perceptionByJurisdiction,
          },
          cmBalances: { previousCreditByJurisdiction },
        });
      };
      const monotributo = async () => {
        // --- Monotributo: cuota por categoría ---
        const profile = await tx.taxpayerProfileVersion.findFirst({
          where: { firmId: ctx.firmId, clientId: input.clientId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        });
        const category = profile?.monotributoCategory ?? "A";
        const feeByCategory: Record<string, string> = {};
        for (const r of rateRules) {
          if (isTypedRuleVersion && r.kind?.key === "FEE" && r.categoryCode) {
            feeByCategory[r.categoryCode] = (r.minAmount ?? r.rate)?.toString() ?? "0";
          } else if (!isTypedRuleVersion && r.concept.startsWith("CUOTA_")) {
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
        return calculateMonotributo({
          engineVersion: activeVersion.engineVersion,
          period: periodRange,
          facts: facts as TaxFact[],
          rules,
          ...(isTypedRuleVersion ? { ruleMode: "TYPED" as const } : {}),
          category,
          parameters: { monthlyFeeByCategory: feeByCategory },
          payments: {
            paid: periodPayments._sum.amount ?? new Prisma.Decimal(0),
          },
        });
      };
      const calculators: Record<TaxEngineKey, () => Promise<TaxEngineResult>> = {
        "vat-ri": async () => {
          const decreeRule = rules.find((rule) => rule.concept === "DTO_814");
          const netRemuneration = f931Runs.reduce(
            (sum, run) => sum.plus(run.netRemuneration),
            new Prisma.Decimal(0),
          );
          return calculateVatRi({
            period: periodRange,
            components: vatRiComponents,
            missingRateVoucherIds,
            bookDifferences: vatBookDifferences.map((item) => ({
              voucherId: item.voucherId,
              difference: dec(item.difference.toString()),
            })),
            rules,
            ...(f931Runs.length > 0
              ? {
                  decree814: {
                    netRemuneration: dec(netRemuneration.toString()),
                    runCount: f931Runs.length,
                    ...(decreeRule?.rate ? { rate: decreeRule.rate } : {}),
                  },
                }
              : {}),
            credits: {
              withholding: dec(withholdingTotal.toString()),
              perception: dec(perceptionTotal.toString()),
              restitution: dec(ivaRestitution.toString()),
              compensation: dec(ivaCompensation.toString()),
              technicalPrevious: dec(technicalPrevious.toString()),
              freeAvailabilityPrevious: dec(previousFree.toString()),
            },
          });
        },
        "vat-ri-legacy": async () =>
          calculateVat({
            engineVersion: activeVersion.engineVersion,
            period: periodRange,
            facts: facts as TaxFact[],
            rules,
            credits: {
              withholding: withholdingTotal,
              perception: perceptionTotal,
              technicalPrevious,
              freeAvailabilityPrevious: previousFree,
            },
          }),
        "iibb-local-tuc": async () => iibbTuc(true),
        "iibb-local-tuc-legacy": async () => iibbTuc(false),
        "iibb-cm-art2": async () => cm03(),
        "iibb-cm-art2-legacy": async () => cm03(),
        "tem-smt": async () => temSmt(),
        "tem-smt-legacy": async () => temSmt(),
        monotributo: async () => monotributo(),
      };
      const result = await calculators[engineKey]();

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
        ruleVersionId: activeVersion.id,
        rulesHash: activeVersion.rulesHash,
        inputHash: result.inputHash,
        outputHash: result.outputHash,
        totals: totals as unknown as Prisma.InputJsonValue,
        status: "CALCULATED" as const,
        reviewedByUserId: null,
        reviewedAt: null,
      };

      // --- Persistencia: reutiliza la versión en curso o crea v1 ---
      const existing = inProgressSettlement;

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
  }

  // ------------------------------------------------------------------
  // G3-04: Workflow maker-checker
  // ------------------------------------------------------------------

  /** CALCULATED → IN_REVIEW (sólo desde calculada y sin bloqueos). */
  async submitReview(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, (tx) =>
      this.submitReviewWithTransaction(ctx, tx, settlementId),
    );
  }

  async submitReviewWithTransaction(ctx: TenantContext, tx: Tx, settlementId: string) {
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
  }

  /** IN_REVIEW → CHANGES_REQUESTED (el revisor pide cambios). */
  async requestChanges(ctx: TenantContext, settlementId: string, comment: string) {
    return withTenantContext(ctx, (tx) =>
      this.requestChangesWithTransaction(ctx, tx, settlementId, comment),
    );
  }

  async requestChangesWithTransaction(
    ctx: TenantContext,
    tx: Tx,
    settlementId: string,
    comment: string,
    allowSelfReview = false,
  ) {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "IN_REVIEW") {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `Solo una revisión en curso puede pedir cambios (estado: ${s.status})`,
        );
      }
      const isSelfReview = s.preparedByUserId === ctx.userId;
      if (isSelfReview && !allowSelfReview) {
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
      const updated = await tx.taxSettlement.update({
        where: { id: settlementId },
        data: { status: "CHANGES_REQUESTED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
      if (isSelfReview) {
        await tx.auditEvent.create({
          data: {
            firmId: ctx.firmId,
            clientId: s.clientId,
            userId: ctx.userId,
            actorKind: ctx.actorKind,
            action: "SELF_REVIEW",
            entityType: "TaxSettlement",
            entityId: settlementId,
            after: { type: "SELF_REVIEW", scope: "SETTLEMENT_REVIEW_CHANGES" },
          },
        });
      }
      return updated;
  }

  /** IN_REVIEW → REVIEWED (aprobación del revisor; exige revisor distinto). */
  async review(ctx: TenantContext, settlementId: string, comment?: string) {
    return withTenantContext(ctx, (tx) =>
      this.reviewWithTransaction(ctx, tx, settlementId, comment),
    );
  }

  async reviewWithTransaction(
    ctx: TenantContext,
    tx: Tx,
    settlementId: string,
    comment?: string,
    allowSelfReview = false,
  ) {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status !== "IN_REVIEW") {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `Solo IN_REVIEW puede aprobarse (estado: ${s.status})`,
        );
      }
      const isSelfReview = s.preparedByUserId === ctx.userId;
      if (isSelfReview && !allowSelfReview) {
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
      const updated = await tx.taxSettlement.update({
        where: { id: settlementId },
        data: { status: "REVIEWED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
      if (isSelfReview) {
        await tx.auditEvent.create({
          data: {
            firmId: ctx.firmId,
            clientId: s.clientId,
            userId: ctx.userId,
            actorKind: ctx.actorKind,
            action: "SELF_REVIEW",
            entityType: "TaxSettlement",
            entityId: settlementId,
            after: { type: "SELF_REVIEW", scope: "SETTLEMENT_REVIEW" },
          },
        });
      }
      return updated;
  }

  /** REVIEWED → FINALIZED (V-002: revisor distinto; V-003: inmutable luego). */
  async finalize(ctx: TenantContext, settlementId: string) {
    return withTenantContext(ctx, (tx) =>
      this.finalizeWithTransaction(ctx, tx, settlementId),
    );
  }

  async finalizeWithTransaction(
    ctx: TenantContext,
    tx: Tx,
    settlementId: string,
    allowSelfReview = false,
  ) {
      const s = await this.getOwned(ctx, tx, settlementId);
      if (s.status === "FINALIZED") throw new SettlementError("SETTLEMENT_IMMUTABLE", "La liquidación ya está finalizada");
      if (s.status !== "REVIEWED") {
        throw new SettlementError(
          "FINALIZE_REQUIRES_REVIEW",
          `No se puede finalizar desde ${s.status}; la revisión debe completarse antes`,
        );
      }
      const isSelfReview = s.preparedByUserId === ctx.userId;
      if (isSelfReview && !allowSelfReview) {
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
      if (isSelfReview) {
        await tx.auditEvent.create({
          data: {
            firmId: ctx.firmId,
            clientId: s.clientId,
            userId: ctx.userId,
            actorKind: ctx.actorKind,
            action: "SELF_REVIEW",
            entityType: "TaxSettlement",
            entityId: settlementId,
            after: { type: "SELF_REVIEW", scope: "SETTLEMENT_FINALIZE" },
          },
        });
      }
      return finalized;
  }

  // ------------------------------------------------------------------
  // G3-09: Rectificación (nueva versión desde FINALIZED)
  // ------------------------------------------------------------------

  async rectify(ctx: TenantContext, settlementId: string, reason: string) {
    return withTenantContext(ctx, (tx) =>
      this.rectifyWithTransaction(ctx, tx, settlementId, reason),
    );
  }

  async rectifyWithTransaction(
    ctx: TenantContext,
    tx: Tx,
    settlementId: string,
    reason: string,
  ) {
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
      assertSettlementMatchesObligation(s, o);
      if (s.status !== "FINALIZED") {
        throw new SettlementError("SETTLEMENT_IMMUTABLE", "La liquidación debe estar finalizada para presentarse");
      }
      const amountFiled = new Prisma.Decimal(input.amountFiled);
      if (amountFiled.isNegative()) {
        throw new SettlementError("INVALID_AMOUNT", "El importe presentado no puede ser negativo");
      }
      const expectedAmount = settlementAmount(s);
      if (amountFiled.minus(expectedAmount).abs().greaterThan("0.01")) {
        throw new SettlementError(
          "INVALID_AMOUNT",
          `El importe presentado (${amountFiled.toFixed(2)}) no coincide con la liquidación finalizada (${expectedAmount.toFixed(2)})`,
        );
      }
      const duplicate = await tx.taxFiling.findFirst({
        where: { obligationId: o.id, settlementId: s.id, status: "FILED" },
      });
      if (duplicate) {
        throw new SettlementError("DUPLICATE_FILING", "La liquidación ya tiene una presentación confirmada");
      }
      // D-3: la transición a FILED exige un acuse validado del cliente.
      if (!input.evidenceDocumentId) {
        throw new SettlementError("FILING_REQUIRES_EVIDENCE", "La presentación exige un acuse (evidenceDocumentId)");
      }
      const evidence = await tx.document.findFirst({
        where: {
          id: input.evidenceDocumentId,
          firmId: ctx.firmId,
          clientId: o.clientId,
          status: { in: ["READY", "APPLIED"] },
          category: "ACUSE",
        },
      });
      if (!evidence) {
        throw new SettlementError(
          "EVIDENCE_NOT_FOUND",
          "El acuse debe existir para el cliente, estar listo y tener categoría ACUSE",
        );
      }
      const filing = await tx.taxFiling.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          settlementId: s.id,
          filedAt: new Date(input.filedAt),
          amountFiled,
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
      assertSettlementMatchesObligation(s, o);
      if (s.status !== "FINALIZED") {
        throw new SettlementError(
          "SETTLEMENT_IMMUTABLE",
          "Sólo se registra un intento de presentación sobre una liquidación finalizada",
        );
      }
      const amountFiled = new Prisma.Decimal(input.amountFiled);
      if (amountFiled.isNegative()) {
        throw new SettlementError("INVALID_AMOUNT", "El importe del intento no puede ser negativo");
      }
      return tx.taxFiling.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          settlementId: s.id,
          filedAt: new Date(input.filedAt),
          amountFiled,
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
      if (!input.settlementId) {
        throw new SettlementError(
          "SETTLEMENT_OBLIGATION_MISMATCH",
          "El pago debe identificar la liquidación que cancela",
        );
      }
      const settlement = await tx.taxSettlement.findFirst({
        where: { id: input.settlementId, firmId: ctx.firmId },
      });
      if (!settlement) throw new SettlementError("SETTLEMENT_NOT_FOUND", "Liquidación no encontrada");
      assertSettlementMatchesObligation(settlement, o);
      // El anticipo es una capacidad de la familia del motor (P2, corte 3),
      // no un prefijo del texto `engineVersion`.
      const settlementEngine = await resolveSettlementTaxEngine(tx, settlement);
      const allowsAdvancePayment = settlementEngine?.family.allowsAdvancePayment ?? false;
      const isAdvancePayment = settlement.status !== "FINALIZED" && allowsAdvancePayment;
      if (settlement.status !== "FINALIZED" && !isAdvancePayment) {
        throw new SettlementError(
          "SETTLEMENT_IMMUTABLE",
          "El pago exige una liquidación finalizada; sólo Monotributo admite anticipos de cálculo",
        );
      }
      const amount = new Prisma.Decimal(input.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new SettlementError("INVALID_AMOUNT", "El pago debe ser mayor que cero");
      }
      if (input.reference) {
        const sameReference = await tx.taxPayment.findFirst({
          where: { obligationId: o.id, reference: input.reference },
        });
        if (sameReference) {
          if (
            sameReference.settlementId === settlement.id &&
            sameReference.amount.equals(amount) &&
            sameReference.paidAt.toISOString().slice(0, 10) === input.paidAt &&
            sameReference.method === input.method
          ) {
            return sameReference;
          }
          throw new SettlementError(
            "INVALID_TRANSITION",
            "La referencia de pago ya fue usada con otros datos",
          );
        }
      }
      const priorPaid = await tx.taxPayment.aggregate({
        where: { obligationId: o.id, status: "PAID" },
        _sum: { principalAmount: true, interestAmount: true },
      });
      const principalPaidBefore = priorPaid._sum.principalAmount ?? new Prisma.Decimal(0);
      const interestPaidBefore = priorPaid._sum.interestAmount ?? new Prisma.Decimal(0);
      const required = settlementAmount(settlement);
      const principalDue = Prisma.Decimal.max(required.minus(principalPaidBefore), 0);
      const paidAt = new Date(`${input.paidAt}T00:00:00.000Z`);
      const isLate = Boolean(o.dueDate && paidAt > o.dueDate);
      const interestSnapshot = isLate
        ? await tx.taxInterestSnapshot.findFirst({
            where: {
              obligationId: o.id,
              settlementId: settlement.id,
              asOfDate: paidAt,
            },
            orderBy: { createdAt: "desc" },
          })
        : null;
      if (!isAdvancePayment && isLate && !interestSnapshot) {
        throw new SettlementError(
          "INTEREST_SNAPSHOT_REQUIRED",
          "Antes de registrar un pago vencido calculá la mora para la misma fecha",
        );
      }
      const interestDue = Prisma.Decimal.max(
        (interestSnapshot?.amount ?? new Prisma.Decimal(0)).minus(interestPaidBefore),
        0,
      );
      const allowed = isAdvancePayment ? amount : principalDue.plus(interestDue);
      if (!isAdvancePayment && amount.greaterThan(allowed.plus("0.01"))) {
        throw new SettlementError(
          "OVERPAYMENT",
          `El pago excede capital más mora pendientes (${allowed.toFixed(2)})`,
        );
      }
      const principalAmount = isAdvancePayment
        ? amount
        : Prisma.Decimal.min(amount, principalDue);
      const interestAmount = isAdvancePayment
        ? new Prisma.Decimal(0)
        : amount.minus(principalAmount);
      const payment = await tx.taxPayment.create({
        data: {
          firmId: ctx.firmId,
          clientId: o.clientId,
          obligationId: o.id,
          settlementId: settlement.id,
          paidAt,
          amount,
          principalAmount,
          interestAmount,
          method: input.method,
          ...(input.reference ? { reference: input.reference } : {}),
          createdByUserId: ctx.userId,
          status: "PAID",
        },
      });

      // Estado de la obligación según lo exigido vs pagado.
      let paidStatus: "PARTIALLY_PAID" | "PAID" = "PARTIALLY_PAID";
      if (!isAdvancePayment) {
        const paid = await tx.taxPayment.aggregate({
          where: { obligationId: o.id, status: "PAID" },
          _sum: { principalAmount: true, interestAmount: true },
        });
        const principalPaid = paid._sum.principalAmount ?? new Prisma.Decimal(0);
        const interestPaid = paid._sum.interestAmount ?? new Prisma.Decimal(0);
        const principalOwed = required.minus(principalPaid);
        const interestOwed = (interestSnapshot?.amount ?? new Prisma.Decimal(0)).minus(interestPaid);
        paidStatus = principalOwed.lessThanOrEqualTo("0.01") && interestOwed.lessThanOrEqualTo("0.01")
          ? "PAID"
          : "PARTIALLY_PAID";
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
        data: {
          status: "REVERSED",
          reversedById: ctx.userId,
          reversedAt: new Date(),
          reversalReason: reason.trim(),
        },
      });
      const o = await tx.taxObligation.findUnique({ where: { id: reversed.obligationId } });
      if (o) {
        const paid = await tx.taxPayment.aggregate({
          where: { obligationId: o.id, status: "PAID" },
          _sum: { principalAmount: true, interestAmount: true },
        });
        const principalPaid = paid._sum.principalAmount ?? new Prisma.Decimal(0);
        const interestPaid = paid._sum.interestAmount ?? new Prisma.Decimal(0);
        const settlement = reversed.settlementId
          ? await tx.taxSettlement.findUnique({ where: { id: reversed.settlementId } })
          : null;
        const required = settlement ? settlementAmount(settlement) : new Prisma.Decimal(0);
        const latestInterest = await tx.taxInterestSnapshot.findFirst({
          where: {
            obligationId: o.id,
            ...(settlement ? { settlementId: settlement.id } : {}),
          },
          orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
        });
        const interestRequired = latestInterest?.amount ?? new Prisma.Decimal(0);
        const filing = settlement
          ? await tx.taxFiling.findFirst({
              where: { obligationId: o.id, settlementId: settlement.id, status: "FILED" },
            })
          : null;
        const nextStatus =
          principalPaid.greaterThanOrEqualTo(required.minus("0.01")) &&
          interestPaid.greaterThanOrEqualTo(interestRequired.minus("0.01")) &&
          required.greaterThan(0)
          ? "PAID"
          : principalPaid.plus(interestPaid).greaterThan(0)
            ? "PARTIALLY_PAID"
            : filing
              ? "FILED"
              : o.dueDate && o.dueDate < new Date()
                ? "OVERDUE"
                : "READY_TO_FILE";
        await tx.taxObligation.update({
          where: { id: o.id },
          data: { status: nextStatus },
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
    settlement: { id: string; firmId: string; clientId: string; taxTypeId: string; regimeId: string; jurisdictionId: string; periodId: string; ruleVersionId: string | null; engineVersion: string; version: number; supersedesId: string | null; totals: Prisma.JsonValue | null },
    userId: string,
  ) {
    const currentPeriod = await tx.taxPeriod.findUniqueOrThrow({
      where: { id: settlement.periodId },
    });
    if (settlement.supersedesId) {
      const downstreamFinalized = await tx.taxSettlement.findMany({
        where: {
          firmId: settlement.firmId,
          clientId: settlement.clientId,
          regimeId: settlement.regimeId,
          status: "FINALIZED",
          period: { startDate: { gt: currentPeriod.endDate } },
        },
        include: { period: true },
        orderBy: [{ period: { startDate: "asc" } }, { version: "desc" }],
      });
      const latestByPeriod = new Map<string, (typeof downstreamFinalized)[number]>();
      for (const downstream of downstreamFinalized) {
        if (!latestByPeriod.has(downstream.periodId)) {
          latestByPeriod.set(downstream.periodId, downstream);
        }
      }
      const cascadeDrafts = await tx.taxSettlement.findMany({
        where: {
          supersedesId: { in: [...latestByPeriod.values()].map((item) => item.id) },
          status: { in: ["DRAFT", "CALCULATED", "IN_REVIEW", "CHANGES_REQUESTED", "REVIEWED"] },
        },
        select: { supersedesId: true },
      });
      const cascaded = new Set(cascadeDrafts.map((item) => item.supersedesId));
      const missingCascade = [...latestByPeriod.values()].filter(
        (item) => !cascaded.has(item.id),
      );
      if (missingCascade.length > 0) {
        throw new SettlementError(
          "INVALID_TRANSITION",
          `La rectificativa modifica saldos ya arrastrados; abrí la rectificativa de ${missingCascade.length} período(s) posterior(es) antes de cerrar`,
        );
      }
    }
    const existingClosing = await tx.taxCreditLot.findFirst({ where: { sourceSettlementId: settlement.id } });
    if (existingClosing) return;
    // El arrastre se resuelve por capacidad de la familia del motor (P2,
    // corte 3): CM03 cierra por jurisdicción; el resto, por tipo de saldo.
    const closingEngine = await resolveSettlementTaxEngine(tx, settlement);
    const closesByJurisdiction = closingEngine?.family.closesByJurisdiction ?? false;
    const totals = (settlement.totals ?? {}) as Record<string, string>;
    const eligiblePeriodIds = await tx.taxPeriod.findMany({
      where: {
        firmId: settlement.firmId,
        clientId: settlement.clientId,
        taxTypeId: settlement.taxTypeId,
        endDate: { lte: currentPeriod.endDate },
      },
      select: { id: true },
    });
    const [lots, workpaperLink] = await Promise.all([
      tx.taxCreditLot.findMany({
        where: {
          firmId: settlement.firmId,
          clientId: settlement.clientId,
          taxTypeId: settlement.taxTypeId,
          OR: [
            { periodId: null },
            { periodId: { in: eligiblePeriodIds.map((item) => item.id) } },
          ],
          AND: {
            OR: closesByJurisdiction
              ? [{ regimeId: settlement.regimeId }, { regimeId: null }]
              : [
                  { regimeId: settlement.regimeId, jurisdictionId: settlement.jurisdictionId },
                  { regimeId: settlement.regimeId, jurisdictionId: null },
                  { regimeId: null, jurisdictionId: settlement.jurisdictionId },
                  { regimeId: null, jurisdictionId: null },
                ],
          },
        },
        include: { movements: true },
      }),
      tx.workpaperSettlement.findFirst({
        where: { settlementId: settlement.id },
        select: { workpaperId: true },
      }),
    ]);
    const available = lots
      .map((lot) => ({ lot, available: lot.originalAmount.minus(lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0))) }))
      .filter((entry) => entry.available.isPositive());

    const replaceKind = async (
      kind: string,
      closingAmount: string,
      jurisdictionId = settlement.jurisdictionId,
      includeUnscoped = true,
    ) => {
      const scoped = available.filter(
        (entry) =>
          (entry.lot.kind === kind ||
            (kind === "IVA_LIBRE" && entry.lot.kind === "SALDO_A_FAVOR")) &&
          (entry.lot.jurisdictionId === jurisdictionId ||
            (includeUnscoped && entry.lot.jurisdictionId === null)),
      );
      if (scoped.length > 0) {
        await tx.taxCreditMovement.createMany({
          data: scoped.map((entry) => ({
            firmId: settlement.firmId,
            clientId: settlement.clientId,
            lotId: entry.lot.id,
            kind: "ROLLED_FORWARD",
            amount: entry.available,
            ...(workpaperLink ? { workpaperId: workpaperLink.workpaperId } : {}),
            settlementId: settlement.id,
            reference: `Cierre ${settlement.id}`,
            createdByUserId: userId,
          })),
        });
      }
      const amount = Prisma.Decimal.max(new Prisma.Decimal(closingAmount || "0"), new Prisma.Decimal(0));
      await tx.taxCreditLot.create({
        data: {
          firmId: settlement.firmId,
          clientId: settlement.clientId,
          taxTypeId: settlement.taxTypeId,
          regimeId: settlement.regimeId,
          jurisdictionId,
          periodId: settlement.periodId,
          kind,
          originalAmount: amount,
          sourceSettlementId: settlement.id,
          reference: `Cierre ${settlement.id} · versión ${settlement.version}`,
          // B1 (§3.1): el saldo derivado de una liquidación finalizada nace
          // verificado; la liquidación ya pasó maker-checker.
          verificationStatus: "VERIFIED",
          verifiedByUserId: userId,
          verifiedAt: new Date(),
          createdByUserId: userId,
        },
      });
    };

    if (
      settlement.engineVersion === VAT_ENGINE_VERSION ||
      settlement.engineVersion === VAT_RI_ENGINE_VERSION
    ) {
      await replaceKind("IVA_TECNICO", totals["SALDO_TECNICO_AFTER"] ?? "0");
      await replaceKind("IVA_LIBRE", totals["SALDO_LIBRE_AFTER"] ?? "0");
      return;
    }
    if (closesByJurisdiction) {
      const closingByJurisdiction = Object.entries(totals)
        .filter(([key]) => key.startsWith("SALDO_A_FAVOR_") && key !== "SALDO_A_FAVOR")
        .sort(([left], [right]) => left.localeCompare(right));
      for (const [index, [key, amount]] of closingByJurisdiction.entries()) {
        const code = key.slice("SALDO_A_FAVOR_".length);
        const jurisdiction = await tx.jurisdiction.findUnique({ where: { code } });
        if (!jurisdiction) {
          throw new SettlementError(
            "INVALID_TRANSITION",
            `No existe la jurisdicción ${code} necesaria para arrastrar el saldo CM`,
          );
        }
        await replaceKind("SALDO_A_FAVOR", amount, jurisdiction.id, index === 0);
      }
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
