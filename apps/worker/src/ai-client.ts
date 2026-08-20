import { createHmac, createHash, randomUUID } from "node:crypto";
import { ObjectStorage, BUCKETS } from "@contable/storage";

/**
 * Cliente del servicio AI (FastAPI) — Fase 5.
 * Firma HMAC-SHA256 sobre method + path + timestamp + nonce + sha256(body)
 * según docs/contratos-node-fastapi.md.
 */

export interface AiClientConfig {
  baseUrl: string;
  secret: string;
  serviceId: string;
}

export function loadAiClientConfig(): AiClientConfig {
  return {
    baseUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
    secret: process.env.AI_SERVICE_SECRET ?? "",
    serviceId: process.env.AI_SERVICE_ID ?? "api",
  };
}

export interface ExtractionSource {
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface ExtractionOptions {
  country: string;
  language: string;
  maxPages: number;
  runQrParser: boolean;
  runOcr: boolean;
  runVisionFallback: boolean;
  schemaVersion: string;
}

export interface ExtractionRunRequest {
  contractVersion: string;
  runId: string;
  firmId: string;
  clientId: string;
  documentId: string;
  source: ExtractionSource;
  options: ExtractionOptions;
  callback: { url: string; expiresAt: string };
}

export interface ExtractedField {
  key: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  confidence: number;
  page?: number | null;
  boundingBox?: Record<string, unknown> | null;
  method: string;
  status: string;
}

export interface ExtractedLineItem {
  description: string;
  quantity?: string | null;
  unitPrice?: string | null;
  netAmount?: string | null;
  vatRate?: string | null;
  vatAmount?: string | null;
  totalAmount?: string | null;
  confidence: number;
  page?: number | null;
  boundingBox?: Record<string, unknown> | null;
  method: string;
  status: string;
}

export interface ExtractionResult {
  documentType: string;
  direction: string;
  letter?: string | null;
  pointOfSale?: string | null;
  number?: string | null;
  emitterCuit?: string | null;
  receiverCuit?: string | null;
  issueDate?: string | null;
  totalAmount?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  currency?: string | null;
  classificationConfidence: number;
  fields: ExtractedField[];
  items: ExtractedLineItem[];
  issues: string[];
  ocrEngine: string;
  model?: string | null;
  provider?: string | null;
  promptVersion?: string | null;
}

export class AiClient {
  constructor(
    private storage: ObjectStorage,
    private config: AiClientConfig = loadAiClientConfig(),
  ) {}

  private sign(method: string, path: string, timestamp: string, nonce: string, bodyHash: string): string {
    const message = `${method}${path}${timestamp}${nonce}${bodyHash}`;
    return createHmac("sha256", this.config.secret).update(message).digest("hex");
  }

  private sha256Hex(body: Buffer): string {
    return createHash("sha256").update(body).digest("hex");
  }

  /**
   * Ejecuta una extracción: genera URL firmada de lectura, arma el request,
   * firma HMAC y llama a FastAPI. Devuelve el resultado estructurado.
   */
  async runExtraction(input: {
    runId: string;
    firmId: string;
    clientId: string;
    documentId: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    schemaVersion: string;
  }): Promise<ExtractionResult> {
    const downloadUrl = await this.storage.getPresignedGetUrl(BUCKETS.originals, input.objectKey, 300);

    const payload: ExtractionRunRequest = {
      contractVersion: "1.0",
      runId: input.runId,
      firmId: input.firmId,
      clientId: input.clientId,
      documentId: input.documentId,
      source: {
        downloadUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
      },
      options: {
        country: "AR",
        language: "es",
        maxPages: 100,
        runQrParser: true,
        runOcr: true,
        runVisionFallback: true,
        schemaVersion: input.schemaVersion,
      },
      callback: {
        url: `${this.config.baseUrl.replace(/\/$/, "")}/internal/v1/extractions/complete`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    };

    const path = "/internal/v1/extractions";
    const body = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const signature = this.sign("POST", path, timestamp, nonce, this.sha256Hex(body));

    // Timeout: un fallo de IA no puede colgar el worker.
    const timeout = AbortSignal.timeout(30_000);
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Id": this.config.serviceId,
        "X-Service-Timestamp": timestamp,
        "X-Service-Nonce": nonce,
        "X-Service-Signature": signature,
      },
      body,
      signal: timeout,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI_EXTRACTION_FAILED ${res.status}: ${text}`);
    }

    return (await res.json()) as ExtractionResult;
  }
}
