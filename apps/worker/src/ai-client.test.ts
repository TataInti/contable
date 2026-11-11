import type { ObjectStorage } from "@contable/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiClient, AiExtractionHttpError } from "./ai-client.js";

const storage = {
  getPresignedGetUrl: vi.fn().mockResolvedValue("https://storage.test/original.pdf"),
} as unknown as ObjectStorage;

function client() {
  return new AiClient(storage, {
    baseUrl: "https://ai.test",
    secret: "synthetic-secret",
    serviceId: "worker-test",
  });
}

function extractionInput() {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    firmId: "22222222-2222-4222-8222-222222222222",
    clientId: "33333333-3333-4333-8333-333333333333",
    documentId: "44444444-4444-4444-8444-444444444444",
    objectKey: "synthetic/document.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    sha256: "a".repeat(64),
    schemaVersion: "voucher-ar-v2.1" as const,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiClient.runExtraction", () => {
  it("conserva el código de dominio cuando el servicio de IA responde 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "CUSTOMER_DATA_EXTRACTION_DISABLED" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const error = await client()
      .runExtraction(extractionInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiExtractionHttpError);
    expect(error).toMatchObject({
      status: 503,
      code: "CUSTOMER_DATA_EXTRACTION_DISABLED",
      message: "AI_EXTRACTION_HTTP_503",
    });
  });

  it("deja el código nulo si la respuesta de error no trae un detalle de texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>upstream error</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const error = await client()
      .runExtraction(extractionInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiExtractionHttpError);
    expect(error).toMatchObject({ status: 502, code: null, message: "AI_EXTRACTION_HTTP_502" });
  });
});
