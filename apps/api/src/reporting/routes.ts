import type { FastifyInstance } from "fastify";
import { ReportService, ReportError, type FormulaNode } from "./report-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { withTenantContext } from "../auth/tenant.js";
import { z } from "zod";
import { exportReport, REPORT_CONTENT_TYPES, type ExportReportResult } from "./report-export.js";

/**
 * Rutas de reportes y publicación (Fase 9).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function reportingRoutes(app: FastifyInstance) {
  const reports = new ReportService();
  const tenantCtx = tenantContextFromRequest;

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof ReportError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // Crear plantilla
  app.get("/api/v1/firms/:firmId/clients/:clientId/report-templates", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.reportTemplate.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { lines: { orderBy: { position: "asc" } } },
      orderBy: { name: "asc" }, take: 100,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/report-runs", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.reportRun.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { template: true, publications: true },
      orderBy: { createdAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/report-templates", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const formula: z.ZodTypeAny = z.lazy(() => z.object({
      op: z.enum(["ACCOUNT", "SUM", "SUB", "ADD", "CONST"]), accountCode: z.string().max(80).optional(),
      children: z.array(formula).max(100).optional(), value: z.string().max(80).optional(),
    }).strict());
    const body = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), kind: z.string().max(40).optional(),
      lines: z.array(z.object({ position: z.number().int().positive(), code: z.string().min(1).max(80), label: z.string().min(1).max(200), formulaAst: formula, isTotal: z.boolean().optional(), indent: z.number().int().min(0).max(10).optional() }).strict()).min(1).max(500),
    }).strict().parse(req.body);
    try {
      const template = await reports.createTemplate(tenantCtx(req), {
        clientId, code: body.code, name: body.name,
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        lines: body.lines.map((line) => ({
          position: line.position, code: line.code, label: line.label,
          formulaAst: line.formulaAst as FormulaNode,
          ...(line.isTotal !== undefined ? { isTotal: line.isTotal } : {}),
          ...(line.indent !== undefined ? { indent: line.indent } : {}),
        })),
      });
      return reply.status(201).send({ data: template });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Ejecutar run
  app.post("/api/v1/firms/:firmId/clients/:clientId/report-runs", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ templateId: z.string().uuid(), cutoff: z.string().date() }).strict().parse(req.body);
    try {
      const run = await reports.runReport(tenantCtx(req), { ...body, clientId });
      return reply.status(201).send({ data: run });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/report-runs/:runId/export", async (req, reply) => {
    const { clientId, runId } = req.params as { clientId: string; runId: string };
    const { format } = z.object({ format: z.enum(["csv", "xlsx", "pdf"]).default("pdf") }).parse(req.query);
    const run = await reports.getRun(tenantCtx(req), clientId, runId);
    const buffer = await exportReport((run.result ?? {}) as ExportReportResult, format);
    const filename = `reporte-${run.template.code}-${run.cutoff.toISOString().slice(0, 10)}.${format}`;
    return reply
      .header("Content-Type", REPORT_CONTENT_TYPES[format])
      .header("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`)
      .header("Cache-Control", "private, no-store")
      .send(buffer);
  });

  // Publicar run
  app.post("/api/v1/firms/:firmId/clients/:clientId/report-runs/:runId/publish", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    try {
      const run = await reports.publish(tenantCtx(req), runId);
      return reply.send({ data: run });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Revocar publicación
  app.post("/api/v1/firms/:firmId/clients/:clientId/report-publications/:publicationId/revoke", async (req, reply) => {
    const { publicationId } = req.params as { publicationId: string };
    try {
      const run = await reports.revoke(tenantCtx(req), publicationId);
      return reply.send({ data: run });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Publicaciones visibles (portal)
  app.get("/api/v1/firms/:firmId/clients/:clientId/report-publications", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const pubs = await reports.listPublished(tenantCtx(req), clientId);
    return reply.send({ data: pubs });
  });

  // Drill-down
  app.get("/api/v1/firms/:firmId/clients/:clientId/reports/drill-down/:accountCode", async (req, reply) => {
    const { clientId, accountCode } = req.params as { clientId: string; accountCode: string };
    try {
      const data = await reports.drillDown(tenantCtx(req), clientId, accountCode);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
