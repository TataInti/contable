// Arrastre de saldos del Legajo (corte 3E): rango del mes anterior y frase de origen con datos «Demo».
import { describe, expect, it } from "vitest";
import { fraseDeArrastre, rangoMesAnterior, saldosDeMesesAnteriores } from "./saldosArrastre";
import { saldoDemo } from "./datosDemoLegajo";
import type { CreditLot } from "./tipos";

const deSeptiembre: CreditLot = {
  ...saldoDemo,
  period: {
    id: "period-sep",
    label: null,
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-09-30T00:00:00.000Z",
  },
  taxType: { id: "tax-type-a", code: "IIBB", name: "Ingresos Brutos" },
  origin: "MANUAL",
  verificationStatus: "PENDING_VERIFICATION",
  carryForward: true,
  available: "500.0000",
};

describe("rangoMesAnterior", () => {
  it("en enero, el mes anterior es diciembre del año previo", () => {
    expect(rangoMesAnterior("2026-01-01")).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" });
  });

  it("toma el mes del inicio aunque venga con hora (ISO del legajo)", () => {
    expect(rangoMesAnterior("2026-03-01T00:00:00.000Z")).toEqual({
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });
  });
});

describe("saldosDeMesesAnteriores", () => {
  it("toma solo los saldos con disponible de un período anterior al inicio del legajo", () => {
    const sinDisponible = { ...deSeptiembre, id: "lot-0", available: "0.0000" };
    const delMismoMes = {
      ...deSeptiembre,
      id: "lot-1",
      period: { ...deSeptiembre.period!, startDate: "2026-10-01T00:00:00.000Z" },
    };
    const sinPeriodo = { ...deSeptiembre, id: "lot-2", period: null };
    expect(
      saldosDeMesesAnteriores(
        [deSeptiembre, sinDisponible, delMismoMes, sinPeriodo],
        "2026-10-01T00:00:00.000Z",
      ),
    ).toEqual([deSeptiembre]);
  });
});

describe("fraseDeArrastre", () => {
  it("dice el origen, el mes, el impuesto y el monto, y que se aplica solo al calcular cuando está verificado", () => {
    const verificado = {
      ...deSeptiembre,
      origin: "CIERRE" as const,
      verificationStatus: "VERIFIED",
      available: "1234.0000",
    };
    expect(fraseDeArrastre(verificado)).toMatch(
      /^Viene del cierre de septiembre de 2026, Ingresos Brutos: .*1\.234,00; se aplica solo al calcular$/,
    );
  });

  it("un saldo sin verificar no se aplica hasta verificarlo (B1)", () => {
    expect(fraseDeArrastre(deSeptiembre)).toMatch(
      /^Viene de la carga manual de septiembre de 2026, Ingresos Brutos: .*500,00; falta verificarlo: no se aplica hasta entonces$/,
    );
  });

  it("un saldo que no se arrastra lo dice", () => {
    const noArrastra = { ...deSeptiembre, verificationStatus: "VERIFIED", carryForward: false };
    expect(fraseDeArrastre(noArrastra)).toMatch(/; no se arrastra al calcular$/);
  });
});
