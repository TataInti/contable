import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";
import { TaxRuleService } from "./fiscal-foundation-service.js";

// Clon de versión con motor opcional (D-R3-E), sin PostgreSQL: el servicio se reemplaza y la prueba mira lo que recibe.
const contexto = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientId: "11111111-2222-4333-8444-777777777777",
  actorKind: "USER" as const,
}));

vi.mock("../auth/tenant.js", () => ({
  tenantContextFromRequest: () => contexto,
  withTenantContext: vi.fn(),
}));

const PACK_ID = "66666666-7777-4888-8999-000000000002";
const MOTOR_ID = "e1000000-0000-4000-8000-000000000001";

async function clonar(payload: Record<string, unknown>) {
  const servicio = vi
    .spyOn(TaxRuleService.prototype, "cloneVersion")
    .mockResolvedValue({ id: "version-2" } as never);
  const app = Fastify({ logger: false });
  fiscalFoundationRoutes(app);
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-packs/${PACK_ID}/versions/clone`,
      payload: { validFrom: "2026-07-01", ...payload },
    });
    return { response, servicio };
  } finally {
    await app.close();
  }
}

describe("clon de versión: motor opcional (D-R3-E)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin engineId el clon llega al servicio sin motor (comportamiento de hoy)", async () => {
    const { response, servicio } = await clonar({});
    expect(response.statusCode).toBe(201);
    expect(servicio).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ engineId: expect.anything() }),
    );
  });

  it("acepta un engineId uuid y lo pasa al servicio", async () => {
    const { response, servicio } = await clonar({ engineId: MOTOR_ID });
    expect(response.statusCode).toBe(201);
    expect(servicio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ engineId: MOTOR_ID }),
    );
  });

  it("rechaza un engineId que no es uuid con 400 y no llega al servicio", async () => {
    const { response, servicio } = await clonar({ engineId: "no-es-uuid" });
    expect(response.statusCode).toBe(400);
    expect(servicio).not.toHaveBeenCalled();
  });
});
