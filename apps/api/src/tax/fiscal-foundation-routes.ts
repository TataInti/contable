import type { FastifyInstance } from "fastify";
import { tenantContextFromRequest } from "../auth/tenant.js";
import {
  FiscalError,
  FiscalMasterService,
  TaxpayerProfileService,
  TaxPeriodService,
  TaxRuleService,
  TaxCalendarService,
} from "./fiscal-foundation-service.js";
import { rulePackValidator } from "./rule-pack-validator.js";
import { z } from "zod";

/** Con `exactOptionalPropertyTypes`, los opcionales se pasan sólo si están definidos. */
function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Rutas de la fundación fiscal (Puerta 1).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 *
 * G1-02: maestros (jurisdicción, autoridad, impuesto, régimen).
 * G1-03: perfil fiscal, inscripciones, actividades y matrícula.
 * G1-04: períodos y obligaciones.
 * G1-05: rule packs, versiones, fuentes y aprobaciones.
 */

export function fiscalFoundationRoutes(app: FastifyInstance) {
  const masters = new FiscalMasterService();
  const profiles = new TaxpayerProfileService();
  const periods = new TaxPeriodService();
  const rules = new TaxRuleService();
  const calendar = new TaxCalendarService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof FiscalError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // ------------------------------------------------------------------
  // G1-02: Maestros
  // ------------------------------------------------------------------

  app.get("/api/v1/tax/jurisdictions", async (req, reply) => {
    try {
      const data = await masters.listJurisdictions(tenantContextFromRequest(req));
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/jurisdictions", async (req, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(160),
        kind: z.enum(["NATIONAL", "PROVINCIAL", "MUNICIPAL"]),
        parentId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await masters.createJurisdiction(tenantContextFromRequest(req), pickDefined(body) as { code: string; name: string; kind: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL"; parentId?: string });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/types", async (req, reply) => {
    try {
      const data = await masters.listTaxTypes(tenantContextFromRequest(req));
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/types", async (req, reply) => {
    const body = z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(160) }).strict().parse(req.body);
    try {
      const data = await masters.createTaxType(tenantContextFromRequest(req), body);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/regimes", async (req, reply) => {
    try {
      const data = await masters.listRegimes(tenantContextFromRequest(req));
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/regimes", async (req, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(160),
        taxTypeId: z.string().uuid(),
        jurisdictionId: z.string().uuid(),
        authorityId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await masters.createRegime(tenantContextFromRequest(req), body);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/activities", async (req, reply) => {
    const q = z.object({ jurisdictionId: z.string().uuid().optional() }).parse(req.query);
    try {
      const data = await masters.listActivities(tenantContextFromRequest(req), q.jurisdictionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/activities", async (req, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(40),
        name: z.string().min(1).max(200),
        jurisdictionId: z.string().uuid(),
        source: z.string().max(200).optional(),
        validFrom: z.string().date(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await masters.createActivity(tenantContextFromRequest(req), pickDefined(body) as { code: string; name: string; jurisdictionId: string; source?: string; validFrom: string });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G1-03: Perfil fiscal
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-profile-versions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await profiles.listVersions(ctx);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-profile-versions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        legalName: z.string().min(1).max(200),
        cuit: z.string().regex(/^\d{11}$/),
        personType: z.enum(["FISICA", "JURIDICA"]),
        nationalCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", "NO_RESPONSABLE"]),
        fiscalAddress: z.string().max(300).optional(),
        fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
        validFrom: z.string().date(),
        source: z.string().max(200).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await profiles.createProfile(ctx, pickDefined({ ...body, clientId: ctx.clientId! }) as { clientId: string; legalName: string; cuit: string; personType: "FISICA" | "JURIDICA"; nationalCondition: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTISTA" | "EXENTO" | "NO_RESPONSABLE"; fiscalAddress?: string; fiscalYearEndMonth?: number; validFrom: string; source?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-profile-versions/:profileVersionId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { profileVersionId } = req.params as { profileVersionId: string };
    try {
      const data = await profiles.submitReview(ctx, profileVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-profile-versions/:profileVersionId/activate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { profileVersionId } = req.params as { profileVersionId: string };
    try {
      const data = await profiles.activate(ctx, profileVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-registrations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        profileVersionId: z.string().uuid(),
        regimeId: z.string().uuid(),
        validFrom: z.string().date(),
        validTo: z.string().date().optional(),
        registrationNumber: z.string().max(80).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await profiles.addRegistration(ctx, pickDefined({ clientId: ctx.clientId!, ...body }) as { clientId: string; profileVersionId: string; regimeId: string; validFrom: string; validTo?: string; registrationNumber?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-registrations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await profiles.listRegistrations(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/tax-registrations/:registrationId/cancel",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { registrationId } = req.params as { registrationId: string };
      const body = z.object({ validTo: z.string().date() }).strict().parse(req.body);
      try {
        const data = await profiles.cancelRegistration(ctx, { registrationId, validTo: body.validTo });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post("/api/v1/firms/:firmId/clients/:clientId/activities", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        profileVersionId: z.string().uuid(),
        activityId: z.string().uuid(),
        isPrimary: z.boolean().optional(),
        validFrom: z.string().date(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await profiles.addClientActivity(ctx, pickDefined({ clientId: ctx.clientId!, ...body }) as { clientId: string; profileVersionId: string; activityId: string; isPrimary?: boolean; validFrom: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/activities", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await profiles.listClientActivities(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/activities/:clientActivityId/end",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { clientActivityId } = req.params as { clientActivityId: string };
      const body = z.object({ validTo: z.string().date() }).strict().parse(req.body);
      try {
        const data = await profiles.endClientActivity(ctx, { clientActivityId, validTo: body.validTo });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post("/api/v1/tax/credentials", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        userId: z.string().uuid(),
        jurisdictionId: z.string().uuid(),
        authorityId: z.string().uuid(),
        registrationNumber: z.string().min(1).max(80),
        validFrom: z.string().date(),
        validTo: z.string().date().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await profiles.addCredential(ctx, pickDefined(body) as { userId: string; jurisdictionId: string; authorityId: string; registrationNumber: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G1-04: Períodos y obligaciones
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-periods", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        taxTypeId: z.string().uuid(),
        startDate: z.string().date(),
        endDate: z.string().date(),
        label: z.string().max(120).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await periods.createPeriod(ctx, pickDefined({ clientId: ctx.clientId!, ...body }) as { clientId: string; taxTypeId: string; startDate: string; endDate: string; label?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-obligations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await periods.listObligations(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-obligations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        profileVersionId: z.string().uuid(),
        regimeId: z.string().uuid(),
        periodId: z.string().uuid(),
        dueDate: z.string().date().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await periods.materializeObligation(ctx, pickDefined({ clientId: ctx.clientId!, ...body }) as { clientId: string; profileVersionId: string; regimeId: string; periodId: string; dueDate?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G1-05: Reglas fiscales
  // ------------------------------------------------------------------

  app.get("/api/v1/tax/rule-packs", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await rules.listPacks(ctx);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/rule-packs/:packId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    try {
      const data = await rules.getPack(ctx, packId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({ code: z.string().min(1).max(40), name: z.string().min(1).max(160), regimeId: z.string().uuid() })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.createPack(ctx, body);
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs/:packId/versions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    const body = z
      .object({
        validFrom: z.string().date(),
        validTo: z.string().date().optional(),
        engineVersion: z.string().min(1).max(80),
        rulesHash: z.string().min(1).max(128),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.createVersion(ctx, pickDefined({ ...body, packId }) as { packId: string; validFrom: string; validTo?: string; engineVersion: string; rulesHash: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs/:packId/versions/clone", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    const body = z.object({ validFrom: z.string().date(), validTo: z.string().date().optional() }).strict().parse(req.body);
    try {
      const data = await rules.cloneVersion(ctx, pickDefined({ packId, ...body }) as { packId: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/rate-rules", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    const body = z
      .object({
        concept: z.string().min(1).max(80),
        rate: z.string().regex(/^\d+(\.\d+)?$/),
        activityCode: z.string().max(40).optional(),
        jurisdictionId: z.string().uuid().optional(),
        minAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        validFrom: z.string().date(),
        validTo: z.string().date().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.addRateRule(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; concept: string; rate: string; activityCode?: string; jurisdictionId?: string; minAmount?: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put("/api/v1/tax/rule-versions/:ruleVersionId/rate-rules", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    const rate = z.string().regex(/^\d+(\.\d+)?$/).optional();
    const body = z
      .object({
        rules: z
          .array(
            z
              .object({
                concept: z.string().min(1).max(80),
                rate,
                activityCode: z.string().max(40).optional(),
                jurisdictionId: z.string().uuid().optional(),
                minAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
                validFrom: z.string().date(),
                validTo: z.string().date().optional(),
              })
              .strict()
              .refine((rule) => Boolean(rule.rate || rule.minAmount), "Cada regla debe tener una tasa o importe"),
          )
          .max(500),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.replaceRateRules(ctx, { ruleVersionId, rules: body.rules });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/due-date-rules", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    const body = z
      .object({
        jurisdictionId: z.string().uuid(),
        frequency: z.string().max(40).optional(),
        dueDay: z.number().int().min(1).max(31),
        cuitEnding: z.string().max(4).optional(),
        validFrom: z.string().date(),
        validTo: z.string().date().optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.addDueDateRule(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; jurisdictionId: string; frequency?: string; dueDay: number; cuitEnding?: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/sources", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    const body = z
      .object({
        authorityId: z.string().uuid(),
        title: z.string().min(1).max(300),
        url: z.string().url().optional(),
        reference: z.string().max(120).optional(),
        fileChecksum: z.string().max(128).optional(),
        consultedAt: z.string().date(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.addSource(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; authorityId: string; title: string; url?: string; reference?: string; fileChecksum?: string; consultedAt: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const data = await rules.submitReview(ctx, ruleVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/approve", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    const body = z
      .object({
        credentialId: z.string().uuid(),
        comment: z.string().max(500).optional(),
        goldenResultsHash: z.string().max(128).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await rules.approve(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; credentialId: string; comment?: string; goldenResultsHash?: string });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/activate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const data = await rules.activate(ctx, ruleVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/credentials", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await rules.listCredentials(ctx);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G1-10: Calendario fiscal (feriados y vencimientos deterministas)
  // ------------------------------------------------------------------

  app.get("/api/v1/tax/holidays", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z.object({ jurisdictionId: z.string().uuid() }).parse(req.query);
    try {
      const data = await calendar.listHolidays(ctx, q.jurisdictionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/holidays", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({ jurisdictionId: z.string().uuid(), date: z.string().date(), name: z.string().max(160).optional() })
      .strict()
      .parse(req.body);
    try {
      const data = await calendar.addHoliday(ctx, pickDefined(body) as { jurisdictionId: string; date: string; name?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // F2.3: revalidación programada de rule packs (fail-safe: retira packs sin versión vigente).
  app.post("/api/v1/firms/:firmId/tax/rule-packs/revalidate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const results = await rulePackValidator.revalidateAll(ctx);
      return reply.send({ data: results });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Materializa la obligación calculando el vencimiento desde la regla vigente.
  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-obligations/from-calendar", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        profileVersionId: z.string().uuid(),
        regimeId: z.string().uuid(),
        periodId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await calendar.materializeObligationWithDueDate(ctx, { clientId: ctx.clientId!, ...body });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export function withTenantContext() {
  return tenantContextFromRequest;
}
