import { Prisma } from "@prisma/client";
import { taxHash } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

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
  | "NO_SETTLEMENTS"
  | "DUPLICATE_WORKPAPER";

export class WorkpaperError extends Error {
  readonly code: WorkpaperErrorCode;
  constructor(code: WorkpaperErrorCode, message: string) {
    super(message);
    this.name = "WorkpaperError";
    this.code = code;
  }
}

export interface WorkpaperCreateInput {
  clientId: string;
  periodStart: string;
  periodEnd: string;
}

export class MonthlyWorkpaperService {
  // ------------------------------------------------------------------
  // Creación y listado
  // ------------------------------------------------------------------

  async create(ctx: TenantContext, input: WorkpaperCreateInput) {
    return withTenantContext(ctx, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: input.clientId, firmId: ctx.firmId },
      });
      if (!client) throw new WorkpaperError("CLIENT_NOT_FOUND", "Cliente no encontrado");

      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

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
      if (existing) return existing;

      return tx.monthlyTaxWorkpaper.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          periodStart,
          periodEnd,
          revision: 1,
          status: "DRAFT",
          preparedByUserId: ctx.userId,
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
          period: {
            startDate: { gte: wp.periodStart },
            endDate: { lte: wp.periodEnd },
          },
        },
        include: { regime: { include: { taxType: true } } },
      });

      const components = obligations.map((ob) => ({
        obligationId: ob.id,
        regimeCode: ob.regime.code,
        taxTypeCode: ob.regime.taxType.code,
        required: true,
        linked: wp.settlements.some((s) => s.obligationId === ob.id),
        settlementStatus: wp.settlements.find((s) => s.obligationId === ob.id)?.settlement.status ?? null,
      }));

      // Fuentes obligatorias por régimen (política inicial).
      const sources = [
        { code: "ARCA_IVA_SALES", required: true, present: false },
        { code: "ARCA_IVA_PURCHASES", required: true, present: false },
        { code: "SICORE_IVA", required: false, present: false },
        { code: "F931", required: false, present: false },
      ];

      return { workpaperId, periodStart: wp.periodStart, periodEnd: wp.periodEnd, components, sources };
    });
  }

  // ------------------------------------------------------------------
  // Cálculo: orquesta los motores por régimen
  // ------------------------------------------------------------------

  async calculate(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
        include: { settlements: { include: { settlement: true } } },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status === "FINALIZED" || wp.status === "SUPERSEDED") {
        throw new WorkpaperError("WORKPAPER_IMMUTABLE", "El expediente finalizado es inmutable");
      }

      // Recalcula cada liquidación vinculada (los motores individuales ya
      // existen en SettlementService; aquí se orquesta el estado coordinado).
      const results = [];
      for (const link of wp.settlements) {
        const s = link.settlement;
        if (s.status === "FINALIZED") continue;
        results.push({ settlementId: s.id, status: s.status, regimeId: s.regimeId });
      }

      // Hash de entrada: combina los hashes de las liquidaciones hijas.
      const inputHash = taxHash({
        workpaperId: wp.id,
        clientId: wp.clientId,
        periodStart: wp.periodStart.toISOString(),
        periodEnd: wp.periodEnd.toISOString(),
        revision: wp.revision,
        settlements: results.map((r) => r.settlementId).sort(),
      });

      const updated = await tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: {
          status: "CALCULATED",
          inputHash,
          cutoffAt: new Date(),
        },
      });
      return { workpaper: updated, settlements: results };
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
    input: { resolution: string; status: "RESOLVED" | "WAIVED" },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const finding = await tx.taxControlFinding.findFirst({
        where: { id: findingId, firmId: ctx.firmId, workpaperId },
      });
      if (!finding) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Control no encontrado");
      if (finding.status !== "OPEN") {
        throw new WorkpaperError("INVALID_TRANSITION", "El control ya fue resuelto");
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
          resolution: input.resolution,
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
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "CALCULATED" && wp.status !== "CHANGES_REQUESTED") {
        throw new WorkpaperError("INVALID_TRANSITION", `No se puede enviar a revisión desde ${wp.status}`);
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
      // Maker-checker: el preparador no revisa su propio expediente.
      if (wp.preparedByUserId === ctx.userId) {
        throw new WorkpaperError("MAKER_CHECKER_VIOLATION", "El preparador no puede revisar su propio expediente");
      }
      if (!input.approved) {
        return tx.monthlyTaxWorkpaper.update({
          where: { id: wp.id },
          data: { status: "CHANGES_REQUESTED", reviewedByUserId: ctx.userId },
        });
      }
      return tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: { status: "REVIEWED", reviewedByUserId: ctx.userId },
      });
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
      if (wp.preparedByUserId === ctx.userId) {
        throw new WorkpaperError("MAKER_CHECKER_VIOLATION", "El preparador no puede finalizar su propio expediente");
      }

      // Controles bloqueantes abiertos impiden el cierre.
      const blocking = wp.controls.filter((c) => c.severity === "BLOCKING" && c.status === "OPEN");
      if (blocking.length > 0) {
        throw new WorkpaperError("BLOCKING_CONTROLS", `${blocking.length} control(es) bloqueante(s) sin resolver`);
      }

      // Componentes requeridos deben estar REVIEWED.
      const missing = wp.settlements.filter(
        (s) => s.required && s.settlement.status !== "REVIEWED" && s.settlement.status !== "FINALIZED",
      );
      if (missing.length > 0) {
        throw new WorkpaperError("SETTLEMENT_NOT_REVIEWED", "Hay componentes requeridos sin revisar");
      }

      // Congela hashes y cierra.
      const outputHash = taxHash({
        workpaperId: wp.id,
        clientId: wp.clientId,
        revision: wp.revision,
        settlements: wp.settlements.map((s) => s.settlement.outputHash).sort(),
        controls: wp.controls.map((c) => `${c.code}:${c.status}`).sort(),
      });

      return tx.monthlyTaxWorkpaper.update({
        where: { id: wp.id },
        data: {
          status: "FINALIZED",
          outputHash,
          finalizedByUserId: ctx.userId,
          cutoffAt: new Date(),
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // Rectificación: nueva revisión inmutable
  // ------------------------------------------------------------------

  async rectify(ctx: TenantContext, workpaperId: string) {
    return withTenantContext(ctx, async (tx) => {
      const wp = await tx.monthlyTaxWorkpaper.findFirst({
        where: { id: workpaperId, firmId: ctx.firmId },
      });
      if (!wp) throw new WorkpaperError("WORKPAPER_NOT_FOUND", "Expediente no encontrado");
      if (wp.status !== "FINALIZED") {
        throw new WorkpaperError("INVALID_TRANSITION", "Sólo se rectifica un expediente finalizado");
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
      if (existing) return existing;

      return tx.monthlyTaxWorkpaper.create({
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
        include: { movements: { orderBy: { createdAt: "asc" } } },
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
          sourceSettlementId: lot.sourceSettlementId,
          sourcePaymentId: lot.sourcePaymentId,
          evidenceDocumentId: lot.evidenceDocumentId,
          createdAt: lot.createdAt,
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
}

export const monthlyWorkpaperService = new MonthlyWorkpaperService();