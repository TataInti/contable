// Datos sintéticos: nombres y CUIT inventados (prefijo + 11111111 + dígito), sin relación con clientes reales.
import { describe, expect, it } from "vitest";
import { contradiccionTipoCuit, motivoGuardarBloqueado, perfilInicial, tipoSegunCuit } from "./perfilInicial";

const cuit = (prefijo: string) => `${prefijo}11111111${prefijo === "20" ? "2" : "9"}`;

describe("perfilInicial · tipo de persona", () => {
  it.each([
    ["Persona humana", "20111111112", "FISICA", "forma"],
    ["Sociedad de responsabilidad limitada (SRL)", "30111111119", "JURIDICA", "forma"],
    ["Sociedad anónima (SA)", "20111111112", "JURIDICA", "forma"],
    ["Otra forma jurídica", "27111111119", "JURIDICA", "forma"],
  ])("forma «%s» con CUIT %s propone %s por la forma jurídica", (legalForm, c, personType, origen) => {
    const inicial = perfilInicial({ legalName: "Cliente SINTÉTICO", cuit: c, profile: { legalForm, vatCondition: null } });
    expect(inicial.personType).toBe(personType);
    expect(inicial.origenTipo).toBe(origen);
  });

  it.each([
    ["20", "FISICA"], ["23", "FISICA"], ["24", "FISICA"], ["27", "FISICA"],
    ["30", "JURIDICA"], ["33", "JURIDICA"], ["34", "JURIDICA"],
  ])("sin forma jurídica, prefijo %s propone %s según el CUIT", (prefijo, personType) => {
    const inicial = perfilInicial({ legalName: "Cliente SINTÉTICO", cuit: cuit(prefijo), profile: { legalForm: null, vatCondition: null } });
    expect(inicial.personType).toBe(personType);
    expect(inicial.origenTipo).toBe("cuit");
  });

  it("sin forma jurídica y con prefijo desconocido (55) no propone tipo: queda «Elegí…»", () => {
    const inicial = perfilInicial({ legalName: "Cliente SINTÉTICO", cuit: cuit("55"), profile: null });
    expect(inicial.personType).toBe("");
    expect(inicial.origenTipo).toBeNull();
  });

  it("la forma jurídica manda sobre el prefijo del CUIT", () => {
    const inicial = perfilInicial({ legalName: "x", cuit: cuit("30"), profile: { legalForm: "Persona humana", vatCondition: null } });
    expect(inicial.personType).toBe("FISICA");
    expect(inicial.origenTipo).toBe("forma");
  });
});

describe("perfilInicial · condición nacional", () => {
  it.each([
    ["RESPONSABLE_INSCRIPTO", "RESPONSABLE_INSCRIPTO"],
    ["MONOTRIBUTISTA", "MONOTRIBUTISTA"],
    ["EXENTO", "EXENTO"],
    ["NO_RESPONSABLE", "NO_RESPONSABLE"],
  ])("condición del alta %s llega como %s", (vatCondition, nationalCondition) => {
    const inicial = perfilInicial({ legalName: "x", cuit: cuit("20"), profile: { legalForm: "Persona humana", vatCondition } });
    expect(inicial.nationalCondition).toBe(nationalCondition);
  });

  it("sin condición en el alta (null) la condición arranca en «Elegí…», sin el valor por defecto Responsable Inscripto", () => {
    const inicial = perfilInicial({ legalName: "x", cuit: cuit("20"), profile: { legalForm: "Persona humana", vatCondition: null } });
    expect(inicial.nationalCondition).toBe("");
  });

  it("condición desconocida no se propone", () => {
    const inicial = perfilInicial({ legalName: "x", cuit: cuit("20"), profile: { legalForm: null, vatCondition: "OTRA" } });
    expect(inicial.nationalCondition).toBe("");
  });
});

describe("perfilInicial · identidad y cliente sin datos", () => {
  it("razón social y CUIT vienen del alta; el CUIT sigue editable (se devuelve tal cual)", () => {
    const inicial = perfilInicial({ legalName: "Cliente SINTÉTICO SRL", cuit: cuit("30"), profile: { legalForm: "Sociedad de responsabilidad limitada (SRL)", vatCondition: "RESPONSABLE_INSCRIPTO" } });
    expect(inicial.legalName).toBe("Cliente SINTÉTICO SRL");
    expect(inicial.cuit).toBe(cuit("30"));
  });

  it("cliente sin datos: todo vacío, sin tipo ni condición propuestos", () => {
    expect(perfilInicial(undefined)).toEqual({ legalName: "", cuit: "", personType: "", nationalCondition: "", origenTipo: null });
    expect(perfilInicial({ legalName: "", cuit: "", profile: null })).toEqual({ legalName: "", cuit: "", personType: "", nationalCondition: "", origenTipo: null });
  });

  it("un valor no-cliente (lista vacía de la API) no rompe la propuesta", () => {
    expect(perfilInicial([] as never)).toEqual({ legalName: "", cuit: "", personType: "", nationalCondition: "", origenTipo: null });
  });
});

describe("tipoSegunCuit", () => {
  it.each([["20", "FISICA"], ["23", "FISICA"], ["24", "FISICA"], ["27", "FISICA"], ["30", "JURIDICA"], ["33", "JURIDICA"], ["34", "JURIDICA"], ["55", null], ["", null]])(
    "prefijo %s → %s", (prefijo, esperado) => {
      expect(tipoSegunCuit(prefijo ? cuit(prefijo) : "")).toBe(esperado);
    },
  );
});

describe("contradiccionTipoCuit · aviso sin bloqueo", () => {
  it("Física con CUIT 30 avisa que corresponde a persona jurídica", () => {
    expect(contradiccionTipoCuit(cuit("30"), "FISICA")).toBe("El CUIT empieza con 30, que corresponde a persona jurídica. Revisá el tipo de persona.");
  });

  it("Jurídica con CUIT 20 avisa que corresponde a persona física", () => {
    expect(contradiccionTipoCuit(cuit("20"), "JURIDICA")).toBe("El CUIT empieza con 20, que corresponde a persona física. Revisá el tipo de persona.");
  });

  it.each([["23", "FISICA"], ["24", "FISICA"], ["27", "FISICA"]])("Jurídica con CUIT %s avisa persona física", (prefijo) => {
    expect(contradiccionTipoCuit(cuit(prefijo), "JURIDICA")).toContain("corresponde a persona física");
  });

  it.each([["33", "JURIDICA"], ["34", "JURIDICA"]])("Física con CUIT %s avisa persona jurídica", (prefijo) => {
    expect(contradiccionTipoCuit(cuit(prefijo), "FISICA")).toContain("corresponde a persona jurídica");
  });

  it("sin contradicción cuando coincide, cuando el prefijo es desconocido o cuando no hay tipo", () => {
    expect(contradiccionTipoCuit(cuit("20"), "FISICA")).toBeNull();
    expect(contradiccionTipoCuit(cuit("30"), "JURIDICA")).toBeNull();
    expect(contradiccionTipoCuit(cuit("55"), "FISICA")).toBeNull();
    expect(contradiccionTipoCuit(cuit("20"), "")).toBeNull();
    expect(contradiccionTipoCuit("2", "FISICA")).toBeNull();
  });
});

describe("motivoGuardarBloqueado · qué falta para guardar", () => {
  it("sin tipo ni condición dice que faltan los dos", () => {
    expect(motivoGuardarBloqueado({ personType: "", nationalCondition: "" })).toBe("Falta elegir el tipo de persona y la condición nacional para guardar.");
  });

  it("sin tipo dice solo el tipo", () => {
    expect(motivoGuardarBloqueado({ personType: "", nationalCondition: "EXENTO" })).toBe("Falta elegir el tipo de persona para guardar.");
  });

  it("sin condición dice solo la condición", () => {
    expect(motivoGuardarBloqueado({ personType: "FISICA", nationalCondition: "" })).toBe("Falta elegir la condición nacional para guardar.");
  });

  it("completo no bloquea", () => {
    expect(motivoGuardarBloqueado({ personType: "JURIDICA", nationalCondition: "MONOTRIBUTISTA" })).toBeNull();
  });
});
