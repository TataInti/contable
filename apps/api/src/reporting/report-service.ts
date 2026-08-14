import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { createHash } from "node:crypto";
import { dec, moneyToString } from "@contable/accounting-engine";

/**
 * Servicio de reportes (Fase 9).
 *
 * Invariantes:
 * - R-001: mismo cutoff produce mismo hash.
 * - R-002: borrador nunca aparece en portal (sólo PUBLISHED).
 * - R-003: publicación inmutable; corrección crea nueva ejecución.
 * - R-004: drill-down hasta evidencia.
 * - R-005: fórmula inválida no compila.
 */

export type ReportErrorCode =
  | "TEMPLATE_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_PUBLISHED"
  | "FORMULA_COMPILE_ERROR"
  | "PUBLICATION_NOT_FOUND"
  | "PUBLICATION_REVOKED";

export class ReportError extends Error {
  readonly code: ReportErrorCode;
  constructor(code: ReportErrorCode, message: string) {
    super(message);
    this.name = "ReportError";
    this.code = code;
  }
}

interface FormulaNode {
  op: "ACCOUNT" | "SUM" | "SUB" | "ADD" | "CONST";
  accountCode?: string;
  children?: FormulaNode[];
  value?: string;
}

export type { FormulaNode };

export class ReportService {
  /** Crea una plantilla con líneas y AST. */
  async createTemplate(
    ctx: TenantContext,
    input: {
      clientId: string;
      code: string;
      name: string;
      kind?: string;
      lines: { position: number; code: string; label: string; formulaAst: FormulaNode; isTotal?: boolean; indent?: number }[];
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      // Validar fórmulas (R-005)
      for (const line of input.lines) {
        this.compileFormula(line.formulaAst);
      }

      return tx.reportTemplate.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          code: input.code,
          name: input.name,
          kind: input.kind ?? "BALANCE",
          lines: {
            create: input.lines.map((l) => ({
              firmId: ctx.firmId,
              clientId: input.clientId,
              position: l.position,
              code: l.code,
              label: l.label,
              formulaAst: l.formulaAst as unknown as Prisma.InputJsonValue,
              isTotal: l.isTotal ?? false,
              indent: l.indent ?? 0,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  /**
   * Ejecuta un run de reporte (R-001: reproducible por templateVersion + cutoff).
   * Calcula cada línea desde el mayor y genera un hash del resultado.
   */
  async runReport(
    ctx: TenantContext,
    input: { clientId: string; templateId: string; cutoff: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const template = await tx.reportTemplate.findFirst({
        where: { id: input.templateId, firmId: ctx.firmId },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      if (!template) throw new ReportError("TEMPLATE_NOT_FOUND", "Plantilla no encontrada");

      const cutoff = new Date(input.cutoff);
      if (Number.isNaN(cutoff.getTime())) {
        throw new ReportError("FORMULA_COMPILE_ERROR", "La fecha de corte es inválida");
      }

      // Saldos por cuenta desde el mayor (posteadas hasta el corte solicitado)
      const lines = await tx.journalLine.findMany({
        where: {
          clientId: input.clientId,
          entry: { status: { in: ["POSTED", "REVERSED"] }, entryDate: { lte: cutoff } },
        },
        include: { account: true },
      });
      const balances = new Map<string, ReturnType<typeof dec>>();
      for (const line of lines) {
        const net = dec(line.debitFunctional.toString()).minus(dec(line.creditFunctional.toString()));
        balances.set(line.account.code, (balances.get(line.account.code) ?? dec(0)).plus(net));
      }

      // Evaluar cada línea
      const resultLines = template.lines.map((l) => {
        const value = this.evaluateFormula(l.formulaAst as unknown as FormulaNode, balances);
        return {
          code: l.code,
          label: l.label,
          value: moneyToString(value),
          isTotal: l.isTotal,
          indent: l.indent,
        };
      });

      const result = {
        templateCode: template.code,
        templateVersion: template.version,
        cutoff: input.cutoff,
        lines: resultLines,
        generatedAt: new Date().toISOString(),
      };

      // R-001: hash reproducible
      const resultHash = createHash("sha256")
        .update(JSON.stringify({ templateCode: template.code, templateVersion: template.version, cutoff: input.cutoff, lines: resultLines }))
        .digest("hex");

      return tx.reportRun.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          templateId: input.templateId,
          templateVersion: template.version,
          cutoff,
          status: "DRAFT",
          resultHash,
          result: result as Prisma.InputJsonValue,
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  async getRun(ctx: TenantContext, clientId: string, runId: string) {
    return withTenantContext(ctx, async (tx) => {
      const run = await tx.reportRun.findFirst({
        where: { id: runId, firmId: ctx.firmId, clientId },
        include: { template: true, publications: true },
      });
      if (!run) throw new ReportError("RUN_NOT_FOUND", "Ejecución no encontrada");
      return run;
    });
  }

  /** Publica un run (R-002: sólo PUBLISHED aparece en portal; R-003: inmutable). */
  async publish(ctx: TenantContext, runId: string) {
    return withTenantContext(ctx, async (tx) => {
      const run = await tx.reportRun.findFirst({ where: { id: runId, firmId: ctx.firmId } });
      if (!run) throw new ReportError("RUN_NOT_FOUND", "Run no encontrado");
      if (run.status === "PUBLISHED") throw new ReportError("RUN_ALREADY_PUBLISHED", "Run ya publicado");

      const updated = await tx.reportRun.update({
        where: { id: runId },
        data: { status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: ctx.userId },
      });

      await tx.reportPublication.create({
        data: {
          firmId: ctx.firmId,
          clientId: run.clientId,
          runId,
          status: "PUBLISHED",
          publishedByUserId: ctx.userId,
        },
      });

      return updated;
    });
  }

  /** Revoca una publicación (R-003: la anterior queda revocada). */
  async revoke(ctx: TenantContext, publicationId: string) {
    return withTenantContext(ctx, async (tx) => {
      const pub = await tx.reportPublication.findFirst({
        where: { id: publicationId, firmId: ctx.firmId },
      });
      if (!pub) throw new ReportError("PUBLICATION_NOT_FOUND", "Publicación no encontrada");
      if (pub.status === "REVOKED") throw new ReportError("PUBLICATION_REVOKED", "Publicación ya revocada");

      await tx.reportPublication.update({
        where: { id: publicationId },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
      });

      return tx.reportRun.update({
        where: { id: pub.runId },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
      });
    });
  }

  /** Publicaciones visibles para el portal (R-002: sólo PUBLISHED). */
  async listPublished(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, async (tx) => {
      return tx.reportPublication.findMany({
        where: { firmId: ctx.firmId, clientId, status: "PUBLISHED" },
        include: { run: true },
        orderBy: { publishedAt: "desc" },
      });
    });
  }

  /** Drill-down: renglón → cuentas → líneas → asiento (R-004). */
  async drillDown(ctx: TenantContext, clientId: string, accountCode: string) {
    return withTenantContext(ctx, async (tx) => {
      const account = await tx.account.findFirst({
        where: { firmId: ctx.firmId, clientId, code: accountCode },
      });
      if (!account) throw new ReportError("TEMPLATE_NOT_FOUND", "Cuenta no encontrada");

      const lines = await tx.journalLine.findMany({
        where: {
          firmId: ctx.firmId,
          clientId,
          accountId: account.id,
          entry: { status: { in: ["POSTED", "REVERSED"] } },
        },
        include: { entry: true },
        orderBy: { position: "asc" },
      });

      return {
        account: { code: account.code, name: account.name },
        lines: lines.map((l) => ({
          entryId: l.entryId,
          entryDate: l.entry.entryDate,
          description: l.entry.description,
          debitFunctional: l.debitFunctional.toString(),
          creditFunctional: l.creditFunctional.toString(),
        })),
      };
    });
  }

  /** Compila una fórmula AST (R-005). */
  private compileFormula(node: FormulaNode): void {
    switch (node.op) {
      case "ACCOUNT":
        if (!node.accountCode) throw new ReportError("FORMULA_COMPILE_ERROR", "ACCOUNT requiere accountCode");
        break;
      case "CONST":
        if (node.value === undefined) throw new ReportError("FORMULA_COMPILE_ERROR", "CONST requiere value");
        break;
      case "SUM":
      case "SUB":
      case "ADD":
        if (!node.children || node.children.length < 2) {
          throw new ReportError("FORMULA_COMPILE_ERROR", `${node.op} requiere al menos 2 hijos`);
        }
        for (const child of node.children) this.compileFormula(child);
        break;
      default:
        throw new ReportError("FORMULA_COMPILE_ERROR", `Operación desconocida: ${node.op}`);
    }
  }

  /** Evalúa una fórmula AST contra saldos. */
  private evaluateFormula(node: FormulaNode, balances: Map<string, ReturnType<typeof dec>>): ReturnType<typeof dec> {
    switch (node.op) {
      case "ACCOUNT":
        return balances.get(node.accountCode ?? "") ?? dec(0);
      case "CONST":
        return dec(node.value ?? "0");
      case "SUM":
        return (node.children ?? []).reduce((acc, c) => acc.plus(this.evaluateFormula(c, balances)), dec(0));
      case "ADD":
        return (node.children ?? []).reduce((acc, c) => acc.plus(this.evaluateFormula(c, balances)), dec(0));
      case "SUB":
        return (node.children ?? []).reduce((acc, c, i) => (i === 0 ? this.evaluateFormula(c, balances) : acc.minus(this.evaluateFormula(c, balances))), dec(0));
      default:
        return dec(0);
    }
  }
}
