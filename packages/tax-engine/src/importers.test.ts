import { describe, expect, it } from "vitest";
import {
  normalizeArcaVoucherBatch,
  normalizeArcaVoucherRow,
  normalizeCm03Batch,
  normalizeCm03Row,
  normalizeF931Batch,
  normalizeF931Row,
  normalizeIibbTucBatch,
  normalizeIibbTucRow,
  normalizeTemSmtBatch,
  normalizeTemSmtRow,
  normalizeWithholdingBatch,
  normalizeWithholdingRow,
} from "./importers.js";

/**
 * Golden tests de adaptadores de importación (G2-02 / G2-03).
 * Cada caso fija entrada cruda y resultado normalizado esperado.
 */

describe("G2-02 adaptador ARCA compras/ventas", () => {
  it("normaliza una fila válida de venta", () => {
    const result = normalizeArcaVoucherRow({
      direction: "SALE",
      letter: "A",
      pointOfSale: "0001",
      numberFrom: "00123",
      numberTo: "00123",
      cuit: "20111111111",
      issuedOn: "2026-01-10",
      net: "100000.00",
      hasIva: true,
      iva21: "21000.00",
      exempt: "0",
      otherTaxes: "0",
      currency: "ARS",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.direction).toBe("SALE");
      expect(result.data.letter).toBe("A");
      expect(result.data.net).toBe("100000.0000");
      expect(result.data.total).toBe("121000.0000");
      expect(result.data.pointOfSale).toBe(1);
      expect(result.data.numberFrom).toBe(123);
    }
  });

  it("deriva total = neto + IVA + exento + otros tributos", () => {
    const result = normalizeArcaVoucherRow({
      direction: "PURCHASE",
      letter: "B",
      pointOfSale: "0002",
      numberFrom: "10",
      cuit: "20222222222",
      issuedOn: "2026-01-15",
      net: "50000.00",
      hasIva: true,
      iva105: "5250.00",
      exempt: "1000.00",
      otherTaxes: "200.00",
      currency: "ARS",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.total).toBe("56450.0000");
    }
  });

  it("rechaza fila con CUIT inválido y detalla el error", () => {
    const result = normalizeArcaVoucherRow({
      direction: "SALE",
      letter: "A",
      pointOfSale: "0001",
      numberFrom: "1",
      cuit: "123",
      issuedOn: "2026-01-10",
      net: "1000",
      hasIva: true,
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("CUIT_INVALID");
  });

  it("rechaza fila con IVA faltante cuando discrimina", () => {
    const result = normalizeArcaVoucherRow({
      direction: "SALE",
      letter: "A",
      pointOfSale: "0001",
      numberFrom: "1",
      cuit: "20111111111",
      issuedOn: "2026-01-10",
      net: "1000",
      hasIva: true,
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("IVA_MISSING");
  });

  it("un lote suma totales y cuenta errores por fila", () => {
    const batch = normalizeArcaVoucherBatch([
      {
        direction: "SALE",
        letter: "A",
        pointOfSale: "0001",
        numberFrom: "1",
        cuit: "20111111111",
        issuedOn: "2026-01-10",
        net: "100000.00",
        hasIva: true,
        iva21: "21000.00",
      },
      {
        direction: "PURCHASE",
        letter: "B",
        pointOfSale: "0002",
        numberFrom: "2",
        cuit: "20222222222",
        issuedOn: "2026-01-15",
        net: "50000.00",
        hasIva: true,
        iva21: "10500.00",
      },
      { direction: "SALE", letter: "X", pointOfSale: "0003", numberFrom: "3", cuit: "bad", issuedOn: "no-date", net: "1", hasIva: true },
    ]);
    expect(batch.totals.net).toBe("150000.0000");
    expect(batch.totals.iva).toBe("31500.0000");
    expect(batch.totals.validRows).toBe(2);
    expect(batch.totals.errorRows).toBe(1);
  });
});

describe("G2-03 adaptador ARCA retenciones/percepciones", () => {
  it("normaliza una retención sufrida", () => {
    const result = normalizeWithholdingRow({
      cuitResponsable: "20111111111",
      cuitAgente: "30555555550",
      concept: "IVA",
      base: "100000.00",
      amount: "2100.00",
      rate: "0.021",
      tipo: "RETENCION",
      issuedOn: "2026-01-20",
      certificateNumber: "R-2026-001",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.kind).toBe("RETENCION");
      expect(result.data.amount).toBe("2100.0000");
      expect(result.data.certificateNumber).toBe("R-2026-001");
    }
  });

  it("normaliza una percepción", () => {
    const result = normalizeWithholdingRow({
      cuitResponsable: "20111111111",
      cuitAgente: "30555555550",
      concept: "IIBB",
      base: "50000.00",
      amount: "1250.00",
      tipo: "PERCEPCION",
      issuedOn: "2026-01-25",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.kind).toBe("PERCEPCION");
    }
  });

  it("rechaza importe negativo o nulo", () => {
    const result = normalizeWithholdingRow({
      cuitResponsable: "20111111111",
      cuitAgente: "30555555550",
      concept: "IVA",
      base: "1000",
      amount: "-50",
      tipo: "RETENCION",
      issuedOn: "2026-01-20",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("AMOUNT_INVALID");
  });

  it("rechaza tipo desconocido", () => {
    const result = normalizeWithholdingRow({
      cuitResponsable: "20111111111",
      cuitAgente: "30555555550",
      concept: "IVA",
      base: "1000",
      amount: "50",
      tipo: "OTRO",
      issuedOn: "2026-01-20",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("KIND_INVALID");
  });

  it("un lote separa totales de retenciones y percepciones", () => {
    const batch = normalizeWithholdingBatch([
      {
        cuitResponsable: "20111111111",
        cuitAgente: "30555555550",
        concept: "IVA",
        base: "100000",
        amount: "2100",
        tipo: "RETENCION",
        issuedOn: "2026-01-20",
      },
      {
        cuitResponsable: "20111111111",
        cuitAgente: "30555555550",
        concept: "IIBB",
        base: "50000",
        amount: "1250",
        tipo: "PERCEPCION",
        issuedOn: "2026-01-25",
      },
    ]);
    expect(batch.totals.withholding).toBe("2100.0000");
    expect(batch.totals.perception).toBe("1250.0000");
    expect(batch.totals.validRows).toBe(2);
  });
});

describe("G2-02 adaptador DGR Tucumán IIBB local", () => {
  it("normaliza una fila válida de actividad", () => {
    const result = normalizeIibbTucRow({
      activityCode: "501100",
      description: "Venta de mercadería",
      income: "100000.00",
      rate: "4",
      exemption: "0",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.activityCode).toBe("501100");
      expect(result.data.income).toBe("100000.0000");
      expect(result.data.rate).toBe("4.000000");
      expect(result.data.description).toBe("Venta de mercadería");
    }
  });

  it("acepta alícuota y mínimo opcionales nulos", () => {
    const result = normalizeIibbTucRow({
      activityCode: "501100",
      income: "50000.00",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.rate).toBeNull();
      expect(result.data.minimum).toBeNull();
    }
  });

  it("rechaza código de actividad vacío", () => {
    const result = normalizeIibbTucRow({
      activityCode: "  ",
      income: "1000",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("ACTIVITY_CODE_INVALID");
  });

  it("rechaza ingreso negativo", () => {
    const result = normalizeIibbTucRow({
      activityCode: "501100",
      income: "-100",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("INCOME_INVALID");
  });

  it("un lote suma ingresos y cuenta errores", () => {
    const batch = normalizeIibbTucBatch([
      { activityCode: "501100", income: "100000.00", rate: "4" },
      { activityCode: "502200", income: "50000.00", rate: "4.5" },
      { activityCode: "", income: "1000" },
    ]);
    expect(batch.totals.net).toBe("150000.0000");
    expect(batch.totals.validRows).toBe(2);
    expect(batch.totals.errorRows).toBe(1);
  });
});

describe("G4 adaptador SMT TEM San Miguel de Tucumán", () => {
  it("normaliza una fila válida de actividad", () => {
    const result = normalizeTemSmtRow({
      activityCode: "601100",
      description: "Comercio minorista",
      income: "100000.00",
      rate: "2",
      exemption: "0",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.activityCode).toBe("601100");
      expect(result.data.income).toBe("100000.0000");
      expect(result.data.rate).toBe("2.000000");
      expect(result.data.description).toBe("Comercio minorista");
    }
  });

  it("acepta alícuota y mínimo opcionales nulos", () => {
    const result = normalizeTemSmtRow({
      activityCode: "601100",
      income: "50000.00",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.rate).toBeNull();
      expect(result.data.minimum).toBeNull();
    }
  });

  it("rechaza código de actividad vacío", () => {
    const result = normalizeTemSmtRow({
      activityCode: "  ",
      income: "1000",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("ACTIVITY_CODE_INVALID");
  });

  it("rechaza ingreso negativo", () => {
    const result = normalizeTemSmtRow({
      activityCode: "601100",
      income: "-100",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("INCOME_INVALID");
  });

  it("un lote suma ingresos y cuenta errores", () => {
    const batch = normalizeTemSmtBatch([
      { activityCode: "601100", income: "100000.00", rate: "2" },
      { activityCode: "602200", income: "50000.00", rate: "3" },
      { activityCode: "", income: "1000" },
    ]);
    expect(batch.totals.net).toBe("150000.0000");
    expect(batch.totals.validRows).toBe(2);
    expect(batch.totals.errorRows).toBe(1);
  });
});

describe("G4 adaptador CM03 artículo 2 (Convenio Multilateral)", () => {
  it("normaliza una fila válida de ingreso por actividad", () => {
    const result = normalizeCm03Row({
      activityCode: "501100",
      description: "Venta de mercadería",
      income: "100000.00",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.activityCode).toBe("501100");
      expect(result.data.income).toBe("100000.0000");
      expect(result.data.coefficient).toBeNull();
    }
  });

  it("normaliza una fila de coeficiente por jurisdicción", () => {
    const result = normalizeCm03Row({
      activityCode: "COEF_TUC",
      income: "0",
      jurisdiction: "TUC",
      coefficient: "0.6",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.activityCode).toBe("COEF_TUC");
      expect(result.data.coefficient).toBe("0.600000");
      expect(result.data.jurisdiction).toBe("TUC");
    }
  });

  it("rechaza coeficiente fuera de rango 0..1", () => {
    const result = normalizeCm03Row({
      activityCode: "COEF_TUC",
      income: "0",
      coefficient: "1.5",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("COEFFICIENT_INVALID");
  });

  it("rechaza ingreso negativo", () => {
    const result = normalizeCm03Row({
      activityCode: "501100",
      income: "-100",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("INCOME_INVALID");
  });

  it("un lote con coeficientes que no suman 1 es inválido", () => {
    const batch = normalizeCm03Batch([
      { activityCode: "501100", income: "100000.00" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.3" },
    ]);
    expect(batch.totals.errorRows).toBe(1);
    expect(batch.rows.some((r) => r.status === "ERROR")).toBe(true);
  });

  it("un lote con coeficientes que suman 1 es válido", () => {
    const batch = normalizeCm03Batch([
      { activityCode: "501100", income: "100000.00" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.4" },
    ]);
    expect(batch.totals.net).toBe("100000.0000");
    expect(batch.totals.validRows).toBe(3);
    expect(batch.totals.errorRows).toBe(0);
  });
});

describe("F1.2 adaptador F.931 (remuneraciones Dto. 814)", () => {
  it("normaliza una fila válida con detracción", () => {
    const result = normalizeF931Row({
      cuit: "20111111111",
      remuneration: "100000.00",
      deduction: "10000.00",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.cuit).toBe("20111111111");
      expect(result.data.remuneration).toBe("100000.0000");
      expect(result.data.deduction).toBe("10000.0000");
      expect(result.data.netRemuneration).toBe("90000.0000");
    }
  });

  it("acepta detracción cero", () => {
    const result = normalizeF931Row({
      cuit: "20111111111",
      remuneration: "50000.00",
    });
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") {
      expect(result.data.deduction).toBe("0.0000");
      expect(result.data.netRemuneration).toBe("50000.0000");
    }
  });

  it("rechaza CUIT inválido", () => {
    const result = normalizeF931Row({
      cuit: "123",
      remuneration: "1000",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("CUIT_INVALID");
  });

  it("rechaza remuneración inválida", () => {
    const result = normalizeF931Row({
      cuit: "20111111111",
      remuneration: "abc",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("REMUNERATION_INVALID");
  });

  it("rechaza detracción mayor que la remuneración", () => {
    const result = normalizeF931Row({
      cuit: "20111111111",
      remuneration: "1000",
      deduction: "2000",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("DEDUCTION_EXCEEDS");
  });

  it("un lote suma remuneración neta y cuenta errores", () => {
    const batch = normalizeF931Batch([
      { cuit: "20111111111", remuneration: "100000.00", deduction: "10000.00" },
      { cuit: "20222222222", remuneration: "50000.00" },
      { cuit: "bad", remuneration: "1000" },
    ]);
    expect(batch.totals.net).toBe("140000.0000");
    expect(batch.totals.validRows).toBe(2);
    expect(batch.totals.errorRows).toBe(1);
  });
});
