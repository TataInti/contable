import { describe, expect, it, vi } from "vitest";
import {
  businessDaysUntil,
  InvalidIsoDateError,
  InvertedIntervalError,
  isBusinessDay,
} from "./business-days.js";

// Fechas SINTÉTICAS, rotuladas «SINT-nn» (Anexo C del plan de corte 3).
// Los feriados de estas pruebas también son sintéticos: los reales y los de
// 2027 se cargan en el corte 3g y no se usan aquí.

interface CasoDorado {
  id: string;
  desde: string;
  hasta: string;
  feriados: readonly string[];
  /** Días hábiles esperados en (desde, hasta]; "error" si desde es posterior a hasta. */
  esperado: number | "error";
  motivo: string;
}

const TABLA_DORADA: readonly CasoDorado[] = [
  {
    id: "SINT-01",
    desde: "2026-11-18",
    hasta: "2026-11-20",
    feriados: [],
    esperado: 2,
    motivo: "cuentan jue 19 y vie 20",
  },
  {
    id: "SINT-02",
    desde: "2026-11-20",
    hasta: "2026-11-23",
    feriados: [],
    esperado: 1,
    motivo: "sábado 21 y domingo 22 no cuentan; lun 23 sí",
  },
  {
    id: "SINT-03",
    desde: "2026-11-20",
    hasta: "2026-11-23",
    feriados: ["2026-11-23"],
    esperado: 0,
    motivo: "el vencimiento cae en feriado: no hay días hábiles en el intervalo",
  },
  {
    id: "SINT-04",
    desde: "2026-11-19",
    hasta: "2026-11-24",
    feriados: ["2026-11-23"],
    esperado: 2,
    motivo: "fin de semana y feriado en medio: cuentan vie 20 y mar 24",
  },
  {
    id: "SINT-05",
    desde: "2026-10-29",
    hasta: "2026-11-02",
    feriados: [],
    esperado: 2,
    motivo: "fin de mes: cuentan vie 30 y lun 2; sábado 31 y domingo 1 no",
  },
  {
    id: "SINT-06",
    desde: "2026-12-31",
    hasta: "2027-01-04",
    feriados: ["2027-01-01"],
    esperado: 1,
    motivo: "cambio de año con feriado: cuenta solo lun 4",
  },
  {
    id: "SINT-07",
    desde: "2026-12-31",
    hasta: "2027-01-04",
    feriados: [],
    esperado: 2,
    motivo: "cambio de año sin feriado: cuentan vie 1 y lun 4",
  },
  {
    id: "SINT-08",
    desde: "2026-11-20",
    hasta: "2026-11-20",
    feriados: [],
    esperado: 0,
    motivo: "vence hoy (dispara con N = 0)",
  },
  {
    id: "SINT-09",
    desde: "2026-11-17",
    hasta: "2026-11-20",
    feriados: [],
    esperado: 3,
    motivo: "ventana con N = 2: el aviso sale el mié 18 (restante 2) y no el mar 17 (restante 3)",
  },
  {
    id: "SINT-10",
    desde: "2026-11-19",
    hasta: "2026-11-21",
    feriados: [],
    esperado: 1,
    motivo: "vencimiento manual en sábado: solo cuenta vie 20",
  },
  {
    id: "SINT-11",
    desde: "2026-11-21",
    hasta: "2026-11-20",
    feriados: [],
    esperado: "error",
    motivo: "desde > hasta: el llamador trata la obligación como vencida antes de contar",
  },
];

/** Valor lanzado por fn, o undefined si fn no lanza. */
function errorDe(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Días hábiles del caso, o "error" si el caso lanza InvertedIntervalError. */
function contarOError(caso: CasoDorado): number | "error" {
  try {
    return businessDaysUntil(caso.desde, caso.hasta, caso.feriados);
  } catch (error) {
    if (error instanceof InvertedIntervalError) return "error";
    throw error;
  }
}

describe("businessDaysUntil: tabla dorada SINT-01 a SINT-11 (Anexo C del plan)", () => {
  for (const caso of TABLA_DORADA) {
    it(`${caso.id}: ${caso.motivo}`, () => {
      if (caso.esperado === "error") {
        expect(
          errorDe(() => businessDaysUntil(caso.desde, caso.hasta, caso.feriados)),
        ).toBeInstanceOf(InvertedIntervalError);
      } else {
        expect(businessDaysUntil(caso.desde, caso.hasta, caso.feriados)).toBe(caso.esperado);
      }
    });
  }
});

describe("ventana de aviso con N = 2 (Anexo C, nota final; vence vie 20-nov-2026, sin feriados)", () => {
  const VENCE = "2026-11-20";

  it("mar 17: restante 3, todavía no hay aviso", () => {
    expect(businessDaysUntil("2026-11-17", VENCE, [])).toBe(3);
  });

  it("mié 18: restante 2, entra en la ventana y hay aviso", () => {
    expect(businessDaysUntil("2026-11-18", VENCE, [])).toBe(2);
  });

  it("jue 19: restante 1", () => {
    expect(businessDaysUntil("2026-11-19", VENCE, [])).toBe(1);
  });

  it("vie 20: restante 0, vence hoy", () => {
    expect(businessDaysUntil("2026-11-20", VENCE, [])).toBe(0);
  });

  it("sáb 21: vencida antes de contar (InvertedIntervalError)", () => {
    expect(errorDe(() => businessDaysUntil("2026-11-21", VENCE, []))).toBeInstanceOf(
      InvertedIntervalError,
    );
  });
});

describe("businessDaysUntil: casos adicionales (fechas sintéticas)", () => {
  it("año 2026 completo sin feriados: (1-ene, 31-dic] tiene 260 días hábiles", () => {
    // El 2-ene-2026 es viernes y el 31-dic-2026 es jueves: 364 días = 52 semanas exactas.
    expect(businessDaysUntil("2026-01-01", "2026-12-31", [])).toBe(260);
  });

  it("acepta los feriados como ReadonlySet y como arreglo, con el mismo resultado", () => {
    const feriados = ["2026-11-23"];
    expect(businessDaysUntil("2026-11-20", "2026-11-24", new Set(feriados))).toBe(1);
    expect(businessDaysUntil("2026-11-20", "2026-11-24", feriados)).toBe(1);
  });

  it("un feriado fuera del intervalo no cambia el conteo", () => {
    expect(businessDaysUntil("2026-11-18", "2026-11-20", ["2026-11-25"])).toBe(2);
  });

  it("reconoce el 29 de febrero de un año bisiesto (martes) y rechaza el de un año común", () => {
    expect(isBusinessDay("2028-02-29", [])).toBe(true);
    expect(errorDe(() => isBusinessDay("2026-02-29", []))).toBeInstanceOf(InvalidIsoDateError);
  });
});

describe("isBusinessDay", () => {
  it("sábado y domingo no son días hábiles", () => {
    expect(isBusinessDay("2026-11-21", [])).toBe(false);
    expect(isBusinessDay("2026-11-22", [])).toBe(false);
  });

  it("un día de semana es hábil si no figura como feriado", () => {
    expect(isBusinessDay("2026-11-20", [])).toBe(true);
    expect(isBusinessDay("2026-11-23", ["2026-11-23"])).toBe(false);
  });

  it("acepta el conjunto de feriados como ReadonlySet", () => {
    expect(isBusinessDay("2026-11-23", new Set(["2026-11-23"]))).toBe(false);
  });
});

describe("errores tipados", () => {
  it("una fecha que no es AAAA-MM-DD de calendario lanza InvalidIsoDateError", () => {
    for (const malformada of ["2026-11-5", "20-11-2026", "2026-13-01", "2026-02-30"]) {
      expect(errorDe(() => isBusinessDay(malformada, []))).toBeInstanceOf(InvalidIsoDateError);
    }
  });

  it("businessDaysUntil también valida las fechas y lanza InvalidIsoDateError", () => {
    expect(errorDe(() => businessDaysUntil("2026-02-30", "2026-03-02", []))).toBeInstanceOf(
      InvalidIsoDateError,
    );
  });

  it("desde > hasta lanza InvertedIntervalError con las dos fechas", () => {
    const error = errorDe(() => businessDaysUntil("2026-11-21", "2026-11-20", []));
    expect(error).toBeInstanceOf(InvertedIntervalError);
    expect(error).toMatchObject({ from: "2026-11-21", to: "2026-11-20" });
  });
});

describe("sin dependencia de la zona horaria del proceso", () => {
  const ZONAS = [
    "UTC",
    "America/Argentina/Buenos_Aires",
    "Pacific/Kiritimati",
    "Pacific/Pago_Pago",
  ];

  it("la tabla dorada da el mismo resultado en cada zona horaria", () => {
    const esperados = TABLA_DORADA.map((caso) => caso.esperado);
    try {
      for (const zona of ZONAS) {
        vi.stubEnv("TZ", zona);
        expect(TABLA_DORADA.map(contarOError), `TZ=${zona}`).toEqual(esperados);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
