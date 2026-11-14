import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFilingReceipt, waitForReceiptReady } from "./filingReceipt";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const uploadMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ api: apiMock, uploadToSignedUrl: uploadMock }));

const BASE = "/firms/firm-a/clients/client-a";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("constancia de presentación subida por el estudio", () => {
  it("la sube como ACUSE, sin pedido documental", async () => {
    apiMock.post
      .mockResolvedValueOnce({ sessionId: "session-1", presignedUrl: "https://storage/put", objectKey: "key-1" })
      .mockResolvedValueOnce({ documentId: "document-1" });
    const file = new File(["constancia"], "constancia-iva.pdf", { type: "application/pdf" });

    await expect(uploadFilingReceipt(BASE, file)).resolves.toBe("document-1");

    expect(apiMock.post).toHaveBeenNthCalledWith(1, `${BASE}/document-upload-sessions`, {
      expectedMime: "application/pdf",
      category: "ACUSE",
    });
    expect(uploadMock).toHaveBeenCalledWith("https://storage/put", file);
    expect(apiMock.post).toHaveBeenNthCalledWith(
      2,
      `${BASE}/document-upload-sessions/session-1/complete`,
      expect.objectContaining({ originalName: "constancia-iva.pdf", objectKey: "key-1", sizeBytes: file.size }),
    );
  });

  it("espera a que termine la validación antes de dar la constancia por lista", async () => {
    apiMock.get
      .mockResolvedValueOnce([{ id: "document-1", status: "VALIDATING" }])
      .mockResolvedValueOnce([{ id: "document-1", status: "READY" }]);

    await expect(waitForReceiptReady(BASE, "document-1", { intervalMs: 1 })).resolves.toBeUndefined();
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it("avisa si el archivo no pasa la validación", async () => {
    apiMock.get.mockResolvedValue([{ id: "document-1", status: "FAILED" }]);

    await expect(waitForReceiptReady(BASE, "document-1", { intervalMs: 1 })).rejects.toThrow(
      /no pasó la validación/,
    );
  });

  it("no espera para siempre: explica que la constancia ya quedó subida", async () => {
    apiMock.get.mockResolvedValue([{ id: "document-1", status: "VALIDATING" }]);

    await expect(
      waitForReceiptReady(BASE, "document-1", { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/ya quedó subida/);
  });
});
