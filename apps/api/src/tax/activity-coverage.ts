// Criterio único de actividades por venta (brief 4J). El cálculo (settlement-service) y la
// clasificación del expediente (workpaper-activity) usan estas funciones: la web solo muestra
// el resultado que devuelve la API. Módulo puro: sin acceso a la base.

export const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export type ActivityLevelLink = {
  code: string;
  name: string;
  validFrom: Date;
  validTo: Date | null;
};

export type LevelActivityContext = {
  periodStart: Date;
  periodEnd: Date;
  /** Vínculos del cliente en el nivel del impuesto, sin filtro de fecha, por «Desde» ascendente. */
  levelLinks: ActivityLevelLink[];
  /** Vínculos vigentes en el período. */
  inForce: ActivityLevelLink[];
  /** Código de la única actividad vigente en el nivel, si hay exactamente una. */
  singleLocalCode: string | null;
  /** true: actividad del nivel; false: de otro nivel; "UNKNOWN": fuera del catálogo o ambigua. */
  isOwnCode: (code: string) => boolean | "UNKNOWN";
};

export function buildLevelActivityContext(input: {
  periodStart: Date;
  periodEnd: Date;
  jurisdictionId: string;
  levelLinks: ActivityLevelLink[];
  catalog: Array<{ code: string; jurisdictionId: string }>;
  /** El cálculo sin fuentes no asigna la única actividad del nivel a las ventas sin código. */
  withSingleLocal: boolean;
}): LevelActivityContext {
  const inForce = input.levelLinks.filter(
    (link) =>
      link.validFrom <= input.periodEnd && (!link.validTo || link.validTo >= input.periodStart),
  );
  const codesInForce = [...new Set(inForce.map((link) => link.code))];
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    levelLinks: input.levelLinks,
    inForce,
    singleLocalCode: input.withSingleLocal && codesInForce.length === 1 ? codesInForce[0]! : null,
    isOwnCode: (code) => {
      const all = input.catalog.filter((item) => item.code === code);
      const own = all.filter((item) => item.jurisdictionId === input.jurisdictionId);
      if (own.length === 0 && all.length > 0) return false;
      if (own.length === 1) return true;
      return "UNKNOWN";
    },
  };
}

export type LevelActivityResolution =
  | { kind: "OWN"; code: string }
  | { kind: "NOT_IN_FORCE"; code: string; name: string; validFrom: Date }
  | { kind: "NONE" }
  | { kind: "UNRESOLVED"; code: string };

const normalizeCode = (code: string) => code.trim().toUpperCase();

function notInForceOf(
  ctx: LevelActivityContext,
  code: string,
): LevelActivityResolution | null {
  const links = ctx.levelLinks.filter((link) => link.code === code);
  if (links.length === 0 || ctx.inForce.some((link) => link.code === code)) return null;
  return { kind: "NOT_IN_FORCE", code, name: links[0]!.name, validFrom: links[0]!.validFrom };
}

/**
 * Actividad que toma un hecho en este nivel. Una actividad propia se usa si está vigente;
 * si es de otro nivel o no trae código, la única vigente del nivel; sin ninguna vigente, se
 * informa la primera vinculada fuera de vigencia.
 */
export function resolveLevelActivity(
  ctx: LevelActivityContext,
  activityCode: string | null | undefined,
): LevelActivityResolution {
  const code = activityCode && activityCode.trim().length > 0 ? normalizeCode(activityCode) : null;
  if (code) {
    const own = ctx.isOwnCode(code);
    if (own === "UNKNOWN") return { kind: "UNRESOLVED", code };
    if (own) return notInForceOf(ctx, code) ?? { kind: "OWN", code };
  }
  if (ctx.singleLocalCode) return { kind: "OWN", code: ctx.singleLocalCode };
  if (ctx.inForce.length === 0 && ctx.levelLinks.length > 0) {
    const first = ctx.levelLinks[0]!;
    return { kind: "NOT_IN_FORCE", code: first.code, name: first.name, validFrom: first.validFrom };
  }
  return { kind: "NONE" };
}

/** Hecho de venta para la validación de actividades (solo comprobantes de venta). */
export type SaleActivityFact = {
  voucherId: string;
  issuedOn: Date;
  lines: Array<{ activityCode: string | null; hasNetAmount: boolean }>;
  classification: { activityCode: string | null } | null;
};

export type ActivityIssue =
  | {
      voucherId: string;
      code: "ACTIVITY_NOT_IN_FORCE";
      activityCode: string;
      activityName: string;
      validFrom: Date;
    }
  | { voucherId: string; code: "ACTIVITY_UNCLASSIFIED"; multipleInForce: boolean };

/**
 * Qué ventas el cálculo no puede asignar a una actividad del nivel. Las reglas son las del
 * cálculo; el cálculo y la clasificación del expediente llaman a esta misma función.
 * Solo aplica a motores con actividad tipada. `cutoffDate` es `YYYY-MM-DDT23:59:59.999Z`.
 */
export function evaluateSaleActivities(
  ctx: LevelActivityContext,
  facts: SaleActivityFact[],
  cutoffDate: string,
): ActivityIssue[] {
  const hasExplicitActivityLines = facts.some((fact) =>
    fact.lines.some((line) => Boolean(line.activityCode) && line.hasNetAmount),
  );
  const multipleInForce = ctx.inForce.length > 1;
  const issues: ActivityIssue[] = [];
  const noVigente = (voucherId: string, r: LevelActivityResolution) => {
    if (r.kind !== "NOT_IN_FORCE") return;
    issues.push({
      voucherId,
      code: "ACTIVITY_NOT_IN_FORCE",
      activityCode: r.code,
      activityName: r.name,
      validFrom: r.validFrom,
    });
  };
  for (const fact of facts) {
    if (fact.issuedOn.toISOString() > cutoffDate) continue;
    let unclassified = false;
    for (const line of fact.lines) {
      if (!line.activityCode || line.activityCode.trim().length === 0) continue;
      const r = resolveLevelActivity(ctx, line.activityCode);
      if (r.kind === "UNRESOLVED") continue;
      if (r.kind !== "OWN") {
        noVigente(fact.voucherId, r);
        unclassified = true;
      }
    }
    if (fact.classification) {
      const bookCode = fact.classification.activityCode ?? ctx.singleLocalCode;
      if (bookCode) {
        const r = resolveLevelActivity(ctx, fact.classification.activityCode);
        if (r.kind !== "UNRESOLVED" && r.kind !== "OWN") {
          noVigente(fact.voucherId, r);
          if (fact.lines.length === 0 && !hasExplicitActivityLines) unclassified = true;
        }
      }
    }
    if (unclassified) {
      issues.push({ voucherId: fact.voucherId, code: "ACTIVITY_UNCLASSIFIED", multipleInForce });
    }
  }
  return issues;
}

/** Texto de ACTIVITY_NOT_IN_FORCE: una actividad (la primera por «Desde»). */
export function mensajeActividadNoVigente(
  issue: { activityName: string; validFrom: Date },
  period: { startDate: Date },
): string {
  const mes = MESES_ES[period.startDate.getUTCMonth()];
  const desde = issue.validFrom.toISOString().slice(0, 10).split("-").reverse().join("/");
  return `La actividad ${issue.activityName} no está vigente en ${mes} ${period.startDate.getUTCFullYear()} para este cliente (vigente desde ${desde}). Corregí la fecha «Desde» en Configuración fiscal → Actividades.`;
}

/** Texto de ACTIVITY_UNCLASSIFIED para una cantidad de ventas. */
export function mensajeActividadSinClasificar(count: number, multipleInForce: boolean): string {
  const frase = count === 1 ? "1 venta tiene" : `${count} ventas tienen`;
  return multipleInForce
    ? `${frase} una actividad de otro nivel y el cliente tiene más de una actividad vigente en este impuesto. Asigná la actividad de cada venta en su clasificación y volvé a calcular.`
    : `${frase} una actividad que el cliente no tiene vinculada en este impuesto. Vinculala en Configuración fiscal → Actividades y volvé a calcular.`;
}

/** Motor cuyas ventas se validan contra las actividades del nivel (cálculo tipado). */
export function esMotorConActividadTipada(isTypedRuleVersion: boolean, engineKey: string): boolean {
  return isTypedRuleVersion && (engineKey === "iibb-local-tuc" || engineKey === "tem-smt");
}
