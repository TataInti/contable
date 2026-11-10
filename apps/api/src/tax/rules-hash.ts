import { createHash } from "node:crypto";

export const RULES_HASH_SCHEMA_VERSION_V1 = 1;
export const RULES_HASH_SCHEMA_VERSION_V2 = 2;

type DecimalValue = { toString(): string } | string | null | undefined;
type DateValue = Date | string | null | undefined;

type RateRuleForHash = {
  concept: string;
  activityCode?: string | null;
  jurisdictionId?: string | null;
  rate?: DecimalValue;
  minAmount?: DecimalValue;
  validFrom?: DateValue;
  validTo?: DateValue;
};

type MinimumRuleForHash = {
  concept: string;
  jurisdictionId?: string | null;
  amount: DecimalValue;
  isConditional?: boolean;
  validFrom?: DateValue;
  validTo?: DateValue;
};

type BracketRuleForHash = {
  concept: string;
  fromAmount: DecimalValue;
  toAmount?: DecimalValue;
  rate: DecimalValue;
  fixedAmount?: DecimalValue;
  validFrom?: DateValue;
  validTo?: DateValue;
};

type DueDateRuleForHash = {
  jurisdictionId: string;
  frequency: string;
  dueDay: number;
  monthOffset?: number;
  cuitEnding?: string | null;
  validFrom?: DateValue;
  validTo?: DateValue;
};

type RoundingRuleForHash = {
  concept: string;
  precision: number;
  mode: string;
};

export type RulePackForHash = {
  engineVersion: string;
  rateRules?: RateRuleForHash[];
  minimumRules?: MinimumRuleForHash[];
  bracketRules?: BracketRuleForHash[];
  dueDateRules?: DueDateRuleForHash[];
  roundingRules?: RoundingRuleForHash[];
};

export type CanonicalRulePackPayloadV2 = {
  rulesHashSchemaVersion: typeof RULES_HASH_SCHEMA_VERSION_V2;
  engineVersion: string;
  rates: Array<{
    concept: string;
    activityCode: string | null;
    jurisdictionId: string | null;
    rate: string | null;
    minAmount: string | null;
    validFrom: string | null;
    validTo: string | null;
  }>;
  minimums: Array<{
    concept: string;
    jurisdictionId: string | null;
    amount: string | null;
    isConditional: boolean;
    validFrom: string | null;
    validTo: string | null;
  }>;
  brackets: Array<{
    concept: string;
    fromAmount: string | null;
    toAmount: string | null;
    rate: string | null;
    fixedAmount: string | null;
    validFrom: string | null;
    validTo: string | null;
  }>;
  dueDates: Array<{
    jurisdictionId: string;
    frequency: string;
    dueDay: number;
    monthOffset: number | null;
    cuitEnding: string | null;
    validFrom: string | null;
    validTo: string | null;
  }>;
  roundings: Array<{
    concept: string;
    precision: number;
    mode: string;
  }>;
};

function decimalString(value: DecimalValue): string | null {
  if (value == null) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.toString());
  if (!match) throw new TypeError("El valor decimal de una regla no tiene formato canónico");

  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent)) throw new TypeError("El exponente decimal excede el rango canónico");

  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const whole = decimalPosition <= 0
    ? "0"
    : decimalPosition >= digits.length
      ? `${digits}${"0".repeat(decimalPosition - digits.length)}`
      : digits.slice(0, decimalPosition);
  const fractional = decimalPosition <= 0
    ? `${"0".repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? ""
      : digits.slice(decimalPosition);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fractional.replace(/0+$/, "");
  const isZero = /^0+$/.test(normalizedWhole) && normalizedFraction.length === 0;
  return `${isZero ? "" : sign}${normalizedWhole}${normalizedFraction ? `.${normalizedFraction}` : ""}`;
}

function dateString(value: DateValue): string | null {
  if (value == null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function sortCanonicalRows<T>(rows: T[]): T[] {
  return rows.sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Serialización canónica v2 de los campos fiscales que intervienen en las reglas.
 * Los arrays se ordenan por su contenido, los decimales son strings y los nulls
 * y las vigencias quedan explícitos para evitar hashes dependientes del orden de
 * inserción o de la representación de los objetos ORM.
 */
export function canonicalRulePackPayload(
  version: RulePackForHash,
  hashSchemaVersion: typeof RULES_HASH_SCHEMA_VERSION_V2 = RULES_HASH_SCHEMA_VERSION_V2,
): CanonicalRulePackPayloadV2 {
  return {
    rulesHashSchemaVersion: hashSchemaVersion,
    engineVersion: version.engineVersion,
    rates: sortCanonicalRows(
      (version.rateRules ?? []).map((rule) => ({
        concept: rule.concept,
        activityCode: rule.activityCode ?? null,
        jurisdictionId: rule.jurisdictionId ?? null,
        rate: decimalString(rule.rate),
        minAmount: decimalString(rule.minAmount),
        validFrom: dateString(rule.validFrom),
        validTo: dateString(rule.validTo),
      })),
    ),
    minimums: sortCanonicalRows(
      (version.minimumRules ?? []).map((rule) => ({
        concept: rule.concept,
        jurisdictionId: rule.jurisdictionId ?? null,
        amount: decimalString(rule.amount),
        isConditional: rule.isConditional ?? false,
        validFrom: dateString(rule.validFrom),
        validTo: dateString(rule.validTo),
      })),
    ),
    brackets: sortCanonicalRows(
      (version.bracketRules ?? []).map((rule) => ({
        concept: rule.concept,
        fromAmount: decimalString(rule.fromAmount),
        toAmount: decimalString(rule.toAmount),
        rate: decimalString(rule.rate),
        fixedAmount: decimalString(rule.fixedAmount),
        validFrom: dateString(rule.validFrom),
        validTo: dateString(rule.validTo),
      })),
    ),
    dueDates: sortCanonicalRows(
      (version.dueDateRules ?? []).map((rule) => ({
        jurisdictionId: rule.jurisdictionId,
        frequency: rule.frequency,
        dueDay: rule.dueDay,
        monthOffset: rule.monthOffset ?? null,
        cuitEnding: rule.cuitEnding ?? null,
        validFrom: dateString(rule.validFrom),
        validTo: dateString(rule.validTo),
      })),
    ),
    roundings: sortCanonicalRows(
      (version.roundingRules ?? []).map((rule) => ({
        concept: rule.concept,
        precision: rule.precision,
        mode: rule.mode,
      })),
    ),
  };
}

export function hashCanonicalRulePackPayload(payload: CanonicalRulePackPayloadV2): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function computeRulesHashV2(version: RulePackForHash): string {
  return hashCanonicalRulePackPayload(canonicalRulePackPayload(version));
}

/** Reproduce exactamente el cálculo usado por RulePackValidator antes del esquema v2. */
export function computeLegacyRulesHashSchemaV1(version: {
  rateRules: {
    concept: string;
    activityCode: string | null;
    jurisdictionId: string | null;
    rate: DecimalValue;
    minAmount: DecimalValue;
  }[];
  minimumRules: {
    concept: string;
    jurisdictionId: string | null;
    amount: { toString(): string };
  }[];
  bracketRules: {
    concept: string;
    fromAmount: { toString(): string };
    toAmount: { toString(): string } | null;
    rate: { toString(): string };
    fixedAmount: { toString(): string } | null;
  }[];
  dueDateRules: {
    jurisdictionId: string;
    frequency: string;
    dueDay: number;
    cuitEnding: string | null;
  }[];
}): string {
  const legacyCanonical = JSON.stringify({
    rate: version.rateRules.map((rule) => [
      rule.concept,
      rule.activityCode,
      rule.jurisdictionId,
      rule.rate?.toString(),
      rule.minAmount?.toString(),
    ]),
    min: version.minimumRules.map((rule) => [
      rule.concept,
      rule.jurisdictionId,
      rule.amount.toString(),
    ]),
    bracket: version.bracketRules.map((rule) => [
      rule.concept,
      rule.fromAmount.toString(),
      rule.toAmount?.toString(),
      rule.rate.toString(),
      rule.fixedAmount?.toString(),
    ]),
    due: version.dueDateRules.map((rule) => [
      rule.jurisdictionId,
      rule.frequency,
      rule.dueDay,
      rule.cuitEnding,
    ]),
  });
  return createHash("sha256").update(legacyCanonical).digest("hex");
}
