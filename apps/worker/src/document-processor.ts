import { withWorkerTenant } from "./lib/prisma.js";
import { Prisma } from "@prisma/client";
import { ObjectStorage, BUCKETS, detectMime, sha256Of } from "@contable/storage";
import { AiClient } from "./ai-client.js";
import { ClamAvClient } from "./clamav-client.js";

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
        where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
        data: { status: "RUNNING", stage: "VALIDATED", progress: 60 },
      });
    });

    // Registrar duplicado si existe
    if (duplicate) {
      await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
        await tx.document.update({ where: { id: payload.documentId }, data: { status: "READY" } });
        await tx.documentProcessingJob.updateMany({
          where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
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
          where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
          data: { status: "SUCCEEDED", stage: "VALIDATED_NO_EXTRACTION", progress: 100, finishedAt: new Date() },
        });
      });
      return;
    }

    // 7. Extracción IA (Fase 5)
    await this.runExtraction(payload, fileVersion, detected);
  }

  private async runExtraction(
    payload: DocumentJobPayload,
    fileVersion: { id: string; objectKey: string; sha256: string; sizeBytes: number },
    mimeType: string,
  ): Promise<void> {
    const runId = crypto.randomUUID();
    const extractionStartedAt = Date.now();
    try {
      const result = await this.ai.runExtraction({
        runId,
        firmId: payload.firmId,
        clientId: payload.clientId,
        documentId: payload.documentId,
        objectKey: fileVersion.objectKey,
        mimeType,
        sizeBytes: fileVersion.sizeBytes,
        sha256: fileVersion.sha256,
        schemaVersion: "voucher-ar-v2",
      });

      await withWorkerTenant(payload.firmId, payload.clientId, (tx) => tx.documentExtraction.create({
        data: {
          firmId: payload.firmId,
          clientId: payload.clientId,
          documentId: payload.documentId,
          fileVersionId: fileVersion.id,
          schemaVersion: "voucher-ar-v2",
          status:
            result.reviewReason || result.issues.length > 0 ? "NEEDS_REVIEW" : "GENERATED",
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
          items: {
            create: result.items.map((i) => {
              const data: Prisma.ExtractedLineItemCreateWithoutExtractionInput = {
                firmId: payload.firmId,
                clientId: payload.clientId,
                description: i.description,
                quantity: i.quantity ?? null,
                unitPrice: i.unitPrice ?? null,
                netAmount: i.netAmount ?? null,
                vatRate: i.vatRate ?? null,
                vatAmount: i.vatAmount ?? null,
                totalAmount: i.totalAmount ?? null,
                confidence: i.confidence,
                page: i.page ?? null,
                method: i.method,
                status: i.status,
              };
              if (i.boundingBox) data.boundingBox = i.boundingBox as Prisma.InputJsonValue;
              return data;
            }),
          },
        },
      }));

      await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
        await tx.document.update({ where: { id: payload.documentId }, data: { status: "EXTRACTED" } });
        await tx.documentProcessingJob.updateMany({
          where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
          data: {
            status: "SUCCEEDED",
            stage:
              result.reviewReason || result.issues.length > 0 ? "NEEDS_REVIEW" : "EXTRACTED",
            progress: 100,
            finishedAt: new Date(),
            error: result.reviewReason ?? null,
          },
        });
      });
    } catch (err) {
      const reviewReason =
        err instanceof Error && err.name === "TimeoutError"
          ? "AI_SERVICE_TIMEOUT"
          : "AI_SERVICE_UNAVAILABLE";
      console.error(
        `[documents] extracción requiere revisión para ${payload.documentId}: ${reviewReason}`,
      );
      await withWorkerTenant(payload.firmId, payload.clientId, (tx) => tx.documentExtraction.create({
        data: {
          firmId: payload.firmId,
          clientId: payload.clientId,
          documentId: payload.documentId,
          fileVersionId: fileVersion.id,
          schemaVersion: "voucher-ar-v2",
          status: "NEEDS_REVIEW",
          ocrEngine: "multimodal-model",
          promptVersion: "vision-ar-v2",
          latencyMs: Date.now() - extractionStartedAt,
          reviewReason,
        },
      }));
      await withWorkerTenant(payload.firmId, payload.clientId, (tx) => tx.document.update({
        where: { id: payload.documentId },
        data: { status: "EXTRACTED" },
      }));
      await withWorkerTenant(payload.firmId, payload.clientId, (tx) => tx.documentProcessingJob.updateMany({
        where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
        data: {
          status: "SUCCEEDED",
          stage: "NEEDS_REVIEW",
          error: reviewReason,
          finishedAt: new Date(),
        },
      }));
    }
  }

  private async markFailed(payload: DocumentJobPayload, error: string): Promise<void> {
    await withWorkerTenant(payload.firmId, payload.clientId, async (tx) => {
      await tx.document.update({
        where: { id: payload.documentId },
        data: { status: "FAILED" },
      });
      await tx.documentProcessingJob.updateMany({
        where: { fileVersionId: payload.fileVersionId, type: "VALIDATE" },
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
