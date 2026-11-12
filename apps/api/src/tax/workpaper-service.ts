import { Prisma } from "@prisma/client";
import { calculateLateInterest, taxHash } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { settlementService } from "./settlement-service.js";
import {
  getWorkpaperSourcePolicy,
  policiesForObligations,
} from "./workpaper-source-policy.js";
import {
  classificationCoverage,
  classificationHash,
  materializeWorkpaperClassifications,
  reviewedSourceFacts,
} from "./workpaper-classification.js";
import {
  materializeWorkpaperAllocations,
  taxInputAllocationHash,
  workpaperAllocationCoverage,
  WorkpaperAllocationError,
} from "./workpaper-allocation.js";

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
  | "ALLOCATION_INCOMPLETE"
  | "ALLOCATION_NOT_FOUND"
  | "ALLOCATION_SCOPE_INVALID"
  | "NO_SETTLEMENTS"
  | "DUE_DATE_NOT_FOUND"
  | "INTEREST_RULE_NOT_FOUND"
  | "DUPLICATE_WORKPAPER";

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

export class MonthlyWorkpaperService {
  private readonly mutablePreparationStates = [
    "DRAFT",
    "COLLECTING_INPUTS",
    "READY_TO_CALCULATE",
    "CHANGES_REQUESTED",
  ] as const;

  private async selfReviewEnabled(tx: Prisma.TransactionClient, firmId: string) {
    const firm = await tx.firm.findUnique({
      where: { id: firmId },
      select: { allowSelfReview: true },
    });
    return firm?.allowSelfReview === true;
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
      regime: { code: string; taxTypeId: string; taxType: { code: string } };
    }>,
  ) {
    const policies = policiesForObligations(
      obligations.map((obligation) => ({
        taxTypeCode: obligation.regime.taxType.code,
        regimeCode: obligation.regime.code,
      })),
    );
    const evidence = await tx.workpaperImportBatch.findMany({
      where: { workpaperId: workpaper.id },
      include: { importBatch: true },
      orderBy: { createdAt: "asc" },
    });

    return policies.map((policy) => {
      const obligation = obligations.find(
        (item) =>
          item.regime.taxType.code === policy.taxTypeCode &&
          (!policy.regimeCode || item.regime.code === policy.regimeCode),
      );
      const batches = evidence.filter((item) => item.sourceCode === policy.code);
      const reviewed = batches.filter(
        (item) => item.status === "REVIEWED" && item.importBatch.status === "COMMITTED",
      );
      return {
        code: policy.code,
        label: policy.label,
        required: policy.required,
        present: reviewed.length > 0,
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
          createdByUserId: item.importBatch.createdByUserId,
          createdAt: item.createdAt,
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
      include: { regime: { include: { taxType: true } } },
    });
    const [sources, classifications, allocations] = await Promise.all([
      this.sourceCoverage(tx, workpaper, obligations),
      classificationCoverage(tx, workpaper.id),
      workpaperAllocationCoverage(tx, workpaper.id),
    ]);
    const ready =
      sources.every((source) => !source.required || source.present) &&
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
        regime: { include: { taxType: true, jurisdiction: true } },
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
            regime: { include: { taxType: true, jurisdiction: true } },
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
        code: { in: automaticCodes },
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
      where: { workpaperId: input.workpaperId },
      include: { voucher: { include: { components: true } } },
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
                include: { regime: { include: { taxType: true, jurisdiction: true } }, period: true },
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
        include: { regime: { include: { taxType: true } } },
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
      const firm = await tx.firm.findUnique({
        where: { id: ctx.firmId },
        select: { allowSelfReview: true },
      });

      return {
        workpaperId,
        periodStart: wp.periodStart,
        periodEnd: wp.periodEnd,
        allowSelfReview: firm?.allowSelfReview === true,
        components,
        sources,
        classifications: {
          total: classifications.total,
          classified: classifications.classified,
          pending: classifications.pending,
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

  async calculate(ctx: TenantContext, workpaperId: string, input?: { cutoff?: string }) {
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

      const sources = await this.sourceCoverage(
        tx,
        wp,
        links.map((link) => link.obligation),
      );
      const missingSources = sources.filter((source) => source.required && !source.present);
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
      const classificationScope = classifications.items.map((classification) => ({
        voucherId: classification.voucherId,
        documentKind: classification.documentKind,
        activityCode: classification.activityCode,
        categoryCode: classification.categoryCode,
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

      for (const link of links) {
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
            policiesForObligations([
              {
                taxTypeCode: link.obligation.regime.taxType.code,
                regimeCode: link.obligation.regime.code,
              },
            ]).map((policy) => policy.code),
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
          const voucherIds = idsFor("FISCAL_VOUCHER");
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
      const inputHash = taxHash({
        workpaperId: wp.id,
        clientId: wp.clientId,
        periodStart: wp.periodStart.toISOString(),
        periodEnd: wp.periodEnd.toISOString(),
        revision: wp.revision,
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
        !["DRAFT", "COLLECTING_INPUTS", "READY_TO_CALCULATE", "CHANGES_REQUESTED"].includes(
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
      if (isSelfReview && !(await this.selfReviewEnabled(tx, ctx.firmId))) {
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

      await materializeWorkpaperClassifications(tx, link.workpaper, voucherIds);
      await this.ensureAllocations(tx, workpaperId);
      await this.refreshPreparationStatus(tx, link.workpaper);
      if (isSelfReview) {
        await this.auditSelfReview(tx, ctx, "WorkpaperImportBatch", link.id, "SOURCE_REVIEW");
      }

      return reviewed;
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
      return classificationCoverage(tx, workpaperId);
    });
  }

  async classifyVoucher(
    ctx: TenantContext,
    workpaperId: string,
    classificationId: string,
    input: {
      categoryCode?: "SUPER" | "TRANSPORTE";
      activityCode?: string;
      saveSupplierProfile?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const classification = await tx.workpaperVoucherClassification.findFirst({
        where: { id: classificationId, workpaperId, firmId: ctx.firmId },
        include: {
          workpaper: true,
          voucher: { include: { components: true, lines: true } },
        },
      });
      if (!classification) {
        throw new WorkpaperError("CLASSIFICATION_NOT_FOUND", "Clasificación no encontrada");
      }
      if (
        !this.mutablePreparationStates.includes(
          classification.workpaper.status as (typeof this.mutablePreparationStates)[number],
        )
      ) {
        throw new WorkpaperError(
          "WORKPAPER_IMMUTABLE",
          "El expediente no admite cambios de clasificación en su estado actual",
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
            OR: [
              { validTo: null },
              { validTo: { gte: classification.workpaper.periodStart } },
            ],
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
            }),
          },
        });
      }

      await this.refreshPreparationStatus(tx, classification.workpaper);
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
                include: { regime: { include: { taxType: true, jurisdiction: true } } },
              },
              settlement: {
                include: {
                  lines: { orderBy: { position: "asc" } },
                  differences: { orderBy: { createdAt: "asc" } },
                  inputs: { where: { kind: "F931" }, orderBy: { createdAt: "asc" } },
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
      return workpaper.settlements.map((component) => ({
        role: component.role,
        required: component.required,
        obligationId: component.obligationId,
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
              f931Inputs: component.settlement.inputs,
            }
          : null,
      }));
    });
  }

  // ------------------------------------------------------------------
  // Controles tipados
  // ------------------------------------------------------------------

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
      if (finding.severity === "BLOCKING") {
        if (!input.evidenceDocumentId) {
          throw new WorkpaperError(
            "BLOCKING_CONTROLS",
            "Resolver o eximir un control bloqueante exige documentación de respaldo",
          );
        }
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
        include: { settlements: { include: { settlement: true } } },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "CALCULATED" && wp.status !== "CHANGES_REQUESTED") {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          `No se puede enviar a revisión desde ${wp.status}`,
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
      const allowSelfReview = isSelfReview && (await this.selfReviewEnabled(tx, ctx.firmId));
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
      const allowSelfReview = isSelfReview && (await this.selfReviewEnabled(tx, ctx.firmId));
      if (isSelfReview && !allowSelfReview) {
        throw new WorkpaperError(
          "MAKER_CHECKER_VIOLATION",
          "El preparador no puede finalizar su propio expediente",
        );
      }

      // Controles bloqueantes abiertos impiden el cierre.
      const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
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
    input: { taxTypeId?: string; jurisdictionId?: string; from?: string; to?: string },
  ) {
    // El saldo disponible se calcula desde los movimientos confirmados, nunca
    // desde un campo mutable.
    return withTenantContext(ctx, async (tx) => {
      const lots = await tx.taxCreditLot.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
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

      return lots.map((lot) => {
        const applied = lot.movements.reduce(
          (acc, m) => acc.plus(m.amount),
          new Prisma.Decimal(0),
        );
        return {
          id: lot.id,
          taxTypeId: lot.taxTypeId,
          jurisdictionId: lot.jurisdictionId,
          regimeId: lot.regimeId,
          periodId: lot.periodId,
          kind: lot.kind,
          originalAmount: lot.originalAmount.toFixed(4),
          available: lot.originalAmount.minus(applied).toFixed(4),
          verificationStatus: lot.verificationStatus,
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
      const lot = await tx.$queryRaw<Array<{ id: string; originalAmount: Prisma.Decimal }>>`
        SELECT "id", "originalAmount"
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
        select: { amount: true },
      });
      const applied = movements.reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0));
      const delta = newAmount.minus(locked.originalAmount);
      if (delta.isZero()) {
        return { id: locked.id, changed: false, delta: "0.0000" };
      }
      // La corrección no puede dejar el disponible en negativo.
      if (newAmount.minus(applied).lessThan(0)) {
        throw new WorkpaperError(
          "INVALID_TRANSITION",
          "La corrección dejaría el disponible en negativo",
        );
      }
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
            originalAmount: { from: locked.originalAmount.toFixed(4), to: newAmount.toFixed(4) },
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
      if (input.regimeId) {
        const regime = await tx.taxRegime.findFirst({ where: { id: input.regimeId, taxTypeId: input.taxTypeId } });
        if (!regime) throw new WorkpaperError("PERIOD_NOT_FOUND", "El régimen no corresponde al impuesto seleccionado");
        if (regime.code === "CM_ART2" && !input.jurisdictionId) {
          throw new WorkpaperError(
            "INVALID_TRANSITION",
            "El saldo de Convenio Multilateral requiere una jurisdicción",
          );
        }
        if (
          regime.code !== "CM_ART2" &&
          input.jurisdictionId &&
          regime.jurisdictionId !== input.jurisdictionId
        ) {
          throw new WorkpaperError("INVALID_TRANSITION", "La jurisdicción no coincide con el régimen seleccionado");
        }
      }
      if (input.jurisdictionId) {
        const jurisdiction = await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId } });
        if (!jurisdiction || !jurisdiction.isActive) {
          throw new WorkpaperError("PERIOD_NOT_FOUND", "La jurisdicción del saldo no existe o está inactiva");
        }
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
   * Edita los metadatos de un lote de crédito (referencia y/o documento de
   * respaldo). El importe original NO se edita: una corrección de monto se
   * registra como movimiento compensatorio para preservar la inmutabilidad
   * del libro de créditos. Cada edición queda auditada en TaxCreditLotHistory
   * con el usuario, la fecha y el diff de campos modificados.
   */
  async updateCreditLot(
    ctx: TenantContext,
    clientId: string,
    lotId: string,
    input: {
      reference?: string | null;
      evidenceDocumentId?: string | null;
      originalAmount?: string;
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
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      const nextReference = input.reference ?? null;
      const nextEvidence = input.evidenceDocumentId ?? null;
      const nextAmount = input.originalAmount ?? null;

      if ((lot.reference ?? null) !== nextReference) {
        changes.reference = { from: lot.reference ?? null, to: nextReference };
      }
      if ((lot.evidenceDocumentId ?? null) !== nextEvidence) {
        changes.evidenceDocumentId = {
          from: lot.evidenceDocumentId ?? null,
          to: nextEvidence,
        };
      }
      if (nextAmount !== null) {
        const currentAmount = lot.originalAmount.toFixed(4);
        const normalizedNext = new Prisma.Decimal(nextAmount).toFixed(4);
        if (currentAmount !== normalizedNext) {
          changes.originalAmount = { from: currentAmount, to: normalizedNext };
        }
      }

      if (Object.keys(changes).length === 0) {
        // Sin cambios reales: no se registra historial ni se toca la BD.
        return {
          id: lot.id,
          reference: lot.reference,
          evidenceDocumentId: lot.evidenceDocumentId,
          originalAmount: lot.originalAmount.toFixed(4),
          changed: false,
        };
      }

      const updateData: Prisma.TaxCreditLotUpdateInput = {};
      if (nextReference !== undefined) updateData.reference = nextReference;
      if (nextEvidence !== undefined) updateData.evidenceDocumentId = nextEvidence;
      if (changes.originalAmount && nextAmount != null) updateData.originalAmount = nextAmount;

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
          regime: { include: { taxType: true, jurisdiction: true } },
          payments: { where: { status: "PAID" } },
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
      const lots = await tx.taxCreditLot.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { movements: true },
      });

      return obligations.map((obligation) => {
        const settlement = settlements.find((item) => item.regimeId === obligation.regimeId);
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
        const availableCredit = lots
          .filter(
            (lot) =>
              lot.taxTypeId === obligation.regime.taxTypeId &&
              (!lot.regimeId || lot.regimeId === obligation.regimeId) &&
              (!lot.jurisdictionId || lot.jurisdictionId === obligation.regime.jurisdictionId),
          )
          .reduce(
            (sum, lot) =>
              sum.plus(
                lot.originalAmount.minus(
                  lot.movements.reduce((movementSum, movement) => movementSum.plus(movement.amount), new Prisma.Decimal(0)),
                ),
              ),
            new Prisma.Decimal(0),
          );
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
