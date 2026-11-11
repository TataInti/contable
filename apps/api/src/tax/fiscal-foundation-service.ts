import { Prisma } from "@prisma/client";
import { calculateDueDate } from "@contable/tax-engine";
import {
  computeLegacyRulesHashSchemaV1,
  computeRulesHashV2,
  RULES_HASH_SCHEMA_VERSION_V1,
  RULES_HASH_SCHEMA_VERSION_V2,
} from "./rules-hash.js";
import {
  ACTIVITY_CODE_PATTERN,
  normalizeActivityCode,
  taxEngineVersionCompatibilityError,
  type TaxRegimeEngineScope,
} from "@contable/contracts";
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
  | "JURISDICTION_PARENT_REQUIRED"
  | "JURISDICTION_PARENT_INVALID"
  | "JURISDICTION_PARENT_NOT_FOUND"
  | "ACTIVITY_NOT_FOUND"
  | "CATALOG_NOT_FOUND"
  | "CATALOG_REFERENCE_IMMUTABLE"
  | "CATALOG_IN_USE"
  | "CATALOG_STATE_UNCHANGED"
  | "PERIOD_OVERLAP"
  | "PERIOD_NOT_FOUND"
  | "OBLIGATION_EXISTS"
  | "OBLIGATION_NOT_FOUND"
  | "RULE_PACK_NOT_FOUND"
  | "RULE_VERSION_NOT_FOUND"
  | "UNSUPPORTED_TAX_ENGINE_VERSION"
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
  | "RULE_VERSION_INVALID"
  | "RULE_VERSION_EMPTY"
  | "RULES_HASH_MISMATCH"
  | "RULES_HASH_SCHEMA_UNSUPPORTED"
  | "INVALID_TRANSITION";

export class FiscalError extends Error {
  readonly code: FiscalErrorCode;
  constructor(code: FiscalErrorCode, message: string) {
    super(message);
    this.name = "FiscalError";
    this.code = code;
  }
}

export function assertTaxEngineVersionCompatible(
  scope: TaxRegimeEngineScope,
  engineVersion: string,
): void {
  const issue = taxEngineVersionCompatibilityError(scope, engineVersion);
  if (issue) throw new FiscalError("UNSUPPORTED_TAX_ENGINE_VERSION", issue);
}

function taxRegimeEngineScope(regime: {
  code: string;
  taxType: { code: string };
  jurisdiction: { code: string };
}): TaxRegimeEngineScope {
  return {
    regimeCode: regime.code,
    taxTypeCode: regime.taxType.code,
    jurisdictionCode: regime.jurisdiction.code,
  };
}

function hasValidDateRange(validFrom: Date, validTo: Date | null): boolean {
  return Number.isFinite(validFrom.getTime()) &&
    (validTo === null || (Number.isFinite(validTo.getTime()) && validTo >= validFrom));
}

function ruleDateRangesAreValid(
  rules: Array<{ validFrom: Date; validTo: Date | null }>,
): boolean {
  return rules.every((rule) => hasValidDateRange(rule.validFrom, rule.validTo));
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  input: {
    firmId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    after: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      firmId: input.firmId,
      userId: input.userId,
      actorKind: "USER",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.before !== undefined ? { before: input.before } : {}),
      after: input.after,
    },
  });
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

type FiscalCatalogKind = "jurisdiction" | "taxType" | "authority" | "regime" | "activity";

interface CatalogUsagePlace {
  label: string;
  count: number;
}

interface CatalogUsage {
  entityId: string;
  used: boolean;
  count: number;
  places: CatalogUsagePlace[];
}

async function catalogUsagePlaces(
  tx: Prisma.TransactionClient,
  kind: FiscalCatalogKind,
  id: string,
  value?: { code: string; name: string },
): Promise<CatalogUsagePlace[]> {
  let counts: Array<[string, Promise<number>]>;
  switch (kind) {
    case "jurisdiction":
      counts = [
        ["Jurisdicciones dependientes", tx.jurisdiction.count({ where: { parentId: id } })],
        ["Organismos", tx.taxAuthority.count({ where: { jurisdictionId: id } })],
        ["Regímenes", tx.taxRegime.count({ where: { jurisdictionId: id } })],
        ["Actividades", tx.economicActivity.count({ where: { jurisdictionId: id } })],
        ["Reglas por jurisdicción", Promise.all([
          tx.taxRateRule.count({ where: { jurisdictionId: id } }),
          tx.taxMinimumRule.count({ where: { jurisdictionId: id } }),
        ]).then(([rates, minimums]) => rates + minimums)],
        ["Vencimientos", tx.dueDateRule.count({ where: { jurisdictionId: id } })],
        ["Feriados", tx.holiday.count({ where: { jurisdictionId: id } })],
        ["Matrículas profesionales", tx.professionalCredential.count({ where: { jurisdictionId: id } })],
        ["Liquidaciones", tx.taxSettlement.count({ where: { jurisdictionId: id } })],
        ["Créditos", Promise.all([
          tx.taxCreditLedgerEntry.count({ where: { jurisdictionId: id } }),
          tx.taxCreditLot.count({ where: { jurisdictionId: id } }),
        ]).then(([entries, lots]) => entries + lots)],
        ["Certificados", Promise.all([
          tx.withholdingCertificate.count({ where: { jurisdictionId: id } }),
          tx.perceptionCertificate.count({ where: { jurisdictionId: id } }),
        ]).then(([withholdings, perceptions]) => withholdings + perceptions)],
        ["Asignaciones fiscales", tx.taxInputAllocation.count({ where: { jurisdictionId: id } })],
        ["Perfiles de proveedores", tx.supplierTaxProfile.count({ where: { jurisdictionId: id } })],
        ["Fichas de clientes (IIBB)", value
          ? tx.clientProfile.count({ where: { iibbJurisdictions: { hasSome: [value.code, value.name] } } })
          : Promise.resolve(0)],
      ];
      break;
    case "taxType":
      counts = [
        ["Regímenes", tx.taxRegime.count({ where: { taxTypeId: id } })],
        ["Períodos fiscales", tx.taxPeriod.count({ where: { taxTypeId: id } })],
        ["Lotes de importación", tx.importBatch.count({ where: { taxTypeId: id } })],
        ["Liquidaciones", tx.taxSettlement.count({ where: { taxTypeId: id } })],
        ["Adaptadores de importación", tx.importAdapter.count({ where: { taxTypeId: id } })],
        ["Créditos", Promise.all([
          tx.taxCreditLedgerEntry.count({ where: { taxTypeId: id } }),
          tx.taxCreditLot.count({ where: { taxTypeId: id } }),
        ]).then(([entries, lots]) => entries + lots)],
        ["Certificados", Promise.all([
          tx.withholdingCertificate.count({ where: { taxTypeId: id } }),
          tx.perceptionCertificate.count({ where: { taxTypeId: id } }),
        ]).then(([withholdings, perceptions]) => withholdings + perceptions)],
        ["Asignaciones fiscales", tx.taxInputAllocation.count({ where: { taxTypeId: id } })],
      ];
      break;
    case "authority":
      counts = [
        ["Regímenes", tx.taxRegime.count({ where: { authorityId: id } })],
        ["Fuentes normativas", tx.normativeSource.count({ where: { authorityId: id } })],
        ["Matrículas profesionales", tx.professionalCredential.count({ where: { authorityId: id } })],
      ];
      break;
    case "regime":
      counts = [
        ["Inscripciones de clientes", tx.taxRegistration.count({ where: { regimeId: id } })],
        ["Obligaciones fiscales", tx.taxObligation.count({ where: { regimeId: id } })],
        ["Paquetes de reglas", tx.taxRulePack.count({ where: { regimeId: id } })],
        ["Liquidaciones", tx.taxSettlement.count({ where: { regimeId: id } })],
        ["Certificados", Promise.all([
          tx.withholdingCertificate.count({ where: { regimeId: id } }),
          tx.perceptionCertificate.count({ where: { regimeId: id } }),
        ]).then(([withholdings, perceptions]) => withholdings + perceptions)],
        ["Créditos y asignaciones", Promise.all([
          tx.taxCreditLot.count({ where: { regimeId: id } }),
          tx.taxInputAllocation.count({ where: { regimeId: id } }),
        ]).then(([lots, allocations]) => lots + allocations)],
      ];
      break;
    case "activity":
      if (!value) return [];
      counts = [
        ["Vínculos de clientes", tx.clientActivity.count({ where: { activityId: id } })],
        ["Reglas fiscales", tx.taxRateRule.count({ where: { activityCode: value.code } })],
        ["Líneas de comprobantes", tx.fiscalVoucherLine.count({ where: { activityCode: value.code } })],
        ["Clasificaciones fiscales", tx.workpaperVoucherClassification.count({ where: { activityCode: value.code } })],
        ["Perfiles de proveedores", tx.supplierTaxProfile.count({ where: { activityCode: value.code } })],
        ["Fichas de clientes", tx.clientProfile.count({ where: { activity: `${value.code} — ${value.name}` } })],
      ];
      break;
  }
  const places = await Promise.all(counts.map(async ([label, count]) => ({ label, count: await count })));
  return places.filter((place) => place.count > 0);
}

function summarizeCatalogUsage(entityId: string, places: CatalogUsagePlace[]): CatalogUsage {
  const count = places.reduce((total, place) => total + place.count, 0);
  return { entityId, used: count > 0, count, places };
}

// ---------------------------------------------------------------------------
// G1-02: Maestros (jurisdicción, autoridad, impuesto, régimen)
// ---------------------------------------------------------------------------

export class FiscalMasterService {
  /** Los selectores reciben activas; la administración solicita includeInactive. */
  async listJurisdictions(ctx: TenantContext, includeInactive = false) {
    return withTenantContext(ctx, (tx) =>
      tx.jurisdiction.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: { parent: { select: { id: true, code: true, name: true, kind: true } } },
        orderBy: { code: "asc" },
        take: 500,
      }),
    );
  }

  async createJurisdiction(
    ctx: TenantContext,
    input: { code: string; name: string; kind: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL"; parentId?: string; duplicateOfId?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      if (input.kind === "NATIONAL" && input.parentId) {
        throw new FiscalError("JURISDICTION_PARENT_INVALID", "Una jurisdicción nacional no puede tener padre");
      }
      if (input.kind !== "NATIONAL" && !input.parentId) {
        throw new FiscalError(
          "JURISDICTION_PARENT_REQUIRED",
          `${input.kind === "PROVINCIAL" ? "Una provincia" : "Un municipio"} debe tener una jurisdicción padre`,
        );
      }
      if (input.parentId) {
        const parent = await tx.jurisdiction.findUnique({ where: { id: input.parentId } });
        if (!parent) {
          throw new FiscalError("JURISDICTION_PARENT_NOT_FOUND", "La jurisdicción padre no existe");
        }
        const expectedParentKind = input.kind === "PROVINCIAL" ? "NATIONAL" : "PROVINCIAL";
        if (parent.kind !== expectedParentKind) {
          throw new FiscalError(
            "JURISDICTION_PARENT_INVALID",
            `${input.kind === "PROVINCIAL" ? "Una provincia requiere una jurisdicción nacional" : "Un municipio requiere una jurisdicción provincial"}; el padre seleccionado es ${parent.kind}`,
          );
        }
      }
      const created = await tx.jurisdiction.create({
        data: {
          code: input.code,
          name: input.name,
          kind: input.kind,
          ...(input.parentId ? { parentId: input.parentId } : {}),
          origin: "UI",
          createdByFirmId: ctx.firmId,
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.duplicateOfId ? "tax.jurisdiction.duplicated" : "tax.jurisdiction.created",
        entityType: "Jurisdiction",
        entityId: created.id,
        before: input.duplicateOfId
          ? await tx.jurisdiction.findUniqueOrThrow({ where: { id: input.duplicateOfId } }).then((source: { code: string; name: string; kind: string; parentId: string | null; isActive: boolean }) => ({
            code: source.code, name: source.name, kind: source.kind, parentId: source.parentId, isActive: source.isActive,
          }))
          : Prisma.JsonNull,
        after: { code: created.code, name: created.name, kind: created.kind, parentId: created.parentId, isActive: created.isActive },
      });
      return created;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) {
        throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe una jurisdicción con ese código");
      }
      throw err;
    });
  }

  async listTaxTypes(ctx: TenantContext, includeInactive = false) {
    return withTenantContext(ctx, (tx) => tx.taxType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: "asc" },
      take: 100,
    }));
  }

  async createTaxType(ctx: TenantContext, input: { code: string; name: string; duplicateOfId?: string }) {
    return withTenantContext(ctx, async (tx) => {
      const created = await tx.taxType.create({
        data: { code: input.code, name: input.name, origin: "UI", createdByFirmId: ctx.firmId },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.duplicateOfId ? "tax.type.duplicated" : "tax.type.created",
        entityType: "TaxType",
        entityId: created.id,
        before: input.duplicateOfId
          ? await tx.taxType.findUniqueOrThrow({ where: { id: input.duplicateOfId } }).then((source: { code: string; name: string; isActive: boolean }) => ({
            code: source.code, name: source.name, isActive: source.isActive,
          }))
          : Prisma.JsonNull,
        after: { code: created.code, name: created.name, isActive: created.isActive },
      });
      return created;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) {
        throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe un tipo de impuesto con ese código");
      }
      throw err;
    });
  }

  async updateJurisdiction(
    ctx: TenantContext,
    input: {
      jurisdictionId: string;
      code?: string;
      name?: string;
      kind?: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL";
      parentId?: string | null;
      isActive?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId } });
      if (!row) throw new FiscalError("CATALOG_NOT_FOUND", "La jurisdicción no existe");
      const hasEditableFields = input.code !== undefined || input.name !== undefined || input.kind !== undefined || input.parentId !== undefined;
      if (!hasEditableFields && input.isActive === row.isActive) {
        throw new FiscalError("CATALOG_STATE_UNCHANGED", input.isActive ? "La jurisdicción ya está activa" : "La jurisdicción ya está desactivada");
      }
      const kind = input.kind ?? row.kind;
      const parentId = input.parentId === undefined ? row.parentId : input.parentId;
      if (kind === "NATIONAL" && parentId) {
        throw new FiscalError("JURISDICTION_PARENT_INVALID", "Una jurisdicción nacional no puede tener padre");
      }
      if (kind !== "NATIONAL" && !parentId) {
        throw new FiscalError(
          "JURISDICTION_PARENT_REQUIRED",
          `${kind === "PROVINCIAL" ? "Una provincia" : "Un municipio"} debe tener una jurisdicción padre`,
        );
      }
      if (parentId) {
        const parent = await tx.jurisdiction.findUnique({ where: { id: parentId } });
        if (!parent) throw new FiscalError("JURISDICTION_PARENT_NOT_FOUND", "La jurisdicción padre no existe");
        const expectedParentKind = kind === "PROVINCIAL" ? "NATIONAL" : "PROVINCIAL";
        if (parent.kind !== expectedParentKind) {
          throw new FiscalError(
            "JURISDICTION_PARENT_INVALID",
            `${kind === "PROVINCIAL" ? "Una provincia requiere una jurisdicción nacional" : "Un municipio requiere una jurisdicción provincial"}; el padre seleccionado es ${parent.kind}`,
          );
        }
      }
      const updated = await tx.jurisdiction.update({
        where: { id: row.id },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: hasEditableFields ? "tax.jurisdiction.updated" : input.isActive ? "tax.jurisdiction.shown" : "tax.jurisdiction.hidden",
        entityType: "Jurisdiction",
        entityId: row.id,
        before: { code: row.code, name: row.name, kind: row.kind, parentId: row.parentId, isActive: row.isActive },
        after: { code: updated.code, name: updated.name, kind: updated.kind, parentId: updated.parentId, isActive: updated.isActive },
      });
      return updated;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe una jurisdicción con ese código");
      throw err;
    });
  }

  async updateTaxType(
    ctx: TenantContext,
    input: { taxTypeId: string; code?: string; name?: string; isActive?: boolean },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.taxType.findUnique({ where: { id: input.taxTypeId } });
      if (!row) throw new FiscalError("CATALOG_NOT_FOUND", "El tipo de impuesto no existe");
      const hasEditableFields = input.code !== undefined || input.name !== undefined;
      if (!hasEditableFields && input.isActive === row.isActive) {
        throw new FiscalError("CATALOG_STATE_UNCHANGED", input.isActive ? "El tipo de impuesto ya está activo" : "El tipo de impuesto ya está desactivado");
      }
      const updated = await tx.taxType.update({
        where: { id: row.id },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: hasEditableFields ? "tax.type.updated" : input.isActive ? "tax.type.shown" : "tax.type.hidden",
        entityType: "TaxType",
        entityId: row.id,
        before: { code: row.code, name: row.name, isActive: row.isActive },
        after: { code: updated.code, name: updated.name, isActive: updated.isActive },
      });
      return updated;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe un tipo de impuesto con ese código");
      throw err;
    });
  }

  async listTaxAuthorities(ctx: TenantContext, jurisdictionId?: string, includeInactive = false) {
    return withTenantContext(ctx, (tx) =>
      tx.taxAuthority.findMany({
        where: {
          ...(jurisdictionId ? { jurisdictionId } : {}),
          ...(includeInactive ? {} : { isActive: true }),
        },
        include: { jurisdiction: true },
        orderBy: { code: "asc" },
        take: 500,
      }),
    );
  }

  async createTaxAuthority(
    ctx: TenantContext,
    input: { code: string; name: string; jurisdictionId: string; duplicateOfId?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const jurisdiction = await tx.jurisdiction.findUnique({
        where: { id: input.jurisdictionId },
      });
      if (!jurisdiction) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const created = await tx.taxAuthority.create({
        data: { code: input.code, name: input.name, jurisdictionId: input.jurisdictionId, origin: "UI", createdByFirmId: ctx.firmId },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.duplicateOfId ? "tax.authority.duplicated" : "tax.authority.created",
        entityType: "TaxAuthority",
        entityId: created.id,
        before: input.duplicateOfId
          ? await tx.taxAuthority.findUniqueOrThrow({ where: { id: input.duplicateOfId } }).then((source: { code: string; name: string; jurisdictionId: string; isActive: boolean }) => ({
            code: source.code, name: source.name, jurisdictionId: source.jurisdictionId, isActive: source.isActive,
          }))
          : Prisma.JsonNull,
        after: { code: created.code, name: created.name, jurisdictionId: created.jurisdictionId, isActive: created.isActive },
      });
      return created;
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

  async updateTaxAuthority(
    ctx: TenantContext,
    input: { authorityId: string; code?: string; name?: string; jurisdictionId?: string; isActive?: boolean },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.taxAuthority.findUnique({ where: { id: input.authorityId } });
      if (!row) throw new FiscalError("CATALOG_NOT_FOUND", "El organismo no existe");
      const hasEditableFields = input.code !== undefined || input.name !== undefined || input.jurisdictionId !== undefined;
      if (!hasEditableFields && input.isActive === row.isActive) {
        throw new FiscalError("CATALOG_STATE_UNCHANGED", input.isActive ? "El organismo ya está activo" : "El organismo ya está oculto");
      }
      if (input.jurisdictionId !== undefined && !(await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId } }))) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const updated = await tx.taxAuthority.update({
        where: { id: row.id },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.jurisdictionId !== undefined ? { jurisdictionId: input.jurisdictionId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: hasEditableFields ? "tax.authority.updated" : input.isActive ? "tax.authority.shown" : "tax.authority.hidden",
        entityType: "TaxAuthority",
        entityId: row.id,
        before: { code: row.code, name: row.name, jurisdictionId: row.jurisdictionId, isActive: row.isActive },
        after: { code: updated.code, name: updated.name, jurisdictionId: updated.jurisdictionId, isActive: updated.isActive },
      });
      return updated;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe un organismo con ese código");
      throw err;
    });
  }

  async listRegimes(ctx: TenantContext, includeInactive = false) {
    return withTenantContext(ctx, (tx) =>
      tx.taxRegime.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: { taxType: true, jurisdiction: true, authority: true },
        orderBy: { code: "asc" },
        take: 200,
      }),
    );
  }

  async createRegime(
    ctx: TenantContext,
    input: { code: string; name: string; taxTypeId: string; jurisdictionId: string; authorityId: string; duplicateOfId?: string },
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
      const created = await tx.taxRegime.create({
        data: {
          code: input.code,
          name: input.name,
          taxTypeId: input.taxTypeId,
          jurisdictionId: input.jurisdictionId,
          authorityId: input.authorityId,
          origin: "UI",
          createdByFirmId: ctx.firmId,
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.duplicateOfId ? "tax.regime.duplicated" : "tax.regime.created",
        entityType: "TaxRegime",
        entityId: created.id,
        before: input.duplicateOfId
          ? await tx.taxRegime.findUniqueOrThrow({ where: { id: input.duplicateOfId } }).then((source: { code: string; name: string; taxTypeId: string; jurisdictionId: string; authorityId: string; isActive: boolean }) => ({
            code: source.code, name: source.name, taxTypeId: source.taxTypeId, jurisdictionId: source.jurisdictionId,
            authorityId: source.authorityId, isActive: source.isActive,
          }))
          : Prisma.JsonNull,
        after: {
          code: created.code, name: created.name, taxTypeId: created.taxTypeId, jurisdictionId: created.jurisdictionId,
          authorityId: created.authorityId, isActive: created.isActive,
        },
      });
      return created;
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

  async updateRegime(
    ctx: TenantContext,
    input: {
      regimeId: string;
      code?: string;
      name?: string;
      taxTypeId?: string;
      jurisdictionId?: string;
      authorityId?: string;
      isActive?: boolean;
    },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const row = await tx.taxRegime.findUnique({ where: { id: input.regimeId } });
      if (!row) throw new FiscalError("CATALOG_NOT_FOUND", "El régimen no existe");
      const hasEditableFields = input.code !== undefined || input.name !== undefined || input.taxTypeId !== undefined ||
        input.jurisdictionId !== undefined || input.authorityId !== undefined;
      if (!hasEditableFields && input.isActive === row.isActive) {
        throw new FiscalError("CATALOG_STATE_UNCHANGED", input.isActive ? "El régimen ya está activo" : "El régimen ya está oculto");
      }
      const taxTypeId = input.taxTypeId ?? row.taxTypeId;
      const jurisdictionId = input.jurisdictionId ?? row.jurisdictionId;
      const authorityId = input.authorityId ?? row.authorityId;
      if (input.taxTypeId !== undefined && !(await tx.taxType.findUnique({ where: { id: taxTypeId } }))) {
        throw new FiscalError("TAX_TYPE_NOT_FOUND", "Impuesto no encontrado");
      }
      if (input.jurisdictionId !== undefined && !(await tx.jurisdiction.findUnique({ where: { id: jurisdictionId } }))) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const authority = input.authorityId !== undefined || input.jurisdictionId !== undefined
        ? await tx.taxAuthority.findUnique({ where: { id: authorityId } })
        : null;
      if ((input.authorityId !== undefined || input.jurisdictionId !== undefined) && !authority) {
        throw new FiscalError("AUTHORITY_NOT_FOUND", "Autoridad fiscal no encontrada");
      }
      if (authority && authority.jurisdictionId !== jurisdictionId) {
        throw new FiscalError("AUTHORITY_JURISDICTION_MISMATCH", "La autoridad fiscal debe corresponder a la jurisdicción del régimen");
      }
      const updated = await tx.taxRegime.update({
        where: { id: row.id },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.taxTypeId !== undefined ? { taxTypeId } : {}),
          ...(input.jurisdictionId !== undefined ? { jurisdictionId } : {}),
          ...(input.authorityId !== undefined ? { authorityId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: hasEditableFields ? "tax.regime.updated" : input.isActive ? "tax.regime.shown" : "tax.regime.hidden",
        entityType: "TaxRegime",
        entityId: row.id,
        before: {
          code: row.code, name: row.name, taxTypeId: row.taxTypeId, jurisdictionId: row.jurisdictionId,
          authorityId: row.authorityId, isActive: row.isActive,
        },
        after: {
          code: updated.code, name: updated.name, taxTypeId: updated.taxTypeId, jurisdictionId: updated.jurisdictionId,
          authorityId: updated.authorityId, isActive: updated.isActive,
        },
      });
      return updated;
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe un régimen con ese código");
      throw err;
    });
  }

  async getCatalogUsage(ctx: TenantContext, kind: FiscalCatalogKind, id: string): Promise<CatalogUsage> {
    return withTenantContext(ctx, async (tx) => {
      const found = kind === "jurisdiction" ? await tx.jurisdiction.findUnique({ where: { id } })
        : kind === "taxType" ? await tx.taxType.findUnique({ where: { id } })
          : kind === "authority" ? await tx.taxAuthority.findUnique({ where: { id } })
            : kind === "regime" ? await tx.taxRegime.findUnique({ where: { id } })
              : await tx.economicActivity.findUnique({ where: { id } });
      if (!found) throw new FiscalError("CATALOG_NOT_FOUND", "El registro no existe en el catálogo");
      const places = await catalogUsagePlaces(tx, kind, id, { code: found.code, name: found.name });
      return summarizeCatalogUsage(id, places);
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
      duplicateOfId?: string;
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
          origin: "UI",
          createdByFirmId: ctx.firmId,
          ...(input.source ? { source: input.source.trim() } : {}),
          validFrom,
          ...(validTo ? { validTo } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.duplicateOfId ? "tax.activity.duplicated" : "tax.activity.created",
        entityType: "EconomicActivity",
        entityId: created.id,
        before: input.duplicateOfId
          ? await tx.economicActivity.findUniqueOrThrow({ where: { id: input.duplicateOfId } }).then((source: { code: string; name: string; jurisdictionId: string; source: string | null; validFrom: Date; validTo: Date | null; isActive: boolean }) => ({
            code: source.code, name: source.name, jurisdictionId: source.jurisdictionId, source: source.source,
            validFrom: source.validFrom.toISOString(), validTo: source.validTo?.toISOString() ?? null, isActive: source.isActive,
          }))
          : Prisma.JsonNull,
        after: {
          code: created.code, name: created.name, jurisdictionId: created.jurisdictionId, source: created.source,
          validFrom: created.validFrom.toISOString(), validTo: created.validTo?.toISOString() ?? null, isActive: created.isActive,
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

  async updateActivity(
    ctx: TenantContext,
    input: {
      activityId: string;
      code?: string;
      name?: string;
      jurisdictionId?: string;
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
      const code = input.code === undefined ? row.code : normalizeActivityCode(input.code);
      if (!ACTIVITY_CODE_PATTERN.test(code)) {
        throw new FiscalError("ACTIVITY_CODE_INVALID", `El código "${code}" no cumple el formato del catálogo`);
      }
      if (input.jurisdictionId !== undefined && !(await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId } }))) {
        throw new FiscalError("JURISDICTION_NOT_FOUND", "Jurisdicción no encontrada");
      }
      const validFrom = input.validFrom ? new Date(input.validFrom) : row.validFrom;
      const validTo =
        input.validTo === undefined ? row.validTo : input.validTo ? new Date(input.validTo) : null;
      assertActivityValidity(validFrom, validTo);
      const nextName = input.name === undefined ? row.name : input.name.trim();
      let codeChange: {
        previousCode: string;
        updatedReferences: number;
        retainedReferences: number;
      } | null = null;
      if (code !== row.code) {
        const oldProfileActivityPrefix = `${row.code} —`;
        const [draftConcepts, draftActivityCodes, voucherLines, classifications, supplierProfiles, clientProfiles] =
          await Promise.all([
            tx.taxRateRule.updateMany({
              where: {
                concept: row.code,
                ruleVersion: { is: { status: "DRAFT" } },
              },
              data: { concept: code },
            }),
            tx.taxRateRule.updateMany({
              where: {
                activityCode: row.code,
                ruleVersion: { is: { status: "DRAFT" } },
              },
              data: { activityCode: code },
            }),
            tx.fiscalVoucherLine.updateMany({ where: { activityCode: row.code }, data: { activityCode: code } }),
            tx.workpaperVoucherClassification.updateMany({
              where: { activityCode: row.code },
              data: { activityCode: code },
            }),
            tx.supplierTaxProfile.updateMany({ where: { activityCode: row.code }, data: { activityCode: code } }),
            tx.clientProfile.updateMany({
              where: { activity: { startsWith: oldProfileActivityPrefix } },
              data: { activity: `${code} — ${nextName}` },
            }),
          ]);
        const [retainedRuleConcepts, retainedRuleActivityCodes, retainedProfiles] = await Promise.all([
          tx.taxRateRule.count({
            where: {
              concept: row.code,
              ruleVersion: { is: { status: { not: "DRAFT" } } },
            },
          }),
          tx.taxRateRule.count({
            where: {
              activityCode: row.code,
              ruleVersion: { is: { status: { not: "DRAFT" } } },
            },
          }),
          tx.clientProfile.count({ where: { activity: { startsWith: oldProfileActivityPrefix } } }),
        ]);
        codeChange = {
          previousCode: row.code,
          updatedReferences:
            draftConcepts.count +
            draftActivityCodes.count +
            voucherLines.count +
            classifications.count +
            supplierProfiles.count +
            clientProfiles.count,
          retainedReferences: retainedRuleConcepts + retainedRuleActivityCodes + retainedProfiles,
        };
      }
      const updated = await tx.economicActivity.update({
        where: { id: row.id },
        data: {
          ...(input.code !== undefined ? { code } : {}),
          ...(input.name !== undefined ? { name: nextName } : {}),
          ...(input.jurisdictionId !== undefined ? { jurisdictionId: input.jurisdictionId } : {}),
          ...(input.source !== undefined ? { source: input.source === null ? null : input.source.trim() } : {}),
          ...(input.validFrom !== undefined ? { validFrom } : {}),
          ...(input.validTo !== undefined ? { validTo } : {}),
        },
      });
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.activity.updated",
        entityType: "EconomicActivity",
        entityId: row.id,
        before: {
          code: row.code, name: row.name, jurisdictionId: row.jurisdictionId, source: row.source,
          validFrom: row.validFrom.toISOString(), validTo: row.validTo?.toISOString() ?? null,
        },
        after: {
          code: updated.code, name: updated.name, jurisdictionId: updated.jurisdictionId, source: updated.source,
          validFrom: updated.validFrom.toISOString(), validTo: updated.validTo?.toISOString() ?? null,
          codeChange,
        },
      });
      return { ...(await withActiveClientLinks(tx, updated)), codeChange };
    }).catch((err: unknown) => {
      if (isUniqueConstraintError(err)) throw new FiscalError("CATALOG_CODE_CONFLICT", "Ya existe una actividad con ese código en la jurisdicción");
      throw err;
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
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: input.isActive ? "tax.activity.shown" : "tax.activity.hidden",
        entityType: "EconomicActivity",
        entityId: row.id,
        before: {
          code: row.code, name: row.name, jurisdictionId: row.jurisdictionId, source: row.source,
          validFrom: row.validFrom.toISOString(), validTo: row.validTo?.toISOString() ?? null, isActive: row.isActive,
        },
        after: {
          code: updated.code, name: updated.name, jurisdictionId: updated.jurisdictionId, source: updated.source,
          validFrom: updated.validFrom.toISOString(), validTo: updated.validTo?.toISOString() ?? null, isActive: updated.isActive,
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
    return withTenantContext(ctx, (tx) =>
      tx.taxRulePack.create({ data: { ...input, origin: "UI", createdByFirmId: ctx.firmId } }),
    );
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
      const pack = await tx.taxRulePack.findUnique({
        where: { id: input.packId },
        include: {
          regime: {
            select: {
              code: true,
              taxType: { select: { code: true } },
              jurisdiction: { select: { code: true } },
            },
          },
        },
      });
      if (!pack) throw new FiscalError("RULE_PACK_NOT_FOUND", "Rule pack no encontrado");
      assertTaxEngineVersionCompatible(
        taxRegimeEngineScope(pack.regime),
        input.engineVersion,
      );
      const count = await tx.taxRuleVersion.count({ where: { packId: input.packId } });
      return tx.taxRuleVersion.create({
        data: {
          packId: input.packId,
          origin: "UI",
          createdByFirmId: ctx.firmId,
          version: count + 1,
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
          engineVersion: input.engineVersion,
          rulesHash: computeRulesHashV2({ engineVersion: input.engineVersion }),
          rulesHashSchemaVersion: RULES_HASH_SCHEMA_VERSION_V2,
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
        include: {
          rateRules: true,
          minimumRules: true,
          bracketRules: true,
          dueDateRules: true,
          roundingRules: true,
          sources: true,
          pack: {
            include: {
              regime: {
                select: {
                  code: true,
                  taxType: { select: { code: true } },
                  jurisdiction: { select: { code: true } },
                },
              },
            },
          },
        },
      });
      if (!source) throw new FiscalError("RULE_VERSION_NOT_FOUND", "El pack no tiene una versión para clonar");
      assertTaxEngineVersionCompatible(
        taxRegimeEngineScope(source.pack.regime),
        source.engineVersion,
      );
      const count = await tx.taxRuleVersion.count({ where: { packId: input.packId } });
      const version = await tx.taxRuleVersion.create({
        data: {
          packId: input.packId,
          origin: "UI",
          createdByFirmId: ctx.firmId,
          version: count + 1,
          status: "DRAFT",
          validFrom: new Date(input.validFrom),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
          engineVersion: source.engineVersion,
          rulesHash: source.rulesHash,
          rulesHashSchemaVersion: RULES_HASH_SCHEMA_VERSION_V2,
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
        source.bracketRules.length
          ? tx.taxBracketRule.createMany({
              data: source.bracketRules.map((rule) => ({
                ruleVersionId: version.id,
                concept: rule.concept,
                fromAmount: rule.fromAmount,
                ...(rule.toAmount ? { toAmount: rule.toAmount } : {}),
                rate: rule.rate,
                ...(rule.fixedAmount ? { fixedAmount: rule.fixedAmount } : {}),
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
        include: {
          rateRules: true,
          minimumRules: true,
          bracketRules: true,
          dueDateRules: true,
          roundingRules: true,
          sources: true,
        },
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

  /** Activa directamente una versión fiscal validada por el Administrador/Titular. */
  async activate(ctx: TenantContext, ruleVersionId: string) {
    return withTenantContext(ctx, async (tx) => {
      const versionInclude = {
        rateRules: true,
        minimumRules: true,
        bracketRules: true,
        dueDateRules: true,
        roundingRules: true,
        pack: {
          include: {
            regime: {
              select: {
                code: true,
                taxType: { select: { code: true } },
                jurisdiction: { select: { code: true } },
              },
            },
          },
        },
      } as const;
      const initial = await tx.taxRuleVersion.findUnique({
        where: { id: ruleVersionId },
        include: versionInclude,
      });
      if (!initial) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");

      // Serializa la activación por paquete para que no queden dos versiones
      // ACTIVAS ante solicitudes administrativas concurrentes.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${initial.packId}), 1)) AS activation_lock`;
      const v = await tx.taxRuleVersion.findUnique({
        where: { id: ruleVersionId },
        include: versionInclude,
      });
      if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
      if (!["DRAFT", "IN_REVIEW", "APPROVED"].includes(v.status)) {
        throw new FiscalError(
          "INVALID_TRANSITION",
          `Sólo una versión DRAFT, IN_REVIEW o APPROVED puede activarse (estado: ${v.status})`,
        );
      }
      if (!Number.isInteger(v.version) || v.version < 1 || !hasValidDateRange(v.validFrom, v.validTo)) {
        throw new FiscalError(
          "RULE_VERSION_INVALID",
          "La versión tiene un número o una vigencia inválidos; corregí la vigencia antes de activar.",
        );
      }
      if (typeof v.engineVersion !== "string" || v.engineVersion.trim() === "") {
        throw new FiscalError("RULE_VERSION_INVALID", "La versión no tiene un motor fiscal definido.");
      }
      assertTaxEngineVersionCompatible(
        taxRegimeEngineScope(v.pack.regime),
        v.engineVersion,
      );
      if (!v.rulesHash || v.rulesHash.trim() === "") {
        throw new FiscalError("RULE_VERSION_INVALID", "La versión no tiene un hash de reglas calculado.");
      }
      if (
        !ruleDateRangesAreValid([
          ...v.rateRules,
          ...v.minimumRules,
          ...v.bracketRules,
          ...v.dueDateRules,
        ])
      ) {
        throw new FiscalError(
          "RULE_VERSION_INVALID",
          "Una regla tiene una vigencia inválida; revisá las fechas antes de activar.",
        );
      }
      if (v.rateRules.length + v.minimumRules.length + v.bracketRules.length + v.dueDateRules.length === 0) {
        throw new FiscalError(
          "RULE_VERSION_EMPTY",
          "La versión no contiene reglas fiscales ni vencimientos para activar.",
        );
      }
      const computedHash = v.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V1
        ? computeLegacyRulesHashSchemaV1(v)
        : v.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V2
          ? computeRulesHashV2(v)
          : null;
      if (computedHash === null) {
        throw new FiscalError(
          "RULES_HASH_SCHEMA_UNSUPPORTED",
          `El esquema de hash ${v.rulesHashSchemaVersion} no es compatible para activar.`,
        );
      }
      if (computedHash !== v.rulesHash) {
        throw new FiscalError(
          "RULES_HASH_MISMATCH",
          "El hash no coincide con las reglas guardadas; guardá nuevamente el borrador antes de activar.",
        );
      }
      await tx.taxRuleVersion.updateMany({
        where: { packId: v.packId, status: "ACTIVE" },
        data: { status: "RETIRED" },
      });
      const activatedAt = new Date();
      const activated = await tx.taxRuleVersion.update({
        where: { id: ruleVersionId },
        data: { status: "ACTIVE", activatedByUserId: ctx.userId, activatedAt },
      });
      const activeVersions = await tx.taxRuleVersion.findMany({
        where: { packId: v.packId, status: "ACTIVE" },
        select: { id: true },
      });
      if (activeVersions.length !== 1 || activeVersions[0]?.id !== ruleVersionId) {
        throw new FiscalError(
          "RULE_VERSION_INVALID",
          "La vigencia se solapa con otra versión activa del paquete; revisá las versiones antes de activar.",
        );
      }
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax_rule_version.activated",
        entityType: "TaxRuleVersion",
        entityId: ruleVersionId,
        after: {
          status: "ACTIVE",
          version: v.version,
          activatedByUserId: ctx.userId,
          activatedAt: activatedAt.toISOString(),
          rulesHash: v.rulesHash,
          validFrom: v.validFrom.toISOString(),
          validTo: v.validTo?.toISOString() ?? null,
        },
      });
      return activated;
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
      include: {
        rateRules: true,
        minimumRules: true,
        bracketRules: true,
        dueDateRules: true,
        roundingRules: true,
      },
    });
    if (!version) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
    return tx.taxRuleVersion.update({
      where: { id: ruleVersionId },
      data: {
        rulesHash: computeRulesHashV2(version),
        rulesHashSchemaVersion: RULES_HASH_SCHEMA_VERSION_V2,
      },
    });
  }

  private async assertDraft(tx: Prisma.TransactionClient, ruleVersionId: string) {
    const v = await tx.taxRuleVersion.findUnique({
      where: { id: ruleVersionId },
      include: {
        pack: {
          include: {
            regime: {
              select: {
                code: true,
                taxType: { select: { code: true } },
                jurisdiction: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!v) throw new FiscalError("RULE_VERSION_NOT_FOUND", "Versión de regla no encontrada");
    if (v.status !== "DRAFT") {
      throw new FiscalError("RULE_VERSION_IMMUTABLE", "Sólo se editan versiones DRAFT; las aprobadas/activas son inmutables");
    }
    assertTaxEngineVersionCompatible(
      taxRegimeEngineScope(v.pack.regime),
      v.engineVersion,
    );
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