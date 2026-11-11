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
  schemaVersion: "voucher-ar-v2";
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

export interface VoucherARV2 {
  tipo_documento:
    | "factura"
    | "ticket_no_fiscal"
    | "recibo"
    | "nota_credito"
    | "nota_debito"
    | "otro"
    | "ilegible";
  letra: string | null;
  punto_venta: string | null;
  numero: string | null;
  fecha: string | null;
  hora: string | null;
  cuit_emisor: string | null;
  cuit_receptor: string | null;
  razon_social_emisor: string | null;
  razon_social_receptor: string | null;
  condicion_iva: string | null;
  neto_gravado: string | null;
  iva: { alicuota: string | null; importe: string | null }[] | null;
  no_gravado: string | null;
  exento: string | null;
  percepciones: { tipo: string | null; importe: string | null }[] | null;
  total: string | null;
  moneda: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  confianza: Record<string, number>;
}

export interface ExtractionResult {
  schemaVersion: "voucher-ar-v2";
  voucher: VoucherARV2 | null;
  classificationConfidence: number | null;
  fields: ExtractedField[];
  issues: string[];
  reviewReason: string | null;
  ocrEngine: string;
  model: string | null;
  provider: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number | null;
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
    schemaVersion: "voucher-ar-v2";
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
        maxPages: 3,
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
    const timeoutMs = Number(process.env.EXTRACTION_WORKER_TIMEOUT_MS ?? 75_000);
    const timeout = AbortSignal.timeout(
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 75_000,
    );
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
      throw new Error(`AI_EXTRACTION_HTTP_${res.status}`);
    }

    try {
      return (await res.json()) as ExtractionResult;
    } catch {
      throw new Error("AI_EXTRACTION_INVALID_RESPONSE");
    }
  }
}
