import { withWorkerTenant } from "./lib/prisma.js";
import { Prisma } from "@prisma/client";
import { ObjectStorage, BUCKETS, detectMime, sha256Of } from "@contable/storage";
import { AiClient, AiExtractionHttpError } from "./ai-client.js";
import { ClamAvClient } from "./clamav-client.js";

const CUSTOMER_DATA_EXTRACTION_DISABLED = "CUSTOMER_DATA_EXTRACTION_DISABLED";

/**
 * Worker de documentos (Fase 4-5).
 * Procesa jobs VALIDATE: descarga de cuarentena, valida magic bytes + hash,
 * ClamAV por streaming, promueve a originals, detecta duplicado binario y
 * dispara la extracción IA (Fase 5).
 */

export interface DocumentJobPayload {
  documentId: string;
  fileVersionId: string;
  firmId: string;
  clientId: string;
  reprocess?: boolean;
  processingJobId?: string;
  previousExtractionId?: string;
}

function processingJobWhere(payload: DocumentJobPayload) {
  return payload.processingJobId
    ? {
        id: payload.processingJobId,
        firmId: payload.firmId,
        clientId: payload.clientId,
        documentId: payload.documentId,
        type: "REPROCESS",
      }
    : { fileVersionId: payload.fileVersionId, type: "VALIDATE" };
}

export class DocumentProcessor {
  constructor(
    private storage: ObjectStorage,
    private ai: AiClient,
    private clamav = new ClamAvClient(),
  ) {}

  async process(payload: DocumentJobPayload): Promise<void> {
    const fileVersion = await withWorkerTenant(payload.firmId, payload.clientId, (tx) =>
      tx.documentFileVersion.findFirst({
        where: { id: payload.fileVersionId, firmId: payload.firmId, clientId: payload.clientId },
        include: { document: { select: { category: true } } },
      }),
    );
    if (!fileVersion) throw new Error("FILE_VERSION_NOT_FOUND");

    if (payload.reprocess) {
      await this.processReprocess(payload, fileVersion);
      return;
    }

    // Descargar de cuarentena
    const data = await this.storage.get(BUCKETS.quarantine, fileVersion.objectKey);

    // 1. Validar magic bytes
    const detected = detectMime(data);
    if (!detected) {
      await this.markFailed(payload, "MAGIC_BYTES_INVALID");
      return;
    }

    // 2. Verificar checksum
    const hash = sha256Of(data);
    if (hash !== fileVersion.sha256) {
      await this.markFailed(payload, "CHECKSUM_MISMATCH");
      return;
    }

    // 3. Antivirus real. Ante indisponibilidad, el archivo permanece en cuarentena.
    const antivirus = await this.clamav.scan(data);
    if (!antivirus.clean) {
      await this.markFailed(payload, `MALWARE_DETECTED:${antivirus.result}`);
      return;
    }

    // 4. Detección de duplicado binario (mismo SHA-256 dentro del cliente)
    const duplicate = await withWorkerTenant(payload.firmId, payload.clientId, (tx) => tx.documentFileVersion.findFirst({
      where: {
        firmId: payload.firmId,
        clientId: payload.clientId,
        sha256: hash,
        id: { not: payload.fileVersionId },
      },
    }));

    // 5. Promover a originals
    await this.storage.promote(BUCKETS.quarantine, fileVersion.objectKey, BUCKETS.originals);

    // 6. Actualizar estado
    await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
      const pages = detectPdfPages(data);
      const fileData: Record<string, unknown> = {
        bucket: BUCKETS.originals,
        antivirusStatus: "CLEAN",
      };
      if (pages !== undefined) fileData.pages = pages;

      await tx.documentFileVersion.update({
        where: { id: payload.fileVersionId },
        data: fileData,
      });
      await tx.document.update({
        where: { id: payload.documentId },
        data: {
          status: duplicate ? "READY" : "VALIDATING",
        },
      });
      await tx.documentProcessingJob.updateMany({
        where: processingJobWhere(payload),
        data: { status: "RUNNING", stage: "VALIDATED", progress: 60 },
      });
    });

    // Registrar duplicado si existe
    if (duplicate) {
      await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
        await tx.document.update({ where: { id: payload.documentId }, data: { status: "READY" } });
        await tx.documentProcessingJob.updateMany({
          where: processingJobWhere(payload),
          data: { status: "SUCCEEDED", stage: "DUPLICATE", progress: 100, finishedAt: new Date() },
        });
      });
      return;
    }

    // Los acuses son evidencia de una presentación, no comprobantes a
    // extraer. Después de antivirus, hash y promoción ya cumplen el contrato
    // de evidencia READY y no deben depender del servicio IA/OCR.
    if (fileVersion.document.category === "ACUSE") {
      await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
        await tx.document.update({ where: { id: payload.documentId }, data: { status: "READY" } });
        await tx.documentProcessingJob.updateMany({
          where: processingJobWhere(payload),
          data: { status: "SUCCEEDED", stage: "VALIDATED_NO_EXTRACTION", progress: 100, finishedAt: new Date() },
        });
      });
      return;
    }

    // 7. Extracción IA (Fase 5)
    await this.runExtraction(payload, fileVersion, detected);
  }

  private async processReprocess(
    payload: DocumentJobPayload,
    fileVersion: {
      id: string;
      objectKey: string;
      sha256: string;
      sizeBytes: number;
      mimeType: string;
      bucket: string;
      antivirusStatus: string;
    },
  ): Promise<void> {
    if (!payload.processingJobId) throw new Error("REPROCESS_JOB_ID_REQUIRED");

    const started = await withWorkerTenant(payload.firmId, payload.clientId, (tx) =>
      tx.documentProcessingJob.updateMany({
        where: {
          ...processingJobWhere(payload),
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "RUNNING", stage: "READING_AI", progress: 10, startedAt: new Date() },
      }),
    );
    if (started.count === 0) return;

    if (fileVersion.bucket !== BUCKETS.originals || fileVersion.antivirusStatus !== "CLEAN") {
      await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
        await tx.document.update({ where: { id: payload.documentId }, data: { status: "EXTRACTED" } });
        await tx.documentProcessingJob.updateMany({
          where: processingJobWhere(payload),
          data: { status: "FAILED", stage: "FILE_NOT_READY", progress: 100, error: "FILE_NOT_READY", finishedAt: new Date() },
        });
      });
      return;
    }

    // El archivo ya superó la validación/antivirus al subirse; se vuelve a
    // solicitar la lectura IA sobre la misma versión promovida a originals.
    await this.runExtraction(payload, fileVersion, fileVersion.mimeType);
  }

  private async runExtraction(
    payload: DocumentJobPayload,
    fileVersion: { id: string; objectKey: string; sha256: string; sizeBytes: number },
    mimeType: string,
  ): Promise<void> {
    const runId = crypto.randomUUID();
    const extractionStartedAt = Date.now();
    let result: Awaited<ReturnType<AiClient["runExtraction"]>>;
    try {
      result = await this.ai.runExtraction({
        runId,
        firmId: payload.firmId,
        clientId: payload.clientId,
        documentId: payload.documentId,
        objectKey: fileVersion.objectKey,
        mimeType,
        sizeBytes: fileVersion.sizeBytes,
        sha256: fileVersion.sha256,
        schemaVersion: "voucher-ar-v2.1",
      });
    } catch (err) {
      await this.recordUnavailableExtraction(payload, fileVersion, extractionStartedAt, err);
      return;
    }

    const needsReview = Boolean(result.reviewReason || result.issues.length > 0 || result.reviewIssues.length > 0);
    await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
      const extraction = await tx.documentExtraction.create({
        data: {
          firmId: payload.firmId,
          clientId: payload.clientId,
          documentId: payload.documentId,
          fileVersionId: fileVersion.id,
          schemaVersion: "voucher-ar-v2.1",
          status: needsReview ? "NEEDS_REVIEW" : "GENERATED",
          classification: result.voucher?.tipo_documento ?? null,
          confidence: result.classificationConfidence ?? null,
          ocrEngine: result.ocrEngine,
          model: result.model ?? null,
          provider: result.provider ?? null,
          promptVersion: result.promptVersion,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          latencyMs: result.latencyMs,
          estimatedCostUsd: result.estimatedCostUsd ?? null,
          reviewReason: result.reviewReason ?? null,
          reviewIssues: result.reviewIssues as unknown as Prisma.InputJsonValue,
          ...(result.voucher
            ? { voucherData: result.voucher as unknown as Prisma.InputJsonValue }
            : {}),
          fields: {
            create: result.fields.map((f) => {
              const data: Prisma.ExtractedFieldCreateWithoutExtractionInput = {
                firmId: payload.firmId,
                clientId: payload.clientId,
                key: f.key,
                rawValue: f.rawValue ?? null,
                normalizedValue: f.normalizedValue ?? null,
                confidence: f.confidence,
                page: f.page ?? null,
                method: f.method,
                status: f.status,
              };
              if (f.boundingBox) data.boundingBox = f.boundingBox as Prisma.InputJsonValue;
              return data;
            }),
          },
        },
      });

      const stage = needsReview ? "NEEDS_REVIEW" : "EXTRACTED";
      if (payload.reprocess) {
        await this.finishReprocess(tx, payload, extraction.id, stage, result.reviewReason ?? null);
        return;
      }

      await tx.document.update({
        where: { id: payload.documentId },
        data: { status: "EXTRACTED", currentExtractionId: extraction.id },
      });
      await tx.documentProcessingJob.updateMany({
        where: processingJobWhere(payload),
        data: {
          status: "SUCCEEDED",
          stage,
          progress: 100,
          finishedAt: new Date(),
          error: result.reviewReason ?? null,
        },
      });
    });
  }

  private async recordUnavailableExtraction(
    payload: DocumentJobPayload,
    fileVersion: { id: string },
    extractionStartedAt: number,
    error: unknown,
  ): Promise<void> {
    // La compuerta productiva (EXTRACTION_CUSTOMER_DATA_ENABLED=false) no es
    // una caída del servicio: conservamos su motivo para que la bandeja
    // explique que la lectura automática no está activada.
    const automatedReadingDisabled =
      error instanceof AiExtractionHttpError &&
      error.status === 503 &&
      error.code === CUSTOMER_DATA_EXTRACTION_DISABLED;
    const reviewReason = automatedReadingDisabled
      ? "CUSTOMER_DATA_EXTRACTION_DISABLED"
      : error instanceof Error && error.name === "TimeoutError"
        ? "AI_SERVICE_TIMEOUT"
        : "AI_SERVICE_UNAVAILABLE";
    console.error(
      `[documents] extracción requiere revisión para ${payload.documentId}: ${reviewReason}`,
    );
    await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
      const extraction = await tx.documentExtraction.create({
        data: {
          firmId: payload.firmId,
          clientId: payload.clientId,
          documentId: payload.documentId,
          fileVersionId: fileVersion.id,
          schemaVersion: "voucher-ar-v2.1",
          status: "NEEDS_REVIEW",
          ocrEngine: "multimodal-model",
          promptVersion: "vision-ar-v6",
          latencyMs: Date.now() - extractionStartedAt,
          reviewReason,
          reviewIssues: [{ reason: reviewReason, sourcePath: null }],
        },
      });

      if (payload.reprocess) {
        await this.finishReprocess(tx, payload, extraction.id, "NEEDS_REVIEW", reviewReason);
        return;
      }

      await tx.document.update({
        where: { id: payload.documentId },
        data: { status: "EXTRACTED", currentExtractionId: extraction.id },
      });
      await tx.documentProcessingJob.updateMany({
        where: processingJobWhere(payload),
        data: {
          status: "SUCCEEDED",
          stage: "NEEDS_REVIEW",
          progress: 100,
          error: reviewReason,
          finishedAt: new Date(),
        },
      });
    });
  }

  private async finishReprocess(
    tx: Prisma.TransactionClient,
    payload: DocumentJobPayload,
    newExtractionId: string,
    stage: "EXTRACTED" | "NEEDS_REVIEW",
    error: string | null,
  ): Promise<void> {
    if (!payload.previousExtractionId || !payload.processingJobId) {
      throw new Error("REPROCESS_CONTEXT_REQUIRED");
    }

    const previous = await tx.documentExtraction.updateMany({
      where: {
        id: payload.previousExtractionId,
        firmId: payload.firmId,
        clientId: payload.clientId,
        documentId: payload.documentId,
        status: { in: ["GENERATED", "NEEDS_REVIEW"] },
      },
      data: { status: "SUPERSEDED" },
    });
    if (previous.count !== 1) throw new Error("PREVIOUS_EXTRACTION_NOT_REVIEWABLE");

    const document = await tx.document.updateMany({
      where: {
        id: payload.documentId,
        firmId: payload.firmId,
        clientId: payload.clientId,
        status: "VALIDATING",
        currentFileVersionId: payload.fileVersionId,
      },
      data: { status: "EXTRACTED", currentExtractionId: newExtractionId },
    });
    if (document.count !== 1) throw new Error("REPROCESS_DOCUMENT_STATE_CHANGED");

    const job = await tx.documentProcessingJob.updateMany({
      where: { ...processingJobWhere(payload), status: "RUNNING" },
      data: { status: "SUCCEEDED", stage, progress: 100, error, finishedAt: new Date() },
    });
    if (job.count !== 1) throw new Error("REPROCESS_JOB_STATE_CHANGED");
  }

  private async markFailed(payload: DocumentJobPayload, error: string): Promise<void> {
    await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
      await tx.document.update({
        where: { id: payload.documentId },
        data: { status: "FAILED" },
      });
      await tx.documentProcessingJob.updateMany({
        where: processingJobWhere(payload),
        data: { status: "FAILED", finishedAt: new Date(), error },
      });
    });
  }
}

function detectPdfPages(buffer: Buffer): number | undefined {
  if (detectMime(buffer) !== "application/pdf") return undefined;
  // Conteo simple de /Type /Page (aproximado; PDF.js real en Fase 5)
  const matches = buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 1;
}
