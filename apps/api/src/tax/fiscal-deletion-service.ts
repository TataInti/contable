import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import {
  DeletionError,
  type DeletionCountItem,
  type DeletionPreview,
} from "../lib/deletion.js";

/**
 * Borrado definitivo de catálogos fiscales creados por UI y de paquetes/
 * versiones de reglas. Sólo OWNER (capability data.delete).
 *
 * Los catálogos son globales: el preview agrega referencias de todos los
 * estudios y la transacción bloquea cualquier baja que afecte a terceros.
 * Sólo se pueden eliminar registros UI creados por el estudio autenticado.
 *
 * Cascada:
 *  - Régimen: elimina las inscripciones del estudio autenticado.
 *  - Actividad: elimina los vínculos cliente-actividad del estudio.
 *  - Organismo: se bloquea si está referenciado por regímenes, fuentes o matrículas.
 *  - Paquete/versión: cascada de parametría; se bloquea si hay aprobaciones,
 *    liquidaciones, decisiones de tratamiento o ajustes asociados.
 */

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

function dependencyItems(entries: Array<[string, string, number]>): DeletionCountItem[] {
  return entries
    .filter(([, , count]) => count > 0)
    .map(([key, label, count]) => ({ key, label, count }));
}

function previewGroups(items: DeletionCountItem[]): DeletionPreview["groups"] {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return total > 0 ? [{ key: "fiscal", label: "Dependencias", count: total }] : [];
}

function isBlocker(items: DeletionCountItem[], keys: string[]): boolean {
  return items.some((item) => keys.includes(item.key) && item.count > 0);
}

function mapFunctionError(err: unknown): never {
  const error = err as {
    code?: string;
    meta?: { code?: string; message?: string };
    message?: string;
  };
  const sqlState = error.meta?.code ?? error.code;
  const message = error.meta?.message ?? error.message ?? "";
  if (sqlState === "42501" || message.includes("FORBIDDEN")) {
    throw new DeletionError(
      "DELETION_FORBIDDEN",
      "Sólo el Titular del estudio puede eliminar este registro",
      403,
    );
  }
  if (sqlState === "P0002" || message.includes("NOT_FOUND")) {
    throw new DeletionError("DELETION_NOT_FOUND", "El registro no existe", 404);
  }
  if (message.includes("CATALOG_IN_USE")) {
    throw new DeletionError(
      "CATALOG_IN_USE",
      "El catálogo tiene dependencias que impiden eliminarlo",
      409,
    );
  }
  if (message.includes("RULE_PACK_NOT_DRAFT") || message.includes("RULE_VERSION_NOT_DRAFT")) {
    throw new DeletionError(
      "RULE_NOT_DRAFT",
      "Sólo se pueden eliminar paquetes y versiones que continúan en borrador",
      409,
    );
  }
  if (message.includes("RULE_PACK_REFERENCE_VERSION")) {
    throw new DeletionError(
      "RULE_PACK_REFERENCE_VERSION",
      "El paquete incluye versiones de referencia que no se pueden eliminar",
      409,
    );
  }
  if (message.includes("RULE_PACK_OUT_OF_SCOPE") || message.includes("RULE_VERSION_OUT_OF_SCOPE")) {
    throw new DeletionError("DELETION_NOT_FOUND", "El registro no existe o no pertenece a este estudio", 404);
  }
  if (message.includes("RULE_PACK_IN_USE") || message.includes("RULE_VERSION_IN_USE")) {
    throw new DeletionError(
      "RULE_IN_USE",
      "La regla está referenciada por liquidaciones, decisiones o ajustes y no se puede eliminar",
      409,
    );
  }
  if (message.includes("RULE_VERSION_SUPERSEDED")) {
    throw new DeletionError(
      "RULE_VERSION_SUPERSEDED",
      "La versión fue reemplazada por otra; eliminá primero la versión sucesora",
      409,
    );
  }
  throw err;
}

type CatalogEntityKind = "AUTHORITY" | "REGIME" | "ACTIVITY";

function assertUiOwnedCatalog(
  record: { origin: string; createdByFirmId: string | null },
  ctx: TenantContext,
): void {
  if (record.origin !== "UI" || record.createdByFirmId !== ctx.firmId) {
    throw new DeletionError(
      "CATALOG_NOT_FOUND",
      "El registro no existe o no pertenece a este estudio",
      404,
    );
  }
}

async function catalogImpact(
  tx: Prisma.TransactionClient,
  kind: CatalogEntityKind,
  id: string,
  ctx: TenantContext,
): Promise<Record<string, number>> {
  try {
    const rows = await tx.$queryRaw<Array<{ result: Record<string, number> }>>`
      SELECT app_tax_catalog_deletion_preview(
        ${kind}, ${id}, ${ctx.firmId}, ${ctx.userId}
      ) AS result
    `;
    return rows[0]?.result ?? {};
  } catch (err) {
    mapFunctionError(err);
  }
}

async function deleteCatalogEntity(
  tx: Prisma.TransactionClient,
  kind: CatalogEntityKind,
  id: string,
  ctx: TenantContext,
): Promise<{ deletedRows: number; counts: Record<string, number> }> {
  try {
    const rows = await tx.$queryRaw<
      Array<{ result: { deletedRows: number; counts: Record<string, number> } }>
    >`
      SELECT app_delete_tax_catalog_entity(
        ${kind}, ${id}, ${ctx.firmId}, ${ctx.userId}
      ) AS result
    `;
    return rows[0]?.result ?? { deletedRows: 0, counts: {} };
  } catch (err) {
    mapFunctionError(err);
  }
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  input: {
    firmId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
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
      after: input.after,
    },
  });
}

export class FiscalDeletionService {
  async previewAuthority(
    authorityId: string,
    ctx: TenantContext,
  ): Promise<DeletionPreview> {
    return withTenantContext(ctx, async (tx) => {
      const authority = await tx.taxAuthority.findUnique({
        where: { id: authorityId },
        include: { jurisdiction: { select: { code: true, name: true } } },
      });
      if (!authority) {
        throw new DeletionError("CATALOG_NOT_FOUND", "El organismo no existe", 404);
      }
      assertUiOwnedCatalog(authority, ctx);
      const impact = await catalogImpact(tx, "AUTHORITY", authorityId, ctx);

      const items = dependencyItems([
        ["regimes", "Regímenes que lo usan", impact.regimes ?? 0],
        ["sources", "Fuentes normativas", impact.sources ?? 0],
        ["credentials", "Matrículas profesionales", impact.credentials ?? 0],
      ]);
      const blocked = isBlocker(items, ["regimes", "sources", "credentials"]);

      return {
        entity: {
          id: authority.id,
          kind: "TAX_AUTHORITY",
          label: authority.name,
          secondary: `${authority.code} · ${authority.jurisdiction.name}`,
        },
        confirmation: {
          expected: authority.code,
          label: "Escribí el código del organismo para confirmar",
        },
        totals: { rows: items.reduce((sum, item) => sum + item.count, 0) },
        groups: previewGroups(items),
        items,
        blockers: blocked ? items : [],
        canDelete: !blocked,
        notes: blocked
          ? ["El organismo está en uso. Eliminá o reasigná primero sus regímenes, fuentes y matrículas."]
          : ["El organismo no tiene dependencias y se puede eliminar."],
      };
    });
  }

  async deleteAuthority(authorityId: string, confirmation: string, ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      const authority = await tx.taxAuthority.findUnique({ where: { id: authorityId } });
      if (!authority) {
        throw new DeletionError("CATALOG_NOT_FOUND", "El organismo no existe", 404);
      }
      assertUiOwnedCatalog(authority, ctx);
      if (confirmation.trim() !== authority.code) {
        throw new DeletionError(
          "CATALOG_CONFIRMATION_MISMATCH",
          "El código escrito no coincide con el del organismo",
          409,
        );
      }
      const deleted = await deleteCatalogEntity(tx, "AUTHORITY", authorityId, ctx);
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.catalog.delete",
        entityType: "TaxAuthority",
        entityId: authorityId,
        after: { code: authority.code, name: authority.name, ...deleted.counts },
      });
      return { id: authorityId, ...deleted };
    }, TRANSACTION_OPTIONS);
  }

  async previewRegime(regimeId: string, ctx: TenantContext): Promise<DeletionPreview> {
    return withTenantContext(ctx, async (tx) => {
      const regime = await tx.taxRegime.findUnique({
        where: { id: regimeId },
        include: {
          taxType: { select: { code: true, name: true } },
          jurisdiction: { select: { code: true, name: true } },
        },
      });
      if (!regime) {
        throw new DeletionError("CATALOG_NOT_FOUND", "El régimen no existe", 404);
      }
      assertUiOwnedCatalog(regime, ctx);
      const impact = await catalogImpact(tx, "REGIME", regimeId, ctx);
      const registrations = impact.registrations ?? 0;

      const items = dependencyItems([
        ["registrations", "Inscripciones del estudio (se eliminan)", registrations],
        ["obligations", "Obligaciones del estudio", impact.obligations ?? 0],
        ["settlements", "Liquidaciones del estudio", impact.settlements ?? 0],
        ["packs", "Paquetes de reglas", impact.packs ?? 0],
        ["otherFirmRegistrations", "Inscripciones de otros estudios", impact.otherFirmRegistrations ?? 0],
      ]);
      const blockers = items.filter((item) =>
        ["obligations", "settlements", "packs", "otherFirmRegistrations"].includes(item.key),
      );
      const blocked = blockers.length > 0;

      return {
        entity: {
          id: regime.id,
          kind: "TAX_REGIME",
          label: regime.name,
          secondary: `${regime.code} · ${regime.taxType.name} · ${regime.jurisdiction.name}`,
        },
        confirmation: {
          expected: regime.code,
          label: "Escribí el código del régimen para confirmar",
        },
        totals: {
          rows: items.reduce((sum, item) => sum + item.count, 0),
          affectedClients: registrations,
        },
        groups: previewGroups(items),
        items,
        blockers,
        canDelete: !blocked,
        notes: blocked
          ? [
              "El régimen tiene historial (obligaciones, liquidaciones o paquetes) o lo usa otro estudio.",
              "Para proteger la trazabilidad no se borra en cascada ese historial.",
            ]
          : ["Las inscripciones del estudio se eliminarán en cascada con el régimen."],
      };
    });
  }

  async deleteRegime(regimeId: string, confirmation: string, ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      const regime = await tx.taxRegime.findUnique({ where: { id: regimeId } });
      if (!regime) {
        throw new DeletionError("CATALOG_NOT_FOUND", "El régimen no existe", 404);
      }
      assertUiOwnedCatalog(regime, ctx);
      if (confirmation.trim() !== regime.code) {
        throw new DeletionError(
          "CATALOG_CONFIRMATION_MISMATCH",
          "El código escrito no coincide con el del régimen",
          409,
        );
      }

      const deleted = await deleteCatalogEntity(tx, "REGIME", regimeId, ctx);
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.catalog.delete",
        entityType: "TaxRegime",
        entityId: regimeId,
        after: { code: regime.code, name: regime.name, ...deleted.counts },
      });
      return { id: regimeId, ...deleted };
    }, TRANSACTION_OPTIONS);
  }

  async previewActivity(activityId: string, ctx: TenantContext): Promise<DeletionPreview> {
    return withTenantContext(ctx, async (tx) => {
      const activity = await tx.economicActivity.findUnique({
        where: { id: activityId },
        include: { jurisdiction: { select: { code: true, name: true } } },
      });
      if (!activity) {
        throw new DeletionError("CATALOG_NOT_FOUND", "La actividad no existe", 404);
      }
      assertUiOwnedCatalog(activity, ctx);
      const impact = await catalogImpact(tx, "ACTIVITY", activityId, ctx);
      const links = impact.clientActivities ?? 0;

      const items = dependencyItems([
        ["clientActivities", "Vínculos de clientes del estudio (se eliminan)", links],
        ["rateRules", "Reglas de alícuota que usan el código", impact.rateRules ?? 0],
        ["otherFirmClientActivities", "Vínculos de otros estudios", impact.otherFirmClientActivities ?? 0],
      ]);
      const blockers = items.filter((item) =>
        ["rateRules", "otherFirmClientActivities"].includes(item.key),
      );
      const blocked = blockers.length > 0;

      return {
        entity: {
          id: activity.id,
          kind: "ECONOMIC_ACTIVITY",
          label: activity.name,
          secondary: `${activity.code} · ${activity.jurisdiction.name}`,
        },
        confirmation: {
          expected: activity.code,
          label: "Escribí el código de la actividad para confirmar",
        },
        totals: {
          rows: items.reduce((sum, item) => sum + item.count, 0),
          affectedClients: links,
        },
        groups: previewGroups(items),
        items,
        blockers,
        canDelete: !blocked,
        notes: blocked
          ? [
              "La actividad está referenciada por reglas de alícuota o por vínculos de otro estudio.",
              "Esos registros son historial y no se borran en cascada.",
            ]
          : ["Los vínculos de clientes del estudio se eliminarán en cascada con la actividad."],
      };
    });
  }

  async deleteActivity(activityId: string, confirmation: string, ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      const activity = await tx.economicActivity.findUnique({ where: { id: activityId } });
      if (!activity) {
        throw new DeletionError("CATALOG_NOT_FOUND", "La actividad no existe", 404);
      }
      assertUiOwnedCatalog(activity, ctx);
      if (confirmation.trim() !== activity.code) {
        throw new DeletionError(
          "CATALOG_CONFIRMATION_MISMATCH",
          "El código escrito no coincide con el de la actividad",
          409,
        );
      }

      const deleted = await deleteCatalogEntity(tx, "ACTIVITY", activityId, ctx);
      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.catalog.delete",
        entityType: "EconomicActivity",
        entityId: activityId,
        after: { code: activity.code, name: activity.name, ...deleted.counts },
      });
      return { id: activityId, ...deleted };
    }, TRANSACTION_OPTIONS);
  }

  async previewRulePack(packId: string, ctx: TenantContext): Promise<DeletionPreview> {
    return withTenantContext(ctx, async (tx) => {
      const pack = await tx.taxRulePack.findUnique({
        where: { id: packId },
        include: {
          regime: {
            select: {
              code: true,
              name: true,
              taxType: { select: { name: true } },
              jurisdiction: { select: { name: true } },
            },
          },
        },
      });
      if (!pack) {
        throw new DeletionError("RULE_PACK_NOT_FOUND", "El paquete de reglas no existe", 404);
      }
      assertUiOwnedCatalog(pack, ctx);

      const versionWhere = { ruleVersion: { packId } } as const;
      const [versions, nonDraftVersions, referenceVersions, rateRules, minimums, brackets, dueDates, roundings, sources, approvals, settlements, decisions, adjustments] =
        await Promise.all([
          tx.taxRuleVersion.count({ where: { packId } }),
          tx.taxRuleVersion.count({ where: { packId, status: { not: "DRAFT" } } }),
          tx.taxRuleVersion.count({
            where: {
              packId,
              OR: [
                { origin: { not: "UI" } },
                { createdByFirmId: null },
                { createdByFirmId: { not: ctx.firmId } },
              ],
            },
          }),
          tx.taxRateRule.count({ where: versionWhere }),
          tx.taxMinimumRule.count({ where: versionWhere }),
          tx.taxBracketRule.count({ where: versionWhere }),
          tx.dueDateRule.count({ where: versionWhere }),
          tx.roundingRule.count({ where: versionWhere }),
          tx.normativeSource.count({ where: versionWhere }),
          tx.ruleApproval.count({ where: versionWhere }),
          tx.taxSettlement.count({ where: versionWhere }),
          tx.taxTreatmentDecision.count({ where: versionWhere }),
          tx.taxAdjustment.count({ where: versionWhere }),
        ]);

      const items = dependencyItems([
        ["versions", "Versiones (se eliminan)", versions],
        ["rateRules", "Alícuotas (se eliminan)", rateRules],
        ["minimums", "Mínimos (se eliminan)", minimums],
        ["brackets", "Escalas (se eliminan)", brackets],
        ["dueDates", "Vencimientos (se eliminan)", dueDates],
        ["roundings", "Redondeos (se eliminan)", roundings],
        ["sources", "Fuentes normativas (se eliminan)", sources],
        ["approvals", "Aprobaciones (se eliminan)", approvals],
        ["settlements", "Liquidaciones que la usan", settlements],
        ["decisions", "Decisiones de tratamiento", decisions],
        ["adjustments", "Ajustes fiscales", adjustments],
      ]);
      const blockers = items.filter((item) =>
        ["approvals", "settlements", "decisions", "adjustments"].includes(item.key),
      );
      if (pack.status !== "DRAFT") {
        blockers.push({ key: "packStatus", label: "El paquete debe seguir en borrador", count: 1 });
      }
      if (nonDraftVersions > 0) {
        blockers.push({ key: "nonDraftVersions", label: "Versiones fuera de borrador", count: nonDraftVersions });
      }
      if (referenceVersions > 0) {
        blockers.push({
          key: "referenceVersions",
          label: "Versiones de referencia o de otro estudio",
          count: referenceVersions,
        });
      }
      const blocked = blockers.length > 0;

      return {
        entity: {
          id: pack.id,
          kind: "TAX_RULE_PACK",
          label: pack.name,
          secondary: `${pack.code} · ${pack.regime.taxType.name} · ${pack.regime.jurisdiction.name}`,
        },
        confirmation: {
          expected: pack.code,
          label: "Escribí el código del paquete para confirmar",
        },
        totals: { rows: items.reduce((sum, item) => sum + item.count, 0) },
        groups: previewGroups(items),
        items,
        blockers,
        canDelete: !blocked,
        notes: blocked
          ? ["El paquete tiene aprobaciones o referencias que impiden eliminarlo."]
          : ["Se eliminarán el paquete, sus versiones y toda la parametría asociada."],
      };
    });
  }

  async deleteRulePack(packId: string, confirmation: string, ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      const pack = await tx.taxRulePack.findUnique({ where: { id: packId } });
      if (!pack) {
        throw new DeletionError("RULE_PACK_NOT_FOUND", "El paquete de reglas no existe", 404);
      }
      assertUiOwnedCatalog(pack, ctx);
      if (confirmation.trim() !== pack.code) {
        throw new DeletionError(
          "RULE_CONFIRMATION_MISMATCH",
          "El código escrito no coincide con el del paquete",
          409,
        );
      }

      let counts: Record<string, number> = {};
      try {
        const rows = await tx.$queryRaw<Array<{ result: Record<string, number> }>>`
          SELECT app_delete_tax_rule_pack(
            ${packId},
            ${ctx.firmId},
            ${ctx.userId}
          ) AS result
        `;
        counts = rows[0]?.result ?? {};
      } catch (err) {
        mapFunctionError(err);
      }

      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.rule_pack.delete",
        entityType: "TaxRulePack",
        entityId: packId,
        after: { code: pack.code, name: pack.name, ...counts },
      });
      return {
        id: packId,
        deletedRows: Object.values(counts).reduce((sum, value) => sum + value, 0) + 1,
        counts,
      };
    }, TRANSACTION_OPTIONS);
  }

  async previewRuleVersion(
    versionId: string,
    ctx: TenantContext,
  ): Promise<DeletionPreview> {
    return withTenantContext(ctx, async (tx) => {
      const version = await tx.taxRuleVersion.findUnique({
        where: { id: versionId },
        include: { pack: { select: { code: true, name: true } } },
      });
      if (!version) {
        throw new DeletionError("RULE_VERSION_NOT_FOUND", "La versión no existe", 404);
      }
      assertUiOwnedCatalog(version, ctx);

      const [rateRules, minimums, brackets, dueDates, roundings, sources, approvals, settlements, decisions, adjustments, supersededBy] =
        await Promise.all([
          tx.taxRateRule.count({ where: { ruleVersionId: versionId } }),
          tx.taxMinimumRule.count({ where: { ruleVersionId: versionId } }),
          tx.taxBracketRule.count({ where: { ruleVersionId: versionId } }),
          tx.dueDateRule.count({ where: { ruleVersionId: versionId } }),
          tx.roundingRule.count({ where: { ruleVersionId: versionId } }),
          tx.normativeSource.count({ where: { ruleVersionId: versionId } }),
          tx.ruleApproval.count({ where: { ruleVersionId: versionId } }),
          tx.taxSettlement.count({ where: { ruleVersionId: versionId } }),
          tx.taxTreatmentDecision.count({ where: { ruleVersionId: versionId } }),
          tx.taxAdjustment.count({ where: { ruleVersionId: versionId } }),
          tx.taxRuleVersion.count({ where: { supersedesId: versionId } }),
        ]);

      const items = dependencyItems([
        ["rateRules", "Alícuotas (se eliminan)", rateRules],
        ["minimums", "Mínimos (se eliminan)", minimums],
        ["brackets", "Escalas (se eliminan)", brackets],
        ["dueDates", "Vencimientos (se eliminan)", dueDates],
        ["roundings", "Redondeos (se eliminan)", roundings],
        ["sources", "Fuentes normativas (se eliminan)", sources],
        ["approvals", "Aprobaciones (se eliminan)", approvals],
        ["settlements", "Liquidaciones que la usan", settlements],
        ["decisions", "Decisiones de tratamiento", decisions],
        ["adjustments", "Ajustes fiscales", adjustments],
        ["supersededBy", "Versiones sucesoras", supersededBy],
      ]);
      const blockers = items.filter((item) =>
        ["approvals", "settlements", "decisions", "adjustments", "supersededBy"].includes(item.key),
      );
      if (version.status !== "DRAFT") {
        blockers.push({ key: "status", label: "La versión debe seguir en borrador", count: 1 });
      }
      const blocked = blockers.length > 0;

      return {
        entity: {
          id: version.id,
          kind: "TAX_RULE_VERSION",
          label: `${version.pack.name} v${version.version}`,
          secondary: `${version.pack.code} · v${version.version} · ${version.status}`,
        },
        confirmation: {
          expected: `${version.pack.code} v${version.version}`,
          label: "Escribí el código y la versión para confirmar",
        },
        totals: { rows: items.reduce((sum, item) => sum + item.count, 0) },
        groups: previewGroups(items),
        items,
        blockers,
        canDelete: !blocked,
        notes: blocked
          ? ["La versión tiene aprobaciones, referencias o una versión sucesora que impiden eliminarla."]
          : ["Se eliminarán la versión y toda su parametría asociada."],
      };
    });
  }

  async deleteRuleVersion(versionId: string, confirmation: string, ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      const version = await tx.taxRuleVersion.findUnique({
        where: { id: versionId },
        include: { pack: { select: { code: true } } },
      });
      if (!version) {
        throw new DeletionError("RULE_VERSION_NOT_FOUND", "La versión no existe", 404);
      }
      assertUiOwnedCatalog(version, ctx);
      const expected = `${version.pack.code} v${version.version}`;
      if (confirmation.trim() !== expected) {
        throw new DeletionError(
          "RULE_CONFIRMATION_MISMATCH",
          "El código y la versión escritos no coinciden",
          409,
        );
      }

      let counts: Record<string, number> = {};
      try {
        const rows = await tx.$queryRaw<Array<{ result: Record<string, number> }>>`
          SELECT app_delete_tax_rule_version(
            ${versionId},
            ${ctx.firmId},
            ${ctx.userId}
          ) AS result
        `;
        counts = rows[0]?.result ?? {};
      } catch (err) {
        mapFunctionError(err);
      }

      await recordAudit(tx, {
        firmId: ctx.firmId,
        userId: ctx.userId,
        action: "tax.rule_version.delete",
        entityType: "TaxRuleVersion",
        entityId: versionId,
        after: { code: version.pack.code, version: version.version, ...counts },
      });
      return {
        id: versionId,
        deletedRows: Object.values(counts).reduce((sum, value) => sum + value, 0) + 1,
        counts,
      };
    }, TRANSACTION_OPTIONS);
  }
}
