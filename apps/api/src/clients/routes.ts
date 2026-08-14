import type { FastifyInstance } from "fastify";
import {
  createClientSchema,
  clientProfileSchema,
  createAccountSchema,
  createCounterpartySchema,
  createCostCenterSchema,
  createFiscalYearSchema,
} from "@contable/contracts";
import { ClientRepository } from "./client-repository.js";
import { tenantContextFromRequest, withTenantContext } from "../auth/tenant.js";

/**
 * Rutas de clientes y maestros (Fase 3).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function clientRoutes(app: FastifyInstance) {
  const repo = new ClientRepository();

  // Crear cliente
  app.post("/api/v1/firms/:firmId/clients", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const body = createClientSchema.parse(req.body);
    const client = await repo.create(firmId, body, tenantContextFromRequest(req));
    return reply.status(201).send({ data: client });
  });

  // Listar clientes
  app.get("/api/v1/firms/:firmId/clients", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const clients = await repo.list(firmId, tenantContextFromRequest(req));
    return reply.send({ data: clients });
  });

  // Obtener cliente
  app.get("/api/v1/firms/:firmId/clients/:clientId", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const client = await repo.get(firmId, clientId, tenantContextFromRequest(req));
    if (!client) {
      return reply.status(404).send({ error: { code: "CLIENT_NOT_FOUND", message: "Cliente no encontrado" } });
    }
    return reply.send({ data: client });
  });

  // Actualizar perfil contable/fiscal
  app.patch("/api/v1/firms/:firmId/clients/:clientId/profile", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = clientProfileSchema.partial().parse(req.body);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) clean[k] = v;
    }
    const profile = await repo.updateProfile(firmId, clientId, clean as never, tenantContextFromRequest(req));
    return reply.send({ data: profile });
  });

  // Crear ejercicio fiscal (con períodos)
  app.post("/api/v1/firms/:firmId/clients/:clientId/fiscal-years", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createFiscalYearSchema.parse(req.body);
    const fiscalYear = await repo.createFiscalYear(firmId, clientId, body, tenantContextFromRequest(req));
    return reply.status(201).send({ data: fiscalYear });
  });

  // Listar ejercicios
  app.get("/api/v1/firms/:firmId/clients/:clientId/fiscal-years", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const fiscalYears = await withTenantContext(tenantContextFromRequest(req), (tx) => tx.fiscalYear.findMany({
      where: { firmId, clientId },
      include: { periods: true },
      orderBy: { startDate: "asc" },
    }));
    return reply.send({ data: fiscalYears });
  });

  // Cuentas
  app.post("/api/v1/firms/:firmId/clients/:clientId/accounts", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createAccountSchema.parse(req.body);
    const account = await repo.createAccount(firmId, clientId, body, tenantContextFromRequest(req));
    return reply.status(201).send({ data: account });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/accounts", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const accounts = await repo.listAccounts(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data: accounts });
  });

  // Contrapartes
  app.post("/api/v1/firms/:firmId/clients/:clientId/counterparties", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createCounterpartySchema.parse(req.body);
    const counterparty = await repo.createCounterparty(firmId, clientId, body, tenantContextFromRequest(req));
    return reply.status(201).send({ data: counterparty });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/counterparties", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const counterparties = await repo.listCounterparties(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data: counterparties });
  });

  // Centros de costo
  app.post("/api/v1/firms/:firmId/clients/:clientId/cost-centers", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createCostCenterSchema.parse(req.body);
    const costCenter = await repo.createCostCenter(firmId, clientId, body, tenantContextFromRequest(req));
    return reply.status(201).send({ data: costCenter });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/cost-centers", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const costCenters = await repo.listCostCenters(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data: costCenters });
  });
}
