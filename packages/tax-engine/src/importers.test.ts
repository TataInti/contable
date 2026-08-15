import { describe, expect, it } from "vitest";
import {
  normalizeArcaVoucherBatch,
  normalizeArcaVoucherRow,
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
      expect(result.data.letter).toBe("A");
      expect(result.data.net).toBe("100000.0000");
      expect(result.data.total).toBe("121000.0000");
      expect(result.data.pointOfSale).toBe(1);
      expect(result.data.numberFrom).toBe(123);
    }
  });

  it("deriva total = neto + IVA + exento + otros tributos", () => {
    const result = normalizeArcaVoucherRow({
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
        letter: "B",
        pointOfSale: "0002",
        numberFrom: "2",
        cuit: "20222222222",
        issuedOn: "2026-01-15",
        net: "50000.00",
        hasIva: true,
        iva21: "10500.00",
      },
      { letter: "X", pointOfSale: "0003", numberFrom: "3", cuit: "bad", issuedOn: "no-date", net: "1", hasIva: true },
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
