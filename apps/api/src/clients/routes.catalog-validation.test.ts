import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activities: [] as Array<{ code: string; name: string; isActive: boolean }>,
  existingProfile: null as null | {
    vatCondition: string | null;
    province: string | null;
    activity: string | null;
    legalForm: string | null;
  },
  create: vi.fn(),
  updateProfile: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("./client-repository.js", () => ({
  ClientRepository: class {
    create = mocks.create;
    updateProfile = mocks.updateProfile;
  },
}));

vi.mock("../tax/fiscal-foundation-service.js", () => ({
  FiscalMasterService: class {
    listActivities = vi.fn(async () => mocks.activities);
  },
}));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => ({ firmId: "firm-a", userId: "user-a", actorKind: "USER" }),
  withTenantContext: async (_ctx: unknown, run: (tx: unknown) => Promise<unknown>) =>
    run({ clientProfile: { findFirst: mocks.findFirst } }),
}));

import { clientRoutes } from "./routes.js";

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.activities = [{ code: "COMERCIO", name: "Comercio", isActive: true }];
  mocks.existingProfile = null;
  mocks.findFirst.mockImplementation(async () => mocks.existingProfile);
  mocks.create.mockImplementation(async () => ({ id: "client-a" }));
  mocks.updateProfile.mockImplementation(
    async (_firmId: string, _clientId: string, data: unknown) => data,
  );
  app = Fastify();
  clientRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const validCreate = {
  legalName: "Razón social libre S.A.",
  cuit: "20111111112",
  vatCondition: "RESPONSABLE_INSCRIPTO",
  province: "Tucumán",
  activity: "COMERCIO — Comercio",
  legalForm: "Sociedad anónima (SA)",
};

describe("validación servidor de categorías de ficha cliente", () => {
  it("rechaza actividad de texto libre durante el alta antes de persistir", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/firms/firm-a/clients",
      payload: { ...validCreate, activity: "Servicios inventados" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("CLIENT_PROFILE_CATEGORY_UNKNOWN");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("valida el alta contra los catálogos y guarda también condición IVA en el perfil", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/firms/firm-a/clients",
      payload: validCreate,
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      "firm-a",
      expect.objectContaining({
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      }),
      expect.objectContaining({ firmId: "firm-a" }),
    );
  });

  it.each([
    { field: "vatCondition", value: "Condición inventada" },
    { field: "province", value: "Provincia inventada" },
    { field: "activity", value: "Actividad inventada" },
    { field: "legalForm", value: "Forma inventada" },
  ])(
    "rechaza por 422 el valor nuevo de $field en el PATCH operativo",
    async ({ field, value }: { field: string; value: string }) => {
      mocks.existingProfile = {
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        activity: "COMERCIO — Comercio",
        legalForm: "Sociedad anónima (SA)",
      };
      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/firms/firm-a/clients/client-a/profile",
        payload: { [field]: value },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("CLIENT_PROFILE_CATEGORY_UNKNOWN");
      expect(mocks.updateProfile).not.toHaveBeenCalled();
    },
  );

  it("acepta conservar sin cambios una forma jurídica histórica fuera del enum", async () => {
    mocks.existingProfile = {
      vatCondition: "Responsable inscripto",
      province: "Provincia de Tucumán",
      activity: "Servicios",
      legalForm: "SRL",
    };
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/firms/firm-a/clients/client-a/profile",
      payload: { legalForm: "SRL" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith(
      "firm-a",
      "client-a",
      expect.objectContaining({ legalForm: "SRL" }),
      expect.objectContaining({ firmId: "firm-a" }),
    );
  });
});
