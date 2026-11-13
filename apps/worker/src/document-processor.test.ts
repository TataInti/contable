import { Prisma } from "@prisma/client";
import { sha256Of, type ObjectStorage } from "@contable/storage";
import { describe, expect, it, vi } from "vitest";
import { AiExtractionHttpError, type AiClient, type ExtractionResult } from "./ai-client.js";
import type { ClamAvClient } from "./clamav-client.js";
import { DocumentProcessor } from "./document-processor.js";
import { withWorkerTenant } from "./lib/prisma.js";

const workerMocks = vi.hoisted(() => ({ withWorkerTenant: vi.fn() }));
vi.mock("./lib/prisma.js", () => ({ withWorkerTenant: workerMocks.withWorkerTenant }));

const extractionResult: ExtractionResult = {
  schemaVersion: "voucher-ar-v2.1",
  voucher: {
    tipo_documento: "factura",
    letra: "A",
    punto_venta: null,
    numero: null,
    fecha: null,
    hora: null,
    cuit_emisor: "30712345675",
    cuit_receptor: null,
    razon_social_emisor: null,
    razon_social_receptor: null,
    condicion_iva: null,
    neto_gravado: null,
    iva: null,
    no_gravado: null,
    exento: null,
    percepciones: null,
    total: null,
    moneda: null,
    cae: null,
    cae_vencimiento: null,
    confianza: { tipo_documento: 0.99, letra: 0.9 },
  },
  classificationConfidence: 0.99,
  fields: [],
  issues: [],
  reviewReason: null,
  reviewIssues: [],
  ocrEngine: "multimodal-model",
  model: "synthetic/model",
  provider: "synthetic-provider",
  promptVersion: "vision-ar-v6",
  inputTokens: null,
  outputTokens: null,
  latencyMs: 0,
  estimatedCostUsd: null,
};

describe("DocumentProcessor extracción sin ítems", () => {
  it("no crea filas de ítems con un resultado sintético", async () => {
    const data = Buffer.from("%PDF-1.4 synthetic fixture");
    const fileVersion = {
      id: "44444444-4444-4444-8444-444444444444",
      objectKey: "synthetic/document.pdf",
      sha256: sha256Of(data),
      sizeBytes: data.byteLength,
      document: { category: "INVOICE" },
    };
    const createExtraction = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const fakeTx = {
      documentFileVersion: {
        findFirst: vi.fn().mockResolvedValueOnce(fileVersion).mockResolvedValueOnce(null),
        update: vi.fn().mockResolvedValue({}),
      },
      document: { update: vi.fn().mockResolvedValue({}) },
      documentProcessingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      documentExtraction: { create: createExtraction },
      extractedLineItem: { create: vi.fn() },
    };

    vi.mocked(withWorkerTenant).mockImplementation(async (_firmId, _clientId, callback) =>
      callback(fakeTx as unknown as Prisma.TransactionClient),
    );

    const storage = {
      get: vi.fn().mockResolvedValue(data),
      promote: vi.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorage;
    const ai = {
      runExtraction: vi.fn().mockResolvedValue(extractionResult),
    } as unknown as AiClient;
    const clamav = {
      scan: vi.fn().mockResolvedValue({ clean: true, result: "synthetic OK" }),
    } as unknown as ClamAvClient;
    const processor = new DocumentProcessor(storage, ai, clamav);

    await processor.process({
      documentId: "33333333-3333-4333-8333-333333333333",
      fileVersionId: fileVersion.id,
      firmId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
    });

    expect(createExtraction).toHaveBeenCalledOnce();
    const createArgs = createExtraction.mock.calls[0]?.[0];
    expect(createArgs?.data).not.toHaveProperty("items");
    expect(createArgs?.data.reviewIssues).toEqual([]);
    expect(fakeTx.extractedLineItem.create).not.toHaveBeenCalled();
  });
});

describe("DocumentProcessor con el servicio de IA no disponible", () => {
  const data = Buffer.from("%PDF-1.4 synthetic fixture");
  const payload = {
    documentId: "33333333-3333-4333-8333-333333333333",
    fileVersionId: "44444444-4444-4444-8444-444444444444",
    firmId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
  };

  async function extractionCreatedAfter(aiError: Error) {
    const fileVersion = {
      id: payload.fileVersionId,
      objectKey: "synthetic/document.pdf",
      sha256: sha256Of(data),
      sizeBytes: data.byteLength,
      document: { category: "INVOICE" },
    };
    const createExtraction = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const fakeTx = {
      documentFileVersion: {
        findFirst: vi.fn().mockResolvedValueOnce(fileVersion).mockResolvedValueOnce(null),
        update: vi.fn().mockResolvedValue({}),
      },
      document: { update: vi.fn().mockResolvedValue({}) },
      documentProcessingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      documentExtraction: { create: createExtraction },
      extractedLineItem: { create: vi.fn() },
    };

    vi.mocked(withWorkerTenant).mockImplementation(async (_firmId, _clientId, callback) =>
      callback(fakeTx as unknown as Prisma.TransactionClient),
    );

    const storage = {
      get: vi.fn().mockResolvedValue(data),
      promote: vi.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorage;
    const ai = {
      runExtraction: vi.fn().mockRejectedValue(aiError),
    } as unknown as AiClient;
    const clamav = {
      scan: vi.fn().mockResolvedValue({ clean: true, result: "synthetic OK" }),
    } as unknown as ClamAvClient;
    const processor = new DocumentProcessor(storage, ai, clamav);

    await processor.process(payload);

    expect(createExtraction).toHaveBeenCalledOnce();
    return createExtraction.mock.calls[0]?.[0]?.data;
  }

  it("conserva CUSTOMER_DATA_EXTRACTION_DISABLED cuando la compuerta de IA responde 503", async () => {
    const created = await extractionCreatedAfter(
      new AiExtractionHttpError(503, "CUSTOMER_DATA_EXTRACTION_DISABLED"),
    );

    expect(created?.status).toBe("NEEDS_REVIEW");
    expect(created?.reviewReason).toBe("CUSTOMER_DATA_EXTRACTION_DISABLED");
    expect(created?.reviewIssues).toEqual([
      { reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null },
    ]);
  });

  it.each([
    ["otro 503 del servicio", new AiExtractionHttpError(503, "MODEL_FAILURE")],
    ["un 500 sin código de dominio", new AiExtractionHttpError(500, null)],
    ["una falla de red", new Error("ECONNREFUSED")],
  ])("mantiene AI_SERVICE_UNAVAILABLE ante %s", async (_label, error) => {
    const created = await extractionCreatedAfter(error);

    expect(created?.reviewReason).toBe("AI_SERVICE_UNAVAILABLE");
    expect(created?.reviewIssues).toEqual([{ reason: "AI_SERVICE_UNAVAILABLE", sourcePath: null }]);
  });
});

describe("DocumentProcessor relectura", () => {
  const payload = {
    documentId: "33333333-3333-4333-8333-333333333333",
    fileVersionId: "44444444-4444-4444-8444-444444444444",
    firmId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    processingJobId: "55555555-5555-4555-8555-555555555555",
    previousExtractionId: "66666666-6666-4666-8666-666666666666",
    reprocess: true,
  };

  async function processReprocess(aiCall: ReturnType<typeof vi.fn>) {
    const data = Buffer.from("%PDF-1.4 synthetic fixture");
    const fileVersion = {
      id: payload.fileVersionId,
      objectKey: "synthetic/document.pdf",
      sha256: sha256Of(data),
      sizeBytes: data.byteLength,
      mimeType: "application/pdf",
      bucket: "originals",
      antivirusStatus: "CLEAN",
      document: { category: "INVOICE" },
    };
    const previous = {
      id: payload.previousExtractionId,
      status: "NEEDS_REVIEW",
      fields: [{ key: "totalAmount", correction: "123.45", method: "HUMAN" }],
    };
    const createExtraction = vi.fn().mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
    const updatePrevious = vi.fn(async ({ data: update }: { data: { status: string } }) => {
      previous.status = update.status;
      return { count: 1 };
    });
    const updateDocument = vi.fn().mockResolvedValue({ count: 1 });
    const updateJob = vi.fn().mockResolvedValue({ count: 1 });
    const fakeTx = {
      documentFileVersion: { findFirst: vi.fn().mockResolvedValue(fileVersion) },
      documentExtraction: { create: createExtraction, updateMany: updatePrevious },
      document: { update: vi.fn().mockResolvedValue({}), updateMany: updateDocument },
      documentProcessingJob: { updateMany: updateJob },
      extractedLineItem: { create: vi.fn() },
    };
    vi.mocked(withWorkerTenant).mockImplementation(async (_firmId, _clientId, callback) =>
      callback(fakeTx as unknown as Prisma.TransactionClient),
    );
    const storage = { get: vi.fn(), promote: vi.fn() } as unknown as ObjectStorage;
    const ai = { runExtraction: aiCall } as unknown as AiClient;

    await new DocumentProcessor(storage, ai).process(payload);
    return { createExtraction, updatePrevious, updateDocument, updateJob, previous, aiCall };
  }

  it("crea la lectura vigente y conserva los campos manuales de la extracción anterior", async () => {
    const aiCall = vi.fn().mockResolvedValue(extractionResult);
    const { createExtraction, updatePrevious, updateDocument, updateJob, previous } = await processReprocess(aiCall);

    expect(aiCall).toHaveBeenCalledOnce();
    expect(aiCall.mock.calls[0]?.[0]).not.toHaveProperty("previousExtractionId");
    expect(createExtraction).toHaveBeenCalledOnce();
    expect(createExtraction.mock.calls[0]?.[0].data).toMatchObject({
      documentId: payload.documentId,
      fileVersionId: payload.fileVersionId,
      status: "GENERATED",
    });
    expect(updatePrevious).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: payload.previousExtractionId,
        status: { in: ["GENERATED", "NEEDS_REVIEW"] },
      }),
      data: { status: "SUPERSEDED" },
    }));
    expect(previous).toEqual({
      id: payload.previousExtractionId,
      status: "SUPERSEDED",
      fields: [{ key: "totalAmount", correction: "123.45", method: "HUMAN" }],
    });
    expect(updateDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "EXTRACTED",
        currentExtractionId: "77777777-7777-4777-8777-777777777777",
      },
    }));
    expect(updateJob).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: payload.processingJobId, status: "RUNNING" }),
      data: expect.objectContaining({ status: "SUCCEEDED", progress: 100 }),
    }));
  });

  it("conserva la lectura no disponible como extracción nueva y deja la anterior consultable", async () => {
    const aiCall = vi.fn().mockRejectedValue(
      new AiExtractionHttpError(503, "CUSTOMER_DATA_EXTRACTION_DISABLED"),
    );
    const { createExtraction, updatePrevious, previous } = await processReprocess(aiCall);

    expect(createExtraction).toHaveBeenCalledOnce();
    expect(createExtraction.mock.calls[0]?.[0].data).toMatchObject({
      status: "NEEDS_REVIEW",
      reviewReason: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      reviewIssues: [{ reason: "CUSTOMER_DATA_EXTRACTION_DISABLED", sourcePath: null }],
    });
    expect(updatePrevious).toHaveBeenCalledOnce();
    expect(previous.status).toBe("SUPERSEDED");
    expect(previous.fields).toEqual([{ key: "totalAmount", correction: "123.45", method: "HUMAN" }]);
  });
});
