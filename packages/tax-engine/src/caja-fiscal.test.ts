import { describe, expect, it } from "vitest";
import { calculateCajaFiscal, CajaFiscalError, type CajaFiscalInput } from "./profitability.js";

/**
 * Tabla dorada del saldo de caja fiscal (corte 8a, plan §3.f). Cifras sintéticas rotuladas «CLI-SINT-01»,
 * período 10/2026, ARS. Caja fiscal = ventas con IVA − compras con IVA − Σ max(0, totalAPagar) de las DJ cargadas.
 */

const PERIODO = { id: "CLI-SINT-01-10-2026", etiqueta: "10/2026" };

function caso(sobrescribir: Partial<CajaFiscalInput> = {}): CajaFiscalInput {
  return {
    periodo: PERIODO,
    ventas: {
      comprobantes: 2,
      facturadoConIva: "1210000.00",
      notasCreditoConIva: "121000.00",
      sinTipoDeCambio: [],
    },
    compras: {
      comprobantes: 1,
      facturadoConIva: "605000.00",
      notasCreditoConIva: "0.00",
      sinTipoDeCambio: [],
    },
    impuestos: [
      {
        impuesto: "IVA",
        periodo: "10/2026",
        regimen: "IVA-SINT",
        dj: { id: "dj-iva-sint", totalAPagar: "180000.00" },
      },
      {
        impuesto: "IIBB",
        periodo: "10/2026",
        regimen: "IIBB-SINT",
        dj: { id: "dj-iibb-sint", totalAPagar: "45000.00" },
      },
      {
        impuesto: "TEM",
        periodo: "10/2026",
        regimen: "TEM-SINT",
        dj: { id: "dj-tem-sint", totalAPagar: "12000.00" },
      },
    ],
    ...sobrescribir,
  };
}

function errorDe(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("saldo de caja fiscal (corte 8a): tabla dorada CLI-SINT-01", () => {
  it("COMPLETO: 1.089.000,00 − 605.000,00 − (180.000,00 + 45.000,00 + 12.000,00) = 247.000,00, con su desglose", () => {
    const r = calculateCajaFiscal(caso());
    expect(r.estado).toBe("COMPLETO");
    expect(r.cifra).toBe("247000.00");
    expect(r.faltantes).toEqual([]);
    expect(r.comprobantes).toEqual({ ventas: 2, compras: 1 });
    expect(r.desglose).toEqual({
      ventasConIva: "1089000.00",
      comprasConIva: "605000.00",
      impuestos: [
        {
          impuesto: "IVA",
          periodo: "10/2026",
          regimen: "IVA-SINT",
          presentacionId: "dj-iva-sint",
          totalAPagar: "180000.00",
          deduccion: "180000.00",
        },
        {
          impuesto: "IIBB",
          periodo: "10/2026",
          regimen: "IIBB-SINT",
          presentacionId: "dj-iibb-sint",
          totalAPagar: "45000.00",
          deduccion: "45000.00",
        },
        {
          impuesto: "TEM",
          periodo: "10/2026",
          regimen: "TEM-SINT",
          presentacionId: "dj-tem-sint",
          totalAPagar: "12000.00",
          deduccion: "12000.00",
        },
      ],
      totalImpuestos: "237000.00",
    });
  });

  it("variante i: DJ de IVA con totalAPagar −30.000,00 deduce 0 y la cifra es 427.000,00 (S-8.4)", () => {
    const r = calculateCajaFiscal(
      caso({
        impuestos: [
          {
            impuesto: "IVA",
            periodo: "10/2026",
            regimen: "IVA-SINT",
            dj: { id: "dj-iva-sint", totalAPagar: "-30000.00" },
          },
          {
            impuesto: "IIBB",
            periodo: "10/2026",
            regimen: "IIBB-SINT",
            dj: { id: "dj-iibb-sint", totalAPagar: "45000.00" },
          },
          {
            impuesto: "TEM",
            periodo: "10/2026",
            regimen: "TEM-SINT",
            dj: { id: "dj-tem-sint", totalAPagar: "12000.00" },
          },
        ],
      }),
    );
    expect(r.cifra).toBe("427000.00");
    expect(r.desglose?.impuestos[0]).toEqual({
      impuesto: "IVA",
      periodo: "10/2026",
      regimen: "IVA-SINT",
      presentacionId: "dj-iva-sint",
      totalAPagar: "-30000.00",
      deduccion: "0.00",
    });
    expect(r.desglose?.totalImpuestos).toBe("57000.00");
  });

  it("una DJ con totalAPagar 0,00 está cargada: deduce 0 y no es faltante (S-8.4)", () => {
    const r = calculateCajaFiscal(
      caso({
        impuestos: [
          {
            impuesto: "IVA",
            periodo: "10/2026",
            regimen: "IVA-SINT",
            dj: { id: "dj-iva-sint", totalAPagar: "0.00" },
          },
          {
            impuesto: "IIBB",
            periodo: "10/2026",
            regimen: "IIBB-SINT",
            dj: { id: "dj-iibb-sint", totalAPagar: "45000.00" },
          },
          {
            impuesto: "TEM",
            periodo: "10/2026",
            regimen: "TEM-SINT",
            dj: { id: "dj-tem-sint", totalAPagar: "12000.00" },
          },
        ],
      }),
    );
    expect(r.estado).toBe("COMPLETO");
    expect(r.faltantes).toEqual([]);
    expect(r.cifra).toBe("427000.00");
  });

  it("variante ii: falta la DJ de TEM 10/2026 → PARCIAL, con el faltante, sin cifra y con el desglose de lo cargado (D13-3 a)", () => {
    const r = calculateCajaFiscal(
      caso({
        impuestos: [
          {
            impuesto: "IVA",
            periodo: "10/2026",
            regimen: "IVA-SINT",
            dj: { id: "dj-iva-sint", totalAPagar: "180000.00" },
          },
          {
            impuesto: "IIBB",
            periodo: "10/2026",
            regimen: "IIBB-SINT",
            dj: { id: "dj-iibb-sint", totalAPagar: "45000.00" },
          },
          { impuesto: "TEM", periodo: "10/2026", regimen: "TEM-SINT", dj: null },
        ],
      }),
    );
    expect(r.estado).toBe("PARCIAL");
    expect(r.cifra).toBeNull();
    expect(r.faltantes).toEqual([{ impuesto: "TEM", periodo: "10/2026", regimen: "TEM-SINT" }]);
    expect(r.desglose).not.toBeNull();
    expect(r.desglose?.totalImpuestos).toBe("225000.00");
  });

  it("variante iii: período sin comprobantes aprobados → SIN_DATOS, sin cifra (no es cero)", () => {
    const r = calculateCajaFiscal(
      caso({
        ventas: {
          comprobantes: 0,
          facturadoConIva: "0.00",
          notasCreditoConIva: "0.00",
          sinTipoDeCambio: [],
        },
        compras: {
          comprobantes: 0,
          facturadoConIva: "0.00",
          notasCreditoConIva: "0.00",
          sinTipoDeCambio: [],
        },
      }),
    );
    expect(r.estado).toBe("SIN_DATOS");
    expect(r.cifra).toBeNull();
    expect(r.desglose).toBeNull();
  });

  it("variante iv: comprobante en moneda extranjera sin tipo de cambio bloquea con el motivo (L-021)", () => {
    const error = errorDe(() =>
      calculateCajaFiscal(
        caso({
          ventas: {
            comprobantes: 2,
            facturadoConIva: "1210000.00",
            notasCreditoConIva: "121000.00",
            sinTipoDeCambio: ["fac-usd-7"],
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(CajaFiscalError);
    expect((error as CajaFiscalError).code).toBe("TIPO_DE_CAMBIO_REQUERIDO");
    expect((error as CajaFiscalError).message).toContain("tipo de cambio");
    expect((error as CajaFiscalError).comprobantes).toEqual(["fac-usd-7"]);
  });

  it("las notas de crédito de compras restan en su lado: 605.000,00 − 5.000,00 = 600.000,00", () => {
    const r = calculateCajaFiscal(
      caso({
        compras: {
          comprobantes: 2,
          facturadoConIva: "605000.00",
          notasCreditoConIva: "5000.00",
          sinTipoDeCambio: [],
        },
      }),
    );
    expect(r.desglose?.comprasConIva).toBe("600000.00");
    expect(r.cifra).toBe("252000.00");
  });

  it("determinismo: mismas entradas → mismo hash de entradas y de salida; otra entrada → otro hash (G5-05)", () => {
    const a = calculateCajaFiscal(caso());
    const b = calculateCajaFiscal(caso());
    expect(b.inputHash).toBe(a.inputHash);
    expect(b.outputHash).toBe(a.outputHash);
    const c = calculateCajaFiscal(
      caso({
        impuestos: [
          {
            impuesto: "IVA",
            periodo: "10/2026",
            regimen: "IVA-SINT",
            dj: { id: "dj-iva-sint", totalAPagar: "180001.00" },
          },
          {
            impuesto: "IIBB",
            periodo: "10/2026",
            regimen: "IIBB-SINT",
            dj: { id: "dj-iibb-sint", totalAPagar: "45000.00" },
          },
          {
            impuesto: "TEM",
            periodo: "10/2026",
            regimen: "TEM-SINT",
            dj: { id: "dj-tem-sint", totalAPagar: "12000.00" },
          },
        ],
      }),
    );
    expect(c.inputHash).not.toBe(a.inputHash);
    expect(c.outputHash).not.toBe(a.outputHash);
  });
});
