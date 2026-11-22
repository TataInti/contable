// Criterio único de actividades por venta (brief 4J, vigencia por cambio: brief 4L). El cálculo
// (settlement-service), la clasificación del expediente (workpaper-activity) y la clasificación de
// comprobantes (workpaper-classification) usan estas funciones: la web solo muestra el resultado
// que devuelve la API. Módulo puro: sin acceso a la base (solo tipos de Prisma).
import type { Prisma } from "@prisma/client";

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
  /** true: cambio de actividad registrado (rige desde validFrom). false o ausente: vale desde siempre. */
  isChange?: boolean;
};

/**
 * Vigencia de un vínculo en un rango de fechas (brief 4L). Sin cambio registrado, la actividad no tiene
 * límite inferior: el período lo define el expediente, no la fecha del alta. Un cambio de actividad rige
 * desde el mes en que se registra. En ambos casos `validTo` corta por arriba (la anterior queda hasta
 * el mes previo al cambio).
 */
export function vigenteEnRango(
  link: Pick<ActivityLevelLink, "validFrom" | "validTo" | "isChange">,
  desde: Date,
  hasta: Date,
): boolean {
  const iniciaAntesDelFin = !link.isChange || link.validFrom <= hasta;
  const noTerminaAntesDelInicio = !link.validTo || link.validTo >= desde;
  return iniciaAntesDelFin && noTerminaAntesDelInicio;
}

export function vigenteEnFecha(
  link: Pick<ActivityLevelLink, "validFrom" | "validTo" | "isChange">,
  fecha: Date,
): boolean {
  return vigenteEnRango(link, fecha, fecha);
}

/** Mismo criterio de `vigenteEnRango` como filtro de Prisma para `clientActivity` (sin fila sin límite inferior). */
export function filtroVigenciaRango(desde: Date, hasta: Date): Prisma.ClientActivityWhereInput {
  return {
    AND: [
      { OR: [{ isChange: false }, { validFrom: { lte: hasta } }] },
      { OR: [{ validTo: null }, { validTo: { gte: desde } }] },
    ],
  };
}

export type LevelActivityContext = {
  periodStart: Date;
  periodEnd: Date;
  /** Vínculos del cliente en el nivel del impuesto, sin filtro de fecha, por fecha de vínculo ascendente. */
  levelLinks: ActivityLevelLink[];
  /** Vínculos vigentes en el período. */
  inForce: ActivityLevelLink[];
  /** Código de la única actividad vigente en el nivel, si hay exactamente una. */
  singleLocalCode: string | null;
  /** true: actividad del nivel; false: de otro nivel; \"UNKNOWN\": fuera del catálogo o ambigua. */
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
  const inForce = input.levelLinks.filter((link) => vigenteEnRango(link, input.periodStart, input.periodEnd));
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
  | { kind: "NOT_IN_FORCE"; code: string; name: string; successor: ActivityLevelLink | null }
  | { kind: "NONE" }
  | { kind: "UNRESOLVED"; code: string };

const normalizeCode = (code: string) => code.trim().toUpperCase();

/** La actividad que rige en el período, si hay exactamente una: es la salida que se ofrece al reclasificar. */
function successorOf(ctx: LevelActivityContext): ActivityLevelLink | null {
  return ctx.inForce.length === 1 ? ctx.inForce[0]! : null;
}

function notInForceOf(ctx: LevelActivityContext, code: string): LevelActivityResolution | null {
  const links = ctx.levelLinks.filter((link) => link.code === code);
  if (links.length === 0 || ctx.inForce.some((link) => link.code === code)) return null;
  return { kind: "NOT_IN_FORCE", code, name: links[0]!.name, successor: successorOf(ctx) };
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
    return { kind: "NOT_IN_FORCE", code: first.code, name: first.name, successor: null };
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
      kind: "NOT_IN_FORCE";
      activityCode: string;
      activityName: string;
      /** Actividad que rige en el período y a la que se reclasifica la venta; null si no hay una sola. */
      successor: ActivityLevelLink | null;
    }
  | { voucherId: string; kind: "UNCLASSIFIED"; multipleInForce: boolean };

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
      kind: "NOT_IN_FORCE",
      activityCode: r.code,
      activityName: r.name,
      successor: r.successor,
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
      issues.push({ voucherId: fact.voucherId, kind: "UNCLASSIFIED", multipleInForce });
    }
  }
  return issues;
}

/**
 * Texto de ACTIVITY_NOT_IN_FORCE (brief 4L): dice qué actividad no rige ese mes y, si hay una sola
 * que rige, a cuál reclasificar. Afirmativo y con salida, sin pedir cambiar fechas.
 */
export function mensajeActividadNoVigente(
  issue: { activityName: string; successor: { name: string; validFrom: Date; isChange?: boolean } | null },
  period: { startDate: Date },
): string {
  const mes = MESES_ES[period.startDate.getUTCMonth()];
  const anio = period.startDate.getUTCFullYear();
  const base = `La actividad ${issue.activityName} no rige en ${mes} ${anio}.`;
  const sucesora = issue.successor;
  if (!sucesora) {
    return `${base} Vinculá la actividad que rige ese mes en Configuración fiscal → Actividades.`;
  }
  const desde = sucesora.isChange
    ? `, vigente desde ${MESES_ES[sucesora.validFrom.getUTCMonth()]} ${sucesora.validFrom.getUTCFullYear()}`
    : "";
  return `${base} Reclasificá con ${sucesora.name}${desde}.`;
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
