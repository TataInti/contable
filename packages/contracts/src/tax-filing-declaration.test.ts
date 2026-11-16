import { describe, expect, it } from "vitest";
import {
  FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS,
  taxFilingCreditDetailReadSchema,
  taxFilingDeclarationBodySchema,
} from "./tax-filing-declaration.js";

// Detalle del saldo a favor por impuesto y jurisdicción (corte 5a, decisión D13-4 a).
// Datos sintéticos: los identificadores son UUID de prueba.
const IIBB = "22222222-2222-4222-8222-222222222222";
const REGIMEN = "33333333-3333-4333-8333-333333333333";
const JURISDICCION = "44444444-4444-4444-8444-444444444444";
const DJ = "55555555-5555-4555-8555-555555555555";

const cuerpo = {
  declarationDocumentId: DJ,
  impuestoDeterminado: "1500.00",
  saldoFavorTecnico: "0",
  saldoLibreDisponibilidad: "0",
  totalAPagar: "1500.00",
};

const uuidDe = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function rutas(resultado: ReturnType<typeof taxFilingDeclarationBodySchema.safeParse>): string[] {
  return resultado.success ? [] : resultado.error.issues.map((issue) => issue.path.join("."));
}

describe("declaración jurada: detalle del saldo a favor por impuesto y jurisdicción (D13-4 a)", () => {
  it("sigue aceptando la DJ sin detalle, con detalle vacío o con un saldo válido", () => {
    expect(taxFilingDeclarationBodySchema.safeParse(cuerpo).success).toBe(true);
    expect(
      taxFilingDeclarationBodySchema.safeParse({ ...cuerpo, saldosFavorDetalle: [] }).success,
    ).toBe(true);
    expect(
      taxFilingDeclarationBodySchema.safeParse({
        ...cuerpo,
        saldosFavorDetalle: [
          { taxTypeId: IIBB, regimeId: REGIMEN, jurisdictionId: JURISDICCION, amount: "250.5000" },
        ],
      }).success,
    ).toBe(true);
  });

  it("acepta el importe mínimo de 0,0001 y un saldo sin régimen ni jurisdicción", () => {
    expect(
      taxFilingDeclarationBodySchema.safeParse({
        ...cuerpo,
        saldosFavorDetalle: [{ taxTypeId: IIBB, amount: "0.0001" }],
      }).success,
    ).toBe(true);
  });

  it.each(["0", "0.0000", "-1", "1.00001", "abc"])(
    "rechaza el importe %s e indica el campo del ítem",
    (amount) => {
      const resultado = taxFilingDeclarationBodySchema.safeParse({
        ...cuerpo,
        saldosFavorDetalle: [{ taxTypeId: IIBB, amount }],
      });
      expect(rutas(resultado)).toContain("saldosFavorDetalle.0.amount");
    },
  );

  it("rechaza un ítem repetido para la misma combinación y acepta el mismo impuesto con otra jurisdicción", () => {
    const base = { taxTypeId: IIBB, amount: "10.0000" };
    expect(
      rutas(
        taxFilingDeclarationBodySchema.safeParse({ ...cuerpo, saldosFavorDetalle: [base, base] }),
      ),
    ).toContain("saldosFavorDetalle.1");
    expect(
      taxFilingDeclarationBodySchema.safeParse({
        ...cuerpo,
        saldosFavorDetalle: [base, { ...base, jurisdictionId: JURISDICCION }],
      }).success,
    ).toBe(true);
  });

  it("rechaza más de 100 ítems y acepta exactamente 100", () => {
    expect(FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS).toBe(100);
    const ítems = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        taxTypeId: IIBB,
        jurisdictionId: uuidDe(i + 1),
        amount: "1.0000",
      }));
    expect(
      rutas(
        taxFilingDeclarationBodySchema.safeParse({ ...cuerpo, saldosFavorDetalle: ítems(101) }),
      ),
    ).toContain("saldosFavorDetalle");
    expect(
      taxFilingDeclarationBodySchema.safeParse({ ...cuerpo, saldosFavorDetalle: ítems(100) })
        .success,
    ).toBe(true);
  });

  it("rechaza campos que no existen en un ítem y un impuesto que no es UUID", () => {
    expect(
      rutas(
        taxFilingDeclarationBodySchema.safeParse({
          ...cuerpo,
          saldosFavorDetalle: [{ taxTypeId: IIBB, amount: "1", saldo: "1" }],
        }),
      ),
    ).toContain("saldosFavorDetalle.0");
    expect(
      rutas(
        taxFilingDeclarationBodySchema.safeParse({
          ...cuerpo,
          saldosFavorDetalle: [{ taxTypeId: "IVA", amount: "1" }],
        }),
      ),
    ).toContain("saldosFavorDetalle.0.taxTypeId");
  });

  it("la lectura acepta el detalle guardado (importes NUMERIC(20,4)) y también null", () => {
    const guardado = [
      { taxTypeId: IIBB, regimeId: null, jurisdictionId: JURISDICCION, amount: "250.5000" },
    ];
    expect(taxFilingCreditDetailReadSchema.safeParse(guardado).success).toBe(true);
    expect(taxFilingCreditDetailReadSchema.safeParse(null).success).toBe(true);
    expect(
      taxFilingCreditDetailReadSchema.safeParse([{ ...guardado[0], amount: "abc" }]).success,
    ).toBe(false);
  });
});
