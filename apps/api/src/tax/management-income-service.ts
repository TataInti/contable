import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de ingresos gerenciales (C, plan piloto fiscal §7.1).
 *
 * Invariantes:
 * - Un ingreso gerencial NUNCA crea comprobante, componente ni ajuste
 *   fiscal: vive sólo en el dominio gerencial (rentabilidad).
 * - Ciclo: DRAFT → PENDING_REVIEW → APPROVED | REJECTED.
 * - Maker-checker: quien creó el ingreso no puede aprobarlo.
 * - El rechazo exige comentario.
 * - Una versión aprobada no se modifica silenciosamente (inmutable).
 */

export type IncomeErrorCode =
  | "INCOME_NOT_FOUND"
  | "INCOME_IMMUTABLE"
  | "INVALID_TRANSITION"
  | "COMMENT_REQUIRED"
  | "MAKER_CHECKER_VIOLATION"
  | "EVIDENCE_NOT_FOUND";

export class ManagementIncomeError extends Error {
  readonly code: IncomeErrorCode;
  constructor(code: IncomeErrorCode, message: string) {
    super(message);
    this.name = "ManagementIncomeError";
    this.code = code;
  }
}

export class ManagementIncomeService {
  /** Alta en DRAFT con fecha devengada, cobro opcional, categoría, moneda e importe. */
  async create(
    ctx: TenantContext,
    input: {
      clientId: string;
      description: string;
      amount: string;
      currency?: string;
      accruedOn: string;
      collectedOn?: string;
      category?: string;
      evidenceDocumentId?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      if (input.evidenceDocumentId) {
        const document = await tx.document.findFirst({
          where: {
            id: input.evidenceDocumentId,
            firmId: ctx.firmId,
            clientId: input.clientId,
            status: "READY",
          },
        });
        if (!document) {
          throw new ManagementIncomeError(
            "EVIDENCE_NOT_FOUND",
            "El documento de respaldo no existe o no está READY",
          );
        }
      }
      return tx.managementIncome.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          description: input.description,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency ?? "ARS",
          accruedOn: new Date(input.accruedOn),
          ...(input.collectedOn ? { collectedOn: new Date(input.collectedOn) } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.evidenceDocumentId ? { evidenceDocumentId: input.evidenceDocumentId } : {}),
          status: "DRAFT",
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /** Envía a revisión (DRAFT → PENDING_REVIEW). */
  async submitForReview(ctx: TenantContext, incomeId: string) {
    return withTenantContext(ctx, async (tx) => {
      const income = await tx.managementIncome.findFirst({
        where: { id: incomeId, firmId: ctx.firmId },
      });
      if (!income) throw new ManagementIncomeError("INCOME_NOT_FOUND", "Ingreso no encontrado");
      if (income.status !== "DRAFT") {
        throw new ManagementIncomeError(
          "INVALID_TRANSITION",
          `Sólo un ingreso DRAFT puede enviarse a revisión (estado actual: ${income.status})`,
        );
      }
      return tx.managementIncome.update({
        where: { id: incomeId },
        data: { status: "PENDING_REVIEW" },
      });
    });
  }

  /** Aprueba el ingreso (PENDING_REVIEW → APPROVED). Maker-checker. */
  async approve(ctx: TenantContext, incomeId: string) {
    return withTenantContext(ctx, async (tx) => {
      const income = await tx.managementIncome.findFirst({
        where: { id: incomeId, firmId: ctx.firmId },
      });
      if (!income) throw new ManagementIncomeError("INCOME_NOT_FOUND", "Ingreso no encontrado");
      if (income.status !== "PENDING_REVIEW") {
        throw new ManagementIncomeError(
          "INVALID_TRANSITION",
          `Sólo un ingreso PENDING_REVIEW puede aprobarse (estado actual: ${income.status})`,
        );
      }
      if (income.createdByUserId === ctx.userId) {
        throw new ManagementIncomeError(
          "MAKER_CHECKER_VIOLATION",
          "El usuario que creó el ingreso no puede aprobarlo",
        );
      }
      return tx.managementIncome.update({
        where: { id: incomeId },
        data: { status: "APPROVED", reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** Rechaza con comentario obligatorio (PENDING_REVIEW → REJECTED). */
  async reject(ctx: TenantContext, incomeId: string, comment: string) {
    return withTenantContext(ctx, async (tx) => {
      const income = await tx.managementIncome.findFirst({
        where: { id: incomeId, firmId: ctx.firmId },
      });
      if (!income) throw new ManagementIncomeError("INCOME_NOT_FOUND", "Ingreso no encontrado");
      if (income.status !== "PENDING_REVIEW") {
        throw new ManagementIncomeError(
          "INVALID_TRANSITION",
          `Sólo un ingreso PENDING_REVIEW puede rechazarse (estado actual: ${income.status})`,
        );
      }
      if (!comment.trim()) {
        throw new ManagementIncomeError("COMMENT_REQUIRED", "El rechazo exige comentario");
      }
      return tx.managementIncome.update({
        where: { id: incomeId },
        data: {
          status: "REJECTED",
          rejectionComment: comment,
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
        },
      });
    });
  }

  /**
   * Edita un ingreso NO aprobado. Una versión aprobada no se modifica
   * silenciosamente: exige crear una nueva versión (inmutabilidad).
   */
  async update(
    ctx: TenantContext,
    incomeId: string,
    input: {
      description?: string;
      amount?: string;
      accruedOn?: string;
      collectedOn?: string | null;
      category?: string | null;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const income = await tx.managementIncome.findFirst({
        where: { id: incomeId, firmId: ctx.firmId },
      });
      if (!income) throw new ManagementIncomeError("INCOME_NOT_FOUND", "Ingreso no encontrado");
      if (income.status === "APPROVED" || income.status === "REJECTED") {
        throw new ManagementIncomeError(
          "INCOME_IMMUTABLE",
          `Un ingreso ${income.status} no se modifica; creá una nueva versión`,
        );
      }
      const data: Prisma.ManagementIncomeUpdateInput = {};
      if (input.description !== undefined) data.description = input.description;
      if (input.amount !== undefined) data.amount = new Prisma.Decimal(input.amount);
      if (input.accruedOn !== undefined) data.accruedOn = new Date(input.accruedOn);
      if (input.collectedOn !== undefined) {
        data.collectedOn = input.collectedOn === null ? null : new Date(input.collectedOn);
      }
      if (input.category !== undefined) data.category = input.category;
      return tx.managementIncome.update({ where: { id: incomeId }, data });
    });
  }

  /** Lista ingresos del cliente con filtros opcionales de fechas y estado. */
  async list(
    ctx: TenantContext,
    clientId: string,
    filters: { from?: string; to?: string; status?: string } = {},
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.managementIncome.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          ...(filters.from || filters.to
            ? {
                accruedOn: {
                  ...(filters.from ? { gte: new Date(filters.from) } : {}),
                  ...(filters.to ? { lte: new Date(filters.to) } : {}),
                },
              }
            : {}),
          ...(filters.status
            ? { status: filters.status as Prisma.EnumManagementExpenseStatusFilter }
            : {}),
        },
        orderBy: { accruedOn: "desc" },
        take: 200,
      }),
    );
  }
}

export const managementIncomeService = new ManagementIncomeService();
