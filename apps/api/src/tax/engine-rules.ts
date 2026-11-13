import { dec } from "@contable/tax-engine";
import type { Prisma } from "@prisma/client";

/**
 * Traducción de las reglas guardadas a las reglas que consume un motor.
 *
 * Es la única fuente de esa traducción: la usa la liquidación real y la usa el
 * simulador, para que lo que se prueba sea exactamente lo que se liquida.
 */

export type EngineRulesErrorCode = "RULE_VERSION_NOT_FOUND" | "RULE_SUBJECT_UNRESOLVED";

export class EngineRulesError extends Error {
  constructor(
    public readonly code: EngineRulesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineRulesError";
  }
}

export type StoredRateRule = Prisma.TaxRateRuleGetPayload<{ include: { kind: true } }>;

export interface BuildEngineRulesOptions {
  /** Versión con reglas tipadas (hash v3). */
  isTyped: boolean;
  /** Clave del motor que va a consumir las reglas. */
  engineKey: string;
  /** Código de jurisdicción por id, para las reglas legacy por jurisdicción. */
  jurisdictionCodeById: ReadonlyMap<string, string>;
}

export function buildEngineRules(
  rateRules: readonly StoredRateRule[],
  options: BuildEngineRulesOptions,
) {
  const effectiveRuleConcept = (rule: StoredRateRule) => {
    if (rule.activityCode) return rule.activityCode;
    if (
      rule.jurisdictionId &&
      ["ALICUOTA", "RATE", "JURISDICCION"].includes(rule.concept)
    ) {
      return options.jurisdictionCodeById.get(rule.jurisdictionId) ?? rule.concept;
    }
    return rule.concept;
  };
  if (!options.isTyped) {
    const duplicateRuleConcepts = rateRules
      .map(effectiveRuleConcept)
      .filter((concept, index, concepts) => concepts.indexOf(concept) !== index);
    if (duplicateRuleConcepts.length > 0) {
      throw new EngineRulesError(
        "RULE_VERSION_NOT_FOUND",
        `La versión normativa tiene reglas efectivas duplicadas para ${[
          ...new Set(duplicateRuleConcepts),
        ].join(", ")}`,
      );
    }
  }
  const typedRuleSubjects = new Set<string>();
  const activitySubjectEngine =
    options.engineKey === "iibb-local-tuc" || options.engineKey === "tem-smt" || options.engineKey === "tem-smt-legacy";
  const vatSubjectEngine = options.engineKey === "vat-ri";
  const rules = rateRules.map((r) => {
    if (options.isTyped) {
      const kind = r.kind!.key;
      const subject = r.isDefault
        ? null
        : kind === "RATE" && activitySubjectEngine
          ? r.activityId ?? null
          : vatSubjectEngine && (kind === "RATE" || kind === "SPECIAL_CREDIT")
            ? r.rate?.toString() ?? null
            : kind === "RATE" || kind === "COEFFICIENT"
              ? r.jurisdictionId ?? null
              : kind === "FEE"
                ? r.categoryCode ?? null
                : null;
      const hasSubject =
        kind === "RATE" ||
        kind === "COEFFICIENT" ||
        kind === "FEE" ||
        (vatSubjectEngine && kind === "SPECIAL_CREDIT");
      if (hasSubject) {
        const subjectKey = JSON.stringify([kind, subject, r.isDefault]);
        if (typedRuleSubjects.has(subjectKey)) {
          throw new EngineRulesError(
            "RULE_SUBJECT_UNRESOLVED",
            `La versión normativa repite el sujeto de la regla ${r.id}`,
          );
        }
        typedRuleSubjects.add(subjectKey);
      }
      const storedRate = r.rate !== null ? dec(r.rate.toString()) : undefined;
      const normalized = storedRate === undefined
        ? undefined
        : kind === "RATE" || kind === "SPECIAL_CREDIT"
          ? storedRate.div(100)
          : storedRate;
      return {
        id: r.id,
        concept: r.concept,
        code: r.concept,
        kind,
        activityId: r.activityId,
        jurisdictionId: r.jurisdictionId,
        categoryCode: r.categoryCode,
        isDefault: r.isDefault,
        ...(normalized !== undefined ? { rate: normalized } : {}),
        ...(r.minAmount !== null ? { minimum: dec(r.minAmount.toString()) } : {}),
        validFrom: r.validFrom.toISOString().slice(0, 10),
        ...(r.validTo ? { validTo: r.validTo.toISOString().slice(0, 10) } : {}),
      };
    }
    const concept = effectiveRuleConcept(r);
    const rate = r.rate !== null ? dec(r.rate.toString()) : undefined;
    // Compatibilidad v1/v2: sólo los coeficientes CM se guardan como razón 0..1.
    const normalized =
      rate !== undefined
        ? concept.startsWith("COEF_")
          ? rate
          : rate.div(100)
        : undefined;
    const min = r.minAmount !== null ? dec(r.minAmount.toString()) : undefined;
    return {
      id: r.id,
      concept,
      code: r.concept,
      ...(normalized !== undefined ? { rate: normalized } : {}),
      ...(min !== undefined ? { minimum: min } : {}),
      validFrom: r.validFrom.toISOString().slice(0, 10),
      ...(r.validTo ? { validTo: r.validTo.toISOString().slice(0, 10) } : {}),
    };
  });
  return rules;
}
