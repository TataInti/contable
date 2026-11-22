import { describe, expect, it } from "vitest";
import {
  clasePerfil,
  esExento,
  grupoPerfil,
  propuestaPerfil,
  clasesOfrecidas,
  CLASES_COMPROBANTE,
} from "./voucher-profile.js";

describe("clase de comprobante para el perfil (corte 4B)", () => {
  it("una factura toma la letra de la columna", () => {
    expect(clasePerfil({ type: "A", letter: "A" })).toBe("FACTURA_A");
    expect(clasePerfil({ type: "B", letter: "B" })).toBe("FACTURA_B");
    expect(clasePerfil({ type: "C", letter: "C" })).toBe("FACTURA_C");
    expect(clasePerfil({ type: "E", letter: "E" })).toBe("FACTURA_E");
  });

  it("una nota importada (letra NC) toma la letra del código ARCA del renglón original", () => {
    expect(
      clasePerfil({ type: "NC", letter: "NC", raw: { Tipo: "3 - Nota de Crédito A" } }),
    ).toBe("NOTAS_A");
    expect(
      clasePerfil({ type: "ND", letter: "ND", raw: { Tipo: "12 - Nota de Débito C" } }),
    ).toBe("NOTAS_C");
    expect(clasePerfil({ type: "NC", letter: "NC", raw: { Tipo: 21 } })).toBe("NOTAS_E");
  });

  it("una nota sin código de ARCA no tiene clase: queda para revisar", () => {
    expect(clasePerfil({ type: "NC", letter: "NC", raw: null })).toBeNull();
    expect(clasePerfil({ type: "NC", letter: "NC", raw: { Tipo: "38 - Nota de Crédito Otros" } })).toBeNull();
  });

  it("una letra fuera de A, B, C y E (por ejemplo M) no tiene clase", () => {
    expect(clasePerfil({ type: "M", letter: "M" })).toBeNull();
    expect(clasePerfil({ type: "51", letter: null })).toBeNull();
  });

  it("un código ARCA de factura cargado a mano se resuelve por la tabla oficial", () => {
    expect(clasePerfil({ type: "6", letter: null })).toBe("FACTURA_B");
    expect(clasePerfil({ type: "11", letter: null })).toBe("FACTURA_C");
  });
});

describe("propuesta por condición frente al IVA", () => {
  it("Responsable Inscripto: A, B y sus notas; exentos sin tildar; E sin tildar", () => {
    expect(propuestaPerfil("RESPONSABLE_INSCRIPTO")).toEqual({
      clases: ["FACTURA_A", "FACTURA_B", "NOTAS_A", "NOTAS_B"],
      exentos: false,
    });
  });

  it("Monotributista: C y sus notas, sin exentos", () => {
    expect(propuestaPerfil("MONOTRIBUTISTA")).toEqual({ clases: ["FACTURA_C", "NOTAS_C"], exentos: false });
  });

  it("otras condiciones no proponen tildes: el estudio elige", () => {
    expect(propuestaPerfil("EXENTO")).toEqual({ clases: [], exentos: false });
    expect(propuestaPerfil(null)).toEqual({ clases: [], exentos: false });
  });

  it("la exportación (E) se ofrece a los dos regímenes, sin tildar por defecto", () => {
    expect(clasesOfrecidas("RESPONSABLE_INSCRIPTO")).toContain("FACTURA_E");
    expect(clasesOfrecidas("MONOTRIBUTISTA")).toContain("FACTURA_E");
    expect(propuestaPerfil("RESPONSABLE_INSCRIPTO").clases).not.toContain("FACTURA_E");
    expect(propuestaPerfil("MONOTRIBUTISTA").clases).not.toContain("FACTURA_E");
  });

  it("el catálogo de clases tiene 8 entradas", () => {
    expect(CLASES_COMPROBANTE).toHaveLength(8);
  });
});

describe("grupo de comprobantes que no corresponden al perfil", () => {
  const monotributo = propuestaPerfil("MONOTRIBUTISTA");

  it("un monotributista con Factura A cae en el grupo FACTURA_A", () => {
    expect(grupoPerfil({ type: "A", letter: "A", exento: false }, monotributo)).toBe("FACTURA_A");
  });

  it("un comprobante permitido no tiene grupo", () => {
    expect(grupoPerfil({ type: "C", letter: "C", exento: false }, monotributo)).toBeNull();
  });

  it("un comprobante exento sin tilde de exentos cae en EXENTO", () => {
    const responsable = propuestaPerfil("RESPONSABLE_INSCRIPTO");
    expect(grupoPerfil({ type: "A", letter: "A", exento: true }, responsable)).toBe("EXENTO");
  });

  it("con tilde de exentos, el comprobante exento queda permitido", () => {
    const responsable = { ...propuestaPerfil("RESPONSABLE_INSCRIPTO"), exentos: true };
    expect(grupoPerfil({ type: "A", letter: "A", exento: true }, responsable)).toBeNull();
  });

  it("un tipo que no se reconoce va a TIPO_NO_RECONOCIDO, aunque haya tildes", () => {
    const responsable = propuestaPerfil("RESPONSABLE_INSCRIPTO");
    expect(grupoPerfil({ type: "M", letter: "M", exento: false }, responsable)).toBe("TIPO_NO_RECONOCIDO");
  });

  it("si un comprobante no permitido también es exento, el motivo es el tipo", () => {
    expect(grupoPerfil({ type: "A", letter: "A", exento: true }, monotributo)).toBe("FACTURA_A");
  });

  it("una nota de crédito C de un monotributista está permitida", () => {
    expect(
      grupoPerfil({ type: "NC", letter: "NC", raw: { Tipo: "13 - Nota de Crédito C" }, exento: false }, monotributo),
    ).toBeNull();
  });
});

describe("exentos según los componentes del comprobante", () => {
  it("hay exento cuando el componente EXENTO tiene importe distinto de cero", () => {
    expect(esExento([{ concept: "NETO", amount: "100" }, { concept: "EXENTO", amount: "50.00" }])).toBe(true);
  });

  it("un componente EXENTO en cero no cuenta", () => {
    expect(esExento([{ concept: "NETO", amount: "100" }, { concept: "EXENTO", amount: "0.0000" }])).toBe(false);
    expect(esExento([])).toBe(false);
  });
});
