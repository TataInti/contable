import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseSifereWorkbook, buildSifereTemplate, SifereParseError } from "@contable/tax-engine";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { IngestionService, ImportError } from "./ingestion-service.js";
import { ManagementExpenseService, ExpenseError } from "./management-expense-service.js";
import { ManagementIncomeService, ManagementIncomeError } from "./management-income-service.js";

/**
 * Rutas de ingestión y subledger fiscal (Puerta 2).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 *
 * G2-01: import batches.
 * G2-02/03: validación con adaptadores ARCA.
 * G2-04: vouchers.
 * G2-08: gastos gerenciales.
 * G2-09: revisión independiente.
 * G2-10: commit atómico e idempotente.
 */

export function ingestionRoutes(app: FastifyInstance) {
  const ingestion = new IngestionService();
  const expenses = new ManagementExpenseService();
  const incomes = new ManagementIncomeService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof ImportError || err instanceof ExpenseError || err instanceof ManagementIncomeError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // ------------------------------------------------------------------
  // G2-01: Lotes de importación
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        origin: z.string().min(1).max(80),
        taxTypeId: z.string().uuid(),
        periodId: z.string().uuid(),
        adapterVersion: z.string().min(1).max(80),
        fileName: z.string().max(240).optional(),
        fileHash: z.string().max(128).optional(),
        workpaperId: z.string().uuid().optional(),
        sourceCode: z.string().min(1).max(80).optional(),
      })
      .strict()
      .refine((value) => Boolean(value.workpaperId) === Boolean(value.sourceCode), {
        message: "El expediente y el código de fuente deben informarse juntos",
      })
      .parse(req.body);
    try {
      const data = await ingestion.createBatch(ctx, {
        clientId: ctx.clientId!,
        origin: body.origin,
        taxTypeId: body.taxTypeId,
        periodId: body.periodId,
        adapterVersion: body.adapterVersion,
        ...(body.fileName ? { fileName: body.fileName } : {}),
        ...(body.fileHash ? { fileHash: body.fileHash } : {}),
        ...(body.workpaperId ? { workpaperId: body.workpaperId } : {}),
        ...(body.sourceCode ? { sourceCode: body.sourceCode } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/validate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    const body = z
      .object({
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.validateBatch(ctx, batchId, body.rows);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/commit", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    const body = z.object({ clientCuit: z.string().regex(/^\d{11}$/) }).strict().parse(req.body ?? {});
    try {
      const data = await ingestion.commitBatch(ctx, batchId, body.clientCuit);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/rows", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    try {
      const data = await ingestion.listBatchRows(ctx, batchId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // G2-05: reconciliación del lote contra los vouchers comiteados.
  app.get("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/reconcile", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    try {
      const data = await ingestion.reconcileBatch(ctx, batchId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // Análisis de libros IVA digital (.xlsx) — sin persistir
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/sifere/analyze", async (req, reply) => {
    const body = z
      .object({
        direction: z.enum(["SALE", "PURCHASE"]),
        base64: z.string().min(1),
      })
      .strict()
      .parse(req.body);
    let raw: Uint8Array;
    try {
      const buffer = Buffer.from(body.base64, "base64");
      raw = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      return reply.status(400).send({
        error: { code: "INVALID_BASE64", message: "El archivo no está codificado en base64" },
      });
    }
    try {
      const data = parseSifereWorkbook(raw, body.direction);
      // Las filas se exponen sin su payload completo para no duplicar los
      // comprobantes en el cliente: el análisis devuelve resumen y la lista de
      // entradas normalizadas listas para importar.
      return reply.send({
        data: {
          direction: data.direction,
          sheetName: data.sheetName,
          headers: data.headers,
          totals: data.totals,
          rates: data.rates,
          taxes: data.taxes,
          detailRows: data.detailRows,
          validRows: data.validRows,
          errorRows: data.errorRows,
          rows: data.rows.map((row) => ({
            index: row.index,
            name: row.name,
            rubro: row.rubro,
            input: row.input,
            errors: row.errors,
          })),
        },
      });
    } catch (err) {
      if (err instanceof SifereParseError) {
        return reply.status(422).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // Persistencia en un paso: parsea el .xlsx, crea el lote, valida y comitea.
  app.post("/api/v1/firms/:firmId/clients/:clientId/sifere/import", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        direction: z.enum(["SALE", "PURCHASE"]),
        base64: z.string().min(1),
        fileName: z.string().max(240),
        fileHash: z.string().max(128),
        taxTypeId: z.string().uuid(),
        periodId: z.string().uuid(),
        clientCuit: z.string().regex(/^\d{11}$/),
        workpaperId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    let raw: Uint8Array;
    try {
      const buffer = Buffer.from(body.base64, "base64");
      raw = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      return reply.status(400).send({
        error: { code: "INVALID_BASE64", message: "El archivo no está codificado en base64" },
      });
    }
    try {
      const data = await ingestion.importSifereWorkbook(ctx, {
        clientId: ctx.clientId!,
        clientCuit: body.clientCuit,
        direction: body.direction,
        raw,
        fileName: body.fileName,
        fileHash: body.fileHash,
        taxTypeId: body.taxTypeId,
        periodId: body.periodId,
        ...(body.workpaperId ? { workpaperId: body.workpaperId } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      if (err instanceof SifereParseError) {
        return reply.status(422).send({ error: { code: err.code, message: err.message } });
      }
      return handleError(reply, err);
    }
  });

  // Plantilla modelo (.xlsx) para ordenar los libros antes de importar.
  app.get("/api/v1/firms/:firmId/clients/:clientId/sifere/template", async (req, reply) => {
    const q = z.object({ direction: z.enum(["SALE", "PURCHASE"]) }).parse(req.query);
    const bytes = buildSifereTemplate(q.direction);
    const name = q.direction === "SALE" ? "modelo-ventas.xlsx" : "modelo-compras.xlsx";
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });

  // ------------------------------------------------------------------
  // G2-04: Vouchers fiscales
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/vouchers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({
        direction: z.enum(["PURCHASE", "SALE"]).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .parse(req.query);
    try {
      const data = await ingestion.listVouchers(ctx, ctx.clientId!, q.direction, q.from, q.to);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        direction: z.enum(["PURCHASE", "SALE"]),
        type: z.string().min(1).max(10),
        letter: z.string().max(1).optional(),
        pointOfSale: z.number().int().nonnegative(),
        number: z.number().int().nonnegative(),
        issuerCuit: z.string().regex(/^\d{11}$/),
        receiverCuit: z.string().regex(/^\d{11}$/),
        issuedOn: z.string().date(),
        currency: z.string().length(3).optional(),
        exchangeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        total: z.string().regex(/^\d+(\.\d+)?$/),
        documentId: z.string().uuid().optional(),
        periodId: z.string().uuid().optional(),
        components: z
          .array(z.object({
            concept: z.string().min(1).max(80),
            base: z.string().regex(/^\d+(\.\d+)?$/),
            rate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
            amount: z.string().regex(/^\d+(\.\d+)?$/),
          }).strict())
          .min(1)
          .max(50),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.createVoucher(ctx, {
        clientId: ctx.clientId!,
        direction: body.direction,
        type: body.type,
        pointOfSale: body.pointOfSale,
        number: body.number,
        issuerCuit: body.issuerCuit,
        receiverCuit: body.receiverCuit,
        issuedOn: body.issuedOn,
        total: body.total,
        components: body.components.map((c) => ({
          concept: c.concept,
          base: c.base,
          amount: c.amount,
          ...(c.rate ? { rate: c.rate } : {}),
        })),
        ...(body.letter ? { letter: body.letter } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.exchangeRate ? { exchangeRate: body.exchangeRate } : {}),
        ...(body.documentId ? { documentId: body.documentId } : {}),
        ...(body.periodId ? { periodId: body.periodId } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // G2-09: revisión independiente de voucher
  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    const body = z
      .object({
        approve: z.boolean(),
        comment: z.string().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.reviewVoucher(ctx, voucherId, body.approve, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // C-2: transiciones separadas para vouchers (submit-review / approve / reject)
  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    try {
      const data = await ingestion.submitVoucherForReview(ctx, voucherId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/approve", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    try {
      const data = await ingestion.approveVoucher(ctx, voucherId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/reject", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    const body = z
      .object({ comment: z.string().max(500).optional() })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.rejectVoucher(ctx, voucherId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G2-03: Retenciones y percepciones
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/withholdings", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .parse(req.query);
    try {
      const data = await ingestion.listWithholdings(ctx, ctx.clientId!, q.from, q.to);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/perceptions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .parse(req.query);
    try {
      const data = await ingestion.listPerceptions(ctx, ctx.clientId!, q.from, q.to);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G2-08: Gastos gerenciales
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/management-expenses", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .parse(req.query);
    try {
      const data = await expenses.list(ctx, ctx.clientId!, q.from, q.to);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        description: z.string().min(1).max(300),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        currency: z.string().length(3).optional(),
        incurredOn: z.string().date(),
        paidOn: z.string().date().optional(),
        category: z.string().max(120).optional(),
        hasFiscalSupport: z.boolean(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.create(ctx, {
        clientId: ctx.clientId!,
        description: body.description,
        amount: body.amount,
        incurredOn: body.incurredOn,
        hasFiscalSupport: body.hasFiscalSupport,
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.paidOn ? { paidOn: body.paidOn } : {}),
        ...(body.category ? { category: body.category } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/approve-treatment", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    const body = z
      .object({
        treatment: z.enum(["MANAGEMENT_ONLY", "FISCAL_COMPUTABLE", "FISCAL_NON_COMPUTABLE", "PENDING_PROFESSIONAL_DECISION"]),
        reason: z.string().min(10).max(1000),
        ruleVersionId: z.string().uuid().optional(),
        evidenceDocumentId: z.string().uuid().optional(),
        reviewedByUserId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.approveTreatment(ctx, {
        expenseId,
        treatment: body.treatment,
        reason: body.reason,
        reviewedByUserId: body.reviewedByUserId,
        ...(body.ruleVersionId ? { ruleVersionId: body.ruleVersionId } : {}),
        ...(body.evidenceDocumentId ? { evidenceDocumentId: body.evidenceDocumentId } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // C-3: transiciones separadas para gastos gerenciales (submit-review / reject)
  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    try {
      const data = await expenses.submitForReview(ctx, expenseId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/reject", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    const body = z
      .object({ comment: z.string().min(1).max(500) })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.reject(ctx, expenseId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // C (§7.1): Ingresos gerenciales — nunca crean comprobante fiscal.
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/management-incomes", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        status: z.string().optional(),
      })
      .parse(req.query);
    try {
      const data = await incomes.list(ctx, ctx.clientId!, {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.status ? { status: q.status } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-incomes", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        description: z.string().min(1).max(300),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        currency: z.string().length(3).optional(),
        accruedOn: z.string().date(),
        collectedOn: z.string().date().optional(),
        category: z.string().max(120).optional(),
        evidenceDocumentId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await incomes.create(ctx, {
        clientId: ctx.clientId!,
        description: body.description,
        amount: body.amount,
        accruedOn: body.accruedOn,
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.collectedOn ? { collectedOn: body.collectedOn } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.evidenceDocumentId ? { evidenceDocumentId: body.evidenceDocumentId } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/firms/:firmId/clients/:clientId/management-incomes/:incomeId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { incomeId } = req.params as { incomeId: string };
    const body = z
      .object({
        description: z.string().min(1).max(300).optional(),
        amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        accruedOn: z.string().date().optional(),
        collectedOn: z.string().date().nullable().optional(),
        category: z.string().max(120).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await incomes.update(ctx, incomeId, {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.accruedOn !== undefined ? { accruedOn: body.accruedOn } : {}),
        ...(body.collectedOn !== undefined ? { collectedOn: body.collectedOn } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-incomes/:incomeId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { incomeId } = req.params as { incomeId: string };
    try {
      const data = await incomes.submitForReview(ctx, incomeId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-incomes/:incomeId/approve", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { incomeId } = req.params as { incomeId: string };
    try {
      const data = await incomes.approve(ctx, incomeId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-incomes/:incomeId/reject", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { incomeId } = req.params as { incomeId: string };
    const body = z
      .object({ comment: z.string().min(1).max(1000) })
      .strict()
      .parse(req.body);
    try {
      const data = await incomes.reject(ctx, incomeId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
