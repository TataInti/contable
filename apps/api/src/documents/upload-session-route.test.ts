import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUploadSession: vi.fn(),
  getRequestItem: vi.fn(),
  getPresignedPutUrl: vi.fn(),
}));

vi.mock("./document-service.js", () => ({
  DocumentService: class {
    createUploadSession = mocks.createUploadSession;
    getRequestItem = mocks.getRequestItem;
  },
}));

vi.mock("../storage/object-storage.js", () => ({
  BUCKETS: { quarantine: "quarantine" },
  ObjectStorage: class {
    getPresignedPutUrl = mocks.getPresignedPutUrl;
  },
}));

vi.mock("../storage/file-validator.js", () => ({ MAX_FILE_SIZE: 25 * 1024 * 1024 }));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => ({ firmId: "firm-a", userId: "user-a", actorKind: "USER" }),
}));

vi.mock("../jobs/outbox-publisher.js", () => ({ outboxPublisher: {} }));

vi.mock("./reprocess-service.js", () => ({
  DocumentReprocessError: class extends Error {},
  DocumentReprocessService: class {},
}));

vi.mock("./extraction-service.js", () => ({
  ExtractionError: class extends Error {},
  ExtractionService: class {},
  InvalidCorrectionError: class extends Error {},
  MANUAL_EXTRACTION_FIELD_KEYS: ["total"],
}));

import { documentRoutes } from "./routes.js";

const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const SESSIONS_URL = `/api/v1/firms/firm-a/clients/${CLIENT_ID}/document-upload-sessions`;

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.createUploadSession.mockResolvedValue({ id: "session-1", expiresAt: new Date("2026-11-17T00:00:00Z") });
  mocks.getRequestItem.mockResolvedValue({ clientId: CLIENT_ID });
  mocks.getPresignedPutUrl.mockResolvedValue("https://storage/put");
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  documentRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function crearSesion(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: SESSIONS_URL, payload });
}

describe("sesión de upload sin pedido documental (caracterización, corte 5b-1)", () => {
  it("la constancia ACUSE sin pedido responde 201 y crea la sesión con su categoría", async () => {
    const response = await crearSesion({ category: "ACUSE" });

    expect(response.statusCode).toBe(201);
    expect(mocks.createUploadSession).toHaveBeenCalledWith(
      "firm-a",
      CLIENT_ID,
      "user-a",
      { category: "ACUSE" },
      expect.anything(),
    );
  });

  it("una categoría ajena sin pedido responde 400 y no crea la sesión", async () => {
    const response = await crearSesion({ category: "OTRO" });

    expect(response.statusCode).toBe(400);
    expect(mocks.createUploadSession).not.toHaveBeenCalled();
  });

  it("una sesión sin pedido ni categoría responde 400", async () => {
    const response = await crearSesion({});

    expect(response.statusCode).toBe(400);
    expect(mocks.createUploadSession).not.toHaveBeenCalled();
  });

  it("un documento común con pedido del cliente responde 201 sin categoría", async () => {
    const response = await crearSesion({ requestItemId: REQUEST_ITEM_ID });

    expect(response.statusCode).toBe(201);
    expect(mocks.createUploadSession).toHaveBeenCalledWith(
      "firm-a",
      CLIENT_ID,
      "user-a",
      { requestItemId: REQUEST_ITEM_ID },
      expect.anything(),
    );
  });
});

describe("sesión de upload con la declaración jurada (pruebas en rojo, corte 5b-1)", () => {
  it("la declaración jurada sin pedido responde 201 y crea la sesión con su categoría", async () => {
    const response = await crearSesion({ category: "DECLARACION_JURADA" });

    expect(response.statusCode).toBe(201);
    expect(mocks.createUploadSession).toHaveBeenCalledWith(
      "firm-a",
      CLIENT_ID,
      "user-a",
      { category: "DECLARACION_JURADA" },
      expect.anything(),
    );
  });

  it("la declaración jurada con pedido documental responde 201, igual que el acuse con pedido", async () => {
    const response = await crearSesion({ category: "DECLARACION_JURADA", requestItemId: REQUEST_ITEM_ID });

    expect(response.statusCode).toBe(201);
  });
});
