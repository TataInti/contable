import type { Prisma } from "@prisma/client";
import {
  buildLevelActivityContext,
  esMotorConActividadTipada,
  evaluateSaleActivities,
  mensajeActividadNoVigente,
  mensajeActividadSinClasificar,
  type ActivityIssue,
  type SaleActivityFact,
} from "./activity-coverage.js";
import { RULES_HASH_SCHEMA_VERSION_V3 } from "./rules-hash.js";
import { findActiveRuleVersion, resolveTaxEngineForVersion } from "./settlement-service.js";

/** Lo que la clasificación muestra por comprobante: el mismo código y texto que el cálculo. */
export type ActivityIssueView = { kind: ActivityIssue["kind"]; message: string };

type Tx = Prisma.TransactionClient;

/**
 * Ventas del expediente que el cálculo no podrá asignar a una actividad (brief 4J). Recorre las
 * obligaciones del período con motor de actividad tipada y aplica la misma validación del cálculo
 * (evaluateSaleActivities). Un comprobante con varias obligaciones muestra el primer hallazgo;
 * «no vigente» tiene prioridad sobre «sin clasificar».
 */
export async function activityIssuesForWorkpaper(
  tx: Tx,
  wp: { id: string; firmId: string; clientId: string; periodStart: Date; periodEnd: Date },
): Promise<Map<string, ActivityIssueView>> {
  const result = new Map<string, ActivityIssueView>();
  const classifications = await tx.workpaperVoucherClassification.findMany({
    where: { workpaperId: wp.id, excludedAt: null, direction: "SALE" },
    select: {
      voucherId: true,
      activityCode: true,
      voucher: {
        select: {
          issuedOn: true,
          lines: { select: { activityCode: true, netAmount: true } },
        },
      },
    },
  });
  if (classifications.length === 0) return result;

  const obligations = await tx.taxObligation.findMany({
    where: {
      firmId: wp.firmId,
      clientId: wp.clientId,
      status: { not: "NOT_APPLICABLE" },
      period: { startDate: { gte: wp.periodStart }, endDate: { lte: wp.periodEnd } },
    },
    select: {
      regimeId: true,
      regime: { select: { jurisdictionId: true } },
      period: { select: { startDate: true, endDate: true } },
    },
    // Mismo orden que el cálculo del expediente: el primer hallazgo coincide con el primer error.
    orderBy: { createdAt: "asc" },
  });
  const cutoffDate = `${wp.periodEnd.toISOString().slice(0, 10)}T23:59:59.999Z`;
  const facts: SaleActivityFact[] = classifications.map((classification) => ({
    voucherId: classification.voucherId,
    issuedOn: classification.voucher.issuedOn,
    lines: classification.voucher.lines.map((line) => ({
      activityCode: line.activityCode,
      hasNetAmount: line.netAmount != null,
    })),
    classification: { activityCode: classification.activityCode },
  }));
  const codes = [
    ...new Set(
      classifications
        .flatMap((classification) => [
          classification.activityCode,
          ...classification.voucher.lines.map((line) => line.activityCode),
        ])
        .filter((code): code is string => typeof code === "string" && code.trim().length > 0)
        .map((code) => code.trim().toUpperCase()),
    ),
  ];
  const catalog = codes.length
    ? await tx.economicActivity.findMany({
        where: { code: { in: codes } },
        select: { code: true, jurisdictionId: true },
      })
    : [];

  for (const obligation of obligations) {
    const pack = await tx.taxRulePack.findFirst({ where: { regimeId: obligation.regimeId } });
    if (!pack) continue;
    const version = await findActiveRuleVersion(tx, pack.id, obligation.period);
    if (!version) continue;
    const engine = await resolveTaxEngineForVersion(tx, version);
    const isTyped = version.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V3;
    if (!engine || !esMotorConActividadTipada(isTyped, engine.engineKey)) continue;

    const levelLinks = await tx.clientActivity.findMany({
      where: {
        firmId: wp.firmId,
        clientId: wp.clientId,
        profile: { status: "ACTIVE" },
        activity: { jurisdictionId: obligation.regime.jurisdictionId },
      },
      include: { activity: { select: { code: true, name: true } } },
      orderBy: [{ validFrom: "asc" }],
    });
    const ctx = buildLevelActivityContext({
      periodStart: obligation.period.startDate,
      periodEnd: obligation.period.endDate,
      jurisdictionId: obligation.regime.jurisdictionId,
      levelLinks: levelLinks.map((link) => ({
        code: link.activity.code,
        name: link.activity.name,
        validFrom: link.validFrom,
        validTo: link.validTo,
      })),
      catalog,
      withSingleLocal: true,
    });
    for (const issue of evaluateSaleActivities(ctx, facts, cutoffDate)) {
      // Primer hallazgo por obligación (el del cálculo); «no vigente» prevalece sobre «sin clasificar».
      const previo = result.get(issue.voucherId);
      if (previo && (previo.kind === "NOT_IN_FORCE" || issue.kind === "UNCLASSIFIED")) continue;
      result.set(issue.voucherId, {
        kind: issue.kind,
        message:
          issue.kind === "NOT_IN_FORCE"
            ? mensajeActividadNoVigente(
                { activityName: issue.activityName, validFrom: issue.validFrom },
                { startDate: wp.periodStart },
              )
            : mensajeActividadSinClasificar(1, issue.multipleInForce),
      });
    }
  }
  return result;
}

/**
 * Agrega a la cobertura de clasificación el hallazgo de actividad por comprobante. Una venta
 * clasificada con actividad no vigente deja de contar como clasificada y pasa a pendiente; `ready`
 * no cambia (lo usa el gate de cálculo del expediente).
 */
export function conActividadPendiente<
  C extends {
    total: number;
    classified: number;
    pending: number;
    excluded: number;
    items: Array<{ voucherId: string; status: string; excludedAt: Date | null }>;
  },
>(coverage: C, issues: Map<string, ActivityIssueView>) {
  const items = coverage.items.map((item) => ({
    ...item,
    activityIssue: item.excludedAt ? null : (issues.get(item.voucherId) ?? null),
  }));
  const activityPending = items.filter(
    (item) => item.activityIssue !== null && item.status === "CLASSIFIED",
  ).length;
  return { ...coverage, items, activityPending, classified: coverage.classified - activityPending };
}
