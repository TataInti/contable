import { calculateIIbbTuc, calculateTemSmt, dec, type TaxEngineResult } from "@contable/tax-engine";
import type { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { buildEngineRules, EngineRulesError, type StoredRateRule } from "./engine-rules.js";
import { RULES_HASH_SCHEMA_VERSION_V3 } from "./rules-hash.js";
import { resolveTaxEngineForVersion } from "./settlement-service.js";

/**
 * Simulador de liquidación para quien administra las reglas.
 *
 * Corre el motor real con las reglas de una versión (borrador o activa) sobre
 * un caso cargado a mano. No lee comprobantes, no escribe nada y no afecta a
 * ningún cliente: sirve para entender y validar el cálculo antes de activarlo.
 */

export type RuleSimulationErrorCode =
  | "RULE_VERSION_NOT_FOUND"
  | "SIMULATION_NOT_SUPPORTED"
  | "SIMULATION_RULES_INVALID"
  | "SIMULATION_INPUT_INVALID";

export class RuleSimulationError extends Error {
  constructor(
    public readonly code: RuleSimulationErrorCode,
    message: string,
    /** Estado HTTP con el que responde la ruta. */
    public readonly httpStatus: 404 | 422 = 422,
  ) {
    super(message);
    this.name = "RuleSimulationError";
  }
}

export interface RuleSimulationInput {
  /** Ingresos del caso, por regla de alícuota de la versión simulada. */
  incomes: ReadonlyArray<{ ruleId: string; amount: string }>;
  withholding?: string;
  perception?: string;
  /** Recaudaciones bancarias (sólo Ingresos Brutos). */
  collected?: string;
  previousCredit?: string;
}

export interface RuleSimulationRun {
  versionId: string;
  version: number;
  status: string;
  engineVersion: string;
  lines: TaxEngineResult["lines"];
  subtotals: TaxEngineResult["subtotals"];
  totalDue: string;
  warnings: string[];
  blocks: string[];
}

export interface RuleSimulationResult {
  engine: { key: string; label: string };
  period: { startDate: string; endDate: string };
  /** Resultado con la versión pedida. */
  result: RuleSimulationRun;
  /** Mismo caso con la versión activa del paquete, si es otra. */
  comparison: RuleSimulationRun | null;
  /** Ingresos que no tienen una regla equivalente en la versión activa. */
  unmatchedInComparison: string[];
}

const ACTIVITY_ENGINES = new Set(["tem-smt", "tem-smt-legacy", "iibb-local-tuc", "iibb-local-tuc-legacy"]);

const versionInclude = {
  pack: { include: { regime: { select: { jurisdictionId: true, calcFamilyId: true } } } },
  rateRules: { include: { kind: true }, orderBy: [{ concept: "asc" }, { id: "asc" }] },
  minimumRules: true,
  engine: true,
} satisfies Prisma.TaxRuleVersionInclude;

type SimulatedVersion = Prisma.TaxRuleVersionGetPayload<{ include: typeof versionInclude }>;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Mes calendario en el que empieza a regir la versión: el período del caso. */
function simulationPeriod(validFrom: Date) {
  const start = new Date(Date.UTC(validFrom.getUTCFullYear(), validFrom.getUTCMonth(), 1));
  const end = new Date(Date.UTC(validFrom.getUTCFullYear(), validFrom.getUTCMonth() + 1, 0));
  const startDate = isoDate(validFrom > start ? validFrom : start);
  return { startDate, endDate: isoDate(end) };
}

/**
 * Clave con la que el motor busca la alícuota de un ingreso: la actividad en
 * las versiones tipadas, el concepto efectivo en las anteriores.
 */
function subjectKey(rule: StoredRateRule, isTyped: boolean): string | null {
  if (isTyped) {
    if (rule.kind?.key !== "RATE") return null;
    if (rule.isDefault) return "";
    return rule.activityId ?? null;
  }
  if (rule.rate === null) return null;
  return rule.activityCode ?? rule.concept;
}

export class RuleSimulationService {
  async simulate(
    ctx: TenantContext,
    ruleVersionId: string,
    input: RuleSimulationInput,
  ): Promise<RuleSimulationResult> {
    return withTenantContext(ctx, async (tx) => {
      const version = await tx.taxRuleVersion.findUnique({
        where: { id: ruleVersionId },
        include: versionInclude,
      });
      if (!version) {
        throw new RuleSimulationError("RULE_VERSION_NOT_FOUND", "La versión de reglas no existe", 404);
      }
      const engine = await resolveTaxEngineForVersion(tx, version);
      if (!engine || !ACTIVITY_ENGINES.has(engine.engineKey)) {
        throw new RuleSimulationError(
          "SIMULATION_NOT_SUPPORTED",
          "Todavía no se puede probar este impuesto. Por ahora el simulador cubre Ingresos Brutos local y TEM.",
        );
      }
      const isTyped = version.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V3;
      const rulesById = new Map(version.rateRules.map((rule) => [rule.id, rule]));

      // Ingresos del caso, traducidos a la clave que usa el motor.
      const incomeBySubject = new Map<string, Prisma.Decimal>();
      for (const income of input.incomes) {
        const rule = rulesById.get(income.ruleId);
        const key = rule ? subjectKey(rule, isTyped) : null;
        if (!rule || key === null) {
          throw new RuleSimulationError(
            "SIMULATION_INPUT_INVALID",
            "Uno de los ingresos apunta a una regla que no es una alícuota de esta versión",
          );
        }
        incomeBySubject.set(key, (incomeBySubject.get(key) ?? dec(0)).plus(dec(income.amount)));
      }

      const period = simulationPeriod(version.validFrom);
      const result = await this.run(tx, version, engine.engineKey, incomeBySubject, input, period);

      // Mismo caso con la versión activa, para ver qué cambia.
      let comparison: RuleSimulationRun | null = null;
      const unmatchedInComparison: string[] = [];
      if (version.status !== "ACTIVE") {
        const active = await tx.taxRuleVersion.findFirst({
          where: { packId: version.packId, status: "ACTIVE" },
          include: versionInclude,
        });
        const activeEngine = active ? await resolveTaxEngineForVersion(tx, active) : null;
        if (active && activeEngine && ACTIVITY_ENGINES.has(activeEngine.engineKey)) {
          const activeIsTyped = active.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V3;
          const activeKeys = new Set(
            active.rateRules.map((rule) => subjectKey(rule, activeIsTyped)).filter((key) => key !== null),
          );
          const comparable = new Map<string, Prisma.Decimal>();
          for (const income of input.incomes) {
            const rule = rulesById.get(income.ruleId)!;
            // La actividad identifica al sujeto en ambos modelos de reglas.
            const key = activeIsTyped ? subjectKey(rule, true) : (rule.activityCode ?? rule.concept);
            if (key === null || (!activeKeys.has(key) && !activeKeys.has("") && !activeKeys.has("DEFAULT"))) {
              unmatchedInComparison.push(rule.concept);
              continue;
            }
            comparable.set(key, (comparable.get(key) ?? dec(0)).plus(dec(income.amount)));
          }
          comparison = await this.run(tx, active, activeEngine.engineKey, comparable, input, period);
        }
      }

      return {
        engine: { key: engine.engineKey, label: version.engine?.label ?? engine.engineVersion },
        period,
        result,
        comparison,
        unmatchedInComparison,
      };
    });
  }

  private async run(
    tx: Prisma.TransactionClient,
    version: SimulatedVersion,
    engineKey: string,
    incomeBySubject: ReadonlyMap<string, Prisma.Decimal>,
    input: RuleSimulationInput,
    period: { startDate: string; endDate: string },
  ): Promise<RuleSimulationRun> {
    const isTyped = version.rulesHashSchemaVersion === RULES_HASH_SCHEMA_VERSION_V3;
    const jurisdictionIds = [
      ...new Set(version.rateRules.map((rule) => rule.jurisdictionId).filter(Boolean) as string[]),
    ];
    const jurisdictions = jurisdictionIds.length
      ? await tx.jurisdiction.findMany({ where: { id: { in: jurisdictionIds } } })
      : [];
    let rules;
    try {
      rules = buildEngineRules(version.rateRules, {
        isTyped,
        engineKey,
        jurisdictionCodeById: new Map(jurisdictions.map((jurisdiction) => [jurisdiction.id, jurisdiction.code])),
      });
    } catch (err) {
      if (err instanceof EngineRulesError) {
        throw new RuleSimulationError("SIMULATION_RULES_INVALID", err.message);
      }
      throw err;
    }

    // Mínimo global: el de la jurisdicción del régimen o, si no hay, el general.
    const regimeJurisdictionId = version.pack.regime.jurisdictionId;
    const scoped = version.minimumRules.filter((rule) => rule.jurisdictionId === regimeJurisdictionId);
    const applicable = scoped.length > 0
      ? scoped
      : version.minimumRules.filter((rule) => rule.jurisdictionId === null);
    if (applicable.length > 1) {
      throw new RuleSimulationError(
        "SIMULATION_RULES_INVALID",
        "La versión tiene más de un mínimo global aplicable",
      );
    }
    const minimum = applicable[0]?.amount ? dec(applicable[0].amount.toString()) : undefined;

    const common = {
      engineVersion: version.engineVersion,
      period: { ...period, cutoff: period.endDate },
      facts: [],
      rules,
      ...(isTyped ? { ruleMode: "TYPED" as const } : {}),
      incomeByActivity: Object.fromEntries(
        [...incomeBySubject].map(([key, amount]) => [key, amount.toString()]),
      ),
      ...(minimum !== undefined ? { minimum } : {}),
      balances: { previousCredit: input.previousCredit ?? "0" },
      declaredParameters: [],
    };
    const withholding = dec(input.withholding ?? "0");
    const perception = dec(input.perception ?? "0");
    const output = engineKey.startsWith("tem-smt")
      ? calculateTemSmt({ ...common, credits: { withholding, perception } })
      : calculateIIbbTuc({
          ...common,
          credits: { withholding, perception, collected: dec(input.collected ?? "0") },
        });

    return {
      versionId: version.id,
      version: version.version,
      status: version.status,
      engineVersion: output.engineVersion,
      lines: output.lines,
      subtotals: output.subtotals,
      totalDue: output.totalDue,
      warnings: output.warnings,
      blocks: output.blocks,
    };
  }
}
