import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { safeBaseName } from "../storage/file-validator.js";
import { validateFile } from "../storage/file-validator.js";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de documentos (Fase 4).
 * Flujo: upload session → subida a cuarentena → complete → worker valida/promueve.
 */

export const UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class DocumentService {
  constructor(private storage: ObjectStorage) {}

  /** Crea una sesión de upload para un cliente autorizado. */
  async createUploadSession(firmId: string, clientId: string, userId: string, opts: { expectedMime?: string; maxFiles?: number; requestItemId?: string; category?: string } = {}, ctx?: TenantContext) {
    const data: Prisma.UploadSessionUncheckedCreateInput = {
      firmId,
      clientId,
      userId,
      status: "PENDING",
      maxSizeBytes: MAX_UPLOAD_BYTES,
      maxFiles: opts.maxFiles ?? 1,
      expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
    };
    if (opts.expectedMime !== undefined) data.expectedMime = opts.expectedMime;
    if (opts.requestItemId !== undefined) data.requestItemId = opts.requestItemId;
    if (opts.category !== undefined) data.category = opts.category;

    return ctx
      ? withTenantContext(ctx, (tx) => tx.uploadSession.create({ data }))
      : prisma.uploadSession.create({ data });
  }

  /** Registra el documento y la versión de archivo tras la subida a cuarentena. */
  async completeUpload(
    sessionId: string,
    input: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      bucket: string;
      objectKey: string;
    },
    ctx?: TenantContext,
  ) {
    const object = await this.storage.get(input.bucket as "quarantine", input.objectKey);
    const validation = validateFile(object, input.mimeType, input.originalName, { maxSize: MAX_UPLOAD_BYTES });
    if (!validation.ok || !validation.sha256 || !validation.detectedMime) {
      throw new Error(`FILE_INVALID:${validation.error ?? "unknown"}`);
    }
    if (input.sizeBytes !== object.length) throw new Error("FILE_SIZE_MISMATCH");
    if (input.sha256 && input.sha256 !== validation.sha256) throw new Error("CHECKSUM_MISMATCH");
    const detectedMime = validation.detectedMime;
    const verifiedSha256 = validation.sha256;

    const run = async (tx: Prisma.TransactionClient) => {
      const session = await tx.uploadSession.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== "PENDING" || session.expiresAt < new Date()) {
        throw new Error("UPLOAD_SESSION_INVALID");
      }
      if (ctx && (session.firmId !== ctx.firmId || session.clientId !== ctx.clientId || session.userId !== ctx.userId)) {
        throw new Error("UPLOAD_SESSION_INVALID");
      }

      // Una sesión vinculada no puede sobrescribir una evidencia ya adjunta.
      // La comprobación se repite al completar para cubrir carreras entre dos
      // sesiones válidas abiertas sobre el mismo ítem.
      const requestItem = session.requestItemId
        ? await tx.documentRequestItem.findFirst({
            where: { id: session.requestItemId, firmId: session.firmId, clientId: session.clientId },
          })
        : null;
      if (session.requestItemId && (!requestItem || requestItem.status !== "PENDING")) {
        throw new Error("REQUEST_ITEM_NOT_PENDING");
      }

      // Crear documento
      const document = await tx.document.create({
        data: {
          firmId: session.firmId,
          clientId: session.clientId,
          uploadedByUserId: session.userId,
          uploadOrigin: "FIRM",
          status: "UPLOADED",
          // Categoría declarada por el cliente en la sesión (§10: acuses).
          ...(session.category ? { category: session.category } : {}),
        },
      });

      // Crear versión de archivo (en cuarentena)
      const fileVersion = await tx.documentFileVersion.create({
        data: {
          firmId: session.firmId,
          clientId: session.clientId,
          documentId: document.id,
          originalName: safeBaseName(input.originalName),
          mimeType: detectedMime,
          extension: getExtension(input.originalName),
          sizeBytes: validation.size,
          sha256: verifiedSha256,
          bucket: input.bucket,
          objectKey: input.objectKey,
          antivirusStatus: "PENDING",
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { currentFileVersionId: fileVersion.id },
      });

      // Marcar sesión completada
      await tx.uploadSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      // G2-07 + B3 (§5.1): si la sesión se creó para responder un ítem de
      // pedido, ligar el documento al ítem y derivar el estado del pedido con
      // la MISMA máquina de estados que WorkService.attachDocument: primer
      // requerido → IN_PROGRESS; todos los requeridos → READY_FOR_REVIEW
      // (nunca COMPLETED automático: la revisión es acción del estudio).
      if (requestItem) {
        await tx.documentRequestItem.update({
          where: { id: requestItem.id },
          data: { status: "ATTACHED", documentId: document.id },
        });
        const items = await tx.documentRequestItem.findMany({ where: { requestId: requestItem.requestId } });
        const required = items.filter((i) => i.required);
        const attachedRequired = required.filter((i) =>
          ["ATTACHED", "ACCEPTED", "WAIVED"].includes(i.status),
        );
        const request = await tx.documentRequest.findFirst({
          where: { id: requestItem.requestId },
        });
        if (request && ["SENT", "IN_PROGRESS", "READY_FOR_REVIEW"].includes(request.status)) {
          let nextStatus = request.status;
          if (required.length > 0 && attachedRequired.length === required.length) {
            nextStatus = "READY_FOR_REVIEW";
          } else if (attachedRequired.length > 0) {
            nextStatus = "IN_PROGRESS";
          }
          if (nextStatus !== request.status) {
            await tx.documentRequest.update({
              where: { id: requestItem.requestId },
              data: { status: nextStatus },
            });
          }
        }
      }

      const job = await tx.documentProcessingJob.create({
        data: {
          firmId: session.firmId,
          clientId: session.clientId,
          documentId: document.id,
          fileVersionId: fileVersion.id,
          type: "VALIDATE",
          status: "QUEUED",
          deduplicationKey: `validate:${fileVersion.id}`,
        },
      });
      // G0-06: el runtime no tiene INSERT directo en outbox_events; la
      // creación pasa por la función SECURITY DEFINER app_create_outbox.
      await tx.$executeRaw`SELECT app_create_outbox(
        ${session.firmId}::text,
        ${session.clientId}::text,
        'documents'::text,
        'document.validate'::text,
        ${job.id}::text,
        ${JSON.stringify({
          documentId: document.id,
          fileVersionId: fileVersion.id,
          firmId: session.firmId,
          clientId: session.clientId,
        })}::jsonb
      )`;
      const auditAfter = { status: "UPLOADED", sha256: validation.sha256, size: validation.size };
      if (ctx?.actorKind === "PORTAL") {
        // Portal may append audit events but must not SELECT them. A raw INSERT
        // avoids Prisma's RETURNING clause, which would require the SELECT RLS policy.
        await tx.$executeRaw`
          INSERT INTO audit_events
            (id, "firmId", "clientId", "userId", "actorKind", action, "entityType", "entityId", after)
          VALUES
            (${randomUUID()}, ${session.firmId}, ${session.clientId}, ${session.userId}, 'PORTAL',
             'document.upload.completed', 'Document', ${document.id}, ${JSON.stringify(auditAfter)}::jsonb)
        `;
      } else {
        await tx.auditEvent.create({
          data: {
            firmId: session.firmId,
            clientId: session.clientId,
            userId: session.userId,
            actorKind: ctx?.actorKind ?? "USER",
            action: "document.upload.completed",
            entityType: "Document",
            entityId: document.id,
            after: auditAfter,
          },
        });
      }
      return { document, fileVersion, job };
    };
    return ctx ? withTenantContext(ctx, run) : prisma.$transaction(run);
  }

  /** Encola el job de validación del documento. */
  async enqueueValidation(documentId: string, fileVersionId: string, firmId: string, clientId: string) {
    const dedupKey = `validate:${fileVersionId}`;
    return prisma.documentProcessingJob.create({
      data: {
        firmId,
        clientId,
        documentId,
        fileVersionId,
        type: "VALIDATE",
        status: "QUEUED",
        deduplicationKey: dedupKey,
      },
    });
  }

  /** Lista documentos de un cliente (para el portal: oculta cuarentena/malware). */
  async listDocuments(firmId: string, clientId: string, ctx?: TenantContext) {
    const query = (tx: Prisma.TransactionClient) => tx.document.findMany({
      where: {
        firmId,
        clientId,
        // §5.2: un documento en cuarentena o rechazado no aparece como
        // evidencia disponible en el portal.
        ...(ctx?.actorKind === "PORTAL"
          ? { fileVersions: { some: { bucket: "originals", antivirusStatus: "CLEAN" } } }
          : {}),
      },
      include: { fileVersions: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    return ctx ? withTenantContext(ctx, query) : prisma.$transaction(query);
  }

  /** G2-07: obtiene un ítem de pedido documental (para ligar uploads). */
  async getRequestItem(ctx: TenantContext, requestItemId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.documentRequestItem.findFirst({
        where: {
          id: requestItemId,
          firmId: ctx.firmId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
        },
      }),
    );
  }

  /** G2-07: liga el documento al ítem del pedido y actualiza el estado del ítem. */
  async attachToRequestItem(ctx: TenantContext, documentId: string, requestItemId: string) {
    return withTenantContext(ctx, async (tx) => {
      const item = await tx.documentRequestItem.findFirst({
        where: {
          id: requestItemId,
          firmId: ctx.firmId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
        },
      });
      if (!item) return null;
      const updated = await tx.documentRequestItem.update({
        where: { id: requestItemId },
        data: { status: "ATTACHED", documentId },
      });
      // Completitud derivada (W-003): si todos los ítems requeridos están ATTACHED.
      const items = await tx.documentRequestItem.findMany({ where: { requestId: item.requestId } });
      const required = items.filter((i) => i.required);
      if (required.every((i) => i.status === "ATTACHED")) {
        await tx.documentRequest.update({
          where: { id: item.requestId },
          data: { status: "COMPLETED" },
        });
      }
      return updated;
    });
  }

  /** Obtiene un documento con sus versiones y jobs. */
  async getDocument(firmId: string, clientId: string, documentId: string, ctx?: TenantContext) {
    const query = (tx: Prisma.TransactionClient) => tx.document.findFirst({
      where: { firmId, clientId, id: documentId },
      include: { fileVersions: true, processingJobs: true },
    });
    return ctx ? withTenantContext(ctx, query) : prisma.$transaction(query);
  }

  /**
   * Genera una URL firmada de preview/descarga para un documento subido.
   *
   * Reautoriza el acceso por RLS (el documento pertenece al cliente en
   * contexto), toma la última versión de archivo y sólo firma una URL si la
   * versión ya superó la validación (antivirus CLEAN) y fue promovida al
   * bucket de originales; mientras el archivo está en cuarentena no se expone.
   */
  async getPreviewUrl(
    ctx: TenantContext,
    documentId: string,
  ): Promise<{ url: string; mimeType: string | null; originalName: string | null } | null> {
    return withTenantContext(ctx, async (tx) => {
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          firmId: ctx.firmId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
        },
        include: {
          fileVersions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      const version = document?.fileVersions[0];
      if (!document || !version) return null;
      // No exponer archivos en cuarentena ni versiones sin validar.
      if (version.bucket !== "originals" || version.antivirusStatus !== "CLEAN") return null;
      const url = await this.storage.getPresignedGetUrl(version.bucket as "originals", version.objectKey);
      return { url, mimeType: version.mimeType, originalName: version.originalName };
    });
  }

  /**
   * F2.2: genera una URL firmada de preview para la evidencia de un ítem de
   * pedido. Reautoriza el acceso al ítem (RLS) antes de firmar la URL, de modo
   * que la evidencia no quede expuesta sin permiso.
   */
  async getEvidencePreviewUrl(ctx: TenantContext, requestItemId: string): Promise<{ url: string; mimeType: string | null; originalName: string | null } | null> {
    return withTenantContext(ctx, async (tx) => {
      const item = await tx.documentRequestItem.findFirst({
        where: {
          id: requestItemId,
          firmId: ctx.firmId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
        },
        include: { document: { include: { fileVersions: { orderBy: { createdAt: "desc" }, take: 1 } } } },
      });
      if (!item?.document) return null;
      const version = item.document.fileVersions[0];
      if (!version) return null;
      const url = await this.storage.getPresignedGetUrl(version.bucket as "originals", version.objectKey);
      return { url, mimeType: version.mimeType, originalName: version.originalName };
    });
  }
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}
