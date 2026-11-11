import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createUploadSessionSchema } from "@contable/contracts";
import { DocumentService } from "./document-service.js";
import { ExtractionError, ExtractionService } from "./extraction-service.js";
import { ObjectStorage, BUCKETS } from "../storage/object-storage.js";
import { MAX_FILE_SIZE } from "../storage/file-validator.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { outboxPublisher } from "../jobs/outbox-publisher.js";
import { z } from "zod";

const completeUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  objectKey: z.string().min(1).max(500),
}).strict();

/**
 * Rutas de documentos (Fase 4-5).
 * Flujo: crear sesión → subir a cuarentena (firma el navegador) → complete.
 * Fase 5: revisión de extracciones (get, corregir campo, aprobar, rechazar).
 */

export function documentRoutes(app: FastifyInstance) {
  const storage = new ObjectStorage();
  const service = new DocumentService(storage);
  const extractionService = new ExtractionService();

  // Crear sesión de upload (G2-07: el body valida requestItemId obligatorio)
  app.post("/api/v1/firms/:firmId/clients/:clientId/document-upload-sessions", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createUploadSessionSchema.parse(req.body);
    const ctx = tenantContextFromRequest(req);
    const userId = ctx.userId;

    // G2-07: valida que el ítem existe y pertenece al cliente antes de crear la sesión.
    const item = await service.getRequestItem(ctx, body.requestItemId);
    if (!item || item.clientId !== clientId) {
      return reply.status(404).send({ error: { code: "REQUEST_ITEM_NOT_FOUND", message: "Ítem de pedido no encontrado" } });
    }

    const session = await service.createUploadSession(firmId, clientId, userId, {
      ...(body.expectedMime !== undefined ? { expectedMime: body.expectedMime } : {}),
      ...(body.maxFiles !== undefined ? { maxFiles: body.maxFiles } : {}),
      requestItemId: body.requestItemId,
    }, ctx);

    // Generar URL firmada de subida directa a cuarentena
    const objectKey = `${session.id}/${randomUUID()}.bin`;
    const presignedUrl = await storage.getPresignedPutUrl(BUCKETS.quarantine, objectKey, MAX_FILE_SIZE);

    return reply.status(201).send({
      data: {
        sessionId: session.id,
        presignedUrl,
        objectKey,
        maxSizeBytes: MAX_FILE_SIZE,
        expiresAt: session.expiresAt,
      },
    });
  });

  // Completar upload
  app.post("/api/v1/firms/:firmId/clients/:clientId/document-upload-sessions/:sessionId/complete", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = completeUploadSchema.parse(req.body);

    try {
      const ctx = tenantContextFromRequest(req);
      const { document } = await service.completeUpload(sessionId, {
        ...body,
        bucket: BUCKETS.quarantine,
      }, ctx);
      void outboxPublisher.dispatchPending().catch((error) => req.log.error({ error }, "No se pudo despachar el outbox"));
      return reply.status(201).send({ data: { documentId: document.id, status: "UPLOADED" } });
    } catch (err) {
      if (err instanceof Error && err.message === "UPLOAD_SESSION_INVALID") {
        return reply.status(400).send({ error: { code: "UPLOAD_SESSION_INVALID", message: "Sesión inválida o expirada" } });
      }
      if (err instanceof Error && err.message === "REQUEST_ITEM_NOT_PENDING") {
        return reply.status(409).send({ error: { code: "REQUEST_ITEM_NOT_PENDING", message: "El ítem ya fue respondido" } });
      }
      throw err;
    }
  });

  // Listar documentos
  app.get("/api/v1/firms/:firmId/clients/:clientId/documents", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const documents = await service.listDocuments(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data: documents });
  });

  // Obtener documento
  app.get("/api/v1/firms/:firmId/clients/:clientId/documents/:documentId", async (req, reply) => {
    const { firmId, clientId, documentId } = req.params as { firmId: string; clientId: string; documentId: string };
    const document = await service.getDocument(firmId, clientId, documentId, tenantContextFromRequest(req));
    if (!document) {
      return reply.status(404).send({ error: { code: "DOCUMENT_NOT_FOUND", message: "Documento no encontrado" } });
    }
    return reply.send({ data: document });
  });

  // Preview/descarga de un documento subido (URL firmada reautorizada por RLS).
  // Sólo se firma la versión ya validada (antivirus CLEAN, bucket originals);
  // mientras el archivo está en cuarentena devuelve 409.
  app.get("/api/v1/firms/:firmId/clients/:clientId/documents/:documentId/preview", async (req, reply) => {
    const { documentId } = req.params as { documentId: string };
    const preview = await service.getPreviewUrl(tenantContextFromRequest(req), documentId);
    if (!preview) {
      return reply.status(404).send({ error: { code: "DOCUMENT_NOT_FOUND", message: "Documento no encontrado" } });
    }
    return reply.send({ data: preview });
  });

  // F2.2: preview de evidencia de un ítem de pedido (URL firmada reautorizada).
  app.get("/api/v1/firms/:firmId/clients/:clientId/document-request-items/:itemId/preview", async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const preview = await service.getEvidencePreviewUrl(tenantContextFromRequest(req), itemId);
    if (!preview) {
      return reply.status(404).send({ error: { code: "EVIDENCE_NOT_FOUND", message: "Sin evidencia para este ítem" } });
    }
    return reply.send({ data: preview });
  });

  // --- Fase 5: revisión de extracciones ---

  // Obtener la extracción más reciente de un documento
  app.get("/api/v1/firms/:firmId/clients/:clientId/documents/:documentId/extraction", async (req, reply) => {
    const { firmId, clientId, documentId } = req.params as { firmId: string; clientId: string; documentId: string };
    const extraction = await extractionService.getLatestForDocument(firmId, clientId, documentId, tenantContextFromRequest(req));
    if (!extraction) {
      return reply.status(404).send({ error: { code: "EXTRACTION_NOT_FOUND", message: "Sin extracción para este documento" } });
    }
    return reply.send({ data: extraction });
  });

  // Obtener una extracción por id
  app.get("/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId", async (req, reply) => {
    const { firmId, clientId, extractionId } = req.params as { firmId: string; clientId: string; extractionId: string };
    const extraction = await extractionService.getById(firmId, clientId, extractionId, tenantContextFromRequest(req));
    if (!extraction) {
      return reply.status(404).send({ error: { code: "EXTRACTION_NOT_FOUND", message: "Extracción no encontrada" } });
    }
    return reply.send({ data: extraction });
  });

  // Corregir un campo extraído
  app.patch("/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId/fields/:fieldId", async (req, reply) => {
    const { firmId, clientId, extractionId, fieldId } = req.params as {
      firmId: string;
      clientId: string;
      extractionId: string;
      fieldId: string;
    };
    const body = z.object({ correction: z.string().trim().min(1).max(5000), reason: z.string().max(500).optional() }).strict().parse(req.body);
    const userId = tenantContextFromRequest(req).userId;

    if (!body.correction) {
      return reply.status(400).send({ error: { code: "CORRECTION_REQUIRED", message: "Corrección requerida" } });
    }

    try {
      await extractionService.correctField(firmId, clientId, extractionId, fieldId, body.correction, body.reason ?? "", userId, tenantContextFromRequest(req));
      return reply.send({ data: { status: "CORRECTED" } });
    } catch (err) {
      if (err instanceof Error && err.message === "EXTRACTION_NOT_FOUND") {
        return reply.status(404).send({ error: { code: "EXTRACTION_NOT_FOUND", message: "Extracción no encontrada" } });
      }
      if (err instanceof Error && err.message === "FIELD_NOT_FOUND") {
        return reply.status(404).send({ error: { code: "FIELD_NOT_FOUND", message: "Campo no encontrado" } });
      }
      throw err;
    }
  });

  // Aprobar extracción
  app.post("/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId/approve", async (req, reply) => {
    const { firmId, clientId, extractionId } = req.params as { firmId: string; clientId: string; extractionId: string };
    const userId = tenantContextFromRequest(req).userId;

    try {
      await extractionService.approve(firmId, clientId, extractionId, userId, tenantContextFromRequest(req));
      return reply.send({ data: { status: "REVIEWED" } });
    } catch (err) {
      if (err instanceof ExtractionError) {
        return reply.status(409).send({ error: { code: err.code, message: err.message } });
      }
      if (err instanceof Error && err.message === "EXTRACTION_NOT_FOUND") {
        return reply.status(404).send({ error: { code: "EXTRACTION_NOT_FOUND", message: "Extracción no encontrada" } });
      }
      throw err;
    }
  });

  // Rechazar extracción
  app.post("/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId/reject", async (req, reply) => {
    const { firmId, clientId, extractionId } = req.params as { firmId: string; clientId: string; extractionId: string };
    const body = z.object({ reason: z.string().max(500).optional() }).strict().parse(req.body ?? {});
    const userId = tenantContextFromRequest(req).userId;

    try {
      await extractionService.reject(firmId, clientId, extractionId, userId, body.reason, tenantContextFromRequest(req));
      return reply.send({ data: { status: "FAILED" } });
    } catch (err) {
      if (err instanceof ExtractionError) {
        return reply.status(409).send({ error: { code: err.code, message: err.message } });
      }
      if (err instanceof Error && err.message === "EXTRACTION_NOT_FOUND") {
        return reply.status(404).send({ error: { code: "EXTRACTION_NOT_FOUND", message: "Extracción no encontrada" } });
      }
      throw err;
    }
  });
}
