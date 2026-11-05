import { describe, expect, it } from "vitest";
import { belongsToDocumentQueue, type DocumentQueueFilter } from "./documentQueue";

function documentWithStatus(status: string) {
  return { status } as { status: string };
}

describe("belongsToDocumentQueue", () => {
  const filters: DocumentQueueFilter[] = ["ALL", "PROCESSING", "NEEDS_REVIEW", "REVIEWED", "ERROR"];

  it("un documento EXTRACTED queda en Para revisar y fuera de Revisados", () => {
    const doc = documentWithStatus("EXTRACTED");
    for (const filter of filters) {
      expect(belongsToDocumentQueue(doc, filter)).toBe(filter === "ALL" || filter === "NEEDS_REVIEW");
    }
  });

  it("un documento REVIEWED (extracción aprobada) está en Revisados y ya no en Para revisar", () => {
    const doc = documentWithStatus("REVIEWED");
    for (const filter of filters) {
      expect(belongsToDocumentQueue(doc, filter)).toBe(filter === "ALL" || filter === "REVIEWED");
    }
  });

  it("estados de error quedan en Con error", () => {
    for (const status of ["EXTRACTION_FAILED", "INFECTED", "FAILED"]) {
      expect(belongsToDocumentQueue(documentWithStatus(status), "ERROR")).toBe(true);
      expect(belongsToDocumentQueue(documentWithStatus(status), "NEEDS_REVIEW")).toBe(false);
      expect(belongsToDocumentQueue(documentWithStatus(status), "REVIEWED")).toBe(false);
    }
  });
});