import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { calculateDueDate } from "@contable/tax-engine";
import { ACTIVITY_CODE_PATTERN, normalizeActivityCode } from "@contable/contracts";
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
  | "TAX_TYPE_NOT_FOUND"
  | "AUTHORITY_NOT_FOUND"
  | "AUTHORITY_JURISDICTION_MISMATCH"
  | "CATALOG_CODE_CONFLICT"
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
  | "ACTIVITY_INACTIVE"
  | "ACTIVITY_STATE_UNCHANGED"
  | "ACTIVITY_VALIDITY_INVALID"
  | "ACTIVITY_FIELD_IMMUTABLE"
  | "ACTIVITY_CODE_INVALID"
  | "ACTIVITY_CODE_UNKNOWN"
  | "ACTIVITY_CODE_INACTIVE"
  | "ACTIVITY_CODE_JURISDICTION_MISMATCH"
  | "INVALID_TRANSITION";

export class FiscalError extends Error {
  readonly code: FiscalErrorCode;
  constructor(code: FiscalErrorCode, message: string) {
    super(message);
    this.name = "FiscalError";
    this.code = code;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2002",
  );
}

export type TaxpayerProfileChanges = {
  legalName?: string;
  cuit?: string;
  personType?: "FISICA" | "JURIDICA";
  nationalCondition?: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTISTA" | "EXENTO" | "NO_RESPONSABLE";
  fiscalAddress?: string | null;
  fiscalYearEndMonth?: number;
  monotributoCategory?: string | null;
  validFrom?: string;
};

/** Serializa la asignación de versión por cliente dentro de la transacción. */
async function lockProfileVersionSequence(tx: Prisma.TransactionClient, clientId: string) {
  // La clave coincide con la unicidad de taxpayer_profile_versions(clientId, version).
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${clientId}), 0)) AS profile_lock`;
}

const PROFILE_VERSION_CONFLICT_MESSAGE =
  "Ya existe una versión fiscal en curso o el perfil no es la versión vigente";

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

  async listTaxAuthorities(ctx: TenantContext, jurisdictionId?: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxAuthority.findMany({
        where: jurisdictionId ? { jurisdictionId } : {},
        include: { jurisdiction: true },
        orderBy: { code: "asc" },
        take: 500,
      }),
    );
  }

  async createTaxAuthority(
    ctx: TenantContext,
    input: { code: string; name: string; jurisdictionId: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const jurisdiction = await tx.jurisdiction.findUnique({
        where: { id: input.jurisdictionId },
      });
      if (!jurisdiction) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      return tx.taxAuthority.create({ data: input });
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) {
        throw new FiscalError(
          "CATALOG_CODE_CONFLICT",
          "Ya existe un registro con ese código en el catálogo fiscal",
        );
      }
      throw err;
    });
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
    return withTenantContext(ctx, async (tx) => {
      const taxType = await tx.taxType.findUnique({ where: { id: input.taxTypeId } });
      if (!taxType) throw new FiscalError("TAX_TYPE_NOT_FOUND", "Impuesto no encontrado");
      const jurisdiction = await tx.jurisdiction.findUnique({
        where: { id: input.jurisdictionId },
      });
      if (!jurisdiction) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const authority = await tx.taxAuthority.findUnique({
        where: { id: input.authorityId },
      });
      if (!authority) {
        throw new FiscalError("AUTHORITY_NOT_FOUND", "Autoridad fiscal no encontrada");
      }
      if (authority.jurisdictionId !== input.jurisdictionId) {
        throw new FiscalError(
          "AUTHORITY_JURISDICTION_MISMATCH",
          "La autoridad fiscal debe corresponder a la jurisdicción del régimen",
        );
      }
      return tx.taxRegime.create({ data: input });
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) {
        throw new FiscalError(
          "CATALOG_CODE_CONFLICT",
          "Ya existe un registro con ese código en el catálogo fiscal",
        );
      }
      throw err;
    });
  }

  /**
   * Catálogo de actividades económicas. Por defecto lista sólo las activas:
   * los selectores (ficha, configuración fiscal) no deben ofrecer actividades
   * desactivadas. La administración del catálogo pasa `includeInactive=true`
   * para poder editar o reactivar. El resto de los valores históricos no se
   * pierde: desactivar nunca borra la fila.
   */
  async listActivities(ctx: TenantContext, jurisdictionId?: string, includeInactive = false) {
    return withTenantContext(ctx, (tx) =>
      tx.economicActivity.findMany({
        where: {
          ...(jurisdictionId ? { jurisdictionId } : {}),
          ...(includeInactive ? {} : { isActive: true }),
        },
        orderBy: { code: "asc" },
        take: 1000,
      }),
    );
  }

  async createActivity(
    ctx: TenantContext,
    input: {
      code: string;
      name: string;
      jurisdictionId: string;
      source?: string;
      validFrom: string;
      validTo?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const jurisdiction = await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId } });
      if (!jurisdiction) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const code = normalizeActivityCode(input.code);
      if (!ACTIVITY_CODE_PATTERN.test(code)) {
        throw new FiscalError("ACTIVITY_CODE_INVALID", `El código "${code}" no cumple el formato del catálogo`);
      }
      const validFrom = new Date(input.validFrom);
      const validTo = input.validTo ? new Date(input.validTo) : null;
      assertActivityValidity(validFrom, validTo);
      const created = await tx.economicActivity.create({
        data: {
          code,
          name: input.name.trim(),
          jurisdictionId: input.jurisdictionId,
          ...(input.source ? { source: input.source.trim() } : {}),
          validFrom,
          ...(validTo ? { validTo } : {}),
        },
      });
      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "tax.activity.created",
          entityType: "EconomicActivity",
          entityId: created.id,
          after: { code: created.code, name: created.name, jurisdictionId: created.jurisdictionId },
        },
      });
      return created;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) {
        throw new FiscalError(
          "CATALOG_CODE_CONFLICT",
          "Ya existe una actividad con ese código en la jurisdicción",
        );
      }
      throw err;
    });
  }

  /**
   * Edición de atributos descriptivos y vigencia. `code` y `jurisdictionId`
   * no son editables: el código es el vínculo textual de las reglas
   * (tax_rate_rules.activityCode) y cambiarlo rompería reglas vigentes; la
   * jurisdicción es parte de la unicidad del catálogo. El rechazo es explícito
   * (el schema Zod de la ruta ya lo excluye; aquí se revalida por defensa).
   */
  async updateActivity(
    ctx: TenantContext,
    input: {
      activityId: string;
      name?: string;
      source?: string | null;
      validFrom?: string;
      validTo?: string | null;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.economicActivity.findUnique({ where: { id: input.activityId } });
      if (!row) {
        throw new FiscalError("ACTIVITY_NOT_FOUND", "Actividad económica no encontrada");
      }
      const validFrom = input.validFrom ? new Date(input.validFrom) : row.validFrom;
      const validTo =
        input.validTo === undefined ? row.validTo : input.validTo ? new Date(input.validTo) : null;
      assertActivityValidity(validFrom, validTo);
      const updated = await tx.economicActivity.update({
        where: { id: row.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.source !== undefined ? { source: input.source === null ? null : input.source.trim() } : {}),
          ...(input.validFrom !== undefined ? { validFrom } : {}),
          ...(input.validTo !== undefined ? { validTo } : {}),
        },
      });
      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: "tax.activity.updated",
          entityType: "EconomicActivity",
          entityId: row.id,
          before: { name: row.name, source: row.source, validFrom: row.validFrom, validTo: row.validTo },
          after: { name: updated.name, source: updated.source, validFrom: updated.validFrom, validTo: updated.validTo },
        },
      });
      return withActiveClientLinks(tx, updated);
    });
  }

  /**
   * Activación/desactivación. Nunca borra: la desactivación saca la actividad
   * de los selectores y bloquea vínculos nuevos, pero las reglas vigentes
   * siguen resolviendo por código y el historial del cliente queda intacto.
   */
  async setActivityState(ctx: TenantContext, input: { activityId: string; isActive: boolean }) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.economicActivity.findUnique({ where: { id: input.activityId } });
      if (!row) {
        throw new FiscalError("ACTIVITY_NOT_FOUND", "Actividad económica no encontrada");
      }
      if (row.isActive === input.isActive) {
        throw new FiscalError(
          "ACTIVITY_STATE_UNCHANGED",
          input.isActive
            ? "La actividad ya está activa"
            : "La actividad ya está desactivada",
        );
      }
      const updated = await tx.economicActivity.update({
        where: { id: row.id },
        data: { isActive: input.isActive },
      });
      await tx.auditEvent.create({
        data: {
          firmId: ctx.firmId,
          userId: ctx.userId,
          actorKind: ctx.actorKind,
          action: input.isActive ? "tax.activity.activated" : "tax.activity.deactivated",
          entityType: "EconomicActivity",
          entityId: row.id,
          before: { isActive: row.isActive },
          after: { isActive: updated.isActive },
        },
      });
      return withActiveClientLinks(tx, updated);
    });
  }
}

function assertActivityValidity(validFrom: Date, validTo: Date | null): void {
  if (validTo && validTo < validFrom) {
    throw new FiscalError(
      "ACTIVITY_VALIDITY_INVALID",
      "La vigencia es inválida: validTo no puede ser anterior a validFrom",
    );
  }
}

/**
 * Valida el vínculo código-regla contra el catálogo, del lado del servidor:
 * `tax_rate_rules.activityCode` es texto libre históricamente; a partir de
 * este corte toda ALTA de regla con activityCode debe apuntar a un código
 * existente (y activo, para altas nuevas) del catálogo de actividades.
 *
 * - La comparación es por `code` normalizado (trim + mayúsculas), igual que
 *   el importador.
 * - Si la regla declara jurisdicción, el catálogo debe tener la actividad en
 *   ESA jurisdicción (la unicidad del catálogo es code+jurisdicción).
 * - `requireActive=false` (reemplazo de borrador): exige sólo existencia, para
 *   no romper borradores clonados de versiones históricas con códigos hoy
 *   desactivados. Las reglas vigentes nunca se reescriben (versiones
 *   APPROVED/ACTIVE inmutables), así la compatibilidad histórica se conserva.
 */
async function assertActivityCodeExists(
  tx: Prisma.TransactionClient,
  activityCode: string,
  jurisdictionId: string | undefined,
  options: { requireActive: boolean },
): Promise<void> {
  const code = normalizeActivityCode(activityCode);
  if (!ACTIVITY_CODE_PATTERN.test(code)) {
    throw new FiscalError("ACTIVITY_CODE_INVALID", `El código "${code}" no cumple el formato del catálogo`);
  }
  const matches = await tx.economicActivity.findMany({ where: { code } });
  if (matches.length === 0) {
    throw new FiscalError(
      "ACTIVITY_CODE_UNKNOWN",
      `El código de actividad "${code}" no existe en el catálogo de actividades`,
    );
  }
  const jurisdictionMatches = jurisdictionId
    ? matches.filter((row) => row.jurisdictionId === jurisdictionId)
    : matches;
  if (jurisdictionMatches.length === 0) {
    throw new FiscalError(
      "ACTIVITY_CODE_JURISDICTION_MISMATCH",
      `El código de actividad "${code}" no está publicado para la jurisdicción de la regla`,
    );
  }
  if (options.requireActive && !jurisdictionMatches.some((row) => row.isActive)) {
    throw new FiscalError(
      "ACTIVITY_CODE_INACTIVE",
      `La actividad "${code}" está desactivada en el catálogo: no admite reglas nuevas`,
    );
  }
}

/** Vínculos de clientes sin baja (vigentes) que referencian la actividad. */
async function withActiveClientLinks(
  tx: Prisma.TransactionClient,
  row: { id: string } & Record<string, unknown>,
) {
  const activeClientLinks = await tx.clientActivity.count({
    where: { activityId: row.id, validTo: null },
  });
  return { ...row, activeClientLinks };
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

  /** Crea el primer perfil o una sucesora DRAFT del perfil activo. */
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
      monotributoCategory?: string;
      validFrom: string;
      source?: string;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      await lockProfileVersionSequence(tx, input.clientId);
      const current = await tx.taxpayerProfileVersion.findFirst({
        where: { firmId: ctx.firmId, clientId: input.clientId },
        orderBy: { version: "desc" },
      });
      if (current && current.status !== "ACTIVE") {
        throw new FiscalError("PROFILE_VERSION_CONFLICT", PROFILE_VERSION_CONFLICT_MESSAGE);
      }
      return tx.taxpayerProfileVersion.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          version: current ? current.version + 1 : 1,
          legalName: input.legalName,
          cuit: input.cuit,
          personType: input.personType,
          nationalCondition: input.nationalCondition,
          ...(input.fiscalAddress !== undefined
            ? { fiscalAddress: input.fiscalAddress }
            : current?.fiscalAddress !== null && current?.fiscalAddress !== undefined
              ? { fiscalAddress: current.fiscalAddress }
              : {}),
          ...(input.fiscalYearEndMonth !== undefined
            ? { fiscalYearEndMonth: input.fiscalYearEndMonth }
            : current
              ? { fiscalYearEndMonth: current.fiscalYearEndMonth }
              : {}),
          ...(input.monotributoCategory !== undefined
            ? { monotributoCategory: input.monotributoCategory }
            : current?.monotributoCategory !== null && current?.monotributoCategory !== undefined
              ? { monotributoCategory: current.monotributoCategory }
              : {}),
          validFrom: new Date(input.validFrom),
          status: "DRAFT",
          ...(input.source ? { source: input.source } : {}),
          createdByUserId: ctx.userId,
          ...(current ? { supersedesId: current.id } : {}),
        },
      });
    });
  }

  /** Crea una nueva versión DRAFT a partir del perfil activo. */
  async newVersion(
    ctx: TenantContext,
    input: { profileVersionId: string; reason: string; changes: TaxpayerProfileChanges },
  ) {
    const clientId = ctx.clientId;
    if (!clientId) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
    return withTenantContext(ctx, async (tx) => {
      await lockProfileVersionSequence(tx, clientId);
      const current = await tx.taxpayerProfileVersion.findFirst({
        where: { id: input.profileVersionId, firmId: ctx.firmId, clientId },
      });
      if (!current) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      const latest = await tx.taxpayerProfileVersion.findFirst({
        where: { firmId: ctx.firmId, clientId },
        orderBy: { version: "desc" },
      });
      if (current.status !== "ACTIVE" || latest?.id !== current.id) {
        throw new FiscalError("PROFILE_VERSION_CONFLICT", PROFILE_VERSION_CONFLICT_MESSAGE);
      }
      const data: Prisma.TaxpayerProfileVersionUncheckedCreateInput = {
        firmId: current.firmId,
        clientId: current.clientId,
        version: current.version + 1,
        legalName: input.changes.legalName ?? current.legalName,
        cuit: input.changes.cuit ?? current.cuit,
        personType: input.changes.personType ?? current.personType,
        nationalCondition: input.changes.nationalCondition ?? current.nationalCondition,
        fiscalAddress:
          input.changes.fiscalAddress !== undefined ? input.changes.fiscalAddress : current.fiscalAddress,
        fiscalYearEndMonth: input.changes.fiscalYearEndMonth ?? current.fiscalYearEndMonth,
        monotributoCategory:
          input.changes.monotributoCategory !== undefined
            ? input.changes.monotributoCategory
            : current.monotributoCategory,
        validFrom: input.changes.validFrom ? new Date(input.changes.validFrom) : current.validFrom,
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
      const profile = await tx.taxpayerProfileVersion.findFirst({
        where: {
          id: profileVersionId,
          firmId: ctx.firmId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
        },
      });
      if (!profile) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      const latest = await tx.taxpayerProfileVersion.findFirst({
        where: { firmId: ctx.firmId, clientId: profile.clientId },
        orderBy: { version: "desc" },
      });
      if (profile.status !== "DRAFT" || latest?.id !== profile.id) {
        throw new FiscalError("INVALID_TRANSITION", "Sólo la última versión DRAFT puede enviarse a revisión");
      }
      return tx.taxpayerProfileVersion.update({
        where: { id: profileVersionId },
        data: { status: "IN_REVIEW" },
      });
    });
  }

  /** Activa la última versión revisada y mantiene la anterior hasta el commit. */
  async activate(ctx: TenantContext, profileVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const profileWhere = {
        id: profileVersionId,
        firmId: ctx.firmId,
        ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
      };
      const candidate = await tx.taxpayerProfileVersion.findFirst({ where: profileWhere });
      if (!candidate) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      const clientId = ctx.clientId ?? candidate.clientId;
      await lockProfileVersionSequence(tx, clientId);
      const profile = await tx.taxpayerProfileVersion.findFirst({ where: profileWhere });
      if (!profile) throw new FiscalError("PROFILE_NOT_FOUND", "Perfil fiscal no encontrado");
      const latest = await tx.taxpayerProfileVersion.findFirst({
        where: { firmId: ctx.firmId, clientId },
        orderBy: { version: "desc" },
      });
      if (profile.status !== "IN_REVIEW" || latest?.id !== profile.id) {
        throw new FiscalError("INVALID_TRANSITION", "Sólo la última versión IN_REVIEW puede activarse");
      }
      // Ambas transiciones quedan en la misma transacción: el perfil vigente
      // permanece ACTIVE hasta que la nueva versión se activa correctamente.
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
    return withTenantContext(ctx, async (tx) => {
      // Coherencia ficha ↔ catálogo: el vínculo se hace contra una actividad
      // del catálogo, existente y activa. Los vínculos ya guardados no se
      // invalidan si la actividad se desactiva después (historial intacto).
      const activity = await tx.economicActivity.findUnique({ where: { id: input.activityId } });
      if (!activity) {
        throw new FiscalError("ACTIVITY_NOT_FOUND", "Actividad económica no encontrada");
      }
      if (!activity.isActive) {
        throw new FiscalError(
          "ACTIVITY_INACTIVE",
          "La actividad está desactivada en el catálogo: no admite nuevos vínculos",
        );
      }
      return tx.clientActivity.create({
        data: {
          firmId: ctx.firmId,
          clientId: input.clientId,
          profileVersionId: input.profileVersionId,
          activityId: input.activityId,
          isPrimary: input.isPrimary ?? false,
          validFrom: new Date(input.validFrom),
        },
      });
    });
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
                monthOffset: rule.monthOffset,
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

  /** Lista versiones de reglas de un pack (B-1: lectura histórica). */
  async listRuleVersions(ctx: TenantContext, packId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.taxRuleVersion.findMany({
        where: { packId },
        include: { rateRules: true, sources: true, approvals: { orderBy: { approvedAt: "desc" }, take: 1 } },
        orderBy: { version: "desc" },
        take: 100,
      }),
    );
  }

  /** Devuelve las fuentes normativas de una versión (B-1: procedencia de la regla). */
  async getRuleVersionSources(ctx: TenantContext, ruleVersionId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.normativeSource.findMany({
        where: { ruleVersionId },
        include: { authority: true },
        orderBy: { consultedAt: "desc" },
        take: 100,
      }),
    );
  }

  /** Devuelve las aprobaciones/golden results de una versión (B-1: evidencia de validación). */
  async getRuleVersionGoldenResults(ctx: TenantContext, ruleVersionId: string) {
    return withTenantContext(ctx, (tx) =>
      tx.ruleApproval.findMany({
        where: { ruleVersionId },
        orderBy: { approvedAt: "desc" },
        take: 100,
      }),
    );
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
      if (input.activityCode) {
        await assertActivityCodeExists(tx, input.activityCode, input.jurisdictionId, {
          requireActive: true,
        });
      }
      const rule = await tx.taxRateRule.create({
        data: {
          ruleVersionId: input.ruleVersionId,
          concept: input.concept,
          rate: new Prisma.Decimal(input.rate),
          // El código se guarda normalizado (trim + mayúsculas): es la clave de
          // vínculo con el catálogo y el importador la normaliza igual.
          ...(input.activityCode ? { activityCode: normalizeActivityCode(input.activityCode) } : {}),
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
      // La validación del catálogo corre ANTES del reemplazo: un lote con un
      // código fantasma no debe destruir las reglas existentes del borrador.
      // Sólo exige existencia (no estado activo): los borradores clonados de
      // versiones históricas pueden conservar códigos hoy desactivados, y el
      // catálogo nunca borra filas.
      const withCode = input.rules.filter((rule) => rule.activityCode);
      await Promise.all(
        withCode.map((rule) =>
          assertActivityCodeExists(tx, rule.activityCode!, rule.jurisdictionId, {
            requireActive: false,
          }),
        ),
      );
      await tx.taxRateRule.deleteMany({ where: { ruleVersionId: input.ruleVersionId } });
      if (input.rules.length > 0) {
        await tx.taxRateRule.createMany({
          data: input.rules.map((rule) => ({
            ruleVersionId: input.ruleVersionId,
            concept: rule.concept,
            ...(rule.rate ? { rate: new Prisma.Decimal(rule.rate) } : {}),
            // Guarda normalizado (trim + mayúsculas), coherente con el catálogo.
            ...(rule.activityCode ? { activityCode: normalizeActivityCode(rule.activityCode) } : {}),
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
      monthOffset?: number;
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
          monthOffset: input.monthOffset ?? 1,
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
        .map((rule) => [rule.jurisdictionId, rule.frequency, rule.dueDay, rule.monthOffset, rule.cuitEnding, rule.validFrom.toISOString(), rule.validTo?.toISOString()])
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
        where: {
          packId: pack.id,
          status: { in: ["ACTIVE", "RETIRED"] },
          validFrom: { lte: period.startDate },
          OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
        },
        orderBy: [{ version: "desc" }, { validFrom: "desc" }],
      });
      if (!activeVersion) {
        throw new FiscalError(
          "RULE_VERSION_NOT_FOUND",
          "No hay una versión normativa vigente para todo el período; la obligación no puede materializar vencimiento",
        );
      }

      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      const cuitEnding = client?.cuit.slice(-1);
      const dueRules = await tx.dueDateRule.findMany({
        where: {
          ruleVersionId: activeVersion.id,
          validFrom: { lte: period.startDate },
          OR: [{ validTo: null }, { validTo: { gte: period.endDate } }],
        },
        orderBy: [{ dueDay: "asc" }, { id: "asc" }],
      });
      const dueRule =
        dueRules.find((rule) => Boolean(rule.cuitEnding) && rule.cuitEnding === cuitEnding) ??
        dueRules.find((rule) => !rule.cuitEnding);
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

      const holidays = await tx.holiday.findMany({
        where: { jurisdictionId: dueRule.jurisdictionId, date: { gte: period.startDate } },
      });

      const result = calculateDueDate(
        {
          id: dueRule.id,
          frequency: (dueRule.frequency ?? "MONTHLY") as "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE",
          dueDay: dueRule.dueDay,
          monthOffset: dueRule.monthOffset,
          ...(dueRule.cuitEnding ? { cuitEnding: dueRule.cuitEnding } : {}),
          validFrom: activeVersion.validFrom.toISOString().slice(0, 10),
          ...(activeVersion.validTo
            ? { validTo: activeVersion.validTo.toISOString().slice(0, 10) }
            : {}),
        },
        {
          startDate: period.startDate.toISOString().slice(0, 10),
          endDate: period.endDate.toISOString().slice(0, 10),
        },
        holidays.map((h) => ({ jurisdictionId: h.jurisdictionId, date: h.date.toISOString().slice(0, 10) })),
        cuitEnding,
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
