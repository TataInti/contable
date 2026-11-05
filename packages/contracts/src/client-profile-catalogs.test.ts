import { describe, expect, it } from "vitest";
import { createClientSchema } from "./clients.js";
import {
  ARGENTINA_PROVINCES,
  CLIENT_LEGAL_FORMS,
  CLIENT_VAT_CONDITIONS,
  clientEconomicActivityValue,
  unknownClientProfileCategoryValues,
} from "./client-profile-catalogs.js";

const activityCatalog = [
  { code: "COMERCIO", name: "Comercio", isActive: true },
  { code: "SERVICIOS", name: "Servicios", isActive: false },
];

describe("catálogos de la ficha del cliente", () => {
  it("reutiliza la condición nacional fiscal y mantiene catálogos geográficos y jurídicos finitos", () => {
    expect(CLIENT_VAT_CONDITIONS).toEqual([
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTISTA",
      "EXENTO",
      "NO_RESPONSABLE",
    ]);
    expect(ARGENTINA_PROVINCES).toHaveLength(24);
    expect(CLIENT_LEGAL_FORMS).toContain("Sociedad de responsabilidad limitada (SRL)");
  });

  it("valida IVA, provincia y forma jurídica durante el alta, sin restringir identidad libre", () => {
    const base = {
      legalName: "Razón social libre S.A.",
      tradeName: "Nombre de fantasía",
      cuit: "20111111112",
    };
    expect(
      createClientSchema.parse({
        ...base,
        vatCondition: "RESPONSABLE_INSCRIPTO",
        province: "Tucumán",
        legalForm: "Sociedad anónima (SA)",
      }).legalName,
    ).toBe(base.legalName);
    expect(createClientSchema.safeParse({ ...base, vatCondition: "texto libre" }).success).toBe(
      false,
    );
    expect(createClientSchema.safeParse({ ...base, province: "Provincia inventada" }).success).toBe(
      false,
    );
    expect(createClientSchema.safeParse({ ...base, legalForm: "SRL no catalogada" }).success).toBe(
      false,
    );
  });

  it("valida actividad contra el catálogo existente y no ofrece entradas inactivas para altas nuevas", () => {
    const valid = clientEconomicActivityValue(activityCatalog[0]!);
    const inactive = clientEconomicActivityValue(activityCatalog[1]!);
    expect(unknownClientProfileCategoryValues({ activity: valid }, activityCatalog)).toEqual({});
    expect(unknownClientProfileCategoryValues({ activity: inactive }, activityCatalog)).toEqual({
      activity: inactive,
    });
    expect(
      unknownClientProfileCategoryValues({ activity: "Actividad inventada" }, activityCatalog),
    ).toEqual({
      activity: "Actividad inventada",
    });
  });

  it("acepta preservar únicamente el valor histórico exacto y no transforma ni borra el dato", () => {
    const values = {
      vatCondition: "Responsable inscripto",
      province: "Provincia de Tucumán",
      activity: "Servicios",
      legalForm: "SRL",
    };
    expect(unknownClientProfileCategoryValues(values, activityCatalog, values)).toEqual({});
    expect(
      unknownClientProfileCategoryValues(
        { ...values, legalForm: "Otra entrada inventada" },
        activityCatalog,
        values,
      ),
    ).toEqual({ legalForm: "Otra entrada inventada" });
  });

  it("admite limpiar campos categóricos opcionales sin requerir una categoría fiscal", () => {
    expect(
      unknownClientProfileCategoryValues(
        {
          vatCondition: "",
          province: " ",
          activity: "",
          legalForm: "",
        },
        activityCatalog,
      ),
    ).toEqual({});
  });
});
