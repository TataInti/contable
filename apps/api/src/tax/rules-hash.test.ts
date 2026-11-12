import { describe, expect, it } from "vitest";
import {
  canonicalRulePackPayload,
  computeRulesHashV2,
  hashCanonicalRulePackPayload,
  type RulePackForHash,
} from "./rules-hash.js";

const decimal = (value: string) => ({ toString: () => value });
const validFrom = new Date("2026-01-01T00:00:00.000Z");
const validTo = new Date("2026-12-31T00:00:00.000Z");

function versionWithoutBracketsOrRoundings(): RulePackForHash {
  return {
    engineVersion: "ar-tax-parametric-v1.0.0",
    rateRules: [
      {
        concept: "VENTAS",
        activityCode: "620100",
        jurisdictionId: "jurisdiction-1",
        rate: decimal("3.5"),
        minAmount: decimal("1000"),
        validFrom,
        validTo: null,
      },
    ],
    minimumRules: [
      {
        concept: "MINIMO_GENERAL",
        jurisdictionId: null,
        amount: decimal("250.00"),
        isConditional: true,
        validFrom,
        validTo,
      },
    ],
    bracketRules: [],
    dueDateRules: [
      {
        jurisdictionId: "jurisdiction-1",
        frequency: "MONTHLY",
        dueDay: 20,
        monthOffset: 1,
        cuitEnding: null,
        validFrom,
        validTo: null,
      },
    ],
    roundingRules: [],
  };
}

function bracket(concept: string, fromAmount: string, rate: string) {
  return {
    concept,
    fromAmount: decimal(fromAmount),
    toAmount: null,
    rate: decimal(rate),
    fixedAmount: decimal("0"),
    validFrom,
    validTo: null,
  };
}

describe("hash canónico de reglas v2", () => {
  it("dos consumidores del mismo payload obtienen el mismo SHA", () => {
    const version = versionWithoutBracketsOrRoundings();
    const payload = canonicalRulePackPayload(version);

    expect(hashCanonicalRulePackPayload(payload)).toBe(computeRulesHashV2(version));
    expect(
      computeRulesHashV2({
        ...version,
        rateRules: (version.rateRules ?? []).map((rule) => ({ ...rule, rate: decimal("3.500000") })),
      }),
    ).toBe(computeRulesHashV2(version));
  });

  it("recalcula el hash v2 existente sin cambios al agregar engineId", () => {
    const version = versionWithoutBracketsOrRoundings();
    const storedHash = computeRulesHashV2(version);
    const migratedVersion = {
      ...version,
      engineId: "e1000000-0000-4000-8000-000000000001",
      rulesHash: storedHash,
      rulesHashSchemaVersion: 2,
    };

    expect(computeRulesHashV2(migratedVersion)).toBe(migratedVersion.rulesHash);
  });

  it("agregar o quitar un tramo cambia el SHA", () => {
    const version = versionWithoutBracketsOrRoundings();
    const originalHash = computeRulesHashV2(version);
    const withBracket = { ...version, bracketRules: [bracket("ESCALA", "0", "2.5")] };

    expect(computeRulesHashV2(withBracket)).not.toBe(originalHash);
    expect(computeRulesHashV2({ ...withBracket, bracketRules: [] })).toBe(originalHash);
  });

  it("agregar o quitar un redondeo cambia el SHA", () => {
    const version = versionWithoutBracketsOrRoundings();
    const originalHash = computeRulesHashV2(version);
    const withRounding = {
      ...version,
      roundingRules: [{ concept: "VENTAS", precision: 2, mode: "HALF_UP" }],
    };

    expect(computeRulesHashV2(withRounding)).not.toBe(originalHash);
    expect(computeRulesHashV2({ ...withRounding, roundingRules: [] })).toBe(originalHash);
  });

  it("el orden de inserción de filas no cambia el SHA", () => {
    const first = versionWithoutBracketsOrRoundings();
    first.rateRules?.push({
      concept: "COMPRAS",
      activityCode: null,
      jurisdictionId: "jurisdiction-2",
      rate: decimal("1.25"),
      minAmount: null,
      validFrom,
      validTo,
    });
    first.minimumRules?.push({
      concept: "MINIMO_ACTIVIDAD",
      jurisdictionId: "jurisdiction-2",
      amount: decimal("500"),
      isConditional: false,
      validFrom,
      validTo: null,
    });
    first.bracketRules = [bracket("ESCALA", "100", "4"), bracket("ESCALA", "0", "2")];
    first.dueDateRules?.push({
      jurisdictionId: "jurisdiction-2",
      frequency: "ANNUAL",
      dueDay: 15,
      monthOffset: 0,
      cuitEnding: "5",
      validFrom,
      validTo,
    });
    first.roundingRules?.push({ concept: "COMPRAS", precision: 0, mode: "DOWN" });
    first.roundingRules?.push({ concept: "MINIMO_ACTIVIDAD", precision: 4, mode: "UP" });

    const reversed: RulePackForHash = {
      ...first,
      rateRules: [...(first.rateRules ?? [])].reverse(),
      minimumRules: [...(first.minimumRules ?? [])].reverse(),
      bracketRules: [...(first.bracketRules ?? [])].reverse(),
      dueDateRules: [...(first.dueDateRules ?? [])].reverse(),
      roundingRules: [...(first.roundingRules ?? [])].reverse(),
    };

    expect(computeRulesHashV2(reversed)).toBe(computeRulesHashV2(first));
  });

  it("mantiene el golden v2 para una versión sin tramos ni redondeos", () => {
    expect(computeRulesHashV2(versionWithoutBracketsOrRoundings())).toBe("a8793db606c14a7717d2413f630aa987720d4d32492e1be90d1a4399d5e3c024");
  });
});
