import type { FastifyInstance } from "fastify";
import { tenantContextFromRequest } from "../auth/tenant.js";
import {
  FiscalError,
  FiscalMasterService,
  TaxpayerProfileService,
  TaxPeriodService,
  TaxRuleService,
  TaxCalendarService,
  type TaxpayerProfileChanges,
} from "./fiscal-foundation-service.js";
import { rulePackValidator } from "./rule-pack-validator.js";
import {
  createEconomicActivitySchema,
  updateEconomicActivitySchema,
} from "@contable/contracts";
import { z } from "zod";
import {
  RuleSimulationError,
  RuleSimulationService,
  type RuleSimulationInput,
} from "./rule-simulation.js";

/** Con `exactOptionalPropertyTypes`, los opcionales se pasan sólo si están definidos. */
function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const ruleVersionDateSchema = z
  .string()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "La fecha debe tener el formato AAAA-MM-DD y un año entre 1900 y 2100.",
  })
  .pipe(z.string().date())
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 1900 && year <= 2100;
  }, {
    message: "El año de vigencia debe estar entre 1900 y 2100.",
  });

function validateRuleVersionRange(
  value: { validFrom: string; validTo?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.validTo && value.validTo < value.validFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validTo"],
      message: "La vigencia hasta debe ser igual o posterior a la vigencia desde.",
    });
  }
}

export const createRulePackVersionSchema = z
  .object({
    validFrom: ruleVersionDateSchema,
    validTo: ruleVersionDateSchema.optional(),
    engineId: z.string().uuid().optional(),
    engineVersion: z.string().min(1).max(80).optional(),
    rulesHash: z.string().min(1).max(128),
  })
  .strict()
  .refine((value) => Boolean(value.engineId || value.engineVersion), {
    path: ["engineId"],
    message: "Seleccioná un motor del catálogo",
  })
  .superRefine(validateRuleVersionRange);

const cloneRulePackVersionSchema = z
  .object({
    validFrom: ruleVersionDateSchema,
    validTo: ruleVersionDateSchema.optional(),
  })
  .strict()
  .superRefine(validateRuleVersionRange);

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
  const simulation = new RuleSimulationService();
  const calendar = new TaxCalendarService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
          details: err.issues.map(({ path, message }) => ({ path, message })),
        },
      });
    }
    if (err instanceof FiscalError) {
      const status = /NOT_FOUND/.test(err.code) ? 404 : err.path ? 422 : 409;
      return reply.status(status).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.path ? { details: { path: err.path } } : {}),
        },
      });
    }
    app.log.error({ err }, "Error interno de la fundación fiscal");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Ocurrió un error interno" },
    });
  };

  // ------------------------------------------------------------------
  // G1-02: Maestros
  // ------------------------------------------------------------------

  app.get("/api/v1/tax/jurisdictions", async (req, reply) => {
    const query = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).strict().parse(req.query);
    try {
      const data = await masters.listJurisdictions(tenantContextFromRequest(req), query.includeInactive === "true");
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/jurisdictions", async (req, reply) => {
    try {
      const body = z
        .object({
          code: z.string().trim().min(1).max(40),
          name: z.string().trim().min(1).max(160),
          kind: z.enum(["NATIONAL", "PROVINCIAL", "MUNICIPAL"]),
          parentId: z.string().uuid().optional(),
          duplicateOfId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      const data = await masters.createJurisdiction(tenantContextFromRequest(req), pickDefined(body) as { code: string; name: string; kind: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL"; parentId?: string; duplicateOfId?: string });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/tax/jurisdictions/:jurisdictionId", async (req, reply) => {
    const { jurisdictionId } = req.params as { jurisdictionId: string };
    try {
      const body = z
        .object({
          code: z.string().trim().min(1).max(40).optional(),
          name: z.string().trim().min(1).max(160).optional(),
          kind: z.enum(["NATIONAL", "PROVINCIAL", "MUNICIPAL"]).optional(),
          parentId: z.string().uuid().nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.values(value).some((field) => field !== undefined), {
          message: "Indicá al menos un campo para actualizar",
        })
        .parse(req.body);
      const data = await masters.updateJurisdiction(tenantContextFromRequest(req), {
        jurisdictionId,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/calc-families", async (req, reply) => {
    try {
      const data = await masters.listCalcFamilies(tenantContextFromRequest(req));
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/regime-modules", async (req, reply) => {
    try {
      const data = await masters.listRegimeModules(tenantContextFromRequest(req));
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/types", async (req, reply) => {
    const query = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).strict().parse(req.query);
    try {
      const data = await masters.listTaxTypes(tenantContextFromRequest(req), query.includeInactive === "true");
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/types", async (req, reply) => {
    try {
      const body = z.object({
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(160),
        defaultFamilyId: z.string().uuid().optional(),
        duplicateOfId: z.string().uuid().optional(),
      }).strict().parse(req.body);
      const data = await masters.createTaxType(tenantContextFromRequest(req), {
        code: body.code,
        name: body.name,
        ...(body.defaultFamilyId !== undefined ? { defaultFamilyId: body.defaultFamilyId } : {}),
        ...(body.duplicateOfId !== undefined ? { duplicateOfId: body.duplicateOfId } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/tax/types/:taxTypeId", async (req, reply) => {
    const { taxTypeId } = req.params as { taxTypeId: string };
    try {
      const body = z
        .object({
          code: z.string().trim().min(1).max(40).optional(),
          name: z.string().trim().min(1).max(160).optional(),
          defaultFamilyId: z.string().uuid().nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.values(value).some((field) => field !== undefined), {
          message: "Indicá al menos un campo para actualizar",
        })
        .parse(req.body);
      const data = await masters.updateTaxType(tenantContextFromRequest(req), {
        taxTypeId,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.defaultFamilyId !== undefined ? { defaultFamilyId: body.defaultFamilyId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/authorities", async (req, reply) => {
    const query = z.object({
      jurisdictionId: z.string().uuid().optional(),
      includeInactive: z.enum(["true", "false"]).optional(),
    }).strict().parse(req.query);
    try {
      const data = await masters.listTaxAuthorities(
        tenantContextFromRequest(req),
        query.jurisdictionId,
        query.includeInactive === "true",
      );
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/authorities", async (req, reply) => {
    try {
      const body = z
        .object({
          code: z.string().trim().min(1).max(40),
          name: z.string().trim().min(1).max(160),
          jurisdictionId: z.string().uuid(),
          duplicateOfId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      const data = await masters.createTaxAuthority(tenantContextFromRequest(req), {
        code: body.code,
        name: body.name,
        jurisdictionId: body.jurisdictionId,
        ...(body.duplicateOfId !== undefined ? { duplicateOfId: body.duplicateOfId } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/tax/authorities/:authorityId", async (req, reply) => {
    const { authorityId } = req.params as { authorityId: string };
    try {
      const body = z.object({
        code: z.string().trim().min(1).max(40).optional(),
        name: z.string().trim().min(1).max(160).optional(),
        jurisdictionId: z.string().uuid().optional(),
        isActive: z.boolean().optional(),
      }).strict().refine((value) => Object.values(value).some((field) => field !== undefined), {
        message: "Indicá al menos un campo para actualizar",
      }).parse(req.body);
      const data = await masters.updateTaxAuthority(tenantContextFromRequest(req), {
        authorityId,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.jurisdictionId !== undefined ? { jurisdictionId: body.jurisdictionId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/regimes/:regimeId/engines", async (req, reply) => {
    try {
      const { regimeId } = z.object({ regimeId: z.string().uuid() }).parse(req.params);
      const data = await masters.listEnginesForRegime(tenantContextFromRequest(req), regimeId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/regimes/:regimeId/rule-kinds", async (req, reply) => {
    try {
      const { regimeId } = z.object({ regimeId: z.string().uuid() }).parse(req.params);
      const data = await masters.listRuleKindsForRegime(tenantContextFromRequest(req), regimeId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/regimes", async (req, reply) => {
    const query = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).strict().parse(req.query);
    try {
      const data = await masters.listRegimes(tenantContextFromRequest(req), query.includeInactive === "true");
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/regimes", async (req, reply) => {
    try {
      const body = z
        .object({
          code: z.string().min(1).max(40),
          name: z.string().min(1).max(160),
          taxTypeId: z.string().uuid(),
          jurisdictionId: z.string().uuid(),
          authorityId: z.string().uuid(),
          calcFamilyId: z.string().uuid().optional(),
          moduleId: z.string().uuid().optional(),
          duplicateOfId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      const data = await masters.createRegime(tenantContextFromRequest(req), {
        code: body.code,
        name: body.name,
        taxTypeId: body.taxTypeId,
        jurisdictionId: body.jurisdictionId,
        authorityId: body.authorityId,
        ...(body.calcFamilyId !== undefined ? { calcFamilyId: body.calcFamilyId } : {}),
        ...(body.moduleId !== undefined ? { moduleId: body.moduleId } : {}),
        ...(body.duplicateOfId !== undefined ? { duplicateOfId: body.duplicateOfId } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/tax/regimes/:regimeId", async (req, reply) => {
    const { regimeId } = req.params as { regimeId: string };
    try {
      const body = z.object({
        code: z.string().trim().min(1).max(40).optional(),
        name: z.string().trim().min(1).max(160).optional(),
        taxTypeId: z.string().uuid().optional(),
        jurisdictionId: z.string().uuid().optional(),
        authorityId: z.string().uuid().optional(),
        calcFamilyId: z.string().uuid().nullable().optional(),
        moduleId: z.string().uuid().nullable().optional(),
        isActive: z.boolean().optional(),
      }).strict().refine((value) => Object.values(value).some((field) => field !== undefined), {
        message: "Indicá al menos un campo para actualizar",
      }).parse(req.body);
      const data = await masters.updateRegime(tenantContextFromRequest(req), {
        regimeId,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.taxTypeId !== undefined ? { taxTypeId: body.taxTypeId } : {}),
        ...(body.jurisdictionId !== undefined ? { jurisdictionId: body.jurisdictionId } : {}),
        ...(body.authorityId !== undefined ? { authorityId: body.authorityId } : {}),
        ...(body.calcFamilyId !== undefined ? { calcFamilyId: body.calcFamilyId } : {}),
        ...(body.moduleId !== undefined ? { moduleId: body.moduleId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/activities", async (req, reply) => {
    try {
      const q = z
        .object({
          jurisdictionId: z.string().uuid().optional(),
          includeInactive: z.enum(["true", "false"]).optional(),
        })
        .strict()
        .parse(req.query);
      const data = await masters.listActivities(
        tenantContextFromRequest(req),
        q.jurisdictionId,
        q.includeInactive === "true",
      );
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/catalog-usage/:kind/:catalogId", async (req, reply) => {
    const { kind, catalogId } = req.params as { kind: string; catalogId: string };
    try {
      const catalogKind = z.enum(["jurisdiction", "taxType", "authority", "regime", "activity"]).parse(kind);
      const data = await masters.getCatalogUsage(tenantContextFromRequest(req), catalogKind, catalogId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/activities", async (req, reply) => {
    try {
      const body = createEconomicActivitySchema.extend({ duplicateOfId: z.string().uuid().optional() }).parse(req.body);
      const data = await masters.createActivity(tenantContextFromRequest(req), pickDefined(body) as {
        code: string;
        name: string;
        jurisdictionId: string;
        source?: string;
        validFrom: string;
        validTo?: string;
        duplicateOfId?: string;
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/tax/activities/:activityId", async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    try {
      const body = updateEconomicActivitySchema.parse(req.body);
      const data = await masters.updateActivity(tenantContextFromRequest(req), {
        activityId,
        ...pickDefined(body),
      } as {
        activityId: string;
        code?: string;
        name?: string;
        jurisdictionId?: string;
        source?: string | null;
        validFrom?: string;
        validTo?: string | null;
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Activación/desactivación explícita (no hay borrado: el catálogo conserva
  // el historial completo y las reglas vigentes siguen resolviendo por código).
  app.post("/api/v1/tax/activities/:activityId/deactivate", async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    try {
      const data = await masters.setActivityState(tenantContextFromRequest(req), {
        activityId,
        isActive: false,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/activities/:activityId/activate", async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    try {
      const data = await masters.setActivityState(tenantContextFromRequest(req), {
        activityId,
        isActive: true,
      });
      return reply.send({ data });
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
    try {
      const body = z
        .object({
          legalName: z.string().min(1).max(200),
          cuit: z.string().regex(/^\d{11}$/),
          personType: z.enum(["FISICA", "JURIDICA"]),
          nationalCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", "NO_RESPONSABLE"]),
          fiscalAddress: z.string().max(300).optional(),
          fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
          monotributoCategory: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]).optional(),
          validFrom: z.string().date(),
          source: z.string().max(200).optional(),
        })
        .strict()
        .parse(req.body);
      const data = await profiles.createProfile(ctx, pickDefined({ ...body, clientId: ctx.clientId! }) as { clientId: string; legalName: string; cuit: string; personType: "FISICA" | "JURIDICA"; nationalCondition: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTISTA" | "EXENTO" | "NO_RESPONSABLE"; fiscalAddress?: string; fiscalYearEndMonth?: number; monotributoCategory?: string; validFrom: string; source?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  const profileChangesSchema = z
    .object({
      legalName: z.string().min(1).max(200).optional(),
      cuit: z.string().regex(/^\d{11}$/).optional(),
      personType: z.enum(["FISICA", "JURIDICA"]).optional(),
      nationalCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", "NO_RESPONSABLE"]).optional(),
      fiscalAddress: z.string().max(300).nullable().optional(),
      fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
      monotributoCategory: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]).nullable().optional(),
      validFrom: z.string().date().optional(),
    })
    .strict()
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), "Indicá al menos un cambio");

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/tax-profile-versions/:profileVersionId/versions",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { profileVersionId } = req.params as { profileVersionId: string };
      try {
        const body = z
          .object({ reason: z.string().trim().min(1).max(200), changes: profileChangesSchema })
          .strict()
          .parse(req.body);
        const data = await profiles.newVersion(ctx, {
          profileVersionId,
          reason: body.reason,
          changes: pickDefined(body.changes) as TaxpayerProfileChanges,
        });
        return reply.code(201).send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

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
    try {
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
      try {
        const body = z.object({ validTo: z.string().date() }).strict().parse(req.body);
        const data = await profiles.cancelRegistration(ctx, { registrationId, validTo: body.validTo });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post("/api/v1/firms/:firmId/clients/:clientId/activities", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = z
        .object({
          profileVersionId: z.string().uuid(),
          activityId: z.string().uuid(),
          isPrimary: z.boolean().optional(),
          validFrom: z.string().date(),
        })
        .strict()
        .parse(req.body);
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
      try {
        const body = z.object({ validTo: z.string().date() }).strict().parse(req.body);
        const data = await profiles.endClientActivity(ctx, { clientActivityId, validTo: body.validTo });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post("/api/v1/tax/credentials", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
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
      const data = await profiles.addCredential(ctx, pickDefined(body) as { userId: string; jurisdictionId: string; authorityId: string; registrationNumber: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G1-04: Períodos y obligaciones
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-periods", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await periods.listPeriods(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-periods", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = z
        .object({
          taxTypeId: z.string().uuid(),
          startDate: z.string().date(),
          endDate: z.string().date(),
          label: z.string().max(120).optional(),
        })
        .strict()
        .parse(req.body);
      const data = await periods.createPeriod(ctx, pickDefined({ clientId: ctx.clientId!, ...body }) as { clientId: string; taxTypeId: string; startDate: string; endDate: string; label?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Abre un mes: períodos y obligaciones de todos los regímenes activos del cliente.
  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-periods/open-month", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = z
        .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Indicá el mes como AAAA-MM") })
        .strict()
        .parse(req.body);
      const data = await calendar.openMonth(ctx, { clientId: ctx.clientId!, month: body.month });
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
    try {
      const body = z
        .object({
          profileVersionId: z.string().uuid(),
          regimeId: z.string().uuid(),
          periodId: z.string().uuid(),
          dueDate: z.string().date().optional(),
        })
        .strict()
        .parse(req.body);
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

  // B-1: lecturas históricas de reglas (procedencia y validación).
  app.get("/api/v1/tax/rule-packs/:packId/versions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    try {
      const data = await rules.listRuleVersions(ctx, packId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/rule-versions/:ruleVersionId/sources", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const data = await rules.getRuleVersionSources(ctx, ruleVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/tax/rule-versions/:ruleVersionId/golden-results", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const data = await rules.getRuleVersionGoldenResults(ctx, ruleVersionId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = z
        .object({ code: z.string().min(1).max(40), name: z.string().min(1).max(160), regimeId: z.string().uuid() })
        .strict()
        .parse(req.body);
      const data = await rules.createPack(ctx, body);
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs/:packId/versions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    try {
      const body = createRulePackVersionSchema.parse(req.body);
      const data = await rules.createVersion(ctx, pickDefined({ ...body, packId }) as {
        packId: string;
        validFrom: string;
        validTo?: string;
        engineId?: string;
        engineVersion?: string;
        rulesHash: string;
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-packs/:packId/versions/clone", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { packId } = req.params as { packId: string };
    try {
      const body = cloneRulePackVersionSchema.parse(req.body);
      const data = await rules.cloneVersion(ctx, pickDefined({ packId, ...body }) as { packId: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/rate-rules", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
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
    try {
      const body = z
        .object({
          rules: z
            .array(
              z
                .object({
                  concept: z.string().max(80).optional(),
                  // Los tipos de regla del catálogo de sistema se sembraron con ids
                  // "k1000000-…", que no son UUID RFC; el servicio valida que existan.
                  kindId: z.string().min(1).max(64).optional(),
                  activityId: z.string().uuid().optional(),
                  categoryCode: z.string().max(8).optional(),
                  isDefault: z.boolean().optional(),
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
      const data = await rules.replaceRateRules(ctx, {
        ruleVersionId,
        rules: body.rules.map((rule) => ({
          ...(rule.concept !== undefined ? { concept: rule.concept } : {}),
          ...(rule.kindId ? { kindId: rule.kindId } : {}),
          ...(rule.activityId ? { activityId: rule.activityId } : {}),
          ...(rule.categoryCode ? { categoryCode: rule.categoryCode } : {}),
          ...(rule.isDefault !== undefined ? { isDefault: rule.isDefault } : {}),
          ...(rule.rate ? { rate: rule.rate } : {}),
          ...(rule.activityCode ? { activityCode: rule.activityCode } : {}),
          ...(rule.jurisdictionId ? { jurisdictionId: rule.jurisdictionId } : {}),
          ...(rule.minAmount ? { minAmount: rule.minAmount } : {}),
          validFrom: rule.validFrom,
          ...(rule.validTo ? { validTo: rule.validTo } : {}),
        })),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/due-date-rules", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const body = z
        .object({
          jurisdictionId: z.string().uuid(),
          frequency: z.string().max(40).optional(),
          dueDay: z.number().int().min(1).max(31),
          monthOffset: z.number().int().min(0).max(24).optional(),
          cuitEnding: z.string().max(4).optional(),
          validFrom: z.string().date(),
          validTo: z.string().date().optional(),
        })
        .strict()
        .parse(req.body);
      const data = await rules.addDueDateRule(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; jurisdictionId: string; frequency?: string; dueDay: number; monthOffset?: number; cuitEnding?: string; validFrom: string; validTo?: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/tax/rule-versions/:ruleVersionId/sources", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
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
      const data = await rules.addSource(ctx, pickDefined({ ...body, ruleVersionId }) as { ruleVersionId: string; authorityId: string; title: string; url?: string; reference?: string; fileChecksum?: string; consultedAt: string });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Simulador: corre el motor con las reglas de la versión sobre un caso
  // cargado a mano. No persiste nada.
  app.post("/api/v1/tax/rule-versions/:ruleVersionId/simulate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { ruleVersionId } = req.params as { ruleVersionId: string };
    try {
      const amount = z.string().regex(/^\d+(\.\d{1,4})?$/);
      const body = z
        .object({
          incomes: z.array(z.object({ ruleId: z.string().uuid(), amount }).strict()).min(1).max(50),
          withholding: amount.optional(),
          perception: amount.optional(),
          collected: amount.optional(),
          previousCredit: amount.optional(),
        })
        .strict()
        .parse(req.body);
      const data = await simulation.simulate(ctx, ruleVersionId, pickDefined(body) as RuleSimulationInput);
      return reply.send({ data });
    } catch (err) {
      if (err instanceof RuleSimulationError) {
        return reply.status(err.httpStatus).send({ error: { code: err.code, message: err.message } });
      }
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
    try {
      const body = z
        .object({
          credentialId: z.string().uuid(),
          comment: z.string().max(500).optional(),
          goldenResultsHash: z.string().max(128).optional(),
        })
        .strict()
        .parse(req.body);
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
    try {
      const body = z
        .object({ jurisdictionId: z.string().uuid(), date: z.string().date(), name: z.string().max(160).optional() })
        .strict()
        .parse(req.body);
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
    try {
      const body = z
        .object({
          profileVersionId: z.string().uuid(),
          regimeId: z.string().uuid(),
          periodId: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
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