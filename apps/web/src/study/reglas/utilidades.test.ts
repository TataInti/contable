import { describe, expect, it } from "vitest";
import { sameRuleRows, validateRuleVersionDate } from "./utilidades";
import { formatearFecha } from "../../lib/formatoFechas";

// Datos sintéticos rotulados «Demo»; no son datos de clientes.
type FilaDemo = Parameters<typeof sameRuleRows>[0][number];

function fila(cambios: Partial<FilaDemo> = {}): FilaDemo {
  return {
    id: "regla-demo-1",
    concept: "Alícuota Demo",
    kindId: "tipo-demo-alicuota",
    activityId: null,
    categoryCode: null,
    isDefault: false,
    activityCode: null,
    jurisdictionId: null,
    rate: "21",
    minAmount: null,
    validFrom: "2026-01-01",
    validTo: null,
    ...cambios,
  };
}

const formatoInvalido = "La fecha debe tener formato AAAA-MM-DD y un año entre 1900 y 2100.";
const anioInvalido = "El año debe estar entre 1900 y 2100.";
const fechaInvalida = "Ingresá una fecha válida.";

describe("validateRuleVersionDate (K1, Demo)", () => {
  it("acepta una fecha AAAA-MM-DD real, incluidos los límites 1900 y 2100 y un 29 de febrero bisiesto", () => {
    expect(validateRuleVersionDate("2026-11-15")).toBeNull();
    expect(validateRuleVersionDate("2024-02-29")).toBeNull();
    expect(validateRuleVersionDate("1900-01-01")).toBeNull();
    expect(validateRuleVersionDate("2100-12-31")).toBeNull();
  });

  it("rechaza cualquier texto que no sea AAAA-MM-DD con el mensaje de formato", () => {
    for (const valor of ["", "2026-1-5", "15/11/2026", "20261115", "2026-11-15 ", "61001-01-01"]) {
      expect(validateRuleVersionDate(valor), valor).toBe(formatoInvalido);
    }
  });

  it("rechaza años fuera de 1900 a 2100 y revisa el año antes que la fecha", () => {
    expect(validateRuleVersionDate("1899-12-31")).toBe(anioInvalido);
    expect(validateRuleVersionDate("2101-01-01")).toBe(anioInvalido);
    expect(validateRuleVersionDate("1899-02-30")).toBe(anioInvalido);
  });

  it("rechaza fechas que no existen con «Ingresá una fecha válida.»", () => {
    for (const valor of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-11-00"]) {
      expect(validateRuleVersionDate(valor), valor).toBe(fechaInvalida);
    }
  });
});

describe("formatearFecha en vigencias (K1, Demo)", () => {
  it("sin fecha muestra «Sin vencimiento»", () => {
    expect(formatearFecha(null, "Sin vencimiento")).toBe("Sin vencimiento");
    expect(formatearFecha("", "Sin vencimiento")).toBe("Sin vencimiento");
  });

  it("formatea la fecha calendario en es-AR", () => {
    expect(formatearFecha("2026-11-15")).toBe("15/11/2026");
    expect(formatearFecha("2026-11-15T00:00:00.000Z")).toBe("15/11/2026");
  });

  it("no corre el día al formatear en el huso de Argentina (UTC-3)", () => {
    const zonaPrevia = process.env.TZ;
    process.env.TZ = "America/Argentina/Buenos_Aires";
    try {
      expect(formatearFecha("2026-11-15")).toBe("15/11/2026");
    } finally {
      if (zonaPrevia === undefined) delete process.env.TZ;
      else process.env.TZ = zonaPrevia;
    }
  });
});

describe("sameRuleRows (K1, Demo)", () => {
  it("considera iguales dos borradores con las mismas filas, incluidos dos vacíos", () => {
    expect(sameRuleRows([fila()], [fila()])).toBe(true);
    expect(sameRuleRows([], [])).toBe(true);
  });

  it("no depende del orden de las filas", () => {
    const primera = fila({ id: "regla-demo-1" });
    const segunda = fila({ id: "regla-demo-2", concept: "Mínimo Demo", rate: null, minAmount: "1000" });
    expect(sameRuleRows([primera, segunda], [segunda, primera])).toBe(true);
  });

  it("distingue una cantidad distinta de filas", () => {
    expect(sameRuleRows([fila()], [])).toBe(false);
  });

  it("distingue cualquier campo editado: concepto, tasa o mínimo", () => {
    expect(sameRuleRows([fila({ concept: "Otro Demo" })], [fila()])).toBe(false);
    expect(sameRuleRows([fila({ rate: "21.5" })], [fila()])).toBe(false);
    expect(sameRuleRows([fila({ minAmount: "100" })], [fila()])).toBe(false);
  });

  it("trata una vigencia hasta sin fecha y otra con fecha como distintas", () => {
    expect(sameRuleRows([fila({ validTo: "2026-12-31" })], [fila({ validTo: null })])).toBe(false);
    expect(sameRuleRows([fila({ validTo: null })], [fila({ validTo: null })])).toBe(true);
  });

  it("compara la vigencia por día: la hora de validFrom no cuenta", () => {
    expect(sameRuleRows([fila({ validFrom: "2026-01-01T03:00:00.000Z" })], [fila()])).toBe(true);
  });

  it("trata isDefault ausente y falso como iguales, y verdadero como distinto", () => {
    expect(sameRuleRows([fila({ isDefault: undefined })], [fila({ isDefault: false })])).toBe(true);
    expect(sameRuleRows([fila({ isDefault: true })], [fila({ isDefault: false })])).toBe(false);
  });

  it("una fila sin par guardado (id distinto) cuenta como distinta", () => {
    expect(sameRuleRows([fila({ id: "regla-nueva" })], [fila({ id: "regla-demo-1" })])).toBe(false);
  });
});
