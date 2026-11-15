import { describe, expect, expectTypeOf, it } from "vitest";
import { DUE_DATE_FREQUENCIES, type DueDateFrequency } from "@contable/contracts";
import {
  periodsForRange,
  type DueDateFrequency as DueDateFrequencyMotor,
} from "@contable/tax-engine";

// La lista cerrada de la API (contracts) y la unión del motor (calendar.ts) deben ser el mismo conjunto (D-R3-A).
describe("frecuencias de vencimiento: contratos y motor", () => {
  it("la lista de contratos es exactamente la unión de calendar.ts", () => {
    expectTypeOf<DueDateFrequency>().toEqualTypeOf<DueDateFrequencyMotor>();
    expect(DUE_DATE_FREQUENCIES).toEqual(["MONTHLY", "QUARTERLY", "ANNUAL", "ONCE"]);
  });

  it("el motor acepta cada valor de la lista", () => {
    for (const frequency of DUE_DATE_FREQUENCIES) {
      expect(() => periodsForRange(frequency, "2026-01", "2026-03")).not.toThrow();
    }
  });

  it("el motor rechaza un valor fuera de la lista en vez de contar 12 meses", () => {
    expect(() => periodsForRange("MENSUAL" as DueDateFrequencyMotor, "2026-01", "2026-03")).toThrow(
      /no válida/,
    );
  });
});
