import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fiscalFoundationRoutes } from "./fiscal-foundation-routes.js";
import { TaxRuleService } from "./fiscal-foundation-service.js";

// Frecuencia de vencimientos en la ruta due-date-rules (D-R3-A), sin PostgreSQL:
// el servicio se reemplaza y la prueba mira qué recibe y qué responde la ruta.
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

const RULE_VERSION_ID = "66666666-7777-4888-8999-000000000001";
const JURISDICTION_ID = "55555555-6666-4777-8888-bbbbbbbbbbbb";

async function altaDeVencimiento(payload: Record<string, unknown>) {
  const servicio = vi
    .spyOn(TaxRuleService.prototype, "addDueDateRule")
    .mockResolvedValue({ id: "due-1" } as never);
  const app = Fastify({ logger: false });
  fiscalFoundationRoutes(app);
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tax/rule-versions/${RULE_VERSION_ID}/due-date-rules`,
      payload: { jurisdictionId: JURISDICTION_ID, dueDay: 20, validFrom: "2026-01-01", ...payload },
    });
    return { response, servicio };
  } finally {
    await app.close();
  }
}

describe("frecuencia de vencimientos en la API (D-R3-A)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["MONTHLY", "QUARTERLY", "ANNUAL", "ONCE"])("acepta %s y lo pasa al servicio", async (frequency) => {
    const { response, servicio } = await altaDeVencimiento({ frequency });
    expect(response.statusCode).toBe(201);
    expect(servicio).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ frequency }));
  });

  it("sin frecuencia la alta sigue respondiendo 201", async () => {
    const { response } = await altaDeVencimiento({});
    expect(response.statusCode).toBe(201);
  });

  // Lista cerrada: «MENSUAL» no es un alias de MONTHLY; hoy la API lo guarda tal cual.
  it.fails("rechaza MENSUAL con 400 y no llega al servicio", async () => {
    const { response, servicio } = await altaDeVencimiento({ frequency: "MENSUAL" });
    expect(response.statusCode).toBe(400);
    expect(servicio).not.toHaveBeenCalled();
  });
});
