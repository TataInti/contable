import type { FastifyInstance } from "fastify";
import {
  createClientSchema,
  updateClientSchema,
  createClientContactSchema,
  updateClientContactSchema,
  clientProfilePatchInputSchema,
  createAccountSchema,
  createCounterpartySchema,
  createCostCenterSchema,
  createFiscalYearSchema,
  matchAccountingStandards,
  matchIibbJurisdictions,
  ARGENTINA_PROVINCES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  unknownClientProfileCategoryValues,
} from "@contable/contracts";
import { ClientRepository } from "./client-repository.js";
import { tenantContextFromRequest, withTenantContext } from "../auth/tenant.js";
import { FiscalMasterService } from "../tax/fiscal-foundation-service.js";

/**
 * Rutas de clientes y maestros (Fase 3).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function clientRoutes(app: FastifyInstance) {
  const repo = new ClientRepository();
  const masters = new FiscalMasterService();

  // Crear cliente
  app.post("/api/v1/firms/:firmId/clients", async (req, reply) => {
    const { firmId } = req.params as { firmId: string };
    const body = createClientSchema.parse(req.body);
    const ctx = tenantContextFromRequest(req);
    const activities = body.activity ? await masters.listActivities(ctx) : [];
    const unknown = unknownClientProfileCategoryValues(
      {
        ...(body.vatCondition !== undefined ? { vatCondition: body.vatCondition } : {}),
        ...(body.province !== undefined ? { province: body.province } : {}),
        ...(body.activity !== undefined ? { activity: body.activity } : {}),
        ...(body.legalForm !== undefined ? { legalForm: body.legalForm } : {}),
      },
      activities,
    );
    if (Object.keys(unknown).length > 0) {
      return reply.status(422).send({
        error: {
          code: "CLIENT_PROFILE_CATEGORY_UNKNOWN",
          message: "La actividad principal debe pertenecer al catálogo fiscal del estudio.",
          details: {
            unknown,
            available: {
              vatCondition: [...CLIENT_VAT_CONDITIONS],
              province: [...ARGENTINA_PROVINCES],
              activity: activities
                .filter((activity) => activity.isActive !== false)
                .map(clientEconomicActivityValue),
              legalForm: [...CLIENT_LEGAL_FORMS],
            },
          },
          requestId: req.id,
        },
      });
    }
    const client = await repo.create(firmId, body, ctx);
    return reply.status(201).send({ data: client });
  });

  // Actualizar identidad y estado conservando el ID del cliente.
  app.patch("/api/v1/firms/:firmId/clients/:clientId", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = updateClientSchema.parse(req.body);
    const client = await repo.updateIdentity(
      firmId,
      clientId,
      body,
      tenantContextFromRequest(req),
    );
    return reply.send({ data: client });
  });

  // Contactos: la colección conserva filas ocultas para poder mostrarlas otra vez.
  app.get("/api/v1/firms/:firmId/clients/:clientId/contacts", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const contacts = await repo.listContacts(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data: contacts });
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/contacts", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = createClientContactSchema.parse(req.body);
    const contact = await repo.createContact(
      firmId,
      clientId,
      body,
      tenantContextFromRequest(req),
    );
    return reply.status(201).send({ data: contact });
  });

  app.patch("/api/v1/firms/:firmId/clients/:clientId/contacts/:contactId", async (req, reply) => {
    const { firmId, clientId, contactId } = req.params as {
      firmId: string;
      clientId: string;
      contactId: string;
    };
    const body = updateClientContactSchema.parse(req.body);
    const contact = await repo.updateContact(
      firmId,
      clientId,
      contactId,
      body,
      tenantContextFromRequest(req),
    );
    return reply.send({ data: contact });
  });

  // Catálogo de actividad principal para la ficha. Reutiliza EconomicActivity
  // (el mismo maestro que usa el onboarding fiscal) con permiso de lectura de
  // clientes, sin abrir permisos de administración de reglas fiscales.
  app.get("/api/v1/firms/:firmId/client-profile-catalogs/activities", async (req, reply) => {
    const data = await masters.listActivities(tenantContextFromRequest(req), undefined, true);
    return reply.send({ data });
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

  // Vista consolidada del cliente: concentra la ficha, períodos y configuración
  // para que el estudio no tenga que reconstruir el contexto desde cada módulo.
  app.get("/api/v1/firms/:firmId/clients/:clientId/summary", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const data = await withTenantContext(tenantContextFromRequest(req), async (tx) => {
      const client = await tx.client.findFirst({
        where: { firmId, id: clientId },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          cuit: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          profile: {
            select: {
              functionalCurrency: true,
              accountingStandard: true,
              fiscalYearEndMonth: true,
              vatCondition: true,
              iibbJurisdictions: true,
              province: true,
              activity: true,
              legalForm: true,
              serviceStartDate: true,
              updatedAt: true,
            },
          },
          onboarding: { select: { completed: true, updatedAt: true } },
        },
      });
      if (!client) return null;

      const [fiscalYears, profiles, registrations, activities, taxPeriods, obligations, accountCount, counterpartyCount, costCenterCount] =
        await Promise.all([
          tx.fiscalYear.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              label: true,
              startDate: true,
              endDate: true,
              status: true,
              periods: {
                select: { id: true, startDate: true, endDate: true, ordinal: true, status: true },
                orderBy: { ordinal: "asc" },
              },
            },
            orderBy: { startDate: "desc" },
          }),
          tx.taxpayerProfileVersion.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              version: true,
              legalName: true,
              cuit: true,
              personType: true,
              nationalCondition: true,
              fiscalAddress: true,
              fiscalYearEndMonth: true,
              monotributoCategory: true,
              validFrom: true,
              validTo: true,
              status: true,
              source: true,
              createdAt: true,
            },
            orderBy: { version: "desc" },
            take: 100,
          }),
          tx.taxRegistration.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              status: true,
              validFrom: true,
              validTo: true,
              registrationNumber: true,
              profile: { select: { id: true, version: true } },
              regime: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  isActive: true,
                  taxType: { select: { id: true, code: true, name: true, isActive: true } },
                  jurisdiction: { select: { id: true, code: true, name: true, isActive: true } },
                },
              },
            },
            orderBy: [{ status: "asc" }, { validFrom: "desc" }],
            take: 300,
          }),
          tx.clientActivity.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              isPrimary: true,
              validFrom: true,
              validTo: true,
              profile: { select: { version: true } },
              activity: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  isActive: true,
                  jurisdiction: { select: { code: true, name: true, isActive: true } },
                },
              },
            },
            orderBy: [{ isPrimary: "desc" }, { validFrom: "desc" }],
            take: 300,
          }),
          tx.taxPeriod.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              startDate: true,
              endDate: true,
              label: true,
              taxType: { select: { id: true, code: true, name: true, isActive: true } },
            },
            orderBy: [{ startDate: "desc" }, { taxType: { code: "asc" } }],
            take: 500,
          }),
          tx.taxObligation.findMany({
            where: { firmId, clientId },
            select: {
              id: true,
              status: true,
              dueDate: true,
              profile: { select: { version: true } },
              regime: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  isActive: true,
                  taxType: { select: { id: true, code: true, name: true, isActive: true } },
                  jurisdiction: { select: { id: true, code: true, name: true, isActive: true } },
                },
              },
              period: { select: { id: true, label: true, startDate: true, endDate: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 500,
          }),
          tx.account.count({ where: { firmId, clientId } }),
          tx.counterparty.count({ where: { firmId, clientId } }),
          tx.costCenter.count({ where: { firmId, clientId, isActive: true } }),
        ]);

      return {
        client,
        accounting: { fiscalYears },
        fiscal: { profiles, registrations, activities, periods: taxPeriods, obligations },
        counts: { accounts: accountCount, counterparties: counterpartyCount, costCenters: costCenterCount },
      };
    });

    if (!data) {
      return reply.status(404).send({ error: { code: "CLIENT_NOT_FOUND", message: "Cliente no encontrado" } });
    }
    return reply.send({ data });
  });

  // Actualizar perfil contable/fiscal
  app.patch("/api/v1/firms/:firmId/clients/:clientId/profile", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = clientProfilePatchInputSchema.parse(req.body);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) clean[k] = v;
    }
    const categoryValues = {
      ...(body.vatCondition !== undefined ? { vatCondition: body.vatCondition } : {}),
      ...(body.province !== undefined ? { province: body.province } : {}),
      ...(body.activity !== undefined ? { activity: body.activity } : {}),
      ...(body.legalForm !== undefined ? { legalForm: body.legalForm } : {}),
    };
    const hasCategoryValues = Object.values(categoryValues).some((value) => value !== undefined);
    if (hasCategoryValues) {
      const ctx = tenantContextFromRequest(req);
      const existing = await withTenantContext(ctx, (tx) =>
        tx.clientProfile.findFirst({
          where: { firmId, clientId },
          select: {
            vatCondition: true,
            province: true,
            activity: true,
            legalForm: true,
          },
        }),
      );
      const activities = await masters.listActivities(ctx);
      const unknown = unknownClientProfileCategoryValues(
        categoryValues,
        activities,
        {
          ...(existing?.vatCondition != null ? { vatCondition: existing.vatCondition } : {}),
          ...(existing?.province != null ? { province: existing.province } : {}),
          ...(existing?.activity != null ? { activity: existing.activity } : {}),
          ...(existing?.legalForm != null ? { legalForm: existing.legalForm } : {}),
        },
      );
      if (Object.keys(unknown).length > 0) {
        return reply.status(422).send({
          error: {
            code: "CLIENT_PROFILE_CATEGORY_UNKNOWN",
            message: "Elegí una opción del catálogo. Los valores históricos se conservan mientras no se modifiquen.",
            details: {
              unknown,
              available: {
                vatCondition: [...CLIENT_VAT_CONDITIONS],
                province: [...ARGENTINA_PROVINCES],
                activity: activities
                  .filter((activity) => activity.isActive !== false)
                  .map(clientEconomicActivityValue),
                legalForm: [...CLIENT_LEGAL_FORMS],
              },
            },
            requestId: req.id,
          },
        });
      }
      // Una opción vacía limpia el campo explícitamente; los valores históricos
      // no matcheados se mantienen sin cambios si el usuario no los reemplaza.
      for (const field of ["vatCondition", "province", "activity", "legalForm"] as const) {
        if (clean[field] === "") clean[field] = null;
      }
    }
    // Jurisdicciones IIBB: validación contra el catálogo fiscal existente.
    // Valores sin match → 422 con detalle; no se inventan códigos ni se
    // borra información guardada (el rechazo no modifica el perfil).
    if (Array.isArray(clean.iibbJurisdictions) && (clean.iibbJurisdictions as string[]).length > 0) {
      const catalog = await masters.listJurisdictions(tenantContextFromRequest(req), true);
      const { canonical, unknown } = matchIibbJurisdictions(catalog, clean.iibbJurisdictions as string[]);
      const existing = await withTenantContext(tenantContextFromRequest(req), (tx) =>
        tx.clientProfile.findFirst({
          where: { firmId, clientId },
          select: { iibbJurisdictions: true },
        }),
      );
      const inactiveNewValues = canonical.filter((code) =>
        catalog.some((entry) => entry.code === code && !entry.isActive) &&
        !existing?.iibbJurisdictions.includes(code),
      );
      const rejected = [...unknown, ...inactiveNewValues];
      if (rejected.length > 0) {
        return reply.status(422).send({
          error: {
            code: "IIBB_JURISDICTION_UNKNOWN",
            message: `Jurisdicciones fuera de las opciones activas: ${rejected.join(", ")}. Seleccioná jurisdicciones activas del catálogo.`,
            details: {
              unknown: rejected,
              available: catalog.filter((entry) => entry.isActive).map((entry) => entry.code),
            },
            requestId: req.id,
          },
        });
      }
      clean.iibbJurisdictions = canonical;
    }
    // Norma contable: validación contra el catálogo definido por el estudio
    // (tabla accounting_standards). Valores sin match → 422 con detalle; los
    // matcheados se canonicalizan al nombre del catálogo. Se validan también
    // las normas desactivadas: desactivar no invalida a los clientes que ya
    // las tienen asignadas. Los datos legacy se conservan en lectura; el
    // rechazo ocurre sólo al guardar y no modifica el perfil.
    if (typeof clean.accountingStandard === "string" && clean.accountingStandard.trim() !== "") {
      const catalog = await withTenantContext(tenantContextFromRequest(req), (tx) =>
        tx.accountingStandard.findMany({
          where: { firmId },
          select: { name: true, isActive: true },
        }),
      );
      const { canonical, unknown } = matchAccountingStandards(catalog, [
        clean.accountingStandard as string,
      ]);
      if (unknown.length > 0) {
        return reply.status(422).send({
          error: {
            code: "ACCOUNTING_STANDARD_UNKNOWN",
            message: `Norma contable fuera del catálogo del estudio: ${unknown.join(", ")}. Definila en Administración o elegí una del catálogo.`,
            details: {
              unknown,
              available: catalog.map((entry) => entry.name),
            },
            requestId: req.id,
          },
        });
      }
      clean.accountingStandard = canonical[0];
    }
    // Cadena vacía = limpiar la norma explícitamente (null, no "").
    if (clean.accountingStandard === "") clean.accountingStandard = null;
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
