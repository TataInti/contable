import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { declarationWarnings } from "./filing-declaration-service.js";

/** Advertencias de la DJ sin base de datos: no bloquean y usan la tolerancia de 0,01 del importe presentado. */
const base = {
  totalAPagar: "1500.00",
  saldoFavorTecnico: "120.5000",
  saldoLibreDisponibilidad: "30.0000",
  amountFiled: new Prisma.Decimal("1500.00"),
  settlementTotals: { SALDO_TECNICO_AFTER: "120.5000", SALDO_LIBRE_AFTER: "30.0000" },
};

describe("declarationWarnings (corte 5a)", () => {
  it("no advierte cuando todo coincide", () => {
    expect(declarationWarnings(base)).toEqual([]);
  });

  it("tolera una diferencia de exactamente 0,01 en el total a pagar", () => {
    expect(declarationWarnings({ ...base, totalAPagar: "1500.01" })).toEqual([]);
    expect(declarationWarnings({ ...base, totalAPagar: "1499.99" })).toEqual([]);
  });

  it("advierte cuando el total a pagar difiere más de 0,01 del importe presentado", () => {
    const [aviso] = declarationWarnings({ ...base, totalAPagar: "1500.02" });
    expect(aviso).toMatchObject({
      code: "TOTAL_A_PAGAR_DISTINTO_DE_PRESENTADO",
      field: "totalAPagar",
    });
    expect(aviso?.message).toContain("1500.02");
  });

  it("advierte por cada saldo que difiere de la liquidación", () => {
    const avisos = declarationWarnings({
      ...base,
      saldoFavorTecnico: "100.0000",
      saldoLibreDisponibilidad: "45.0000",
    });
    expect(avisos.map((a) => a.code)).toEqual([
      "SALDO_TECNICO_DISTINTO_DE_LIQUIDACION",
      "SALDO_LIBRE_DISTINTO_DE_LIQUIDACION",
    ]);
  });

  it("no compara saldos cuando la liquidación no los informa", () => {
    const avisos = declarationWarnings({
      ...base,
      saldoFavorTecnico: "999.0000",
      saldoLibreDisponibilidad: "999.0000",
      settlementTotals: null,
    });
    expect(avisos).toEqual([]);
    expect(
      declarationWarnings({
        ...base,
        saldoFavorTecnico: "999.0000",
        settlementTotals: { TOTAL_A_INGRESAR: "1500" },
      }),
    ).toEqual([]);
  });
});
