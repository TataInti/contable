import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { calculateDueDate } from "@contable/tax-engine";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Servicio de fundación fiscal (Puerta 1).
 *
 * Cubre G1-02 (maestros), G1-03 (perfil fiscal), G1-04 (períodos y
 * obligaciones) y G1-05 (rule packs y reglas).
 *
 * Invariantes:
 * - Un perfil fiscal ACTIVE no se edita; corregirlo crea una versión nueva.
 * - No se pueden solapar registros incompatibles (mismo régimen + vigencia).
 * - Una regla APPROVED/ACTIVE es inmutable; corregirla crea una versión nueva.
 * - Toda mutación sensible registra createdBy/updatedBy y motivo.
 */

export type FiscalErrorCode =
  | "PROFILE_NOT_FOUND"
  | "PROFILE_ALREADY_ACTIVE"
  | "PROFILE_VERSION_CONFLICT"
  | "REGISTRATION_OVERLAP"
  | "REGISTRATION_NOT_FOUND"
  | "ACTIVITY_LINK_NOT_FOUND"
  | "REGIME_NOT_FOUND"
  | "JURISDICTION_NOT_FOUND"
  | "ACTIVITY_NOT_FOUND"
  | "PERIOD_OVERLAP"
  | "PERIOD_NOT_FOUND"
  | "OBLIGATION_EXISTS"
  | "OBLIGATION_NOT_FOUND"
  | "RULE_PACK_NOT_FOUND"
  | "RULE_VERSION_NOT_FOUND"
  | "RULE_VERSION_IMMUTABLE"
  | "RULE_VERSION_ALREADY_APPROVED"
  | "CREDENTIAL_NOT_FOUND"
  | "CREDENTIAL_INACTIVE"
  | "APPROVER_MISMATCH"
  | "INVALID_TRANSITION";

export class FiscalError extends Error {
  readonly code: FiscalErrorCode;
  constructor(code: FiscalErrorCode, message: string) {
    super(message);
    this.name = "FiscalError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// G1-02: Maestros (jurisdicción, autoridad, impuesto, régimen)
// ---------------------------------------------------------------------------

export class FiscalMasterService {
  /** Lista jurisdicciones (filtradas por firma vía RLS). */
  async listJurisdictions(ctx: TenantContext) {
    return withTenantContext(ctx, (tx) =>
      tx.jurisdiction.findMany({ orderBy: { code: "asc" }, take: 500 }),
    );
  }

  async createJurisdiction(
    ctx: TenantContext,
    input: { code: string; name: string; kind: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL"; parentId?: string },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.jurisdiction.create({
        data: {
          code: input.code,
          name: input.name,
          kind: input.kind,
          ...(input.parentId ? { parentId: input.parentId } : {}),
        },
      }),
    );
  }

  async listTaxTypes(ctx: TenantContext) {
    return withTenantContext(ctx, (tx) => tx.taxType.findMany({ orderBy: { code: "asc" }, take: 100 }));
  }

  async createTaxType(ctx: TenantContext, input: { code: string; name: string }) {
    return withTenantContext(ctx, (tx) => tx.taxType.create({ data: input }));
  }

  async listRegimes(ctx: TenantContext) {
    return withTenantContext(ctx, (tx) =>
      tx.taxRegime.findMany({
        include: { taxType: true, jurisdiction: true, authority: true },
        orderBy: { code: "asc" },
        take: 200,
      }),
    );
  }

  async createRegime(
    ctx: TenantContext,
    input: { code: string; name: string; taxTypeId: string; jurisdictionId: string; authorityId: string },
  ) {
    return withTenantContext(ctx, (tx) => {
      const regime = tx.taxRegime.findUnique({ where: { id: input.taxTypeId } });
      if (!regime) throw new FiscalError("REGIME_NOT_FOUND", "Régimen no encontrado");
      return tx.taxRegime.create({ data: input });
    });
  }

  async listActivities(ctx: TenantContext, jurisdictionId?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.economicActivity.findMany({
        where: jurisdictionId ? { jurisdictionId } : {},
        orderBy: { code: "asc" },
        take: 1000,
      }),
    );
  }

  async createActivity(
    ctx: TenantContext,
    input: { code: string; name: string; jurisdictionId: string; source?: string; validFrom: string },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.economicActivity.create({
        data: {
          code: input.code,
          name: input.name,
          jurisdictionId: input.jurisdictionId,
          ...(input.source ? { source: input.source } : {}),
          validFrom: new Date(input.validFrom),
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// G1-03: Perfil fiscal, inscripciones, actividades del cliente y matrícula
// ---------------------------------------------------------------------------

export class TaxpayerProfileService {
  /** Lista versiones de perfil del cliente. */
  async listVersions(ctx: TenantContext, clientId?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxpayerProfileVersion.findMany({
        where: { firmId: ctx.firmId, ...(clientId ?? ctx.clientId ? { clientId: clientId ?? ctx.clientId! } : {}) },
        orderBy: { version: "desc" },
        take: 100,
      }),
    );
  }

  /** Inscripciones vigentes e históricas, con su alcance fiscal legible. */
  async listRegistrations(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxRegistration.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: {
          regime: { include: { taxType: true, jurisdiction: true } },
          profile: { select: { id: true, version: true, legalName: true } },
        },
        orderBy: [{ status: "asc" }, { validFrom: "desc" }],
        take: 300,
      }),
    );
  }

  /** Actividades del contribuyente, no el maestro completo de actividades. */
  async listClientActivities(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.clientActivity.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { activity: { include: { jurisdiction: true } }, profile: { select: { version: true } } },
        orderBy: [{ isPrimary: "desc" }, { validFrom: "desc" }],
        take: 300,
      }),
    );
  }

  /** Crea la primera versión de un perfil fiscal. */
  async createProfile(
    ctx: TenantContext,
    input: {
      clientId: string;
      legalName: string;
      cuit: string;
      personType: "FISICA" | "JURIDICA";
      nationalCondition: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTISTA" | "EXENTO" | "NO_RESPONSABLE";
      fiscalAddress?: string;
      fiscalYearEndMonth?: number;
      validFrom: string;
      source?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const existing = await tx.taxpayerProfileVersion.findFirst({
        where: { firmId: ctx.firmId, clientId: input.clientId, status: "ACTIVE" },
      });
      if (existing) {
        throw new FiscalError("PROFILE_ALREADY_ACTIVE", "El cliente ya tiene un perfil fiscal activo");
      }
      return tx.taxpayerProfileVersion.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          version: 1,
          legalName: input.legalName,
          cuit: input.cuit,
          personType: input.personType,
          nationalCondition: input.nationalCondition,
          ...(input.fiscalAddress ? { fiscalAddress: input.fiscalAddress } : {}),
          ...(input.fiscalYearEndMonth !== undefined ? { fiscalYearEndMonth: input.fiscalYearEndMonth } : {}),
          validFrom: new Date(input.validFrom),
          status: "DRAFT",
          ...(input.source ? { source: input.source } : {}),
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /** Crea una nueva versión a partir de una existente (corrección). */
  async newVersion(
    ctx: TenantContext,
    input: { profileVersionId: string; reason: string; changes: Prisma.TaxpayerProfileVersionUncheckedUpdateInput },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const current = await tx.taxpayerProfileVersion.findUnique({
        where: { id: input.profileVersionId },
      });
      if (!current) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      if (current.status === "ACTIVE") {
        throw new FiscalError("PROFILE_ALREADY_ACTIVE", "Un perfil activo no se edita; cree una versión nueva");
      }
      const nextVersion = current.version + 1;
      const data: Prisma.TaxpayerProfileVersionUncheckedCreateInput = {
        firmId: current.firmId,
        clientId: current.clientId,
        version: nextVersion,
        legalName: (input.changes.legalName as string) ?? current.legalName,
        cuit: (input.changes.cuit as string) ?? current.cuit,
        personType:
          (input.changes.personType as "FISICA" | "JURIDICA") ?? current.personType,
        nationalCondition:
          (input.changes.nationalCondition as
            | "RESPONSABLE_INSCRIPTO"
            | "MONOTRIBUTISTA"
            | "EXENTO"
            | "NO_RESPONSABLE") ?? current.nationalCondition,
        fiscalAddress: (input.changes.fiscalAddress as string) ?? current.fiscalAddress,
        fiscalYearEndMonth: (input.changes.fiscalYearEndMonth as number) ?? current.fiscalYearEndMonth,
        validFrom: (input.changes.validFrom as Date) ?? current.validFrom,
        status: "DRAFT",
        source: input.reason,
        createdByUserId: ctx.userId,
        supersedesId: current.id,
      };
      return tx.taxpayerProfileVersion.create({ data });
    });
  }

  /** Envía a revisión. */
  async submitReview(ctx: TenantContext, profileVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const profile = await tx.taxpayerProfileVersion.findUnique({ where: { id: profileVersionId } });
      if (!profile) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      if (profile.status !== "DRAFT") {
        throw new FiscalError("INVALID_TRANSITION", `No se puede enviar a revisión desde ${profile.status}`);
      }
      return tx.taxpayerProfileVersion.update({
        where: { id: profileVersionId },
        data: { status: "IN_REVIEW" },
      });
    });
  }

  /** Activa la versión (requiere revisión previa). */
  async activate(ctx: TenantContext, profileVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const profile = await tx.taxpayerProfileVersion.findUnique({ where: { id: profileVersionId } });
      if (!profile) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      if (profile.status !== "IN_REVIEW") {
        throw new FiscalError("INVALID_TRANSITION", `Sólo un perfil IN_REVIEW puede activarse (estado: ${profile.status})`);
      }
      // Supersede cualquier versión activa previa.
      await tx.taxpayerProfileVersion.updateMany({
        where: { firmId: profile.firmId, clientId: profile.clientId, status: "ACTIVE" },
        data: { status: "SUPERSEDED" },
      });
      return tx.taxpayerProfileVersion.update({
        where: { id: profileVersionId },
        data: { status: "ACTIVE", activatedAt: new Date(), reviewedByUserId: ctx.userId, reviewedAt: new Date() },
      });
    });
  }

  /** Registra una inscripción en un régimen (sin solapar vigencias). */
  async addRegistration(
    ctx: TenantContext,
    input: {
      clientId: string;
      profileVersionId: string;
      regimeId: string;
      validFrom: string;
      validTo?: string;
      registrationNumber?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const overlap = await tx.taxRegistration.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          regimeId: input.regimeId,
          status: "ACTIVE",
          validTo: null,
        },
      });
      if (overlap) {
        throw new FiscalError("REGISTRATION_OVERLAP", "Ya existe una inscripción activa para ese régimen");
      }
      return tx.taxRegistration.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          profileVersionId: input.profileVersionId,
          regimeId: input.regimeId,
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
          ...(input.registrationNumber ? { registrationNumber: input.registrationNumber } : {}),
          createdByUserId: ctx.userId,
        },
      });
    });
  }

  /** Una adhesión no se borra: se cierra su vigencia y permanece auditable. */
  async cancelRegistration(
    ctx: TenantContext,
    input: { registrationId: string; validTo: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const registration = await tx.taxRegistration.findFirst({
        where: { id: input.registrationId, firmId: ctx.firmId, clientId: ctx.clientId! },
      });
      if (!registration) {
        throw new FiscalError("REGISTRATION_NOT_FOUND", "Inscripción fiscal no encontrada");
      }
      const validTo = new Date(input.validTo);
      if (validTo < registration.validFrom) {
        throw new FiscalError("INVALID_TRANSITION", "La baja no puede ser anterior al inicio de vigencia");
      }
      return tx.taxRegistration.update({
        where: { id: registration.id },
        data: { status: "CANCELLED", validTo },
      });
    });
  }

  /** Vincula una actividad económica al cliente. */
  async addClientActivity(
    ctx: TenantContext,
    input: { clientId: string; profileVersionId: string; activityId: string; isPrimary?: boolean; validFrom: string },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.clientActivity.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          profileVersionId: input.profileVersionId,
          activityId: input.activityId,
          isPrimary: input.isPrimary ?? false,
          validFrom: new Date(input.validFrom),
        },
      }),
    );
  }

  async endClientActivity(ctx: TenantContext, input: { clientActivityId: string; validTo: string }) {
    return withTenantContext(ctx, async (tx) => {
      const link = await tx.clientActivity.findFirst({
        where: { id: input.clientActivityId, firmId: ctx.firmId, clientId: ctx.clientId! },
      });
      if (!link) throw new FiscalError("ACTIVITY_LINK_NOT_FOUND", "Actividad del cliente no encontrada");
      const validTo = new Date(input.validTo);
      if (validTo < link.validFrom) {
        throw new FiscalError("INVALID_TRANSITION", "La baja no puede ser anterior al inicio de vigencia");
      }
      return tx.clientActivity.update({ where: { id: link.id }, data: { validTo } });
    });
  }

  /** Registra la matrícula profesional de un usuario. */
  async addCredential(
    ctx: TenantContext,
    input: {
      userId: string;
      jurisdictionId: string;
      authorityId: string;
      registrationNumber: string;
      validFrom: string;
      validTo?: string;
    },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.professionalCredential.create({
        data: {
          firmId: ctx.firmId,
          userId: input.userId,
          jurisdictionId: input.jurisdictionId,
          authorityId: input.authorityId,
          registrationNumber: input.registrationNumber,
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// G1-04: Períodos y obligaciones materializadas
// ---------------------------------------------------------------------------

export class TaxPeriodService {
  /** Crea un período fiscal (único por cliente + impuesto + fechas). */
  async createPeriod(
    ctx: TenantContext,
    input: { clientId: string; taxTypeId: string; startDate: string; endDate: string; label?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const overlap = await tx.taxPeriod.findFirst({
        where: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          startDate: { lte: new Date(input.endDate) },
          endDate: { gte: new Date(input.startDate) },
        },
      });
      if (overlap) {
        throw new FiscalError("PERIOD_OVERLAP", "El período se solapa con uno existente para el mismo impuesto");
      }
      return tx.taxPeriod.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          taxTypeId: input.taxTypeId,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          ...(input.label ? { label: input.label } : {}),
        },
      });
    });
  }

  /** Lista los períodos fiscales disponibles para asociar saldos y obligaciones. */
  async listPeriods(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxPeriod.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { taxType: true },
        orderBy: [{ startDate: "desc" }, { taxType: { code: "asc" } }],
        take: 500,
      }),
    );
  }

  /** Materializa la obligación de un cliente para un régimen y período. */
  async materializeObligation(
    ctx: TenantContext,
    input: { clientId: string; profileVersionId: string; regimeId: string; periodId: string; dueDate?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const existing = await tx.taxObligation.findFirst({
        where: { firmId: ctx.firmId, clientId: input.clientId, regimeId: input.regimeId, periodId: input.periodId },
      });
      if (existing) {
        throw new FiscalError("OBLIGATION_EXISTS", "La obligación ya existe para ese régimen y período");
      }
      return tx.taxObligation.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          profileVersionId: input.profileVersionId,
          regimeId: input.regimeId,
          periodId: input.periodId,
          ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
          materializedBy: ctx.userId,
        },
      });
    });
  }

  async listObligations(ctx: TenantContext, clientId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxObligation.findMany({
        where: { firmId: ctx.firmId, clientId },
        include: { regime: { include: { taxType: true, jurisdiction: true } }, period: true },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// G1-05: Rule packs, versiones, fuentes y aprobaciones
// ---------------------------------------------------------------------------

export class TaxRuleService {
  /** Lista rule packs del régimen. */
  async listPacks(ctx: TenantContext) {
    return withTenantContext(ctx, (tx) =>
      tx.taxRulePack.findMany({
        include: { regime: { include: { taxType: true, jurisdiction: true } }, versions: { orderBy: { version: "desc" }, take: 5 } },
        orderBy: { code: "asc" },
        take: 200,
      }),
    );
  }

  /** Detalle completo para administrar una versión sin inferir valores desde la UI. */
  async getPack(ctx: TenantContext, packId: string) {
    return withTenantContext(ctx, async (tx) => {
      const pack = await tx.taxRulePack.findUnique({
        where: { id: packId },
        include: {
          regime: { include: { taxType: true, jurisdiction: true, authority: true } },
          versions: {
            orderBy: { version: "desc" },
            include: {
              rateRules: { orderBy: [{ concept: "asc" }, { activityCode: "asc" }] },
              minimumRules: { orderBy: { concept: "asc" } },
              dueDateRules: { orderBy: { dueDay: "asc" } },
              roundingRules: { orderBy: { concept: "asc" } },
              sources: { orderBy: { consultedAt: "desc" } },
            },
          },
        },
      });
      if (!pack) throw new FiscalError("RULE_PACK_NOT_FOUND", "Rule pack no encontrado");
      return pack;
    });
  }

  /** Crea un rule pack para un régimen. */
  async createPack(ctx: TenantContext, input: { code: string; name: string; regimeId: string }) {
    return withTenantContext(ctx, (tx) => tx.taxRulePack.create({ data: input }));
  }

  /** Crea la primera versión de un rule pack. */
  async createVersion(
    ctx: TenantContext,
    input: {
      packId: string;
      validFrom: string;
      validTo?: string;
      engineVersion: string;
      rulesHash: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const pack = await tx.taxRulePack.findUnique({ where: { id: input.packId } });
      if (!pack) throw new FiscalError("RULE_PACK_NOT_FOUND", "Rule pack no encontrado");
      const count = await tx.taxRuleVersion.count({ where: { packId: input.packId } });
      return tx.taxRuleVersion.create({
        data: {
          packId: input.packId,
          version: count + 1,
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
          engineVersion: input.engineVersion,
          rulesHash: input.rulesHash,
          status: "DRAFT",
        },
      });
    });
  }

  /**
   * Los cambios normativos siempre parten de una versión conocida. Copia la
   * configuración operativa y deja un borrador aislado para revisión.
   */
  async cloneVersion(ctx: TenantContext, input: { packId: string; validFrom: string; validTo?: string }) {
    return withTenantContext(ctx, async (tx) => {
      const source = await tx.taxRuleVersion.findFirst({
        where: { packId: input.packId },
        orderBy: { version: "desc" },
        include: { rateRules: true, minimumRules: true, dueDateRules: true, roundingRules: true, sources: true },
      });
      if (!source) throw new FiscalError("RULE_VERSION_NOT_FOUND", "El pack no tiene una versión para clonar");
      const count = await tx.taxRuleVersion.count({ where: { packId: input.packId } });
      const version = await tx.taxRuleVersion.create({
        data: {
          packId: input.packId,
          version: count + 1,
          status: "DRAFT",
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
          engineVersion: source.engineVersion,
          rulesHash: source.rulesHash,
          supersedesId: source.id,
        },
      });
      await Promise.all([
        source.rateRules.length
          ? tx.taxRateRule.createMany({
              data: source.rateRules.map((rule) => ({
                ruleVersionId: version.id,
                concept: rule.concept,
                ...(rule.activityCode ? { activityCode: rule.activityCode } : {}),
                ...(rule.jurisdictionId ? { jurisdictionId: rule.jurisdictionId } : {}),
                ...(rule.rate ? { rate: rule.rate } : {}),
                ...(rule.minAmount ? { minAmount: rule.minAmount } : {}),
                validFrom: new Date(input.validFrom),
                ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
              })),
            })
          : Promise.resolve({ count: 0 }),
        source.minimumRules.length
          ? tx.taxMinimumRule.createMany({
              data: source.minimumRules.map((rule) => ({
                ruleVersionId: version.id,
                concept: rule.concept,
                ...(rule.jurisdictionId ? { jurisdictionId: rule.jurisdictionId } : {}),
                amount: rule.amount,
                isConditional: rule.isConditional,
                validFrom: new Date(input.validFrom),
                ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
              })),
            })
          : Promise.resolve({ count: 0 }),
        source.dueDateRules.length
          ? tx.dueDateRule.createMany({
              data: source.dueDateRules.map((rule) => ({
                ruleVersionId: version.id,
                jurisdictionId: rule.jurisdictionId,
                frequency: rule.frequency,
                dueDay: rule.dueDay,
                ...(rule.cuitEnding ? { cuitEnding: rule.cuitEnding } : {}),
                validFrom: new Date(input.validFrom),
                ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
              })),
            })
          : Promise.resolve({ count: 0 }),
        source.roundingRules.length
          ? tx.roundingRule.createMany({
              data: source.roundingRules.map((rule) => ({
                ruleVersionId: version.id,
                concept: rule.concept,
                precision: rule.precision,
                mode: rule.mode,
              })),
            })
          : Promise.resolve({ count: 0 }),
        source.sources.length
          ? tx.normativeSource.createMany({
              data: source.sources.map((sourceItem) => ({
                ruleVersionId: version.id,
                authorityId: sourceItem.authorityId,
                title: sourceItem.title,
                ...(sourceItem.url ? { url: sourceItem.url } : {}),
                ...(sourceItem.reference ? { reference: sourceItem.reference } : {}),
                ...(sourceItem.fileChecksum ? { fileChecksum: sourceItem.fileChecksum } : {}),
                consultedAt: sourceItem.consultedAt,
              })),
            })
          : Promise.resolve({ count: 0 }),
      ]);
      await this.refreshHash(tx, version.id);
      return tx.taxRuleVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: { rateRules: true, minimumRules: true, dueDateRules: true, sources: true },
      });
    });
  }

  /** Agrega una regla de alícuota a una versión DRAFT. */
  async addRateRule(
    ctx: TenantContext,
    input: {
      ruleVersionId: string;
      concept: string;
      rate: string;
      activityCode?: string;
      jurisdictionId?: string;
      minAmount?: string;
      validFrom: string;
      validTo?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      await this.assertDraft(tx, input.ruleVersionId);
      const rule = await tx.taxRateRule.create({
        data: {
          ruleVersionId: input.ruleVersionId,
          concept: input.concept,
          rate: new Prisma.Decimal(input.rate),
          ...(input.activityCode ? { activityCode: input.activityCode } : {}),
          ...(input.jurisdictionId ? { jurisdictionId: input.jurisdictionId } : {}),
          ...(input.minAmount ? { minAmount: new Prisma.Decimal(input.minAmount) } : {}),
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
        },
      });
      await this.refreshHash(tx, input.ruleVersionId);
      return rule;
    });
  }

  /** Reemplazo atómico: evita que una tasa anterior quede oculta en un borrador. */
  async replaceRateRules(
    ctx: TenantContext,
    input: {
      ruleVersionId: string;
      rules: Array<{
        concept: string;
        rate?: string;
        activityCode?: string;
        jurisdictionId?: string;
        minAmount?: string;
        validFrom: string;
        validTo?: string;
      }>;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      await this.assertDraft(tx, input.ruleVersionId);
      await tx.taxRateRule.deleteMany({ where: { ruleVersionId: input.ruleVersionId } });
      if (input.rules.length > 0) {
        await tx.taxRateRule.createMany({
          data: input.rules.map((rule) => ({
            ruleVersionId: input.ruleVersionId,
            concept: rule.concept,
            ...(rule.rate ? { rate: new Prisma.Decimal(rule.rate) } : {}),
            ...(rule.activityCode ? { activityCode: rule.activityCode } : {}),
            ...(rule.jurisdictionId ? { jurisdictionId: rule.jurisdictionId } : {}),
            ...(rule.minAmount ? { minAmount: new Prisma.Decimal(rule.minAmount) } : {}),
            validFrom: new Date(rule.validFrom),
            ...(rule.validTo ? { validTo: new Date(rule.validTo) } : {}),
          })),
        });
      }
      await this.refreshHash(tx, input.ruleVersionId);
      return tx.taxRateRule.findMany({
        where: { ruleVersionId: input.ruleVersionId },
        orderBy: [{ concept: "asc" }, { activityCode: "asc" }],
      });
    });
  }

  /** Agrega una regla de vencimiento. */
  async addDueDateRule(
    ctx: TenantContext,
    input: {
      ruleVersionId: string;
      jurisdictionId: string;
      frequency?: string;
      dueDay: number;
      cuitEnding?: string;
      validFrom: string;
      validTo?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      await this.assertDraft(tx, input.ruleVersionId);
      const rule = await tx.dueDateRule.create({
        data: {
          ruleVersionId: input.ruleVersionId,
          jurisdictionId: input.jurisdictionId,
          frequency: input.frequency ?? "MONTHLY",
          dueDay: input.dueDay,
          ...(input.cuitEnding ? { cuitEnding: input.cuitEnding } : {}),
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
        },
      });
      await this.refreshHash(tx, input.ruleVersionId);
      return rule;
    });
  }

  /** Agrega una fuente normativa. */
  async addSource(
    ctx: TenantContext,
    input: {
      ruleVersionId: string;
      authorityId: string;
      title: string;
      url?: string;
      reference?: string;
      fileChecksum?: string;
      consultedAt: string;
    },
  ) {
    return withTenantContext(ctx, (tx) =>
      tx.normativeSource.create({
        data: {
          ruleVersionId: input.ruleVersionId,
          authorityId: input.authorityId,
          title: input.title,
          ...(input.url ? { url: input.url } : {}),
          ...(input.reference ? { reference: input.reference } : {}),
          ...(input.fileChecksum ? { fileChecksum: input.fileChecksum } : {}),
          consultedAt: new Date(input.consultedAt),
        },
      }),
    );
  }

  /** Envía una versión a revisión. */
  async submitReview(ctx: TenantContext, ruleVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const v = await tx.taxRuleVersion.findUnique({ where: { id: ruleVersionId } });
      if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
      if (v.status !== "DRAFT") {
        throw new FiscalError("INVALID_TRANSITION", `No se puede enviar a revisión desde ${v.status}`);
      }
      return tx.taxRuleVersion.update({ where: { id: ruleVersionId }, data: { status: "IN_REVIEW" } });
    });
  }

  /**
   * Aprueba una versión con matrícula profesional vigente.
   * La aprobación es append-only (rule_approvals sin UPDATE/DELETE para runtime).
   */
  async approve(
    ctx: TenantContext,
    input: { ruleVersionId: string; credentialId: string; comment?: string; goldenResultsHash?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const v = await tx.taxRuleVersion.findUnique({ where: { id: input.ruleVersionId } });
      if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
      if (v.status !== "IN_REVIEW") {
        throw new FiscalError("INVALID_TRANSITION", `Sólo una versión IN_REVIEW puede aprobarse (estado: ${v.status})`);
      }
      const credential = await tx.professionalCredential.findUnique({
        where: { id: input.credentialId },
      });
      if (!credential) throw new FiscalError("CREDENTIAL_NOT_FOUND", "Matrícula no encontrada");
      if (credential.status !== "ACTIVE") {
        throw new FiscalError("CREDENTIAL_INACTIVE", "La matrícula no está activa");
      }
      if (credential.userId !== ctx.userId) {
        throw new FiscalError("APPROVER_MISMATCH", "La matrícula pertenece a otro usuario");
      }
      const approval = await tx.ruleApproval.create({
        data: {
          ruleVersionId: input.ruleVersionId,
          credentialId: input.credentialId,
          approvedByUserId: ctx.userId,
          ...(input.comment ? { comment: input.comment } : {}),
          ...(input.goldenResultsHash ? { goldenResultsHash: input.goldenResultsHash } : {}),
        },
      });
      await tx.taxRuleVersion.update({
        where: { id: input.ruleVersionId },
        data: { status: "APPROVED", approvedByUserId: ctx.userId, approvedAt: new Date() },
      });
      return approval;
    });
  }

  /** Activa una versión aprobada. */
  async activate(ctx: TenantContext, ruleVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const v = await tx.taxRuleVersion.findUnique({ where: { id: ruleVersionId } });
      if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
      if (v.status !== "APPROVED") {
        throw new FiscalError("INVALID_TRANSITION", `Sólo una versión APPROVED puede activarse (estado: ${v.status})`);
      }
      await tx.taxRuleVersion.updateMany({
        where: { packId: v.packId, status: "ACTIVE" },
        data: { status: "RETIRED" },
      });
      return tx.taxRuleVersion.update({
        where: { id: ruleVersionId },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
    });
  }

  async listCredentials(ctx: TenantContext) {
    return withTenantContext(ctx, (tx) =>
      tx.professionalCredential.findMany({
        where: { firmId: ctx.firmId, userId: ctx.userId, status: "ACTIVE" },
        include: { jurisdiction: true, authority: true },
        orderBy: { validFrom: "desc" },
        take: 50,
      }),
    );
  }

  private async refreshHash(tx: Prisma.TransactionClient, ruleVersionId: string) {
    const version = await tx.taxRuleVersion.findUnique({
      where: { id: ruleVersionId },
      include: { rateRules: true, minimumRules: true, dueDateRules: true, roundingRules: true },
    });
    if (!version) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
    const canonical = JSON.stringify({
      rate: version.rateRules
        .map((rule) => [rule.concept, rule.activityCode, rule.jurisdictionId, rule.rate?.toString(), rule.minAmount?.toString(), rule.validFrom.toISOString(), rule.validTo?.toISOString()])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      minimum: version.minimumRules
        .map((rule) => [rule.concept, rule.jurisdictionId, rule.amount.toString(), rule.isConditional, rule.validFrom.toISOString(), rule.validTo?.toISOString()])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      due: version.dueDateRules
        .map((rule) => [rule.jurisdictionId, rule.frequency, rule.dueDay, rule.cuitEnding, rule.validFrom.toISOString(), rule.validTo?.toISOString()])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      rounding: version.roundingRules
        .map((rule) => [rule.concept, rule.precision, rule.mode])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    });
    return tx.taxRuleVersion.update({
      where: { id: ruleVersionId },
      data: { rulesHash: createHash("sha256").update(canonical).digest("hex") },
    });
  }

  private async assertDraft(tx: Prisma.TransactionClient, ruleVersionId: string) {
    const v = await tx.taxRuleVersion.findUnique({ where: { id: ruleVersionId } });
    if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
    if (v.status !== "DRAFT") {
      throw new FiscalError("RULE_VERSION_IMMUTABLE", "Sólo se editan versiones DRAFT; las aprobadas/activas son inmutables");
    }
  }
}

// ---------------------------------------------------------------------------
// G1-10: Calendario fiscal determinista
// Materializa vencimientos desde DueDateRule (versión ACTIVE) + Holidays.
// ---------------------------------------------------------------------------

export class TaxCalendarService {
  /**
   * Genera la obligación materializada (TaxObligation) para un cliente/
   * régimen/período usando la regla de vencimiento vigente del rule pack
   * activo de ese régimen. El ajuste por feriado es determinista.
   */
  async materializeObligationWithDueDate(
    ctx: TenantContext,
    input: { clientId: string; profileVersionId: string; regimeId: string; periodId: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const period = await tx.taxPeriod.findUnique({ where: { id: input.periodId } });
      if (!period) throw new FiscalError("PERIOD_NOT_FOUND", "Período fiscal no encontrado");

      const pack = await tx.taxRulePack.findFirst({
        where: { regimeId: input.regimeId },
      });
      if (!pack) throw new FiscalError("RULE_PACK_NOT_FOUND", "No existe rule pack para el régimen");
      const activeVersion = await tx.taxRuleVersion.findFirst({
        where: { packId: pack.id, status: "ACTIVE" },
      });
      if (!activeVersion) {
        throw new FiscalError(
          "RULE_VERSION_NOT_FOUND",
          "No hay versión ACTIVE del rule pack; la obligación no puede materializar vencimiento",
        );
      }

      const dueRule = await tx.dueDateRule.findFirst({
        where: { ruleVersionId: activeVersion.id },
      });
      if (!dueRule) {
        // Sin regla de vencimiento: obligación sin fecha (PENDING).
        return tx.taxObligation.create({
          data: {
            firmId: ctx.firmId,
            clientId: input.clientId,
            profileVersionId: input.profileVersionId,
            regimeId: input.regimeId,
            periodId: input.periodId,
            materializedBy: ctx.userId,
          },
        });
      }

      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      const holidays = await tx.holiday.findMany({
        where: { jurisdictionId: dueRule.jurisdictionId, date: { gte: period.startDate } },
      });

      const result = calculateDueDate(
        {
          id: dueRule.id,
          frequency: (dueRule.frequency ?? "MONTHLY") as "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE",
          dueDay: dueRule.dueDay,
          ...(dueRule.cuitEnding ? { cuitEnding: dueRule.cuitEnding } : {}),
          validFrom: activeVersion.validFrom.toISOString().slice(0, 10),
        },
        {
          startDate: period.startDate.toISOString().slice(0, 10),
          endDate: period.endDate.toISOString().slice(0, 10),
        },
        holidays.map((h) => ({ jurisdictionId: h.jurisdictionId, date: h.date.toISOString().slice(0, 10) })),
        client?.cuit.slice(-1) ?? undefined,
      );

      return tx.taxObligation.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          profileVersionId: input.profileVersionId,
          regimeId: input.regimeId,
          periodId: input.periodId,
          dueDate: new Date(result.dueDate),
          status: "READY_TO_CALCULATE",
          materializedBy: ctx.userId,
        },
      });
    });
  }

  /** Lista feriados de una jurisdicción. */
  async listHolidays(ctx: TenantContext, jurisdictionId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.holiday.findMany({ where: { jurisdictionId }, orderBy: { date: "asc" }, take: 500 }),
    );
  }

  async addHoliday(ctx: TenantContext, input: { jurisdictionId: string; date: string; name?: string }) {
    return withTenantContext(ctx, (tx) =>
      tx.holiday.create({
        data: {
          jurisdictionId: input.jurisdictionId,
          date: new Date(input.date),
          ...(input.name ? { name: input.name } : {}),
        },
      }),
    );
  }
}
