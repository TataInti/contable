import { describe, expect, it } from "vitest";
import { formatMoney } from "../formato";
import type { WorkpaperCalculationComponent } from "../tipos";
import {
  cuerpoCalculo,
  errorMinimo,
  lineasDeFormula,
  motivoSeleccionCalculo,
  seleccionEfectiva,
  seleccionHabitual,
} from "./seleccionCalculo";

// Datos inventados (Demo): un IIBB con mínimo libre y un IVA sin mínimo declarado.
function componente(over: Partial<WorkpaperCalculationComponent> = {}): WorkpaperCalculationComponent {
  return {
    role: "PRINCIPAL",
    required: true,
    obligationId: "ob-iibb",
    habitual: true,
    usaMinimoDeclarado: true,
    minimoAnterior: { amount: "1600.00" },
    obligation: {
      regimeCode: "IIBB_TUC",
      regimeName: "Contribuyente Local Tucumán",
      taxTypeCode: "IIBB",
      taxTypeName: "Ingresos Brutos",
      jurisdictionName: "Tucumán",
    },
    settlement: null,
    ...over,
  };
}

const iva = componente({
  obligationId: "ob-iva",
  habitual: false,
  usaMinimoDeclarado: false,
  minimoAnterior: null,
  obligation: {
    regimeCode: "IVA",
    regimeName: "Régimen general",
    taxTypeCode: "IVA",
    taxTypeName: "IVA",
    jurisdictionName: "Nacional",
  },
});

describe("selección de impuestos a liquidar", () => {
  it("por defecto elige el perfil habitual", () => {
    expect(seleccionHabitual([componente(), iva]).obligationIds).toEqual(["ob-iibb"]);
  });

  it("sin selección propia usa el perfil habitual", () => {
    expect(seleccionEfectiva([componente(), iva], null).obligationIds).toEqual(["ob-iibb"]);
  });

  it("una selección vacía no puede calcularse y lo dice", () => {
    const motivo = motivoSeleccionCalculo([componente(), iva], { obligationIds: [], minimums: {} });
    expect(motivo).toBe("Elegí al menos un impuesto para liquidar este mes.");
  });

  it("el cuerpo del cálculo envía solo lo marcado y los mínimos cargados", () => {
    const cuerpo = cuerpoCalculo([componente(), iva], {
      obligationIds: ["ob-iibb", "ob-iva"],
      minimums: { "ob-iibb": "5000.00", "ob-iva": "999" },
    });
    // El mínimo solo viaja para impuestos que lo usan.
    expect(cuerpo).toEqual({ obligationIds: ["ob-iibb", "ob-iva"], minimums: { "ob-iibb": "5000.00" } });
  });

  it("un mínimo vacío no viaja: sin mínimo no se aplica", () => {
    const cuerpo = cuerpoCalculo([componente()], { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "" } });
    expect(cuerpo).toEqual({ obligationIds: ["ob-iibb"] });
  });
});

describe("mínimo libre", () => {
  it("acepta importes con hasta dos decimales y rechaza el resto con un motivo", () => {
    expect(errorMinimo("")).toBeNull();
    expect(errorMinimo("1600")).toBeNull();
    expect(errorMinimo("1600.5")).toBeNull();
    expect(errorMinimo("12.345")).toBe(
      "Escribí solo el importe, con hasta dos decimales (por ejemplo 1500 o 1500.50).",
    );
  });

  it("un mínimo inválido bloquea el cálculo y lo señala", () => {
    const motivo = motivoSeleccionCalculo([componente()], {
      obligationIds: ["ob-iibb"],
      minimums: { "ob-iibb": "12.345" },
    });
    expect(motivo).toBe("Corregí el mínimo marcado en rojo antes de calcular.");
  });
});

describe("fórmula legible", () => {
  const liquidado = componente({
    settlement: {
      id: "s1",
      status: "CALCULATED",
      engineVersion: "ar-iibb-tuc-local-v1.2.0",
      ruleVersionId: "rv1",
      rulesHash: "h",
      totals: {
        BASE_TOTAL: "115000.00",
        IMPUESTO_POR_ACTIVIDAD: "4025.00",
        MINIMO_APLICADO: "5000.00",
        IMPUESTO_DETERMINADO: "5000.00",
        RETENCIONES: "0.00",
        TOTAL_A_INGRESAR: "5000.00",
      },
      lines: [
        {
          id: "l1",
          position: 1,
          concept: "ACTIVIDAD_620100",
          formula: null,
          inputs: { rate: "0.035" },
          amount: "4025.00",
        },
      ],
      differences: [],
      f931Inputs: [],
      minimo: { amount: "5000.00", origen: "CAMPO", declaredAt: "2026-11-22T12:00:00.000Z" },
    },
  });

  it("explica base × alícuota, el mínimo y cuál se aplicó", () => {
    const lineas = lineasDeFormula(liquidado);
    expect(lineas[0]).toContain("Base");
    expect(lineas[0]).toContain("× alícuota 3,5 %");
    expect(lineas).toContain(`Mínimo: mínimo del mes ${formatMoney("5000.00")}.`);
    expect(lineas).toContain("Se aplica el mínimo porque el impuesto por actividad es menor.");
    expect(lineas.at(-1)).toBe(`Total a ingresar: ${formatMoney("5000.00")}.`);
  });

  it("sin mínimo ingresado lo dice en una frase", () => {
    const sinMinimo = componente({
      settlement: { ...liquidado.settlement!, minimo: null, totals: { BASE_TOTAL: "115000.00", IMPUESTO_POR_ACTIVIDAD: "4025.00", TOTAL_A_INGRESAR: "4025.00" } },
    });
    expect(lineasDeFormula(sinMinimo)).toContain("Sin mínimo: completalo si corresponde.");
  });
});
