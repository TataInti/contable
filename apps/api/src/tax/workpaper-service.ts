import { derivePeriodStatus } from "./period-status.js";
import { Prisma, type MonthlyTaxWorkpaperStatus } from "@prisma/client";
import { motivoSiLoteUsado, origenDelLote } from "./declaration-credit-lots.js";
import {
  FILTRO_SALDOS_SIN_REEMPLAZADOS,
  filtroSaldosVigentes,
  periodosElegibles,
  sumaDisponible,
} from "./credit-lots-vigentes.js";
import { calculateLateInterest, taxHash } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { resolveTaxEngineForVersion, settlementService } from "./settlement-service.js";
import {
  getWorkpaperSourcePolicy,
  isSourceRequired,
  obligationForPolicy,
  policiesForObligations,
  sourceCodesForCalculation,
} from "./workpaper-source-policy.js";
import {
  classificationCoverage,
  classificationHash,
  materializeWorkpaperClassifications,
  reviewedSourceFacts,
} from "./workpaper-classification.js";
import { activityIssuesForWorkpaper, conActividadPendiente } from "./workpaper-activity.js";
import { gruposDeComprobantes, loadPerfilPermitido } from "./voucher-permissions-core.js";
import { GRUPO_LABELS, PREFIJO_CONTROL_PERFIL, type GrupoPerfil } from "./voucher-profile.js";
import {
  materializeWorkpaperAllocations,
  taxInputAllocationHash,
  workpaperAllocationCoverage,
  WorkpaperAllocationError,
} from "./workpaper-allocation.js";
import { retirarImputacionesDelLote, ESTADO_IMPUTACION_RETIRADA } from "./fuentes-vigentes.js";

/**
 * Servicio del expediente mensual de liquidación (Fase 1, PLAN §5.6).
 *
 * MonthlyTaxWorkpaper es el agregado de trabajo y cierre para un cliente y
 * un mes calendario. Agrupa IVA RI, cada componente de IIBB activo y TEM.
 * Cada TaxSettlement sigue siendo el cálculo versionado de UNA obligación.
 *
 * Estados: DRAFT → COLLECTING_INPUTS → READY_TO_CALCULATE → CALCULATING →
 * CALCULATED → IN_REVIEW → (CHANGES_REQUESTED) → REVIEWED → FINALIZED.
 * Una rectificativa crea una NUEVA revisión (revision+1) que referencia la
 * anterior (supersedesId); la revisión anterior queda inmutable.
 *
 * Invariantes:
 * - No se finaliza si falta un componente requerido, hay un control
 *   bloqueante abierto, una fuente quedó sin revisar o un cálculo hijo
 *   no está REVIEWED.
 * - El cierre congela hashes/snapshots, crea lotes de saldo a favor y
 *   proyecta los saldos de apertura del período siguiente.
 */

export type WorkpaperErrorCode =
  | "WORKPAPER_NOT_FOUND"
  | "WORKPAPER_IMMUTABLE"
  | "WORKPAPER_FINALIZED"
  | "INVALID_TRANSITION"
  | "MAKER_CHECKER_VIOLATION"
  | "PERIOD_NOT_FOUND"
  | "CLIENT_NOT_FOUND"
  | "BLOCKING_CONTROLS"
  | "MISSING_REQUIRED_COMPONENT"
  | "SETTLEMENT_NOT_REVIEWED"
  | "SOURCE_NOT_REVIEWED"
  | "CLASSIFICATION_INCOMPLETE"
  | "CLASSIFICATION_NOT_FOUND"
  | "CLASSIFICATION_EXCLUDED"
  | "CLASSIFICATION_RULE_NOT_FOUND"
  | "ALLOCATION_INCOMPLETE"
  | "ALLOCATION_NOT_FOUND"
  | "ALLOCATION_SCOPE_INVALID"
  | "NO_SETTLEMENTS"
  | "DUE_DATE_NOT_FOUND"
  | "INTEREST_RULE_NOT_FOUND"
  | "DUPLICATE_WORKPAPER"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_HAS_REVIEWED_BATCH"
  | "WORKPAPER_FINALIZED"
  | "NO_MOVEMENTS_NOT_FOUND";

/** Estado de cobertura de una fuente: el lote revisado o la marca «Sin movimientos» la cubren para el cálculo (corte 2A). */
export type WorkpaperSourceStatusCode = "PENDING" | "LOADED" | "NO_MOVEMENTS";

/** Una fuente cuenta como cubierta si tiene un lote revisado o está marcada sin movimientos. */
export function isSourceCovered(source: { present: boolean; status: WorkpaperSourceStatusCode }): boolean {
  return source.present || source.status === "NO_MOVEMENTS";
}

/** Problema de origen de un saldo a favor, compartido por el saldo inicial y el detalle de la DJ (D13-4 a). */
export type CreditOriginProblem =
  | "REGIME_NOT_OF_TAX"
  | "CM_REQUIRES_JURISDICTION"
  | "JURISDICTION_MISMATCH"
  | "JURISDICTION_NOT_ACTIVE";

/**
 * Reglas del origen de un saldo a favor: el régimen pertenece al impuesto, el Convenio Multilateral
 * exige jurisdicción y la jurisdicción existe y está activa. Devuelve el primer problema o null;
 * cada llamador traduce el código a su propio error.
 */
export async function creditOriginProblem(
  tx: Prisma.TransactionClient,
  origen: { taxTypeId: string; regimeId?: string | undefined; jurisdictionId?: string | undefined },
): Promise<CreditOriginProblem | null> {
  if (origen.regimeId) {
    const regime = await tx.taxRegime.findFirst({
      where: { id: origen.regimeId, taxTypeId: origen.taxTypeId },
    });
    if (!regime) return "REGIME_NOT_OF_TAX";
    if (regime.code === "CM_ART2" && !origen.jurisdictionId) return "CM_REQUIRES_JURISDICTION";
    if (
      regime.code !== "CM_ART2" &&
      origen.jurisdictionId &&
      regime.jurisdictionId !== origen.jurisdictionId
    ) {
      return "JURISDICTION_MISMATCH";
    }
  }
  if (origen.jurisdictionId) {
    const jurisdiction = await tx.jurisdiction.findUnique({ where: { id: origen.jurisdictionId } });
    if (!jurisdiction || !jurisdiction.isActive) return "JURISDICTION_NOT_ACTIVE";
  }
  return null;
}

/** Traducción de cada problema al error del saldo inicial (códigos y mensajes de siempre). */
const OPENING_CREDIT_ORIGIN_ERRORS: Record<
  CreditOriginProblem,
  { code: WorkpaperErrorCode; message: string }
> = {
  REGIME_NOT_OF_TAX: {
    code: "PERIOD_NOT_FOUND",
    message: "El régimen no corresponde al impuesto seleccionado",
  },
  CM_REQUIRES_JURISDICTION: {
    code: "INVALID_TRANSITION",
    message: "El saldo de Convenio Multilateral requiere una jurisdicción",
  },
  JURISDICTION_MISMATCH: {
    code: "INVALID_TRANSITION",
    message: "La jurisdicción no coincide con el régimen seleccionado",
  },
  JURISDICTION_NOT_ACTIVE: {
    code: "PERIOD_NOT_FOUND",
    message: "La jurisdicción del saldo no existe o está inactiva",
  },
};

/**
 * Indica si el motor vigente del régimen usa el mínimo declarado por el contador (IIBB Tucumán).
 * Se decide por el id del motor del paquete de reglas, nunca por el nombre del impuesto.
 */
async function regimeUsaMinimoDeclarado(
  tx: Prisma.TransactionClient,
  regimeId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<boolean> {
  const pack = await tx.taxRulePack.findFirst({ where: { regimeId }, select: { id: true } });
  if (!pack) return false;
  const version = await tx.taxRuleVersion.findFirst({
    where: {
      packId: pack.id,
      status: { in: ["ACTIVE", "RETIRED"] },
      validFrom: { lte: periodStart },
      OR: [{ validTo: null }, { validTo: { gte: periodEnd } }],
    },
    orderBy: [{ validFrom: "desc" }, { version: "desc" }],
    select: { engineId: true, engineVersion: true },
  });
  if (!version) return false;
  const engine = await resolveTaxEngineForVersion(tx, version);
  return engine?.engineKey === "iibb-local-tuc";
}

export class WorkpaperError extends Error {
  readonly code: WorkpaperErrorCode;
  constructor(code: WorkpaperErrorCode, message: string) {
    super(message);
    this.name = "WorkpaperError";
    this.code = code;
  }
}

export interface Cm03CoefficientSourceRow {
  sourceId: string;
  jurisdiction: string;
  coefficient: string;
}

export function cm03CoefficientSourceRowsFromFacts(
  facts: readonly { rowId: string; sourceType: string; normalized: unknown }[],
): Cm03CoefficientSourceRow[] {
  return facts.flatMap((fact) => {
    if (fact.sourceType !== "CM03_COEFFICIENT") return [];
    const normalized = (fact.normalized ?? {}) as Record<string, unknown>;
    const jurisdiction = typeof normalized["jurisdiction"] === "string"
      ? normalized["jurisdiction"].trim().toUpperCase()
      : "";
    const coefficient = normalized["coefficient"];
    if (!jurisdiction || typeof coefficient !== "string") {
      throw new WorkpaperError(
        "INVALID_TRANSITION",
        `El coeficiente CM03 ${fact.rowId} no tiene jurisdicción o coeficiente resuelto`,
      );
    }
    return [{ sourceId: fact.rowId, jurisdiction, coefficient }];
  });
}

export function resolveCm03CoefficientJurisdictionIds(
  rows: readonly Cm03CoefficientSourceRow[],
  jurisdictionIdByCode: ReadonlyMap<string, string>,
): Array<Cm03CoefficientSourceRow & { jurisdictionId: string }> {
  return rows.map((row) => {
    const jurisdictionId = jurisdictionIdByCode.get(row.jurisdiction);
    if (!jurisdictionId) {
      throw new WorkpaperError(
        "INVALID_TRANSITION",
        `La jurisdicción ${row.jurisdiction} del coeficiente CM03 ${row.sourceId} no existe en el catálogo`,
      );
    }
    return { ...row, jurisdictionId };
  });
}

export interface WorkpaperCreateInput {
  clientId: string;
  periodStart?: string;
  periodEnd?: string;
  accountingPeriodId?: string;
}

/**
 * Control bloqueante abierto: impide enviar el expediente a revisión y cerrarlo.
 * Un solo predicado para ambos casos (P3): el envío y el cierre lo usan.
 */
export function esControlBloqueanteAbierto(control: { severity: string; status: string }): boolean {
  return control.severity === "BLOCKING" && control.status === "OPEN";
}

export class MonthlyWorkpaperService {
  private readonly mutablePreparationStates = [
    "DRAFT",
    "COLLECTING_INPUTS",
    "READY_TO_CALCULATE",
    "CHANGES_REQUESTED",
  ] as const;

  /**
   * Revisar lo que uno mismo cargó sólo vale para Titular y Administrador, y sólo si
   * el estudio lo tiene habilitado. El resto de los roles necesita a otra persona.
   */
  private async selfReviewEnabled(tx: Prisma.TransactionClient, firmId: string, userId: string) {
    const firm = await tx.firm.findUnique({
      where: { id: firmId },
      select: { allowSelfReview: true },
    });
    if (firm?.allowSelfReview !== true) return false;
    const membership = await tx.firmMembership.findUnique({
      where: { firmId_userId: { firmId, userId } },
      select: { role: true, status: true },
    });
    return membership?.status === "ACTIVE" && (membership.role === "OWNER" || membership.role === "ADMIN");
  }

  private async auditSelfReview(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    entityType: string,
    entityId: string,
    scope: string,
  ) {
    await tx.auditEvent.create({
      data: {
        firmId: ctx.firmId,
        userId: ctx.userId,
        actorKind: ctx.actorKind,
        action: "SELF_REVIEW",
        entityType,
        entityId,
        after: { type: "SELF_REVIEW", scope },
      },
    });
  }

  private async sourceCoverage(
    tx: Prisma.TransactionClient,
    workpaper: { id: string },
    obligations: Array<{
      periodId: string;
      regime: { code: string; taxTypeId: string; taxType: { code: string }; calcFamily: { key: string } | null };
    }>,
  ) {
    const obligationRefs = obligations.map((obligation) => ({
      taxTypeCode: obligation.regime.taxType.code,
      calcFamilyKey: obligation.regime.calcFamily?.key ?? null,
    }));
    const policies = policiesForObligations(obligationRefs);
    const evidence = await tx.workpaperImportBatch.findMany({
      where: { workpaperId: workpaper.id },
      include: { importBatch: true },
      orderBy: { createdAt: "asc" },
    });
    const actorIds = [...new Set(evidence.flatMap((item) => [
      item.importBatch.createdByUserId,
      item.reviewedByUserId,
      item.retiredByUserId,
    ]).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length
      ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const actorName = (id: string | null) => actors.find((actor) => actor.id === id)?.name ?? null;
    const reviewedCodes = new Set(
      evidence
        .filter((item) => item.status === "REVIEWED" && item.importBatch.status === "COMMITTED")
        .map((item) => item.sourceCode),
    );
    const activeMarks = await tx.workpaperSourceStatus.findMany({
      where: { workpaperId: workpaper.id, clearedAt: null },
      include: { markedBy: { select: { name: true } } },
    });
    // Una marca «Sin movimientos» vigente cubre la base para las fuentes que se satisfacen con ella (satisfiedBy),
    // igual que un lote revisado. No cambia `present` ni los lotes.
    const markedCodes = new Set(
      activeMarks
        .filter((item) => item.status === "NO_MOVEMENTS")
        .map((item) => item.sourceCode),
    );

    return policies.map((policy) => {
      const mark = activeMarks.find((item) => item.sourceCode === policy.code) ?? null;
      const obligation = obligationForPolicy(
        policy,
        obligations.map((item) => ({
          taxTypeCode: item.regime.taxType.code,
          calcFamilyKey: item.regime.calcFamily?.key ?? null,
          item,
        })),
      )?.item;
      const batches = evidence.filter((item) => item.sourceCode === policy.code);
      const reviewed = batches.filter(
        (item) => item.status === "REVIEWED" && item.importBatch.status === "COMMITTED",
      );
      const present = reviewed.length > 0;
      return {
        code: policy.code,
        label: policy.label,
        required: isSourceRequired(policy, obligationRefs, reviewedCodes, markedCodes),
        present,
        status: (present ? "LOADED" : mark ? "NO_MOVEMENTS" : "PENDING") as WorkpaperSourceStatusCode,
        noMovements:
          !present && mark
            ? { byUserId: mark.markedByUserId, byName: mark.markedBy.name, at: mark.markedAt }
            : null,
        count: reviewed.reduce((sum, item) => sum + item.importBatch.validRows, 0),
        taxTypeId: obligation?.regime.taxTypeId ?? null,
        periodId: obligation?.periodId ?? null,
        origin: policy.origin,
        adapterVersion: policy.adapterVersion,
        expectedColumns: policy.expectedColumns,
        batches: batches.map((item) => ({
          id: item.id,
          importBatchId: item.importBatchId,
          fileName: item.importBatch.fileName,
          batchStatus: item.importBatch.status,
          reviewStatus: item.status,
          totalRows: item.importBatch.totalRows,
          validRows: item.importBatch.validRows,
          errorRows: item.importBatch.errorRows,
          totals: item.importBatch.totals,
          snapshotHash: item.snapshotHash,
          reviewedAt: item.reviewedAt,
          reviewedByUserId: item.reviewedByUserId,
          reviewedByName: actorName(item.reviewedByUserId),
          createdByUserId: item.importBatch.createdByUserId,
          createdByName: actorName(item.importBatch.createdByUserId),
          createdAt: item.createdAt,
          retiredByUserId: item.retiredByUserId,
          retiredByName: actorName(item.retiredByUserId),
          retiredAt: item.retiredAt,
          retireReason: item.retireReason,
          replacedByBatchId: item.replacedByBatchId,
          replacedAt: item.replacedAt,
        })),
      };
    });
  }

  private async ensureAllocations(tx: Prisma.TransactionClient, workpaperId: string) {
    try {
      await materializeWorkpaperAllocations(tx, workpaperId);
    } catch (error) {
      if (error instanceof WorkpaperAllocationError) {
        throw new WorkpaperError("ALLOCATION_SCOPE_INVALID", error.message);
      }
      throw error;
    }
  }

  private async refreshPreparationStatus(
    tx: Prisma.TransactionClient,
    workpaper: {
      id: string;
      firmId: string;
      clientId: string;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    const obligations = await tx.taxObligation.findMany({
      where: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        status: { not: "NOT_APPLICABLE" },
        period: {
          startDate: { gte: workpaper.periodStart },
          endDate: { lte: workpaper.periodEnd },
        },
      },
      include: { regime: { include: { taxType: true, calcFamily: true } } },
    });
    const [sources, classifications, allocations] = await Promise.all([
      this.sourceCoverage(tx, workpaper, obligations),
      classificationCoverage(tx, workpaper.id),
      workpaperAllocationCoverage(tx, workpaper.id),
    ]);
    const ready =
      sources.every((source) => !source.required || isSourceCovered(source)) &&
      classifications.ready &&
      allocations.ready;
    await tx.monthlyTaxWorkpaper.updateMany({
      where: {
        id: workpaper.id,
        status: { in: ["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE"] },
      },
      data: { status: ready ? "READY_TO_CALCULATE" : "COLLECTING_INPUTS" },
    });
    return { sources, classifications, allocations, ready };
  }

  /**
   * Materializa una fila estable por obligación esperada. settlementId queda
   * vacío hasta que exista un cálculo; de ese modo cobertura y cierre no
   * confunden "sin liquidación" con "sin obligación".
   */
  private async materializeComponents(
    tx: Prisma.TransactionClient,
    workpaper: {
      id: string;
      firmId: string;
      clientId: string;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    const obligations = await tx.taxObligation.findMany({
      where: {
        firmId: workpaper.firmId,
        clientId: workpaper.clientId,
        status: { not: "NOT_APPLICABLE" },
        period: {
          startDate: { gte: workpaper.periodStart },
          endDate: { lte: workpaper.periodEnd },
        },
      },
      include: {
        period: true,
        regime: { include: { taxType: true, jurisdiction: true, calcFamily: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const obligation of obligations) {
      const currentSettlement = await tx.taxSettlement.findFirst({
        where: {
          firmId: workpaper.firmId,
          clientId: workpaper.clientId,
          regimeId: obligation.regimeId,
          periodId: obligation.periodId,
          status: { not: "SUPERSEDED" },
        },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });
      const existingLink = await tx.workpaperSettlement.findUnique({
        where: {
          workpaperId_obligationId: {
            workpaperId: workpaper.id,
            obligationId: obligation.id,
          },
        },
      });

      await tx.workpaperSettlement.upsert({
        where: {
          workpaperId_obligationId: {
            workpaperId: workpaper.id,
            obligationId: obligation.id,
          },
        },
        create: {
          firmId: workpaper.firmId,
          clientId: workpaper.clientId,
          workpaperId: workpaper.id,
          obligationId: obligation.id,
          ...(currentSettlement ? { settlementId: currentSettlement.id } : {}),
          role: `${obligation.regime.taxType.code}:${obligation.regime.code}`,
          required: true,
          statusAtLink: currentSettlement?.status ?? "MISSING",
        },
        update: {
          // Una rectificativa puede haber fijado explícitamente su nueva
          // settlement; el sync normal no debe volver a la versión anterior.
          ...(!existingLink?.settlementId && currentSettlement
            ? { settlementId: currentSettlement.id }
            : {}),
          role: `${obligation.regime.taxType.code}:${obligation.regime.code}`,
          statusAtLink: existingLink?.settlementId
            ? existingLink.statusAtLink
            : (currentSettlement?.status ?? "MISSING"),
        },
      });
    }

    return tx.workpaperSettlement.findMany({
      where: { workpaperId: workpaper.id },
      include: {
        settlement: true,
        obligation: {
          include: {
            period: true,
            regime: { include: { taxType: true, jurisdiction: true, calcFamily: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Materializa los puntos de control del proceso real para este snapshot. */
  private async materializeControls(
    tx: Prisma.TransactionClient,
    input: {
      workpaperId: string;
      firmId: string;
      clientId: string;
      sourceHash: string;
      sources: Array<{
        code: string;
        batches: Array<{ reviewStatus: string; totals: Prisma.JsonValue | null }>;
      }>;
      components: Array<{ taxTypeCode: string; settlementId: string }>;
      allocationsReady: boolean;
      allocationsCount: number;
      /** Año del período: las tildes de comprobantes del cliente se guardan por año (corte 4B). */
      periodYear: number;
    },
  ) {
    const automaticCodes = [
      "BOOK_RATE_RECONCILIATION",
      "PORTAL_IVA_RECONCILIATION",
      "BANK_CREDIT_RECONCILIATION",
      "CASH_ALLOCATION_RECONCILIATION",
    ];
    await tx.taxControlFinding.updateMany({
      where: {
        workpaperId: input.workpaperId,
        OR: [{ code: { in: automaticCodes } }, { code: { startsWith: PREFIJO_CONTROL_PERFIL } }],
        status: "OPEN",
        NOT: { sourceHash: input.sourceHash },
      },
      data: {
        status: "RESOLVED",
        resolution: "Reemplazado por un nuevo snapshot de cálculo",
      },
    });
    const ensure = async (control: {
      code: string;
      severity: "INFO" | "WARNING" | "BLOCKING";
      status: "OPEN" | "RESOLVED";
      settlementId?: string;
      expected?: Prisma.Decimal;
      actual?: Prisma.Decimal;
      tolerance?: Prisma.Decimal;
      resolution?: string;
    }) => {
      const existing = await tx.taxControlFinding.findFirst({
        where: {
          workpaperId: input.workpaperId,
          code: control.code,
          sourceHash: input.sourceHash,
        },
      });
      if (existing) return existing;
      return tx.taxControlFinding.create({
        data: {
          firmId: input.firmId,
          clientId: input.clientId,
          workpaperId: input.workpaperId,
          ...(control.settlementId ? { settlementId: control.settlementId } : {}),
          code: control.code,
          severity: control.severity,
          status: control.status,
          ...(control.expected ? { expected: control.expected } : {}),
          ...(control.actual ? { actual: control.actual } : {}),
          ...(control.tolerance ? { tolerance: control.tolerance } : {}),
          ...(control.resolution ? { resolution: control.resolution } : {}),
          sourceHash: input.sourceHash,
        },
      });
    };

    const classifications = await tx.workpaperVoucherClassification.findMany({
      where: { workpaperId: input.workpaperId, excludedAt: null },
      include: { voucher: { include: { components: true, importRow: { select: { raw: true } } } } },
    });
    let bookExpected = new Prisma.Decimal(0);
    let bookActual = new Prisma.Decimal(0);
    for (const classification of classifications) {
      const taxable = classification.voucher.components.filter((component) =>
        ["IVA_21", "IVA_105", "IVA_27"].includes(component.concept),
      );
      if (taxable.length === 0) continue;
      const declaredNet = classification.voucher.components.find(
        (component) => component.concept === "NETO",
      );
      if (!declaredNet) continue;
      bookExpected = bookExpected.plus(declaredNet.amount.abs());
      bookActual = bookActual.plus(
        taxable.reduce((sum, component) => sum.plus(component.base.abs()), new Prisma.Decimal(0)),
      );
    }
    const bookTolerance = new Prisma.Decimal("0.05");
    const bookMatches = bookExpected.minus(bookActual).abs().lessThanOrEqualTo(bookTolerance);
    const ivaComponent = input.components.find((component) => component.taxTypeCode === "IVA");
    await ensure({
      code: "BOOK_RATE_RECONCILIATION",
      severity: bookMatches ? "INFO" : "BLOCKING",
      status: bookMatches ? "RESOLVED" : "OPEN",
      ...(ivaComponent ? { settlementId: ivaComponent.settlementId } : {}),
      expected: bookExpected,
      actual: bookActual,
      tolerance: bookTolerance,
      ...(bookMatches
        ? { resolution: "El neto general coincide con la suma de bases por alícuota" }
        : {}),
    });

    if (ivaComponent) {
      const settlement = await tx.taxSettlement.findUnique({
        where: { id: ivaComponent.settlementId },
      });
      const totals = (settlement?.totals ?? {}) as Record<string, string>;
      const sourceIva = (code: string) => {
        const source = input.sources.find((item) => item.code === code);
        return (source?.batches ?? [])
          .filter((batch) => batch.reviewStatus === "REVIEWED")
          .reduce((sum, batch) => {
            const batchTotals = (batch.totals ?? {}) as Record<string, string>;
            return sum.plus(batchTotals["iva"] ?? "0");
          }, new Prisma.Decimal(0));
      };
      const portalExpected = sourceIva("ARCA_IVA_SALES").minus(
        sourceIva("ARCA_IVA_PURCHASES"),
      );
      const portalActual = new Prisma.Decimal(totals["DEBITO_FISCAL"] ?? "0").minus(
        totals["CREDITO_FISCAL"] ?? "0",
      );
      const portalTolerance = new Prisma.Decimal("0.02");
      const portalMatches = portalExpected
        .minus(portalActual)
        .abs()
        .lessThanOrEqualTo(portalTolerance);
      await ensure({
        code: "PORTAL_IVA_RECONCILIATION",
        severity: portalMatches ? "INFO" : "BLOCKING",
        status: portalMatches ? "RESOLVED" : "OPEN",
        settlementId: ivaComponent.settlementId,
        expected: portalExpected,
        actual: portalActual,
        tolerance: portalTolerance,
        ...(portalMatches
          ? { resolution: "El IVA de los libros oficiales coincide con el cálculo" }
          : {}),
      });
    }

    const billedSales = classifications
      .filter((classification) => classification.direction === "SALE")
      .reduce(
        (sum, classification) => sum.plus(classification.voucher.total.abs()),
        new Prisma.Decimal(0),
      );
    const bankApplicable = billedSales.greaterThan(0);
    // Comprobantes de venta que no corresponden al perfil del cliente (corte 4B): un control bloqueante por grupo.
    const permitidoPerfil = await loadPerfilPermitido(tx, {
      firmId: input.firmId,
      clientId: input.clientId,
      year: input.periodYear,
    });
    const gruposPerfil = gruposDeComprobantes(classifications, permitidoPerfil);
    for (const [grupo, filas] of gruposPerfil) {
      await ensure({
        code: `${PREFIJO_CONTROL_PERFIL}${grupo}`,
        severity: "BLOCKING",
        status: "OPEN",
        actual: new Prisma.Decimal(filas.length),
      });
    }

    await ensure({
      code: "BANK_CREDIT_RECONCILIATION",
      severity: bankApplicable ? "BLOCKING" : "INFO",
      status: bankApplicable ? "OPEN" : "RESOLVED",
      expected: billedSales,
      ...(!bankApplicable ? { resolution: "No hay ventas que conciliar en el período" } : {}),
    });
    const cashApplicable = classifications.length > 0 || input.allocationsCount > 0;
    await ensure({
      code: "CASH_ALLOCATION_RECONCILIATION",
      severity: cashApplicable ? "BLOCKING" : "INFO",
      status: cashApplicable ? "OPEN" : "RESOLVED",
      ...(!cashApplicable
        ? { resolution: "No hay movimientos de caja o imputaciones que conciliar" }
        : !input.allocationsReady
        ? { resolution: "Hay imputaciones fiscales pendientes" }
        : {}),
    });

    // P1 (§3.1.4/§3.1.6): saldo de una presentación superada. Si existen
    // lotes del alcance del expediente en estado SUPERSEDED con disponible,
    // se abre un control bloqueante: sólo la última presentación verifica
    // alimenta el período.
    const supersededLots = await tx.taxCreditLot.count({
      where: {
        firmId: input.firmId,
        clientId: input.clientId,
        verificationStatus: "SUPERSEDED",
        sourceSettlementId: null,
        movements: { none: { kind: "ROLLED_FORWARD" } },
      },
    });
    await ensure({
      code: "SUPERSEDED_OPENING_CREDIT",
      severity: supersededLots > 0 ? "BLOCKING" : "INFO",
      status: supersededLots > 0 ? "OPEN" : "RESOLVED",
      ...(supersededLots > 0
        ? {}
        : { resolution: "No hay saldos de presentaciones superadas sin consumir" }),
    });
  }

  // ------------------------------------------------------------------
  // Creación y listado
  // ------------------------------------------------------------------

  async create(ctx: TenantContext, input: WorkpaperCreateInput) {
    return withTenantContext(ctx, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: input.clientId, firmId: ctx.firmId },
      });
      if (!client) throw new WorkpaperError("CLIENT_NOT_FOUND", "Cliente no encontrado");

      const accountingPeriod = input.accountingPeriodId
        ? await tx.accountingPeriod.findFirst({
            where: { id: input.accountingPeriodId, firmId: ctx.firmId, clientId: input.clientId },
            select: { startDate: true, endDate: true },
          })
        : null;
      if (input.accountingPeriodId && !accountingPeriod) {
        throw new WorkpaperError("PERIOD_NOT_FOUND", "Período contable no encontrado");
      }
      if ((!input.periodStart || !input.periodEnd) && !accountingPeriod) {
        throw new WorkpaperError("PERIOD_NOT_FOUND", "Indicá un período para crear el expediente");
      }

      const periodStart = accountingPeriod?.startDate ?? new Date(input.periodStart!);
      const periodEnd = accountingPeriod?.endDate ?? new Date(input.periodEnd!);

      // Idempotencia: mismo cliente + mes + revisión 1 ya existe.
      const existing = await tx.monthlyTaxWorkpaper.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          periodStart,
          periodEnd,
          revision: 1,
        },
      });
      const workpaper =
        existing ??
        (await tx.monthlyTaxWorkpaper.create({
          data: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            periodStart,
            periodEnd,
            revision: 1,
            status: "DRAFT",
            preparedByUserId: ctx.userId,
          },
        }));

      if (workpaper.status !== "FINALIZED" && workpaper.status !== "SUPERSEDED") {
        const links = await this.materializeComponents(tx, workpaper);
        if (links.some((link) => link.required && !link.settlementId)) {
          await tx.monthlyTaxWorkpaper.update({
            where: { id: workpaper.id },
            data: { status: "COLLECTING_INPUTS" },
          });
        }
      }

      return tx.monthlyTaxWorkpaper.findUniqueOrThrow({
        where: { id: workpaper.id },
        include: {
          settlements: { include: { settlement: true, obligation: true } },
          controls: true,
        },
      });
    });
  }

  async list(ctx: TenantContext, clientId: string, from?: string, to?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.monthlyTaxWorkpaper.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(from ? { periodStart: { gte: new Date(from) } } : {}),
          ...(to ? { periodEnd: { lte: new Date(to) } } : {}),
        },
        include: {
          settlements: { include: { settlement: true } },
          controls: true,
        },
        orderBy: [{ periodStart: "desc" }, { revision: "desc" }],
        take: 100,
      }),
    );
  }

  async listForAccountingPeriod(ctx: TenantContext, clientId: string, accountingPeriodId: string) {
    return withTenantContext(ctx, async (tx) => {
      const accountingPeriod = await tx.accountingPeriod.findFirst({
        where: { id: accountingPeriodId, firmId: ctx.firmId, clientId },
        select: { startDate: true, endDate: true },
      });
      if (!accountingPeriod) throw new WorkpaperError("PERIOD_NOT_FOUND", "Período contable no encontrado");

      return tx.monthlyTaxWorkpaper.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          periodStart: accountingPeriod.startDate,
          periodEnd: accountingPeriod.endDate,
        },
        include: {
          settlements: { include: { settlement: true } },
          controls: true,
        },
        orderBy: { revision: "desc" },
        take: 100,
      });
    });
  }

  async get(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: {
          settlements: {
            include: {
              settlement: {
                include: { regime: { include: { taxType: true, jurisdiction: true, calcFamily: true } }, period: true },
              },
              obligation: true,
            },
          },
          controls: true,
          interestSnapshots: true,
        },
      }),
    );
  }

  // ------------------------------------------------------------------
  // Cobertura: qué fuentes se requieren para el mes
  // ------------------------------------------------------------------

  async coverage(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: { settlements: { include: { settlement: true } } },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");

      // Obligaciones activas del cliente en el período.
      const obligations = await tx.taxObligation.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: wp.clientId,
          status: { not: "NOT_APPLICABLE" },
          period: {
            startDate: { gte: wp.periodStart },
            endDate: { lte: wp.periodEnd },
          },
        },
        include: { regime: { include: { taxType: true, calcFamily: true } } },
      });

      const components = obligations.map((ob) => {
        const link = wp.settlements.find((item) => item.obligationId === ob.id);
        return {
          required: link?.required ?? true,
          linked: Boolean(link?.settlementId),
          settlementStatus: link?.settlement?.status ?? null,
          obligationId: ob.id,
          regimeCode: ob.regime.code,
          taxTypeCode: ob.regime.taxType.code,
        };
      });

      const sources = await this.sourceCoverage(tx, wp, obligations);
      const classifications = await classificationCoverage(tx, wp.id);
      const allocations = await workpaperAllocationCoverage(tx, wp.id);
      return {
        workpaperId,
        periodStart: wp.periodStart,
        periodEnd: wp.periodEnd,
        allowSelfReview: await this.selfReviewEnabled(tx, ctx.firmId, ctx.userId),
        components,
        sources,
        classifications: {
          total: classifications.total,
          classified: classifications.classified,
          pending: classifications.pending,
          excluded: classifications.excluded,
          ready: classifications.ready,
        },
        allocations: {
          total: allocations.total,
          allocated: allocations.allocated,
          pending: allocations.pending,
          ready: allocations.ready,
        },
      };
    });
  }

  // ------------------------------------------------------------------
  // Cálculo: orquesta los motores por régimen
  // ------------------------------------------------------------------

  async calculate(
    ctx: TenantContext,
    workpaperId: string,
    input?: {
      cutoff?: string;
      /** Impuestos a liquidar este mes (ids de obligación). Ausente = todos los del expediente. */
      obligationIds?: string[];
      /** Mínimo del mes por obligación de IIBB Tucumán (id de obligación → importe). */
      minimums?: Record<string, string>;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status === "FINALIZED" || wp.status === "SUPERSEDED") {
        throw new WorkpaperError("WORKPAPER_IMMUTABLE", "El expediente finalizado es inmutable");
      }
      if (wp.status === "IN_REVIEW" || wp.status === "REVIEWED") {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          `No se puede recalcular un expediente en estado ${wp.status}`,
        );
      }

      const links = await this.materializeComponents(tx, wp);
      if (links.length === 0) {
        throw new WorkpaperError(
          "NO_SETTLEMENTS",
          "El expediente no tiene obligaciones fiscales materializadas para el período",
        );
      }

      const seleccion = input?.obligationIds ? new Set(input.obligationIds) : null;
      if (seleccion) {
        const conocidas = new Set(links.map((link) => link.obligation.id));
        if ([...seleccion].some((id) => !conocidas.has(id))) {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            "Hay impuestos elegidos que no pertenecen a este expediente. Recargá la etapa y volvé a elegir.",
          );
        }
        if (seleccion.size === 0) {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            "Elegí al menos un impuesto para liquidar este mes.",
          );
        }
      }
      const liquidables = seleccion
        ? links.filter((link) => seleccion.has(link.obligation.id))
        : links;

      const sources = await this.sourceCoverage(
        tx,
        wp,
        liquidables.map((link) => link.obligation),
      );
      const missingSources = sources.filter((source) => source.required && !isSourceCovered(source));
      if (missingSources.length > 0) {
        throw new WorkpaperError(
          "SOURCE_NOT_REVIEWED",
          `Faltan fuentes obligatorias revisadas: ${missingSources.map((source) => source.label).join(", ")}`,
        );
      }

      await materializeWorkpaperClassifications(tx, wp);
      const classifications = await classificationCoverage(tx, wp.id);
      if (!classifications.ready) {
        throw new WorkpaperError(
          "CLASSIFICATION_INCOMPLETE",
          `Hay ${classifications.pending} comprobante(s) sin rubro o actividad`,
        );
      }
      await this.ensureAllocations(tx, wp.id);
      const allocations = await workpaperAllocationCoverage(tx, wp.id);
      if (!allocations.ready) {
        throw new WorkpaperError(
          "ALLOCATION_INCOMPLETE",
          `Hay ${allocations.pending} retención(es) o percepción(es) sin imputar`,
        );
      }
      const sourceFacts = await reviewedSourceFacts(tx, wp.id);
      // Los comprobantes excluidos con motivo quedan fuera del cálculo y de su hash de entrada.
      const excludedVoucherIds = new Set(
        classifications.items
          .filter((classification) => classification.excludedAt !== null)
          .map((classification) => classification.voucherId),
      );
      const classificationScope = classifications.items
        .filter((classification) => classification.excludedAt === null)
        .map((classification) => ({
        voucherId: classification.voucherId,
        documentKind: classification.documentKind,
        activityCode: classification.activityCode,
        categoryCode: classification.categoryCode,
        ivaCredit: classification.ivaCredit,
        rateBuckets: classification.rateBuckets as Array<{
          rate: string;
          base: string;
          amount: string;
        }>,
        snapshotHash: classification.snapshotHash,
      }));

      const requestedCutoff = input?.cutoff;
      if (requestedCutoff) {
        const cutoffDate = new Date(`${requestedCutoff}T00:00:00.000Z`);
        if (cutoffDate < wp.periodStart || cutoffDate > wp.periodEnd) {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            "La fecha de corte debe pertenecer al período del expediente",
          );
        }
      }

      const results: Array<{
        settlementId: string;
        status: string;
        regimeId: string;
        taxTypeCode: string;
        inputHash: string;
        outputHash: string;
        version: number;
      }> = [];

      for (const link of liquidables) {
        let settlement = link.settlement;
        if (settlement?.status === "IN_REVIEW") {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            `La liquidación ${link.role} está en revisión y no puede recalcularse`,
          );
        }

        if (
          !settlement ||
          ["DRAFT", "CALCULATED", "CHANGES_REQUESTED"].includes(settlement.status)
        ) {
          const cutoff =
            requestedCutoff ?? link.obligation.period.endDate.toISOString().slice(0, 10);
          const sourceCodes = new Set(
            sourceCodesForCalculation(
              {
                taxTypeCode: link.obligation.regime.taxType.code,
                calcFamilyKey: link.obligation.regime.calcFamily?.key ?? null,
              },
              new Set(Object.keys(sourceFacts.bySourceCode)),
            ),
          );
          const relevantFacts = [...sourceCodes].flatMap(
            (sourceCode) => sourceFacts.bySourceCode[sourceCode] ?? [],
          );
          const idsFor = (sourceType: string) => [
            ...new Set(
              relevantFacts
                .filter((fact) => fact.sourceType === sourceType)
                .map((fact) => fact.sourceId),
            ),
          ];
          const voucherIds = idsFor("FISCAL_VOUCHER").filter((id) => !excludedVoucherIds.has(id));
          const cm03CoefficientRows = cm03CoefficientSourceRowsFromFacts(relevantFacts);
          const cm03Jurisdictions = cm03CoefficientRows.length > 0
            ? await tx.jurisdiction.findMany({
                where: { code: { in: [...new Set(cm03CoefficientRows.map((row) => row.jurisdiction))] } },
                select: { id: true, code: true },
              })
            : [];
          const jurisdictionIdByCode = new Map(
            cm03Jurisdictions.map((jurisdiction) => [jurisdiction.code, jurisdiction.id]),
          );
          const cm03Coefficients = resolveCm03CoefficientJurisdictionIds(
            cm03CoefficientRows,
            jurisdictionIdByCode,
          );
          const calculated = await settlementService.calculateWithTransaction(ctx, tx, {
            clientId: wp.clientId,
            taxTypeId: link.obligation.regime.taxTypeId,
            regimeId: link.obligation.regimeId,
            jurisdictionId: link.obligation.regime.jurisdictionId,
            periodId: link.obligation.periodId,
            cutoff,
            ...(input?.minimums?.[link.obligation.id]
              ? { declaredMinimum: input.minimums[link.obligation.id]! }
              : {}),
            sourceScope: {
              workpaperId: wp.id,
              obligationId: link.obligation.id,
              voucherIds,
              withholdingIds: idsFor("WITHHOLDING"),
              perceptionIds: idsFor("PERCEPTION"),
              f931RunIds: idsFor("F931_RUN"),
              classifications: classificationScope.filter((classification) =>
                voucherIds.includes(classification.voucherId),
              ).map((classification) => ({
                voucherId: classification.voucherId,
                documentKind: classification.documentKind,
                activityCode: classification.activityCode,
                categoryCode: classification.categoryCode,
                ivaCredit: classification.ivaCredit,
                rateBuckets: classification.rateBuckets as Array<{
                  rate: string;
                  base: string;
                  amount: string;
                }>,
                snapshotHash: classification.snapshotHash,
              })),
              cm03Coefficients,
            },
          });
          settlement = calculated.settlement;
        }

        if (!settlement) {
          throw new WorkpaperError(
            "MISSING_REQUIRED_COMPONENT",
            `No se pudo calcular el componente requerido ${link.role}`,
          );
        }

        await tx.workpaperSettlement.update({
          where: { id: link.id },
          data: { settlementId: settlement.id, statusAtLink: settlement.status },
        });
        results.push({
          settlementId: settlement.id,
          status: settlement.status,
          regimeId: settlement.regimeId,
          taxTypeCode: link.obligation.regime.taxType.code,
          inputHash: settlement.inputHash,
          outputHash: settlement.outputHash,
          version: settlement.version,
        });
      }

      // Hash de entrada: combina los hashes de las liquidaciones hijas.
      const permitidoCalculo = await loadPerfilPermitido(tx, {
        firmId: ctx.firmId,
        clientId: wp.clientId,
        year: wp.periodStart.getUTCFullYear(),
      });
      const inputHash = taxHash({
        workpaperId: wp.id,
        clientId: wp.clientId,
        periodStart: wp.periodStart.toISOString(),
        periodEnd: wp.periodEnd.toISOString(),
        revision: wp.revision,
        voucherProfile: { clases: [...permitidoCalculo.clases], exentos: permitidoCalculo.exentos },
        settlements: results
          .map((result) => ({
            settlementId: result.settlementId,
            version: result.version,
            inputHash: result.inputHash,
            outputHash: result.outputHash,
          }))
          .sort((a, b) => a.settlementId.localeCompare(b.settlementId)),
        sources: sources
          .flatMap((source) =>
            source.batches
              .filter((batch) => batch.reviewStatus === "REVIEWED")
              .map((batch) => ({
                sourceCode: source.code,
                importBatchId: batch.importBatchId,
                snapshotHash: batch.snapshotHash,
              })),
          )
          .sort((a, b) =>
            `${a.sourceCode}:${a.importBatchId}`.localeCompare(
              `${b.sourceCode}:${b.importBatchId}`,
            ),
          ),
        classifications: classificationScope
          .map((classification) => ({
            voucherId: classification.voucherId,
            snapshotHash: classification.snapshotHash,
          }))
          .sort((a, b) => a.voucherId.localeCompare(b.voucherId)),
        allocations: allocations.items
          .map((allocation) => ({
            sourceType: allocation.sourceType,
            sourceId: allocation.sourceId,
            obligationId: allocation.obligationId,
            jurisdictionId: allocation.jurisdictionId,
            amount: allocation.amount.toFixed(4),
            snapshotHash: allocation.snapshotHash,
          }))
          .sort((a, b) =>
            `${a.sourceType}:${a.sourceId}:${a.jurisdictionId}`.localeCompare(
              `${b.sourceType}:${b.sourceId}:${b.jurisdictionId}`,
            ),
          ),
      });

      const cutoffAt = new Date(
        `${requestedCutoff ?? wp.periodEnd.toISOString().slice(0, 10)}T00:00:00.000Z`,
      );

      await this.materializeControls(tx, {
        workpaperId: wp.id,
        firmId: ctx.firmId,
        clientId: wp.clientId,
        sourceHash: inputHash,
        periodYear: wp.periodStart.getUTCFullYear(),
        sources,
        components: results.map((result) => ({
          taxTypeCode: result.taxTypeCode,
          settlementId: result.settlementId,
        })),
        allocationsReady: allocations.ready,
        allocationsCount: allocations.total,
      });

      const updated = await tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: {
          status: "CALCULATED",
          inputHash,
          outputHash: null,
          reviewedByUserId: null,
          cutoffAt,
        },
      });
      return { workpaper: updated, settlements: results };
    });
  }

  /**
   * Revisa en bloque una fuente importada y aprueba atómicamente todos los
   * hechos que produjo. El lote conserva sus filas; este vínculo congela el
   * snapshot aceptado por una revisión concreta del expediente.
   */
  async reviewSource(ctx: TenantContext, workpaperId: string, sourceLinkId: string) {
    return withTenantContext(ctx, async (tx) => {
      const link = await tx.workpaperImportBatch.findFirst({
        where: { id: sourceLinkId, workpaperId, firmId: ctx.firmId },
        include: {
          workpaper: true,
          importBatch: { include: { rows: { orderBy: { position: "asc" } } } },
        },
      });
      if (!link) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Fuente no encontrada");
      if (
        !["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE", "CHANGES_REQUESTED", "CALCULATED"].includes(
          link.workpaper.status,
        )
      ) {
        throw new WorkpaperError(
          "WORKPAPER_IMMUTABLE",
          "El expediente no admite revisar fuentes en su estado actual",
        );
      }
      if (link.status === "REVIEWED") return link;
      if (link.importBatch.status !== "COMMITTED" || link.importBatch.errorRows > 0) {
        throw new WorkpaperError(
          "SOURCE_NOT_REVIEWED",
          "El lote debe estar confirmado y sin errores antes de revisarse",
        );
      }
      const isSelfReview = link.importBatch.createdByUserId === ctx.userId;
      if (isSelfReview && !(await this.selfReviewEnabled(tx, ctx.firmId, ctx.userId))) {
        throw new WorkpaperError(
          "MAKER_CHECKER_VIOLATION",
          "Quien importó el lote no puede revisar su propia fuente",
        );
      }

      const policy = getWorkpaperSourcePolicy(link.sourceCode);
      if (!policy) {
        throw new WorkpaperError("SOURCE_NOT_REVIEWED", "La fuente no tiene una política activa");
      }
      if (policy.voucherDirection) {
        const mismatch = link.importBatch.rows.some((row) => {
          const normalized = (row.normalized ?? {}) as Record<string, unknown>;
          return normalized["direction"] !== policy.voucherDirection;
        });
        if (mismatch) {
          throw new WorkpaperError(
            "SOURCE_NOT_REVIEWED",
            `El lote contiene comprobantes que no corresponden a ${policy.label}`,
          );
        }
      }

      const sourceIds = (sourceType: string) =>
        link.importBatch.rows
          .filter((row) => row.sourceType === sourceType && row.sourceId)
          .map((row) => row.sourceId!);
      const voucherIds = sourceIds("FISCAL_VOUCHER");
      const withholdingIds = sourceIds("WITHHOLDING");
      const perceptionIds = sourceIds("PERCEPTION");
      const f931RunIds = sourceIds("F931_RUN");

      const invalidVouchers = await tx.fiscalVoucher.count({
        where: {
          id: { in: voucherIds },
          status: { notIn: ["DRAFT", "IN_REVIEW", "APPROVED"] },
        },
      });
      if (invalidVouchers > 0) {
        throw new WorkpaperError(
          "SOURCE_NOT_REVIEWED",
          "El lote contiene comprobantes rechazados o reemplazados",
        );
      }

      const reviewedAt = new Date();
      if (voucherIds.length > 0) {
        await tx.fiscalVoucher.updateMany({
          where: { id: { in: voucherIds }, status: { in: ["DRAFT", "IN_REVIEW"] } },
          data: {
            status: "APPROVED",
            reviewedByUserId: ctx.userId,
            reviewedAt,
            approvedByUserId: ctx.userId,
            approvedAt: reviewedAt,
            version: { increment: 1 },
          },
        });
      }
      if (withholdingIds.length > 0) {
        await tx.withholdingCertificate.updateMany({
          where: { id: { in: withholdingIds }, status: { in: ["DRAFT", "IN_REVIEW"] } },
          data: { status: "APPROVED", reviewedByUserId: ctx.userId, reviewedAt },
        });
      }
      if (perceptionIds.length > 0) {
        await tx.perceptionCertificate.updateMany({
          where: { id: { in: perceptionIds }, status: { in: ["DRAFT", "IN_REVIEW"] } },
          data: { status: "APPROVED", reviewedByUserId: ctx.userId, reviewedAt },
        });
      }
      if (f931RunIds.length > 0) {
        await tx.f931Run.updateMany({
          where: { id: { in: f931RunIds } },
          data: { status: "REVIEWED", reviewedByUserId: ctx.userId, reviewedAt },
        });
      }

      const snapshotHash = taxHash({
        workpaperId,
        sourceCode: link.sourceCode,
        importBatchId: link.importBatchId,
        fileHash: link.importBatch.fileHash,
        adapterVersion: link.importBatch.adapterVersion,
        totals: link.importBatch.totals,
        rows: link.importBatch.rows.map((row) => ({
          position: row.position,
          status: row.status,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
        })),
      });
      const reviewed = await tx.workpaperImportBatch.update({
        where: { id: link.id },
        data: {
          status: "REVIEWED",
          snapshotHash,
          reviewedByUserId: ctx.userId,
          reviewedAt,
        },
      });

      if (link.workpaper.status === "CALCULATED") {
        await tx.monthlyTaxWorkpaper.update({
          where: { id: workpaperId },
          data: { status: "COLLECTING_INPUTS", inputHash: null, outputHash: null, reviewedByUserId: null },
        });
      }

      await materializeWorkpaperClassifications(tx, link.workpaper, voucherIds);
      await this.ensureAllocations(tx, workpaperId);
      await this.refreshPreparationStatus(tx, link.workpaper);
      // Un lote revisado manda: la marca «Sin movimientos» de la fuente se limpia sola, con historial (corte 2A).
      await tx.workpaperSourceStatus.updateMany({
        where: { workpaperId, sourceCode: link.sourceCode, clearedAt: null },
        data: { clearedAt: reviewedAt, clearedByUserId: ctx.userId, clearReason: "BATCH_REVIEWED" },
      });
      if (isSelfReview) {
        await this.auditSelfReview(tx, ctx, "WorkpaperImportBatch", link.id, "SOURCE_REVIEW");
      }

      return reviewed;
    });
  }

  async retireBatch(ctx: TenantContext, workpaperId: string, batchId: string, reason: string) {
    return withTenantContext(ctx, async (tx) => {
      const link = await tx.workpaperImportBatch.findFirst({
        where: { importBatchId: batchId, workpaperId, firmId: ctx.firmId },
        include: { workpaper: true, importBatch: true },
      });
      if (!link) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Archivo no encontrado");
      const finalizedSettlement = await tx.taxSettlement.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: link.clientId,
          periodId: link.importBatch.periodId,
          status: "FINALIZED",
        },
        select: { id: true },
      });
      if (link.workpaper.status === "FINALIZED" || finalizedSettlement) {
        throw new WorkpaperError(
          "WORKPAPER_FINALIZED",
          "Para cambiar un mes cerrado, rectificá la liquidación.",
        );
      }
      if (!["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE", "CHANGES_REQUESTED", "CALCULATED"].includes(link.workpaper.status)) {
        throw new WorkpaperError("WORKPAPER_IMMUTABLE", "El expediente no admite cambios en su estado actual");
      }
      if (["RETIRED", "REPLACED"].includes(link.status)) {
        throw new WorkpaperError("INVALID_TRANSITION", "Este archivo ya no está vigente");
      }
      const retiredAt = new Date();
      const retired = await tx.workpaperImportBatch.update({
        where: { id: link.id },
        data: { status: "RETIRED", retiredByUserId: ctx.userId, retiredAt, retireReason: reason },
      });
      // 4K: un lote retirado no aporta imputaciones al cálculo (fuentes-vigentes.ts).
      await retirarImputacionesDelLote(tx, { workpaperId, importBatchId: batchId });
      await tx.monthlyTaxWorkpaper.update({
        where: { id: workpaperId },
        data: {
          ...(link.workpaper.status === "CALCULATED" ? { status: "COLLECTING_INPUTS" } : {}),
          inputHash: null,
          outputHash: null,
          reviewedByUserId: null,
        },
      });
      await this.refreshPreparationStatus(tx, link.workpaper);
      return retired;
    });
  }

  // ------------------------------------------------------------------
  // Sin movimientos (corte 2A, D2): la fuente de un mes queda cubierta sin lote revisado.
  // La marca no cuenta como lote revisado (present sigue en false) y se deshace con historial.
  // ------------------------------------------------------------------

  /** Mes cerrado o en revisión: no se cambian sus fuentes. Con preparación, calculado o con cambios pedidos, sí. */
  private assertNoMovementsEditable(status: string) {
    if (status === "FINALIZED" || status === "SUPERSEDED") {
      throw new WorkpaperError(
        "WORKPAPER_FINALIZED",
        "Para cambiar un mes cerrado, rectificá la liquidación",
      );
    }
    if (status === "IN_REVIEW" || status === "REVIEWED") {
      throw new WorkpaperError(
        "WORKPAPER_IMMUTABLE",
        "El mes está en revisión. Pedí cambios para modificar sus fuentes.",
      );
    }
  }

  private async loadNoMovementsWorkpaper(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    workpaperId: string,
  ) {
    const wp = await tx.monthlyTaxWorkpaper.findFirst({
      where: { id: workpaperId, firmId: ctx.firmId },
    });
    if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
    this.assertNoMovementsEditable(wp.status);
    return wp;
  }

  private async sourceFromCoverage(
    tx: Prisma.TransactionClient,
    wp: { id: string; firmId: string; clientId: string; periodStart: Date; periodEnd: Date },
    sourceCode: string,
  ) {
    const obligations = await tx.taxObligation.findMany({
      where: {
        firmId: wp.firmId,
        clientId: wp.clientId,
        status: { not: "NOT_APPLICABLE" },
        period: { startDate: { gte: wp.periodStart }, endDate: { lte: wp.periodEnd } },
      },
      include: { regime: { include: { taxType: true, calcFamily: true } } },
    });
    const sources = await this.sourceCoverage(tx, wp, obligations);
    const source = sources.find((item) => item.code === sourceCode);
    if (!source) {
      throw new WorkpaperError(
        "SOURCE_NOT_FOUND",
        "La fuente no corresponde a las obligaciones de este mes",
      );
    }
    return source;
  }

  /**
   * Cambiar una marca cambia el cálculo: igual que al cargar o revisar un lote, el mes vuelve a
   * preparación (READY_TO_CALCULATE o COLLECTING_INPUTS) y hay que recalcular. Un mes ya calculado
   * o con cambios pedidos pasa por el mismo camino.
   */
  private async invalidateAfterSourceChange(
    tx: Prisma.TransactionClient,
    wp: {
      id: string;
      firmId: string;
      clientId: string;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    await this.reabrirPreparacion(tx, wp, ["CALCULATED", "CHANGES_REQUESTED"]);
  }

  /** Núcleo compartido: recalcula la preparación y devuelve a preparación los estados indicados. */
  private async reabrirPreparacion(
    tx: Prisma.TransactionClient,
    wp: {
      id: string;
      firmId: string;
      clientId: string;
      periodStart: Date;
      periodEnd: Date;
    },
    estados: string[],
  ) {
    const { ready } = await this.refreshPreparationStatus(tx, wp);
    await tx.monthlyTaxWorkpaper.updateMany({
      where: { id: wp.id, status: { in: estados as MonthlyTaxWorkpaperStatus[] } },
      data: { status: ready ? "READY_TO_CALCULATE" : "COLLECTING_INPUTS" },
    });
  }

  /**
   * Un saldo que cambia de importe o de arrastre cambia el cálculo del período donde aplica y de los
   * posteriores del mismo impuesto. Si alguno de esos meses está finalizado, el cambio se rechaza con
   * guía; los que están calculados y no finalizados vuelven a preparación (mismo núcleo que las fuentes).
   */
  private async invalidarPorCambioDeSaldo(
    tx: Prisma.TransactionClient,
    lote: { firmId: string; clientId: string; taxTypeId: string; periodId: string | null },
  ) {
    const periodoDelLote = lote.periodId
      ? await tx.taxPeriod.findUnique({ where: { id: lote.periodId }, select: { endDate: true } })
      : null;
    const candidatos = await tx.monthlyTaxWorkpaper.findMany({
      where: {
        firmId: lote.firmId,
        clientId: lote.clientId,
        status: { not: "SUPERSEDED" },
        ...(periodoDelLote ? { periodEnd: { gte: periodoDelLote.endDate } } : {}),
        settlements: { some: { obligation: { regime: { taxTypeId: lote.taxTypeId } } } },
      },
      select: { id: true, firmId: true, clientId: true, periodStart: true, periodEnd: true, status: true },
    });
    if (candidatos.some((wp) => wp.status === "FINALIZED")) {
      throw new WorkpaperError(
        "WORKPAPER_FINALIZED",
        "Para cambiar un mes cerrado, rectificá la liquidación",
      );
    }
    for (const wp of candidatos) {
      await this.reabrirPreparacion(tx, wp, ["CALCULATED", "IN_REVIEW", "REVIEWED", "CHANGES_REQUESTED"]);
    }
  }

  /**
   * Marca la fuente como «Sin movimientos». Rechaza si ya tiene un lote revisado (el lote manda).
   * Repetir la marca vigente no cambia nada.
   */
  async setNoMovements(ctx: TenantContext, workpaperId: string, sourceCode: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await this.loadNoMovementsWorkpaper(tx, ctx, workpaperId);
      const source = await this.sourceFromCoverage(tx, wp, sourceCode);
      if (source.present) {
        throw new WorkpaperError(
          "SOURCE_HAS_REVIEWED_BATCH",
          "La fuente tiene un archivo revisado: el archivo manda y no puede marcarse sin movimientos",
        );
      }
      if (source.status === "NO_MOVEMENTS") return source;

      await tx.workpaperSourceStatus.create({
        data: {
          firmId: wp.firmId,
          clientId: wp.clientId,
          workpaperId: wp.id,
          sourceCode,
          status: "NO_MOVEMENTS",
          markedByUserId: ctx.userId,
          markedAt: new Date(),
        },
      });
      await this.invalidateAfterSourceChange(tx, wp);
      return this.sourceFromCoverage(tx, wp, sourceCode);
    });
  }

  /** Deshace la marca «Sin movimientos»: completa clearedAt (la fila queda como historial). */
  async clearNoMovements(ctx: TenantContext, workpaperId: string, sourceCode: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await this.loadNoMovementsWorkpaper(tx, ctx, workpaperId);
      const active = await tx.workpaperSourceStatus.findFirst({
        where: { workpaperId: wp.id, sourceCode, clearedAt: null },
      });
      if (!active) {
        throw new WorkpaperError(
          "NO_MOVEMENTS_NOT_FOUND",
          "La fuente no está marcada sin movimientos",
        );
      }
      await tx.workpaperSourceStatus.update({
        where: { id: active.id },
        data: { clearedAt: new Date(), clearedByUserId: ctx.userId, clearReason: "MANUAL" },
      });
      await this.invalidateAfterSourceChange(tx, wp);
      return this.sourceFromCoverage(tx, wp, sourceCode);
    });
  }

  // ------------------------------------------------------------------
  // Clasificación: proveedor → rubro/actividad → tratamiento del documento
  // ------------------------------------------------------------------

  async listClassifications(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
      });
      if (!workpaper) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (this.mutablePreparationStates.includes(workpaper.status as (typeof this.mutablePreparationStates)[number])) {
        await materializeWorkpaperClassifications(tx, workpaper);
      }
      const coverage = await classificationCoverage(tx, workpaperId);
      // Hallazgo de actividad por venta: el mismo criterio que el cálculo (activity-coverage.ts).
      return conActividadPendiente(coverage, await activityIssuesForWorkpaper(tx, workpaper));
    });
  }

  /**
   * Cambiar clasificaciones o exclusiones cambia el cálculo: igual que las fuentes, un mes calculado vuelve
   * a preparación y uno cerrado se rechaza con guía; en revisión se pide cambios primero.
   */
  private async loadClassificationWorkpaper(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    workpaperId: string,
  ) {
    const wp = await tx.monthlyTaxWorkpaper.findFirst({ where: { id: workpaperId, firmId: ctx.firmId } });
    if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
    this.assertNoMovementsEditable(wp.status);
    return wp;
  }

  private async loadClassificationsForChange(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    workpaperId: string,
    classificationIds: readonly string[],
  ) {
    const ids = [...new Set(classificationIds)];
    const rows = await tx.workpaperVoucherClassification.findMany({
      where: { id: { in: ids }, workpaperId, firmId: ctx.firmId },
      include: { workpaper: true, voucher: { include: { components: true, lines: true } } },
    });
    if (rows.length !== ids.length) {
      throw new WorkpaperError("CLASSIFICATION_NOT_FOUND", "Clasificación no encontrada");
    }
    return rows;
  }

  async classifyVoucher(
    ctx: TenantContext,
    workpaperId: string,
    classificationId: string,
    input: {
      categoryCode?: "SUPER" | "TRANSPORTE";
      activityCode?: string;
      saveSupplierProfile?: boolean;
      rememberRule?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const [classification] = await this.loadClassificationsForChange(tx, ctx, workpaperId, [
        classificationId,
      ]);
      await this.applyClassification(tx, ctx, classification!, input);
      if (input.rememberRule) {
        await this.rememberClassificationRule(tx, ctx, workpaper, [classification!], input);
      }
      await this.invalidateAfterSourceChange(tx, workpaper);
      return classificationCoverage(tx, workpaperId);
    });
  }

  /** Una misma actividad o rubro para varios comprobantes (todos compras o todos ventas). */
  async classifyVouchers(
    ctx: TenantContext,
    workpaperId: string,
    input: {
      classificationIds: string[];
      categoryCode?: "SUPER" | "TRANSPORTE";
      activityCode?: string;
      rememberRule?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const rows = await this.loadClassificationsForChange(tx, ctx, workpaperId, input.classificationIds);
      if (new Set(rows.map((row) => row.direction)).size > 1) {
        throw new WorkpaperError(
          "CLASSIFICATION_INCOMPLETE",
          "Elegí solo compras o solo ventas: cada grupo se clasifica con su propio rubro o actividad",
        );
      }
      for (const row of rows) {
        await this.applyClassification(tx, ctx, row, { ...input, saveSupplierProfile: false });
      }
      if (input.rememberRule) {
        await this.rememberClassificationRule(tx, ctx, workpaper, rows, input);
      }
      await this.invalidateAfterSourceChange(tx, workpaper);
      return classificationCoverage(tx, workpaperId);
    });
  }

  private async applyClassification(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    classification: Prisma.WorkpaperVoucherClassificationGetPayload<{
      include: { workpaper: true; voucher: { include: { components: true; lines: true } } };
    }>,
    input: {
      categoryCode?: "SUPER" | "TRANSPORTE";
      activityCode?: string;
      saveSupplierProfile?: boolean;
    },
  ) {
    const workpaperId = classification.workpaperId;
    if (classification.excludedAt) {
      throw new WorkpaperError(
        "CLASSIFICATION_EXCLUDED",
        "El comprobante está excluido del cálculo. Reincluilo para clasificarlo",
      );
    }
    if (classification.direction === "PURCHASE" && !input.categoryCode) {
      throw new WorkpaperError(
        "CLASSIFICATION_INCOMPLETE",
        "Las compras requieren un rubro SUPER o TRANSPORTE",
      );
    }
    const activityCode = input.activityCode?.trim() || null;
    if (classification.direction === "SALE" && !activityCode) {
      throw new WorkpaperError(
        "CLASSIFICATION_INCOMPLETE",
        "Las ventas requieren una actividad fiscal",
      );
    }

    let supplierProfileId: string | null = classification.supplierProfileId;
    if (
      classification.direction === "PURCHASE" &&
      input.categoryCode &&
      input.saveSupplierProfile !== false
    ) {
      const current = await tx.supplierTaxProfile.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: classification.clientId,
          cuitNormalized: classification.counterpartyCuit,
          status: "ACTIVE",
          validFrom: { lte: classification.workpaper.periodEnd },
          OR: [{ validTo: null }, { validTo: { gte: classification.workpaper.periodStart } }],
        },
        orderBy: { version: "desc" },
      });
      if (
        current?.categoryCode === input.categoryCode &&
        (current.activityCode ?? null) === activityCode
      ) {
        supplierProfileId = current.id;
      } else {
        if (
          current &&
          current.validFrom.getTime() === classification.workpaper.periodStart.getTime()
        ) {
          const updated = await tx.supplierTaxProfile.update({
            where: { id: current.id },
            data: {
              categoryCode: input.categoryCode,
              activityCode,
              createdByUserId: ctx.userId,
            },
          });
          supplierProfileId = updated.id;
        } else {
          const latest = await tx.supplierTaxProfile.findFirst({
            where: {
              firmId: ctx.firmId,
              clientId: classification.clientId,
              cuitNormalized: classification.counterpartyCuit,
            },
            orderBy: { version: "desc" },
          });
          if (current) {
            await tx.supplierTaxProfile.update({
              where: { id: current.id },
              data: {
                status: "SUPERSEDED",
                validTo: new Date(classification.workpaper.periodStart.getTime() - 1),
              },
            });
          }
          const created = await tx.supplierTaxProfile.create({
            data: {
              firmId: ctx.firmId,
              clientId: classification.clientId,
              cuitNormalized: classification.counterpartyCuit,
              validFrom: classification.workpaper.periodStart,
              categoryCode: input.categoryCode,
              activityCode,
              status: "ACTIVE",
              version: (latest?.version ?? 0) + 1,
              createdByUserId: ctx.userId,
            },
          });
          supplierProfileId = created.id;
        }
      }
    }

    const candidates =
      classification.direction === "PURCHASE" && supplierProfileId
        ? await tx.workpaperVoucherClassification.findMany({
            where: {
              workpaperId,
              direction: "PURCHASE",
              counterpartyCuit: classification.counterpartyCuit,
              excludedAt: null,
            },
            include: { voucher: { include: { components: true, lines: true } } },
          })
        : [classification];
    const classifiedAt = new Date();
    for (const candidate of candidates) {
      const categoryCode =
        candidate.direction === "PURCHASE"
          ? (input.categoryCode ?? candidate.categoryCode)
          : candidate.categoryCode;
      const candidateActivity =
        candidate.direction === "SALE" ? activityCode : (activityCode ?? candidate.activityCode);
      await tx.workpaperVoucherClassification.update({
        where: { id: candidate.id },
        data: {
          supplierProfileId,
          categoryCode,
          activityCode: candidateActivity,
          status: "CLASSIFIED",
          origin: "MANUAL",
          classifiedByUserId: ctx.userId,
          classifiedAt,
          snapshotHash: classificationHash({
            voucher: candidate.voucher,
            documentKind: candidate.documentKind,
            categoryCode,
            activityCode: candidateActivity,
            rateBuckets: candidate.rateBuckets,
            supplierProfileId,
            ivaCredit: candidate.ivaCredit,
          }),
        },
      });
    }
  }

  // ------------------------------------------------------------------
  // «Recordar para este proveedor/cliente» (corte 3B): una regla vigente por cliente, sentido y CUIT.
  // ------------------------------------------------------------------

  /**
   * Guarda una regla por cada contraparte de los comprobantes recién clasificados y la aplica a los
   * pendientes del mismo CUIT en este mes (marcados «por regla»). Cambiar el destino de una regla
   * revoca la anterior y deja la nueva: la fila revocada queda como historial.
   */
  private async rememberClassificationRule(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    workpaper: { id: string; firmId: string; clientId: string },
    rows: Array<{ direction: "PURCHASE" | "SALE"; counterpartyCuit: string }>,
    input: { categoryCode?: "SUPER" | "TRANSPORTE"; activityCode?: string },
  ) {
    const activityCode = input.activityCode?.trim() || null;
    const targets = new Map<string, { direction: "PURCHASE" | "SALE"; cuit: string }>();
    for (const row of rows) {
      targets.set(`${row.direction}:${row.counterpartyCuit}`, {
        direction: row.direction,
        cuit: row.counterpartyCuit,
      });
    }
    for (const target of targets.values()) {
      const categoryCode = target.direction === "PURCHASE" ? (input.categoryCode ?? null) : null;
      const current = await tx.classificationRule.findFirst({
        where: {
          clientId: workpaper.clientId,
          direction: target.direction,
          counterpartyCuit: target.cuit,
          revokedAt: null,
        },
      });
      if (
        !current ||
        current.categoryCode !== categoryCode ||
        (current.activityCode ?? null) !== activityCode
      ) {
        if (current) {
          await tx.classificationRule.update({
            where: { id: current.id },
            data: { revokedAt: new Date(), revokedByUserId: ctx.userId },
          });
        }
        await tx.classificationRule.create({
          data: {
            firmId: workpaper.firmId,
            clientId: workpaper.clientId,
            direction: target.direction,
            counterpartyCuit: target.cuit,
            categoryCode,
            activityCode,
            createdByUserId: ctx.userId,
          },
        });
      }
      const pending = await tx.workpaperVoucherClassification.findMany({
        where: {
          workpaperId: workpaper.id,
          direction: target.direction,
          counterpartyCuit: target.cuit,
          excludedAt: null,
          status: { not: "CLASSIFIED" },
        },
        include: { voucher: { include: { components: true, lines: true } } },
      });
      const classifiedAt = new Date();
      for (const item of pending) {
        await tx.workpaperVoucherClassification.update({
          where: { id: item.id },
          data: {
            categoryCode,
            activityCode,
            status: "CLASSIFIED",
            origin: "RULE",
            classifiedByUserId: ctx.userId,
            classifiedAt,
            snapshotHash: classificationHash({
              voucher: item.voucher,
              documentKind: item.documentKind,
              categoryCode,
              activityCode,
              rateBuckets: item.rateBuckets,
              supplierProfileId: item.supplierProfileId,
              ivaCredit: item.ivaCredit,
            }),
          },
        });
      }
    }
  }

  /** Reglas vigentes del cliente del expediente, con quién y cuándo las creó. */
  async listClassificationRules(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        select: { clientId: true },
      });
      if (!workpaper) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      const rules = await tx.classificationRule.findMany({
        where: { firmId: ctx.firmId, clientId: workpaper.clientId, revokedAt: null },
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ direction: "asc" }, { counterpartyCuit: "asc" }],
      });
      return rules.map((rule) => ({
        id: rule.id,
        direction: rule.direction,
        counterpartyCuit: rule.counterpartyCuit,
        categoryCode: rule.categoryCode,
        activityCode: rule.activityCode,
        createdByName: rule.createdBy.name,
        createdAt: rule.createdAt,
      }));
    });
  }

  /**
   * Borra una regla (queda revocada, con quién y cuándo). Los comprobantes ya clasificados conservan su
   * clasificación: la regla solo decide los comprobantes que lleguen después.
   */
  async deleteClassificationRule(ctx: TenantContext, workpaperId: string, ruleId: string) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        select: { clientId: true },
      });
      if (!workpaper) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      const rule = await tx.classificationRule.findFirst({
        where: { id: ruleId, firmId: ctx.firmId, clientId: workpaper.clientId, revokedAt: null },
      });
      if (!rule) {
        throw new WorkpaperError("CLASSIFICATION_RULE_NOT_FOUND", "La regla no existe o ya se borró");
      }
      await tx.classificationRule.update({
        where: { id: rule.id },
        data: { revokedAt: new Date(), revokedByUserId: ctx.userId },
      });
      return { id: rule.id };
    });
  }

  // ------------------------------------------------------------------
  // Exclusión con motivo (corte 3B): el comprobante queda visible, fuera del cálculo, y se puede reincluir.
  // ------------------------------------------------------------------

  async excludeVouchers(
    ctx: TenantContext,
    workpaperId: string,
    input: { classificationIds: string[]; reason: string },
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new WorkpaperError("CLASSIFICATION_INCOMPLETE", "Indicá el motivo de la exclusión");
    }
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const rows = await this.loadClassificationsForChange(tx, ctx, workpaperId, input.classificationIds);
      const excludedAt = new Date();
      for (const row of rows) {
        await tx.workpaperVoucherClassification.update({
          where: { id: row.id },
          data: { excludedAt, excludedByUserId: ctx.userId, excludedReason: reason },
        });
      }
      await this.invalidateAfterSourceChange(tx, workpaper);
      return classificationCoverage(tx, workpaperId);
    });
  }

  async includeVouchers(ctx: TenantContext, workpaperId: string, input: { classificationIds: string[] }) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const rows = await this.loadClassificationsForChange(tx, ctx, workpaperId, input.classificationIds);
      for (const row of rows) {
        await tx.workpaperVoucherClassification.update({
          where: { id: row.id },
          data: { excludedAt: null, excludedByUserId: null, excludedReason: null },
        });
      }
      await this.invalidateAfterSourceChange(tx, workpaper);
      return classificationCoverage(tx, workpaperId);
    });
  }

  async listAllocations(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
      });
      if (!workpaper) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (
        this.mutablePreparationStates.includes(
          workpaper.status as (typeof this.mutablePreparationStates)[number],
        )
      ) {
        await this.ensureAllocations(tx, workpaperId);
      }
      return workpaperAllocationCoverage(tx, workpaperId);
    });
  }

  async reallocateInput(
    ctx: TenantContext,
    workpaperId: string,
    allocationId: string,
    input: { jurisdiction: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const allocation = await tx.taxInputAllocation.findFirst({
        where: { id: allocationId, workpaperId, firmId: ctx.firmId },
        include: { workpaper: true, obligation: { include: { regime: true } } },
      });
      if (!allocation) {
        throw new WorkpaperError("ALLOCATION_NOT_FOUND", "Imputación no encontrada");
      }
      // 4K: una imputación de un archivo retirado o reemplazado no vuelve a contar.
      if (allocation.status === ESTADO_IMPUTACION_RETIRADA) {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "Esta imputación ya no está vigente: su archivo fue retirado o reemplazado",
        );
      }
      if (!allocation.workpaper || !allocation.obligation) {
        throw new WorkpaperError(
          "ALLOCATION_SCOPE_INVALID",
          "La imputación no conserva su expediente u obligación",
        );
      }
      if (
        !this.mutablePreparationStates.includes(
          allocation.workpaper.status as (typeof this.mutablePreparationStates)[number],
        )
      ) {
        throw new WorkpaperError(
          "WORKPAPER_IMMUTABLE",
          "El expediente no admite cambios de imputación en su estado actual",
        );
      }
      const jurisdictionValue = input.jurisdiction.trim().toUpperCase();
      const jurisdiction = await tx.jurisdiction.findFirst({
        where: {
          isActive: true,
          OR: [{ id: jurisdictionValue }, { code: jurisdictionValue }],
        },
      });
      if (!jurisdiction) {
        throw new WorkpaperError(
          "ALLOCATION_SCOPE_INVALID",
          `La jurisdicción ${jurisdictionValue} no existe`,
        );
      }
      const source =
        allocation.sourceType === "WITHHOLDING"
          ? await tx.withholdingCertificate.findUnique({ where: { id: allocation.sourceId } })
          : allocation.sourceType === "PERCEPTION"
            ? await tx.perceptionCertificate.findUnique({ where: { id: allocation.sourceId } })
            : null;
      if (!source || !allocation.regimeId || !allocation.periodId) {
        throw new WorkpaperError(
          "ALLOCATION_SCOPE_INVALID",
          "La imputación no conserva un certificado o alcance fiscal válido",
        );
      }
      const snapshotHash = taxInputAllocationHash({
        sourceType: allocation.sourceType,
        source,
        obligationId: allocation.obligation.id,
        taxTypeId: allocation.taxTypeId,
        regimeId: allocation.regimeId,
        jurisdictionId: jurisdiction.id,
        periodId: allocation.periodId,
        amount: allocation.amount,
      });
      await tx.taxInputAllocation.update({
        where: { id: allocation.id },
        data: {
          jurisdictionId: jurisdiction.id,
          status: "ALLOCATED",
          snapshotHash,
          allocatedByUserId: ctx.userId,
          allocatedAt: new Date(),
        },
      });
      const sourceScope = { jurisdictionId: jurisdiction.id };
      if (allocation.sourceType === "WITHHOLDING") {
        await tx.withholdingCertificate.update({ where: { id: source.id }, data: sourceScope });
      } else {
        await tx.perceptionCertificate.update({ where: { id: source.id }, data: sourceScope });
      }
      await this.refreshPreparationStatus(tx, allocation.workpaper);
      return workpaperAllocationCoverage(tx, workpaperId);
    });
  }

  async calculationBreakdown(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: {
          settlements: {
            include: {
              obligation: {
                include: { regime: { include: { taxType: true, jurisdiction: true, calcFamily: true } } },
              },
              settlement: {
                include: {
                  lines: { orderBy: { position: "asc" } },
                  differences: { orderBy: { createdAt: "asc" } },
                  inputs: {
                    where: { kind: { in: ["F931", "IIBB_MINIMUM_DECLARED", "TEM_CATEGORY"] } },
                    orderBy: { createdAt: "asc" },
                  },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!workpaper) {
        throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      }
      // Perfil habitual: los regímenes liquidados en el expediente anterior del cliente. Si no hay
      // uno previo con liquidaciones, todos los inscriptos del mes cuentan como habituales.
      const anterior = await tx.monthlyTaxWorkpaper.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: workpaper.clientId,
          periodStart: { lt: workpaper.periodStart },
          settlements: { some: { settlementId: { not: null } } },
        },
        orderBy: { periodStart: "desc" },
        include: {
          settlements: {
            where: { settlementId: { not: null } },
            include: { obligation: { select: { regimeId: true } } },
          },
        },
      });
      const regimenesAnteriores = new Set(
        anterior?.settlements.map((link) => link.obligation.regimeId) ?? [],
      );
      return Promise.all(
        workpaper.settlements.map(async (component) => {
          const regimeId = component.obligation.regimeId;
          const usaMinimoDeclarado = await regimeUsaMinimoDeclarado(
            tx,
            regimeId,
            workpaper.periodStart,
            workpaper.periodEnd,
          );
          const minimoDelMes = component.settlement?.inputs.find(
            (input) => input.kind === "IIBB_MINIMUM_DECLARED",
          );
          const minimoCategoria = component.settlement?.inputs.find(
            (input) => input.kind === "TEM_CATEGORY",
          );
          // Último mínimo que usó el cliente en este impuesto, sin contar la liquidación actual.
          const ultimo = usaMinimoDeclarado
            ? await tx.settlementInput.findFirst({
                where: {
                  firmId: ctx.firmId,
                  clientId: workpaper.clientId,
                  kind: "IIBB_MINIMUM_DECLARED",
                  settlement: { regimeId },
                  ...(component.settlement ? { settlementId: { not: component.settlement.id } } : {}),
                },
                orderBy: { createdAt: "desc" },
                select: { snapshot: true },
              })
            : null;
          return {
            role: component.role,
            required: component.required,
            obligationId: component.obligationId,
            habitual: !anterior || regimenesAnteriores.has(regimeId),
            usaMinimoDeclarado,
            minimoAnterior: ultimo
              ? { amount: String((ultimo.snapshot as Record<string, unknown>)["amount"] ?? "") }
              : null,
            obligation: {
              regimeCode: component.obligation.regime.code,
              regimeName: component.obligation.regime.name,
              taxTypeCode: component.obligation.regime.taxType.code,
              taxTypeName: component.obligation.regime.taxType.name,
              jurisdictionName: component.obligation.regime.jurisdiction.name,
            },
            settlement: component.settlement
              ? {
                  id: component.settlement.id,
                  status: component.settlement.status,
                  engineVersion: component.settlement.engineVersion,
                  ruleVersionId: component.settlement.ruleVersionId,
                  rulesHash: component.settlement.rulesHash,
                  totals: component.settlement.totals,
                  lines: component.settlement.lines,
                  differences: component.settlement.differences,
                  f931Inputs: component.settlement.inputs.filter((input) => input.kind === "F931"),
                  minimo: minimoDelMes
                    ? {
                        amount: String((minimoDelMes.snapshot as Record<string, unknown>)["amount"] ?? ""),
                        origen: "CAMPO" as const,
                        declaredAt: String((minimoDelMes.snapshot as Record<string, unknown>)["declaredAt"] ?? ""),
                      }
                    : minimoCategoria
                      ? {
                          amount: String((minimoCategoria.snapshot as Record<string, unknown>)["minimum"] ?? ""),
                          origen: "CATEGORIA" as const,
                          declaredAt: null,
                        }
                      : null,
                }
              : null,
          };
        }),
      );
    });
  }

  // ------------------------------------------------------------------
  // Controles tipados
  // ------------------------------------------------------------------

  /** Cambio de tildes de comprobantes del cliente (corte 4B): reabre sus expedientes del año para recalcular. */
  async reopenForVoucherPermissions(
    tx: Prisma.TransactionClient,
    input: { firmId: string; clientId: string; year: number },
  ) {
    const expedientes = await tx.monthlyTaxWorkpaper.findMany({
      where: {
        firmId: input.firmId,
        clientId: input.clientId,
        periodStart: {
          gte: new Date(Date.UTC(input.year, 0, 1)),
          lt: new Date(Date.UTC(input.year + 1, 0, 1)),
        },
      },
    });
    for (const wp of expedientes) {
      await this.invalidateAfterSourceChange(tx, wp);
    }
  }

  /** Excluye del cálculo, con motivo, los comprobantes de un grupo del perfil que no corresponde (corte 4B). */
  async excludeProfileGroup(ctx: TenantContext, workpaperId: string, grupo: string, reason: string) {
    const motivo = reason.trim();
    if (!motivo) {
      throw new WorkpaperError("CLASSIFICATION_INCOMPLETE", "Indicá el motivo de la exclusión");
    }
    return withTenantContext(ctx, async (tx) => {
      const wp = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const rows = await this.profileGroupRows(tx, ctx, wp, grupo);
      const excludedAt = new Date();
      for (const row of rows) {
        await tx.workpaperVoucherClassification.update({
          where: { id: row.id },
          data: { excludedAt, excludedByUserId: ctx.userId, excludedReason: motivo },
        });
      }
      await this.sincronizarControlesDePerfil(tx, ctx, wp);
      await this.invalidateAfterSourceChange(tx, wp);
      return { grupo, comprobantes: rows.length };
    });
  }

  /** Acepta, con motivo, los comprobantes de un grupo del perfil: quedan registrados como del cliente (corte 4B). */
  async acceptProfileGroup(ctx: TenantContext, workpaperId: string, grupo: string, reason: string) {
    const motivo = reason.trim();
    if (!motivo) {
      throw new WorkpaperError("CLASSIFICATION_INCOMPLETE", "Indicá el motivo por el que lo aceptás");
    }
    return withTenantContext(ctx, async (tx) => {
      const wp = await this.loadClassificationWorkpaper(tx, ctx, workpaperId);
      const rows = await this.profileGroupRows(tx, ctx, wp, grupo);
      const profileAcceptedAt = new Date();
      for (const row of rows) {
        await tx.workpaperVoucherClassification.update({
          where: { id: row.id },
          data: {
            profileAcceptedAt,
            profileAcceptedByUserId: ctx.userId,
            profileAcceptedReason: motivo,
          },
        });
      }
      await this.sincronizarControlesDePerfil(tx, ctx, wp);
      await this.invalidateAfterSourceChange(tx, wp);
      return { grupo, comprobantes: rows.length };
    });
  }

  /** Comprobantes pendientes de un grupo del perfil, según las tildes vigentes del año del expediente. */
  private async profileGroupRows(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    wp: { id: string; clientId: string; periodStart: Date },
    grupo: string,
  ) {
    if (!(grupo in GRUPO_LABELS)) {
      throw new WorkpaperError("CLASSIFICATION_NOT_FOUND", "Grupo de comprobantes no reconocido");
    }
    const filas = (await this.gruposPerfilPendientes(tx, ctx, wp)).get(grupo as GrupoPerfil) ?? [];
    if (filas.length === 0) {
      throw new WorkpaperError("CLASSIFICATION_NOT_FOUND", "No quedan comprobantes pendientes en ese grupo");
    }
    return filas;
  }

  /** Comprobantes de venta pendientes del perfil por grupo: la misma consulta para el control y para la acción. */
  private async gruposPerfilPendientes(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    wp: { id: string; clientId: string; periodStart: Date },
  ) {
    const permitido = await loadPerfilPermitido(tx, {
      firmId: ctx.firmId,
      clientId: wp.clientId,
      year: wp.periodStart.getUTCFullYear(),
    });
    const rows = await tx.workpaperVoucherClassification.findMany({
      where: { workpaperId: wp.id, firmId: ctx.firmId, excludedAt: null },
      include: { voucher: { include: { components: true, importRow: { select: { raw: true } } } } },
    });
    return gruposDeComprobantes(rows, permitido);
  }

  /**
   * Tras aceptar o excluir un grupo, los controles de perfil abiertos siguen a los comprobantes: un grupo sin
   * pendientes queda resuelto y los demás muestran su cantidad actual. Sin esto, el control seguía abierto
   * hasta el próximo cálculo y una segunda acción sobre él respondía «No quedan comprobantes pendientes».
   */
  private async sincronizarControlesDePerfil(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    wp: { id: string; clientId: string; periodStart: Date },
  ) {
    const abiertos = await tx.taxControlFinding.findMany({
      where: {
        firmId: ctx.firmId,
        workpaperId: wp.id,
        status: "OPEN",
        code: { startsWith: PREFIJO_CONTROL_PERFIL },
      },
    });
    if (abiertos.length === 0) return;
    const grupos = await this.gruposPerfilPendientes(tx, ctx, wp);
    for (const control of abiertos) {
      const filas = grupos.get(control.code.slice(PREFIJO_CONTROL_PERFIL.length) as GrupoPerfil) ?? [];
      if (filas.length === 0) {
        await tx.taxControlFinding.update({
          where: { id: control.id },
          data: {
            status: "RESOLVED",
            resolution: "Resuelto con motivo: los comprobantes del grupo se aceptaron o se excluyeron del cálculo",
            resolvedByUserId: ctx.userId,
          },
        });
      } else {
        await tx.taxControlFinding.update({
          where: { id: control.id },
          data: { actual: new Prisma.Decimal(filas.length) },
        });
      }
    }
  }

  async listControls(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxControlFinding.findMany({
        where: { firmId: ctx.firmId, workpaperId },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  async resolveControl(
    ctx: TenantContext,
    workpaperId: string,
    findingId: string,
    input: {
      resolution: string;
      status: "RESOLVED" | "WAIVED";
      evidenceDocumentId?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const finding = await tx.taxControlFinding.findFirst({
        where: { id: findingId, firmId: ctx.firmId, workpaperId },
      });
      if (!finding) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Control no encontrado");
      if (finding.status !== "OPEN") {
        throw new WorkpaperError("INVALID_TRANSITION", "El control ya fue resuelto");
      }
      // El respaldo documental es opcional: lo que se exige es la explicación escrita
      // (la valida la ruta). Si se adjunta un documento, debe ser del cliente y estar listo.
      if (input.evidenceDocumentId) {
        const evidence = await tx.document.findFirst({
          where: {
            id: input.evidenceDocumentId,
            firmId: ctx.firmId,
            clientId: finding.clientId,
            status: { in: ["READY", "APPLIED", "REVIEWED"] },
          },
        });
        if (!evidence) {
          throw new WorkpaperError(
            "BLOCKING_CONTROLS",
            "La evidencia del control debe pertenecer al cliente y estar lista o revisada",
          );
        }
      }
      // F1.5: un waiver de un control bloqueante exige un revisor autorizado
      // distinto del preparador del expediente (maker-checker).
      if (input.status === "WAIVED" && finding.severity === "BLOCKING") {
        const wp = await tx.monthlyTaxWorkpaper.findFirst({
          where: { id: workpaperId, firmId: ctx.firmId },
          select: { preparedByUserId: true },
        });
        if (wp?.preparedByUserId === ctx.userId) {
          throw new WorkpaperError(
            "MAKER_CHECKER_VIOLATION",
            "El preparador no puede eximir un control bloqueante de su propio expediente",
          );
        }
      }
      return tx.taxControlFinding.update({
        where: { id: findingId },
        data: {
          status: input.status,
          resolution: input.resolution.trim(),
          ...(input.evidenceDocumentId
            ? { evidenceDocumentId: input.evidenceDocumentId }
            : {}),
          resolvedByUserId: ctx.userId,
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // Revisión y cierre
  // ------------------------------------------------------------------

  async submitReview(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: { settlements: { include: { settlement: true } }, controls: true },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "CALCULATED" && wp.status !== "CHANGES_REQUESTED") {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          `No se puede enviar a revisión desde ${wp.status}`,
        );
      }

      // Compuerta de la API (desvío 1, decisión de Ciro): no se envía con controles bloqueantes abiertos.
      const bloqueantes = wp.controls.filter(esControlBloqueanteAbierto);
      if (bloqueantes.length > 0) {
        throw new WorkpaperError(
          "BLOCKING_CONTROLS",
          `Hay ${bloqueantes.length} control(es) que bloquean el envío. Resolvelos o eximilos y volvé a enviar.`,
        );
      }

      if (wp.settlements.length === 0) {
        throw new WorkpaperError(
          "NO_SETTLEMENTS",
          "El expediente no contiene liquidaciones calculadas",
        );
      }
      const missing = wp.settlements.filter((link) => link.required && !link.settlement);
      if (missing.length > 0) {
        throw new WorkpaperError(
          "MISSING_REQUIRED_COMPONENT",
          `Faltan ${missing.length} componente(s) requeridos`,
        );
      }

      for (const link of wp.settlements) {
        if (!link.settlement || !link.required) continue;
        if (link.settlement.status === "CALCULATED") {
          const settlement = await settlementService.submitReviewWithTransaction(
            ctx,
            tx,
            link.settlement.id,
          );
          await tx.workpaperSettlement.update({
            where: { id: link.id },
            data: { statusAtLink: settlement.status },
          });
          continue;
        }
        if (!["IN_REVIEW", "REVIEWED", "FINALIZED"].includes(link.settlement.status)) {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            `El componente ${link.role} no puede enviarse a revisión desde ${link.settlement.status}`,
          );
        }
      }

      return tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: { status: "IN_REVIEW" },
      });
    });
  }

  async review(ctx: TenantContext, workpaperId: string, input: { approved: boolean; comment?: string }) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: { settlements: { include: { settlement: true } } },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "IN_REVIEW") {
        throw new WorkpaperError("INVALID_TRANSITION", `No se puede revisar desde ${wp.status}`);
      }
      // Maker-checker stays active unless the OWNER explicitly enabled this
      // audited option for the study.
      const isSelfReview = wp.preparedByUserId === ctx.userId;
      const allowSelfReview = isSelfReview && (await this.selfReviewEnabled(tx, ctx.firmId, ctx.userId));
      if (isSelfReview && !allowSelfReview) {
        throw new WorkpaperError(
          "MAKER_CHECKER_VIOLATION",
          "El preparador no puede revisar su propio expediente",
        );
      }
      if (
        wp.settlements.length === 0 ||
        wp.settlements.some((link) => link.required && !link.settlement)
      ) {
        throw new WorkpaperError(
          "MISSING_REQUIRED_COMPONENT",
          "El expediente no tiene todos sus componentes requeridos",
        );
      }

      if (!input.approved) {
        const comment = input.comment?.trim() || "Cambios solicitados desde el expediente mensual";
        for (const link of wp.settlements) {
          if (link.required && link.settlement?.status === "IN_REVIEW") {
            const settlement = await settlementService.requestChangesWithTransaction(
              ctx,
              tx,
              link.settlement.id,
              comment,
              allowSelfReview,
            );
            await tx.workpaperSettlement.update({
              where: { id: link.id },
              data: { statusAtLink: settlement.status },
            });
          }
        }
        const updated = await tx.monthlyTaxWorkpaper.update({
          where: { id: wp.id },
          data: { status: "CHANGES_REQUESTED", reviewedByUserId: ctx.userId },
        });
        if (isSelfReview) {
          await this.auditSelfReview(tx, ctx, "MonthlyTaxWorkpaper", wp.id, "WORKPAPER_REVIEW");
        }
        return updated;
      }

      for (const link of wp.settlements) {
        if (!link.required || !link.settlement) continue;
        if (link.settlement.status === "IN_REVIEW") {
          const settlement = await settlementService.reviewWithTransaction(
            ctx,
            tx,
            link.settlement.id,
            input.comment,
            allowSelfReview,
          );
          await tx.workpaperSettlement.update({
            where: { id: link.id },
            data: { statusAtLink: settlement.status },
          });
          continue;
        }
        if (!["REVIEWED", "FINALIZED"].includes(link.settlement.status)) {
          throw new WorkpaperError(
            "SETTLEMENT_NOT_REVIEWED",
            `El componente ${link.role} no está listo para aprobarse`,
          );
        }
      }

      const updated = await tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: { status: "REVIEWED", reviewedByUserId: ctx.userId },
      });
      if (isSelfReview) {
        await this.auditSelfReview(tx, ctx, "MonthlyTaxWorkpaper", wp.id, "WORKPAPER_REVIEW");
      }
      return updated;
    });
  }

  async finalize(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: {
          settlements: { include: { settlement: true } },
          controls: true,
        },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "REVIEWED") {
        throw new WorkpaperError("INVALID_TRANSITION", `No se puede finalizar desde ${wp.status}`);
      }
      const isSelfReview = wp.preparedByUserId === ctx.userId;
      const allowSelfReview = isSelfReview && (await this.selfReviewEnabled(tx, ctx.firmId, ctx.userId));
      if (isSelfReview && !allowSelfReview) {
        throw new WorkpaperError(
          "MAKER_CHECKER_VIOLATION",
          "El preparador no puede finalizar su propio expediente",
        );
      }

      // Controles bloqueantes abiertos impiden el cierre.
      const blocking = wp.controls.filter(esControlBloqueanteAbierto);
      if (blocking.length > 0) {
        throw new WorkpaperError(
          "BLOCKING_CONTROLS",
          `${blocking.length} control(es) bloqueante(s) sin resolver`,
        );
      }

      if (wp.settlements.length === 0) {
        throw new WorkpaperError(
          "NO_SETTLEMENTS",
          "No se puede cerrar un expediente sin componentes",
        );
      }
      const missing = wp.settlements.filter((link) => link.required && !link.settlement);
      if (missing.length > 0) {
        throw new WorkpaperError(
          "MISSING_REQUIRED_COMPONENT",
          `Faltan ${missing.length} componente(s) requeridos`,
        );
      }

      const finalizedSettlements = [];
      for (const link of wp.settlements) {
        if (!link.required || !link.settlement) continue;
        if (link.settlement.status === "REVIEWED") {
          const settlement = await settlementService.finalizeWithTransaction(
            ctx,
            tx,
            link.settlement.id,
            allowSelfReview,
          );
          finalizedSettlements.push(settlement);
          await tx.workpaperSettlement.update({
            where: { id: link.id },
            data: { statusAtLink: settlement.status },
          });
          continue;
        }
        if (link.settlement.status === "FINALIZED") {
          finalizedSettlements.push(link.settlement);
          continue;
        }
        throw new WorkpaperError(
          "SETTLEMENT_NOT_REVIEWED",
          `El componente ${link.role} está en ${link.settlement.status}`,
        );
      }

      // Congela hashes y cierra.
      const outputHash = taxHash({
        workpaperId: wp.id,
        clientId: wp.clientId,
        revision: wp.revision,
        settlements: finalizedSettlements
          .map((settlement) => ({
            id: settlement.id,
            version: settlement.version,
            outputHash: settlement.outputHash,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        controls: wp.controls.map((c) => `${c.code}:${c.status}`).sort(),
      });

      const finalized = await tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: {
          status: "FINALIZED",
          outputHash,
          finalizedByUserId: ctx.userId,
          cutoffAt: wp.cutoffAt ?? new Date(),
        },
      });
      if (isSelfReview) {
        await this.auditSelfReview(tx, ctx, "MonthlyTaxWorkpaper", wp.id, "WORKPAPER_FINALIZE");
      }
      return finalized;
    });
  }

  // ------------------------------------------------------------------
  // Rectificación: nueva revisión inmutable
  // ------------------------------------------------------------------

  async rectify(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: {
          settlements: { include: { settlement: true } },
          sources: true,
          classifications: true,
          inputAllocations: true,
        },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "FINALIZED") {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "Sólo se rectifica un expediente finalizado",
        );
      }

      const nextRevision = wp.revision + 1;
      const existing = await tx.monthlyTaxWorkpaper.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: wp.clientId,
          periodStart: wp.periodStart,
          periodEnd: wp.periodEnd,
          revision: nextRevision,
        },
      });
      if (existing) {
        return tx.monthlyTaxWorkpaper.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            settlements: { include: { settlement: true, obligation: true } },
            controls: true,
          },
        });
      }

      const next = await tx.monthlyTaxWorkpaper.create({
        data: {
          firmId: ctx.firmId,
          clientId: wp.clientId,
          periodStart: wp.periodStart,
          periodEnd: wp.periodEnd,
          revision: nextRevision,
          status: "DRAFT",
          supersedesId: wp.id,
          preparedByUserId: ctx.userId,
        },
      });

      for (const link of wp.settlements) {
        let settlementId: string | undefined;
        let statusAtLink = "MISSING";
        if (link.settlement) {
          if (link.settlement.status !== "FINALIZED") {
            throw new WorkpaperError(
              "INVALID_TRANSITION",
              `El componente ${link.role} no está finalizado`,
            );
          }
          const rectified = await settlementService.rectifyWithTransaction(
            ctx,
            tx,
            link.settlement.id,
            `Rectificación del expediente mensual, revisión ${nextRevision}`,
          );
          settlementId = rectified.id;
          statusAtLink = rectified.status;
        }
        await tx.workpaperSettlement.create({
          data: {
            firmId: wp.firmId,
            clientId: wp.clientId,
            workpaperId: next.id,
            obligationId: link.obligationId,
            ...(settlementId ? { settlementId } : {}),
            role: link.role,
            required: link.required,
            statusAtLink,
          },
        });
      }

      for (const source of wp.sources) {
        await tx.workpaperImportBatch.create({
          data: {
            firmId: wp.firmId,
            clientId: wp.clientId,
            workpaperId: next.id,
            importBatchId: source.importBatchId,
            sourceCode: source.sourceCode,
            status: source.status,
            snapshotHash: source.snapshotHash,
            reviewedByUserId: source.reviewedByUserId,
            reviewedAt: source.reviewedAt,
          },
        });
      }

      for (const classification of wp.classifications) {
        await tx.workpaperVoucherClassification.create({
          data: {
            firmId: wp.firmId,
            clientId: wp.clientId,
            workpaperId: next.id,
            voucherId: classification.voucherId,
            supplierProfileId: classification.supplierProfileId,
            direction: classification.direction,
            counterpartyCuit: classification.counterpartyCuit,
            documentKind: classification.documentKind,
            categoryCode: classification.categoryCode,
            activityCode: classification.activityCode,
            rateBuckets: classification.rateBuckets as Prisma.InputJsonValue,
            status: classification.status,
            origin: classification.origin,
            snapshotHash: classification.snapshotHash,
            classifiedByUserId: classification.classifiedByUserId,
            classifiedAt: classification.classifiedAt,
          },
        });
      }

      for (const allocation of wp.inputAllocations) {
        await tx.taxInputAllocation.create({
          data: {
            firmId: wp.firmId,
            clientId: wp.clientId,
            workpaperId: next.id,
            obligationId: allocation.obligationId,
            sourceCode: allocation.sourceCode,
            sourceType: allocation.sourceType,
            sourceId: allocation.sourceId,
            taxTypeId: allocation.taxTypeId,
            regimeId: allocation.regimeId,
            jurisdictionId: allocation.jurisdictionId,
            periodId: allocation.periodId,
            amount: allocation.amount,
            status: allocation.status,
            snapshotHash: allocation.snapshotHash,
            allocatedByUserId: allocation.allocatedByUserId,
            allocatedAt: allocation.allocatedAt,
          },
        });
      }

      return tx.monthlyTaxWorkpaper.findUniqueOrThrow({
        where: { id: next.id },
        include: {
          settlements: { include: { settlement: true, obligation: true } },
          controls: true,
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // F1.7: Libro de créditos de solo lectura (TaxCreditLot/Movement)
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // F1.7: Libro de créditos de solo lectura (TaxCreditLot/Movement)
  // ------------------------------------------------------------------

  async creditLedger(
    ctx: TenantContext,
    clientId: string,
    input: {
      taxTypeId?: string;
      jurisdictionId?: string;
      from?: string;
      to?: string;
      /** Auditoría: incluye los saldos reemplazados (SUPERSEDED), con su estado. Por defecto, solo los vigentes. */
      incluirReemplazados?: boolean;
    },
  ) {
    // El saldo disponible se calcula desde los movimientos confirmados, nunca
    // desde un campo mutable.
    return withTenantContext(ctx, async (tx) => {
      const lots = await tx.taxCreditLot.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          // La lista de Saldos muestra solo saldos vigentes: un lote reemplazado por la declaración
          // jurada no se vuelve a mostrar como disponible (su historial queda en el lote nuevo y en el libro).
          ...(input.incluirReemplazados ? {} : FILTRO_SALDOS_SIN_REEMPLAZADOS),
          ...(input.taxTypeId ? { taxTypeId: input.taxTypeId } : {}),
          ...(input.jurisdictionId ? { jurisdictionId: input.jurisdictionId } : {}),
          ...(input.from ? { createdAt: { gte: new Date(input.from) } } : {}),
          ...(input.to ? { createdAt: { lte: new Date(input.to) } } : {}),
        },
        include: {
          movements: { orderBy: { createdAt: "asc" } },
          createdBy: true,
          verifiedBy: true,
          history: { orderBy: { createdAt: "asc" }, include: { createdBy: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      // Período e impuesto de cada saldo: la etapa Saldos dice de dónde viene («Viene del cierre de …»).
      const periodIds = [
        ...new Set(lots.map((lot) => lot.periodId).filter((id): id is string => id !== null)),
      ];
      const taxTypeIds = [...new Set(lots.map((lot) => lot.taxTypeId))];
      const [periodos, tiposDeImpuesto] = await Promise.all([
        tx.taxPeriod.findMany({
          where: { id: { in: periodIds } },
          select: { id: true, label: true, startDate: true, endDate: true },
        }),
        tx.taxType.findMany({
          where: { id: { in: taxTypeIds } },
          select: { id: true, code: true, name: true },
        }),
      ]);
      const periodoPorId = new Map(periodos.map((periodo) => [periodo.id, periodo] as const));
      const tipoPorId = new Map(tiposDeImpuesto.map((tipo) => [tipo.id, tipo] as const));

      return lots.map((lot) => {
        const applied = lot.movements.reduce(
          (acc, m) => acc.plus(m.amount),
          new Prisma.Decimal(0),
        );
        return {
          id: lot.id,
          taxTypeId: lot.taxTypeId,
          taxType: tipoPorId.get(lot.taxTypeId) ?? null,
          jurisdictionId: lot.jurisdictionId,
          regimeId: lot.regimeId,
          periodId: lot.periodId,
          period: lot.periodId ? (periodoPorId.get(lot.periodId) ?? null) : null,
          kind: lot.kind,
          originalAmount: lot.originalAmount.toFixed(4),
          // Monto vigente: el original con sus correcciones compensatorias (el disponible descuenta los usos).
          importeVigente: lot.originalAmount
            .minus(
              lot.movements
                .filter((m) => m.kind === "AMOUNT_CORRECTION")
                .reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0)),
            )
            .toFixed(4),
          available: lot.originalAmount.minus(applied).toFixed(4),
          verificationStatus: lot.verificationStatus,
          origin: origenDelLote(lot),
          sourceFilingId: lot.sourceFilingId,
          carryForward: lot.carryForward,
          verifiedBy: lot.verifiedByUserId
            ? { id: lot.verifiedByUserId, name: lot.verifiedBy?.name ?? null }
            : null,
          verifiedAt: lot.verifiedAt,
          sourceSettlementId: lot.sourceSettlementId,
          sourcePaymentId: lot.sourcePaymentId,
          evidenceDocumentId: lot.evidenceDocumentId,
          reference: lot.reference,
          createdBy: lot.createdBy
            ? { id: lot.createdBy.id, name: lot.createdBy.name }
            : null,
          createdAt: lot.createdAt,
          history: lot.history.map((h) => ({
            id: h.id,
            createdAt: h.createdAt,
            changes: h.changes,
            createdBy: h.createdBy
              ? { id: h.createdBy.id, name: h.createdBy.name }
              : null,
          })),
          movements: lot.movements.map((m) => ({
            id: m.id,
            kind: m.kind,
            amount: m.amount.toString(),
            workpaperId: m.workpaperId,
            settlementId: m.settlementId,
            reference: m.reference,
            createdAt: m.createdAt,
          })),
        };
      });
    });
  }

  /**
   * Punto de entrada controlado para saldos previos a Contable. No se edita
   * un lote: una corrección futura se registra como movimiento compensatorio.
   */
  async registerCreditUse(
    ctx: TenantContext,
    clientId: string,
    input: {
      lotId: string;
      amount: string;
      reference: string;
      kind?: "APPLICATION" | "EXTERNAL_USE" | "COMPENSATION";
      workpaperId?: string;
      settlementId?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // Lock pesimista del lote: dos ejecuciones concurrentes no pueden gastar
      // el mismo disponible dos veces (§3.2).
      const lot = await tx.$queryRaw<Array<{ id: string; originalAmount: Prisma.Decimal; verificationStatus: string }>>`
        SELECT "id", "originalAmount", "verificationStatus"::text AS "verificationStatus"
        FROM "tax_credit_lots"
        WHERE "id" = ${input.lotId} AND "firmId" = ${ctx.firmId} AND "clientId" = ${clientId}
        FOR UPDATE
      `;
      const locked = lot[0];
      if (!locked) {
        throw new WorkpaperError("CLIENT_NOT_FOUND", "El saldo no existe para este cliente");
      }
      if (locked.verificationStatus !== "VERIFIED") {
        throw new WorkpaperError(
          "SOURCE_NOT_REVIEWED",
          "Sólo un saldo verificado puede aplicarse o compensarse",
        );
      }
      const amount = new Prisma.Decimal(input.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new WorkpaperError("INVALID_TRANSITION", "El importe debe ser mayor a cero");
      }

      // Idempotencia por referencia: repetir la misma operación no duplica el
      // consumo (§3.2).
      const existing = await tx.taxCreditMovement.findFirst({
        where: {
          lotId: input.lotId,
          reference: input.reference,
          kind: { in: ["APPLICATION", "EXTERNAL_USE", "COMPENSATION"] },
        },
      });
      if (existing) {
        return { id: existing.id, duplicated: true, amount: existing.amount.toFixed(4) };
      }

      const movements = await tx.taxCreditMovement.findMany({
        where: { lotId: input.lotId },
        select: { amount: true },
      });
      const applied = movements.reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0));
      const available = locked.originalAmount.minus(applied);
      if (amount.greaterThan(available)) {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          `El disponible (${available.toFixed(4)}) es insuficiente para aplicar ${amount.toFixed(4)}`,
        );
      }

      const movement = await tx.taxCreditMovement.create({
        data: {
          firmId: ctx.firmId,
          clientId,
          lotId: input.lotId,
          kind: input.kind ?? "APPLICATION",
          amount,
          reference: input.reference,
          ...(input.workpaperId ? { workpaperId: input.workpaperId } : {}),
          ...(input.settlementId ? { settlementId: input.settlementId } : {}),
          createdByUserId: ctx.userId,
        },
      });
      return { id: movement.id, duplicated: false, amount: movement.amount.toFixed(4) };
    });
  }

  /**
   * B2 (§3.2): corrección de monto de un lote. El importe original NO se
   * edita: se registra un movimiento compensatorio (positivo o negativo) que
   * ajusta el disponible y deja historial auditable.
   */
  async correctCreditLotAmount(
    ctx: TenantContext,
    clientId: string,
    lotId: string,
    input: { newAmount: string; reason: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const lot = await tx.$queryRaw<
        Array<{ id: string; originalAmount: Prisma.Decimal; taxTypeId: string; periodId: string | null }>
      >`
        SELECT "id", "originalAmount", "taxTypeId", "periodId"
        FROM "tax_credit_lots"
        WHERE "id" = ${lotId} AND "firmId" = ${ctx.firmId} AND "clientId" = ${clientId}
        FOR UPDATE
      `;
      const locked = lot[0];
      if (!locked) {
        throw new WorkpaperError("CLIENT_NOT_FOUND", "El saldo no existe para este cliente");
      }
      const newAmount = new Prisma.Decimal(input.newAmount);
      if (newAmount.lessThanOrEqualTo(0)) {
        throw new WorkpaperError("INVALID_TRANSITION", "El nuevo importe debe ser mayor a cero");
      }
      const movements = await tx.taxCreditMovement.findMany({
        where: { lotId },
        select: { amount: true, kind: true },
      });
      // El importe vigente del saldo es el original más las correcciones ya registradas (no el original a secas).
      const correcciones = movements
        .filter((m) => m.kind === "AMOUNT_CORRECTION")
        .reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0));
      const otrosUsos = movements
        .filter((m) => m.kind !== "AMOUNT_CORRECTION")
        .reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0));
      const importeVigente = locked.originalAmount.minus(correcciones);
      const delta = newAmount.minus(importeVigente);
      if (delta.isZero()) {
        return { id: locked.id, changed: false, delta: "0.0000" };
      }
      // La corrección no puede dejar el disponible en negativo.
      if (newAmount.minus(otrosUsos).lessThan(0)) {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "La corrección dejaría el disponible en negativo",
        );
      }
      // Corrección con invalidación: un mes finalizado rechaza el cambio; los calculados vuelven a preparación.
      await this.invalidarPorCambioDeSaldo(tx, {
        firmId: ctx.firmId,
        clientId,
        taxTypeId: locked.taxTypeId,
        periodId: locked.periodId,
      });
      const movement = await tx.taxCreditMovement.create({
        data: {
          firmId: ctx.firmId,
          clientId,
          lotId,
          kind: "AMOUNT_CORRECTION",
          // Convención: los movimientos reducen el disponible. Una corrección
          // que AUMENTA el saldo se registra negativa (compensatoria).
          amount: delta.negated(),
          reference: input.reason,
          createdByUserId: ctx.userId,
        },
      });
      await tx.taxCreditLotHistory.create({
        data: {
          lotId,
          firmId: ctx.firmId,
          clientId,
          createdByUserId: ctx.userId,
          changes: {
            originalAmount: { from: importeVigente.toFixed(4), to: newAmount.toFixed(4) },
            reason: { from: null, to: input.reason },
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { id: movement.id, changed: true, delta: delta.toFixed(4) };
    });
  }

  /**
   * Punto de entrada controlado para saldos previos a Contable. No se edita
   * un lote: una corrección futura se registra como movimiento compensatorio.
   */
  async createOpeningCredit(
    ctx: TenantContext,
    input: {
      clientId: string;
      taxTypeId: string;
      regimeId?: string;
      jurisdictionId?: string;
      periodId: string;
      kind: "IVA_TECNICO" | "IVA_LIBRE" | "SALDO_A_FAVOR";
      amount: string;
      evidenceDocumentId?: string;
      reference?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const [period, taxType, document] = await Promise.all([
        tx.taxPeriod.findFirst({ where: { id: input.periodId, firmId: ctx.firmId, clientId: input.clientId } }),
        tx.taxType.findUnique({ where: { id: input.taxTypeId } }),
        input.evidenceDocumentId
          ? tx.document.findFirst({ where: { id: input.evidenceDocumentId, firmId: ctx.firmId, clientId: input.clientId, status: "READY" } })
          : Promise.resolve(null),
      ]);
      if (!period || !taxType) throw new WorkpaperError("PERIOD_NOT_FOUND", "El período o impuesto del saldo no existe");
      if (period.taxTypeId !== input.taxTypeId) {
        throw new WorkpaperError("INVALID_TRANSITION", "El período no corresponde al impuesto del saldo");
      }
      if (input.evidenceDocumentId && !document) {
        throw new WorkpaperError("SOURCE_NOT_REVIEWED", "Seleccioná un documento de respaldo del cliente");
      }
      if (new Prisma.Decimal(input.amount).lessThanOrEqualTo(0)) {
        throw new WorkpaperError("INVALID_TRANSITION", "El saldo inicial debe ser mayor a cero");
      }
      if (input.kind.startsWith("IVA_") && taxType.code !== "IVA") {
        throw new WorkpaperError("INVALID_TRANSITION", "Los saldos técnicos y libres sólo corresponden a IVA");
      }
      const problema = await creditOriginProblem(tx, input);
      if (problema) {
        const error = OPENING_CREDIT_ORIGIN_ERRORS[problema];
        throw new WorkpaperError(error.code, error.message);
      }
      const existing = await tx.taxCreditLot.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          regimeId: input.regimeId ?? null,
          jurisdictionId: input.jurisdictionId ?? null,
          periodId: input.periodId,
          kind: input.kind,
          evidenceDocumentId: input.evidenceDocumentId ?? null,
          sourceSettlementId: null,
          sourceFilingId: null,
        },
      });
      if (existing) {
        const amount = new Prisma.Decimal(input.amount);
        // Idempotencia: exactamente la misma presentación (mismo respaldo,
        // importe y referencia) devuelve el lote existente. Una referencia
        // distinta es una NUEVA presentación que supera a la anterior.
        if (
          existing.originalAmount.equals(amount) &&
          (existing.reference ?? null) === (input.reference ?? null)
        ) {
          return existing;
        }
      }

      // P1 (§3.1.5 última rectificativa / §3.1.4 presentación superada): una
      // nueva presentación del mismo alcance marca a las anteriores como
      // SUPERSEDED. Sólo la última versión alimenta el período.
      await tx.taxCreditLot.updateMany({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          regimeId: input.regimeId ?? null,
          jurisdictionId: input.jurisdictionId ?? null,
          periodId: input.periodId,
          kind: input.kind,
          sourceSettlementId: null,
          sourceFilingId: null,
          verificationStatus: { not: "SUPERSEDED" },
        },
        data: { verificationStatus: "SUPERSEDED" },
      });

      return tx.taxCreditLot.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          ...(input.regimeId ? { regimeId: input.regimeId } : {}),
          ...(input.jurisdictionId ? { jurisdictionId: input.jurisdictionId } : {}),
          periodId: input.periodId,
          kind: input.kind,
          originalAmount: new Prisma.Decimal(input.amount),
          ...(input.evidenceDocumentId ? { evidenceDocumentId: input.evidenceDocumentId } : {}),
          ...(input.reference ? { reference: input.reference } : {}),
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /**
   * Edita los metadatos de un lote de crédito: referencia y documento de respaldo, y el arrastre.
   * El importe NO se edita aquí: una corrección de monto se registra como movimiento compensatorio
   * con motivo (`correctCreditLotAmount`). Cada edición queda auditada en TaxCreditLotHistory con el
   * usuario, la fecha y el diff de campos modificados. Un cambio de arrastre altera el cálculo y sigue
   * la misma invalidación que una corrección.
   */
  async updateCreditLot(
    ctx: TenantContext,
    clientId: string,
    lotId: string,
    input: {
      reference?: string | null;
      evidenceDocumentId?: string | null;
      carryForward?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const lot = await tx.taxCreditLot.findFirst({
        where: { id: lotId, firmId: ctx.firmId, clientId },
      });
      if (!lot) {
        throw new WorkpaperError("CLIENT_NOT_FOUND", "El saldo no existe para este cliente");
      }

      if (input.evidenceDocumentId) {
        const document = await tx.document.findFirst({
          where: {
            id: input.evidenceDocumentId,
            firmId: ctx.firmId,
            clientId,
            status: "READY",
          },
        });
        if (!document) {
          throw new WorkpaperError(
            "SOURCE_NOT_REVIEWED",
            "Seleccioná un documento de respaldo del cliente",
          );
        }
      }

      // Construir el diff de campos modificados para la auditoría.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      // Un campo que no viene en el PATCH conserva su valor: solo cambia lo que se envía.
      const nextReference = input.reference !== undefined ? input.reference : (lot.reference ?? null);
      const nextEvidence =
        input.evidenceDocumentId !== undefined
          ? input.evidenceDocumentId
          : (lot.evidenceDocumentId ?? null);

      if ((lot.reference ?? null) !== nextReference) {
        changes.reference = { from: lot.reference ?? null, to: nextReference };
      }
      if ((lot.evidenceDocumentId ?? null) !== nextEvidence) {
        changes.evidenceDocumentId = {
          from: lot.evidenceDocumentId ?? null,
          to: nextEvidence,
        };
      }

      // Corte 6a: el arrastre se cambia con historial y no si el saldo ya se usó en un cierre.
      if (input.carryForward !== undefined && input.carryForward !== lot.carryForward) {
        const motivo = await motivoSiLoteUsado(tx, lot);
        if (motivo) throw new WorkpaperError("INVALID_TRANSITION", motivo);
        changes.carryForward = { from: lot.carryForward, to: input.carryForward };
        // El arrastre cambia el cálculo del período donde aplica y de los posteriores.
        await this.invalidarPorCambioDeSaldo(tx, lot);
      }
      if (Object.keys(changes).length === 0) {
        // Sin cambios reales: no se registra historial ni se toca la BD.
        return {
          id: lot.id,
          reference: lot.reference,
          evidenceDocumentId: lot.evidenceDocumentId,
          originalAmount: lot.originalAmount.toFixed(4),
          carryForward: lot.carryForward,
          changed: false,
        };
      }

      const updateData: Prisma.TaxCreditLotUpdateInput = {};
      if (nextReference !== undefined) updateData.reference = nextReference;
      if (nextEvidence !== undefined) updateData.evidenceDocumentId = nextEvidence;
      if (changes.carryForward && input.carryForward !== undefined) {
        updateData.carryForward = input.carryForward;
      }

      const updated = await tx.taxCreditLot.update({
        where: { id: lot.id },
        data: updateData,
      });

      await tx.taxCreditLotHistory.create({
        data: {
          lotId: lot.id,
          firmId: ctx.firmId,
          clientId,
          createdByUserId: ctx.userId,
          changes: changes as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        id: updated.id,
        reference: updated.reference,
        evidenceDocumentId: updated.evidenceDocumentId,
        originalAmount: updated.originalAmount.toFixed(4),
        carryForward: updated.carryForward,
        changed: true,
      };
    });
  }

  /**
   * B1 (§3.1): verificación de un saldo anterior. Exige documento de
   * evidencia o referencia oficial, registra usuario y fecha, y aplica
   * maker-checker: quien creó el lote no puede verificarlo. Un lote ya
   * verificado no se reverifica (inmutabilidad de la verificación).
   */
  async verifyCreditLot(
    ctx: TenantContext,
    clientId: string,
    lotId: string,
    input: { evidenceDocumentId?: string; officialReference?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const lot = await tx.taxCreditLot.findFirst({
        where: { id: lotId, firmId: ctx.firmId, clientId },
      });
      if (!lot) {
        throw new WorkpaperError("CLIENT_NOT_FOUND", "El saldo no existe para este cliente");
      }
      if (lot.verificationStatus === "VERIFIED") {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "El saldo ya fue verificado y no puede reverificarse",
        );
      }
      if (lot.createdByUserId === ctx.userId) {
        throw new WorkpaperError(
          "MAKER_CHECKER_VIOLATION",
          "El usuario que registró el saldo no puede verificarlo",
        );
      }
      if (!input.evidenceDocumentId && !input.officialReference) {
        throw new WorkpaperError(
          "SOURCE_NOT_REVIEWED",
          "La verificación exige documento de evidencia o referencia oficial",
        );
      }
      if (input.evidenceDocumentId) {
        const document = await tx.document.findFirst({
          where: {
            id: input.evidenceDocumentId,
            firmId: ctx.firmId,
            clientId,
            status: "READY",
          },
        });
        if (!document) {
          throw new WorkpaperError(
            "SOURCE_NOT_REVIEWED",
            "Seleccioná un documento de respaldo del cliente",
          );
        }
      }
      const verified = await tx.taxCreditLot.update({
        where: { id: lot.id },
        data: {
          verificationStatus: "VERIFIED",
          verifiedByUserId: ctx.userId,
          verifiedAt: new Date(),
          ...(input.evidenceDocumentId && !lot.evidenceDocumentId
            ? { evidenceDocumentId: input.evidenceDocumentId }
            : {}),
        },
      });
      await tx.taxCreditLotHistory.create({
        data: {
          lotId: lot.id,
          firmId: ctx.firmId,
          clientId,
          createdByUserId: ctx.userId,
          changes: {
            verificationStatus: { from: lot.verificationStatus, to: "VERIFIED" },
            ...(input.officialReference
              ? { officialReference: { from: null, to: input.officialReference } }
              : {}),
            ...(input.evidenceDocumentId
              ? { evidenceDocumentId: { from: lot.evidenceDocumentId, to: input.evidenceDocumentId } }
              : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        id: verified.id,
        verificationStatus: verified.verificationStatus,
        verifiedByUserId: verified.verifiedByUserId,
        verifiedAt: verified.verifiedAt,
      };
    });
  }

  /** Posición fiscal del período: devengado fiscal, pagos y saldo pendiente. */
  async position(ctx: TenantContext, clientId: string, periodId: string) {
    return withTenantContext(ctx, async (tx) => {
      const obligations = await tx.taxObligation.findMany({
        where: { firmId: ctx.firmId, clientId, periodId },
        include: {
          period: true,
          regime: { include: { taxType: true, jurisdiction: true, calcFamily: true } },
          payments: { where: { status: "PAID" } },
          filings: { where: { status: "FILED" }, orderBy: { filedAt: "desc" } },
        },
        orderBy: { dueDate: "asc" },
      });
      const settlements = await tx.taxSettlement.findMany({
        where: { firmId: ctx.firmId, clientId, periodId, status: { not: "SUPERSEDED" } },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });
      const interest = await tx.taxInterestSnapshot.findMany({
        where: { firmId: ctx.firmId, clientId, obligationId: { in: obligations.map((item) => item.id) } },
        orderBy: { createdAt: "desc" },
      });
      // «Disponible» = el crédito que el cálculo aplicaría a la obligación (credit-lots-vigentes.ts).
      const familias = await tx.calcFamily.findMany({
        where: {
          id: {
            in: obligations
              .map((item) => item.regime.calcFamilyId)
              .filter((id): id is string => id !== null),
          },
        },
        select: { id: true, closesByJurisdiction: true },
      });
      const creditoDisponible = new Map<string, Prisma.Decimal>();
      for (const obligation of obligations) {
        const lots = await tx.taxCreditLot.findMany({
          where: filtroSaldosVigentes({
            firmId: ctx.firmId,
            clientId,
            taxTypeId: obligation.regime.taxTypeId,
            regimeId: obligation.regimeId,
            jurisdictionId: obligation.regime.jurisdictionId,
            periodIds: await periodosElegibles(tx, {
              firmId: ctx.firmId,
              clientId,
              taxTypeId: obligation.regime.taxTypeId,
              hasta: obligation.period.endDate,
            }),
            ignorarJurisdiccion:
              familias.find((item) => item.id === obligation.regime.calcFamilyId)
                ?.closesByJurisdiction ?? false,
          }),
          include: { movements: true },
        });
        creditoDisponible.set(obligation.id, sumaDisponible(lots));
      }
      // Legajo mensual por período (la revisión más alta primero): su estado entra en periodStatus.
      const workpapers = await tx.monthlyTaxWorkpaper.findMany({
        where: { firmId: ctx.firmId, clientId },
        select: { periodStart: true, periodEnd: true, status: true },
        orderBy: { revision: "desc" },
      });

      return obligations.map((obligation) => {
        const settlement = settlements.find((item) => item.regimeId === obligation.regimeId);
        // La presentación que cuenta es la de la liquidación vigente: una rectificativa no hereda la DJ anterior.
        const filing = settlement
          ? (obligation.filings.find((item) => item.settlementId === settlement.id) ?? null)
          : null;
        const hasAcuse = Boolean(filing?.evidenceDocumentId);
        const hasDeclaration = Boolean(filing?.declarationDocumentId);
        const totals = (settlement?.totals ?? {}) as Record<string, string>;
        const accrued = new Prisma.Decimal(totals["TOTAL_A_INGRESAR"] ?? totals["totalDue"] ?? "0");
        const paid = obligation.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
        const principalPaid = obligation.payments.reduce(
          (sum, payment) => sum.plus(payment.principalAmount),
          new Prisma.Decimal(0),
        );
        const interestPaid = obligation.payments.reduce(
          (sum, payment) => sum.plus(payment.interestAmount),
          new Prisma.Decimal(0),
        );
        const availableCredit = creditoDisponible.get(obligation.id) ?? new Prisma.Decimal(0);
        const latestInterest = interest.find((item) => item.obligationId === obligation.id);
        const pending = Prisma.Decimal.max(accrued.minus(principalPaid), new Prisma.Decimal(0));
        const interestPending = Prisma.Decimal.max(
          (latestInterest?.amount ?? new Prisma.Decimal(0)).minus(interestPaid),
          new Prisma.Decimal(0),
        );
        return {
          obligationId: obligation.id,
          status: obligation.status,
          dueDate: obligation.dueDate,
          regime: obligation.regime,
          // Presentación ya registrada (con su constancia): la pantalla no la vuelve a ofrecer.
          filedAt: obligation.filings[0]?.filedAt ?? null,
          // Presentación de la liquidación vigente y su declaración jurada (corte 5b-2).
          filingId: filing?.id ?? null,
          hasAcuse,
          hasDeclaration,
          declarationDocumentId: filing?.declarationDocumentId ?? null,
          impuestoDeterminado: filing?.impuestoDeterminado?.toFixed(4) ?? null,
          saldoFavorTecnico: filing?.saldoFavorTecnico?.toFixed(4) ?? null,
          saldoLibreDisponibilidad: filing?.saldoLibreDisponibilidad?.toFixed(4) ?? null,
          totalAPagar: filing?.totalAPagar?.toFixed(4) ?? null,
          saldosFavorDetalle: filing?.saldosFavorDetalle ?? null,
          declaredAt: filing?.declaredAt ?? null,
          // Única fuente del estado del período (period-status.ts); la web no lo recalcula.
          periodStatus: derivePeriodStatus({
            workpaperStatus:
              workpapers.find(
                (item) =>
                  item.periodStart.getTime() === obligation.period.startDate.getTime() &&
                  item.periodEnd.getTime() === obligation.period.endDate.getTime(),
              )?.status ?? null,
            settlementStatus: settlement?.status ?? null,
            filing: filing ? { hasAcuse, hasDeclaration } : null,
          }),
          settlement: settlement
            ? { id: settlement.id, status: settlement.status, version: settlement.version, totals }
            : null,
          accrued: accrued.toFixed(4),
          paid: paid.toFixed(4),
          principalPaid: principalPaid.toFixed(4),
          interestPaid: interestPaid.toFixed(4),
          pending: pending.toFixed(4),
          availableCredit: Prisma.Decimal.max(availableCredit, new Prisma.Decimal(0)).toFixed(4),
          interest: interestPending.toFixed(4),
          totalPayable: pending.plus(interestPending).toFixed(4),
        };
      });
    });
  }

  /**
   * Congela la mora de una obligación a una fecha determinada. La tasa
   * proviene de la misma versión normativa que produjo la liquidación y los
   * pagos parciales reducen la base desde su fecha efectiva.
   */
  async calculateInterest(
    ctx: TenantContext,
    workpaperId: string,
    input: { obligationId: string; asOfDate: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const workpaper = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: {
          settlements: {
            where: { obligationId: input.obligationId },
            include: {
              settlement: true,
              obligation: {
                include: {
                  payments: { where: { status: "PAID" }, orderBy: [{ paidAt: "asc" }, { id: "asc" }] },
                  regime: true,
                },
              },
            },
          },
        },
      });
      if (!workpaper) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      const link = workpaper.settlements[0];
      if (!link) {
        throw new WorkpaperError("INVALID_TRANSITION", "La obligación no pertenece a este expediente");
      }
      const obligation = link.obligation;
      if (!obligation.dueDate) {
        throw new WorkpaperError("DUE_DATE_NOT_FOUND", "La obligación no tiene un vencimiento materializado");
      }
      const settlement = link.settlement;
      if (!settlement || settlement.status !== "FINALIZED" || !settlement.ruleVersionId) {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "La mora exige una liquidación finalizada y trazada a su versión normativa",
        );
      }

      const asOfDate = new Date(`${input.asOfDate}T00:00:00.000Z`);
      const applicableRules = await tx.taxRateRule.findMany({
        where: {
          ruleVersionId: settlement.ruleVersionId,
          concept: "INTERES_MENSUAL",
          validFrom: { lte: asOfDate },
          OR: [{ validTo: null }, { validTo: { gte: asOfDate } }],
        },
        orderBy: { id: "asc" },
      });
      const jurisdictionRules = applicableRules.filter(
        (rule) => rule.jurisdictionId === obligation.regime.jurisdictionId,
      );
      const candidates = jurisdictionRules.length
        ? jurisdictionRules
        : applicableRules.filter((rule) => !rule.jurisdictionId);
      if (candidates.length !== 1 || !candidates[0]?.rate) {
        throw new WorkpaperError(
          "INTEREST_RULE_NOT_FOUND",
          candidates.length > 1
            ? "Hay más de una tasa mensual de mora aplicable a la fecha"
            : "La versión normativa no contiene una tasa INTERES_MENSUAL aplicable",
        );
      }

      const totals = (settlement.totals ?? {}) as Record<string, string>;
      const principal = totals["TOTAL_A_INGRESAR"] ?? totals["totalDue"] ?? "0";
      const result = calculateLateInterest({
        principal,
        dueDate: obligation.dueDate.toISOString().slice(0, 10),
        asOfDate: input.asOfDate,
        monthlyRate: candidates[0].rate.div(100).toString(),
        payments: obligation.payments.map((payment) => ({
          id: payment.id,
          paidAt: payment.paidAt.toISOString().slice(0, 10),
          amount: payment.principalAmount.toString(),
        })),
      });
      const status = new Prisma.Decimal(result.outstandingAmount).isZero()
        ? "NO_DEBT"
        : result.daysLate === 0
          ? "NOT_DUE"
          : "CALCULATED";
      const snapshot = await tx.taxInterestSnapshot.upsert({
        where: {
          obligationId_inputHash: {
            obligationId: obligation.id,
            inputHash: result.inputHash,
          },
        },
        update: {},
        create: {
          firmId: ctx.firmId,
          clientId: workpaper.clientId,
          workpaperId: workpaper.id,
          obligationId: obligation.id,
          settlementId: settlement.id,
          baseAmount: new Prisma.Decimal(result.baseAmount),
          dueDate: obligation.dueDate,
          asOfDate,
          daysLate: result.daysLate,
          monthlyRate: new Prisma.Decimal(result.monthlyRate),
          ruleVersionId: settlement.ruleVersionId,
          amount: new Prisma.Decimal(result.amount),
          status,
          inputHash: result.inputHash,
        },
      });
      if (result.daysLate > 0 && new Prisma.Decimal(result.outstandingAmount).greaterThan(0)) {
        await tx.taxObligation.update({
          where: { id: obligation.id },
          data: { status: "OVERDUE" },
        });
      }
      return {
        ...snapshot,
        engineVersion: result.engineVersion,
        outstandingAmount: result.outstandingAmount,
        segments: result.segments,
      };
    });
  }

  /** Consolida la posición fiscal de todos los impuestos que coinciden con un período contable. */
  async positionForAccountingPeriod(ctx: TenantContext, clientId: string, accountingPeriodId: string) {
    const taxPeriods = await withTenantContext(ctx, async (tx) => {
      const accountingPeriod = await tx.accountingPeriod.findFirst({
        where: { id: accountingPeriodId, firmId: ctx.firmId, clientId },
        select: { startDate: true, endDate: true },
      });
      if (!accountingPeriod) throw new WorkpaperError("PERIOD_NOT_FOUND", "Período contable no encontrado");
      return tx.taxPeriod.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          startDate: { lte: accountingPeriod.endDate },
          endDate: { gte: accountingPeriod.startDate },
        },
        select: { id: true },
      });
    });

    const positions = await Promise.all(taxPeriods.map((taxPeriod) => this.position(ctx, clientId, taxPeriod.id)));
    return positions.flat();
  }
}

export const monthlyWorkpaperService = new MonthlyWorkpaperService();
