import { describe, expect, it } from "vitest";
import { extractionRequestSchema } from "./domain.js";

const extractionRequest = {
  contractVersion: "1.0",
  runId: "01900000-0000-7000-8000-000000000001",
  firmId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  documentId: "33333333-3333-4333-8333-333333333333",
  source: {
    downloadUrl: "https://signed.example/document.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    sha256: "a".repeat(64),
  },
  options: {
    country: "AR",
    language: "es",
    maxPages: 3,
    schemaVersion: "voucher-ar-v2",
  },
  callback: {
    url: "https://api.example/internal/v1/extractions/complete",
    expiresAt: "2026-11-11T12:00:00Z",
  },
};

describe("contrato de extracción fiscal sin QR", () => {
  it("rechaza opciones de lectura QR", () => {
    expect(
      extractionRequestSchema.safeParse({
        ...extractionRequest,
        options: { ...extractionRequest.options, runQrParser: true },
      }).success,
    ).toBe(false);
  });
});
