import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de gastos gerenciales (G2-08).
 *
 * Invariantes (PLAN §7.5):
 * - Por defecto taxTreatment = MANAGEMENT_ONLY: afecta rentabilidad, nunca
 *   reduce impuestos.
 * - FISCAL_COMPUTABLE exige una decisión profesional con regla vigente,
 *   motivo, evidencia y revisor distinto.
 * - Estados: DRAFT → PENDING_REVIEW → APPROVED | REJECTED → SUPERSEDED.
 */

export type ExpenseErrorCode =
  | "EXPENSE_NOT_FOUND"
  | "EXPENSE_IMMUTABLE"
  | "DECISION_REQUIRES_REASON"
  | "DECISION_REQUIRES_REVIEW"
  | "DECISION_LOCKED"
  | "MAKER_REVIEWER_SAME";

export class ExpenseError extends Error {
  readonly code: ExpenseErrorCode;
  constructor(code: ExpenseErrorCode, message: string) {
    super(message);
    this.name = "ExpenseError";
    this.code = code;
  }
}

export class ManagementExpenseService {
  /** Crea un gasto gerencial (estado DRAFT, tratamiento MANAGEMENT_ONLY). */
  async create(
    ctx: TenantContext,
    input: {
      clientId: string;
      description: string;
      amount: string;
      currency?: string;
      incurredOn: string;
      paidOn?: string;
      category?: string;
      hasFiscalSupport: boolean;
    },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.managementExpense.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          description: input.description,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency ?? "ARS",
          incurredOn: new Date(input.incurredOn),
          ...(input.paidOn ? { paidOn: new Date(input.paidOn) } : {}),
          ...(input.category ? { category: input.category } : {}),
          hasFiscalSupport: input.hasFiscalSupport,
          taxTreatment: "MANAGEMENT_ONLY",
          status: input.hasFiscalSupport ? "APPROVED" : "PENDING_REVIEW",
          createdByUserId: ctx.userId,
        },
      }),
    );
  }

  /** Envía a revisión (sólo desde DRAFT). */
  async submitForReview(ctx: TenantContext, expenseId: string) {
    return withTenantContext(ctx, async (tx) => {
      const expense = await tx.managementExpense.findFirst({
        where: { id: expenseId, firmId: ctx.firmId },
      });
      if (!expense) throw new ExpenseError("EXPENSE_NOT_FOUND", "Gasto no encontrado");
      if (expense.status !== "DRAFT") {
        throw new ExpenseError("EXPENSE_IMMUTABLE", `El gasto está en estado ${expense.status}`);
      }
      return tx.managementExpense.update({
        where: { id: expenseId },
        data: { status: "PENDING_REVIEW" },
      });
    });
  }

  /**
   * G2-08: decisión profesional de tratamiento fiscal.
   * FISCAL_COMPUTABLE exige: regla vigente, motivo, evidencia y revisor
   * distinto del profesional que decide.
   */
  async approveTreatment(
    ctx: TenantContext,
    input: {
      expenseId: string;
      treatment: "MANAGEMENT_ONLY" | "FISCAL_COMPUTABLE" | "FISCAL_NON_COMPUTABLE" | "PENDING_PROFESSIONAL_DECISION";
      reason: string;
      ruleVersionId?: string;
      evidenceDocumentId?: string;
      reviewedByUserId: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const expense = await tx.managementExpense.findFirst({
        where: { id: input.expenseId, firmId: ctx.firmId },
      });
      if (!expense) throw new ExpenseError("EXPENSE_NOT_FOUND", "Gasto no encontrado");
      if (expense.status !== "PENDING_REVIEW" && expense.status !== "DRAFT") {
        throw new ExpenseError("EXPENSE_IMMUTABLE", `El gasto está en estado ${expense.status}`);
      }
      if (!input.reason.trim()) {
        throw new ExpenseError("DECISION_REQUIRES_REASON", "La decisión exige un motivo");
      }
      if (input.treatment === "FISCAL_COMPUTABLE" && !input.ruleVersionId) {
        throw new ExpenseError(
          "DECISION_REQUIRES_REASON",
          "FISCAL_COMPUTABLE exige una regla vigente aprobada",
        );
      }
      // Maker-checker: el profesional no puede ser su propio revisor.
      if (input.reviewedByUserId === ctx.userId) {
        throw new ExpenseError("MAKER_REVIEWER_SAME", "El profesional no puede revisar su propia decisión");
      }

      // Verifica que la regla existe y está activa/aprobada.
      if (input.ruleVersionId) {
        const rule = await tx.taxRuleVersion.findFirst({
          where: { id: input.ruleVersionId, status: { in: ["ACTIVE", "APPROVED"] } },
        });
        if (!rule) {
          throw new ExpenseError(
            "DECISION_REQUIRES_REASON",
            "La regla no está activa o aprobada",
          );
        }
      }

      const decision = await tx.taxTreatmentDecision.create({
        data: {
          firmId: ctx.firmId,
          clientId: expense.clientId,
          expenseId: expense.id,
          ...(input.ruleVersionId ? { ruleVersionId: input.ruleVersionId } : {}),
          treatment: input.treatment,
          reason: input.reason,
          ...(input.evidenceDocumentId ? { evidenceDocumentId: input.evidenceDocumentId } : {}),
          decidedByUserId: ctx.userId,
          reviewedByUserId: input.reviewedByUserId,
        },
      });

      // Si FISCAL_COMPUTABLE, se deriva un ajuste fiscal trazable (G2-09).
      if (input.treatment === "FISCAL_COMPUTABLE") {
        await tx.taxAdjustment.create({
          data: {
            firmId: ctx.firmId,
            clientId: expense.clientId,
            ...(input.ruleVersionId ? { ruleVersionId: input.ruleVersionId } : {}),
            concept: "GASTO_GERENCIAL_COMPUTABLE",
            amount: expense.amount,
            reason: input.reason,
            treatmentDecisionId: decision.id,
            createdByUserId: ctx.userId,
          },
        });
      }

      return tx.managementExpense.update({
        where: { id: expense.id },
        data: { status: "APPROVED", taxTreatment: input.treatment, reviewedByUserId: input.reviewedByUserId },
      });
    });
  }

  /** Rechaza el gasto (desde PENDING_REVIEW o DRAFT). */
  async reject(ctx: TenantContext, expenseId: string, comment: string) {
    return withTenantContext(ctx, async (tx) => {
      const expense = await tx.managementExpense.findFirst({
        where: { id: expenseId, firmId: ctx.firmId },
      });
      if (!expense) throw new ExpenseError("EXPENSE_NOT_FOUND", "Gasto no encontrado");
      if (expense.status === "APPROVED" || expense.status === "REJECTED") {
        throw new ExpenseError("EXPENSE_IMMUTABLE", `El gasto está en estado ${expense.status}`);
      }
      return tx.managementExpense.update({
        where: { id: expenseId },
        data: { status: "REJECTED" },
      });
    });
  }

  async list(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.managementExpense.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { decisions: true },
        orderBy: { incurredOn: "desc" },
        take: 500,
      }),
    );
  }
}