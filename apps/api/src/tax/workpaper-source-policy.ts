/**
 * Registro mínimo y versionado de fuentes del expediente mensual.
 *
 * Mantiene en un solo lugar la correspondencia entre una obligación fiscal,
 * la fuente que espera el proceso real y el adaptador que normaliza sus filas.
 * Las políticas se amplían junto con los formatos oficiales; no se infieren
 * desde nombres de archivo ni desde datos cargados por el usuario.
 */
export interface WorkpaperSourcePolicy {
  code: string;
  label: string;
  taxTypeCode: string;
  regimeCode?: string;
  origin: string;
  adapterVersion: string;
  required: boolean;
  voucherDirection?: "SALE" | "PURCHASE";
  allocationJurisdiction?: "OBLIGATION" | "ROW_REQUIRED";
  expectedColumns: readonly string[];
}

export const WORKPAPER_SOURCE_POLICIES: readonly WorkpaperSourcePolicy[] = [
  {
    code: "ARCA_IVA_SALES",
    label: "Libro IVA Ventas",
    taxTypeCode: "IVA",
    regimeCode: "RI",
    origin: "ARCA",
    adapterVersion: "ARCA_LIBRO_IVA_V1",
    required: true,
    voucherDirection: "SALE",
    expectedColumns: [
      "direction", "letter", "pointOfSale", "numberFrom", "numberTo", "cuit",
      "issuedOn", "net", "hasIva", "iva21", "iva105", "iva27", "exempt",
      "otherTaxes", "currency",
    ],
  },
  {
    code: "ARCA_IVA_PURCHASES",
    label: "Libro IVA Compras",
    taxTypeCode: "IVA",
    regimeCode: "RI",
    origin: "ARCA",
    adapterVersion: "ARCA_LIBRO_IVA_V1",
    required: true,
    voucherDirection: "PURCHASE",
    expectedColumns: [
      "direction", "letter", "pointOfSale", "numberFrom", "numberTo", "cuit",
      "issuedOn", "net", "hasIva", "iva21", "iva105", "iva27", "exempt",
      "otherTaxes", "currency",
    ],
  },
  {
    code: "SICORE_IVA",
    label: "Retenciones y percepciones IVA",
    taxTypeCode: "IVA",
    regimeCode: "RI",
    origin: "ARCA_RET",
    adapterVersion: "ARCA_RET_V1",
    required: false,
    allocationJurisdiction: "OBLIGATION",
    expectedColumns: [
      "kind", "cuitResponsable", "cuitAgente", "concept", "base", "amount",
      "rate", "issuedOn", "certificateNumber", "documentKind",
    ],
  },
  {
    code: "F931",
    label: "F.931 remuneraciones y contribuciones",
    taxTypeCode: "IVA",
    regimeCode: "RI",
    origin: "F931",
    adapterVersion: "F931_V1",
    required: false,
    expectedColumns: ["cuit", "remuneration", "deduction"],
  },
  {
    code: "DGR_IIBB_TUC",
    label: "Ingresos Brutos Tucumán",
    taxTypeCode: "IIBB",
    regimeCode: "IIBB_LOCAL_TUC",
    origin: "DGR_IIBB",
    adapterVersion: "DGR_IIBB_V1",
    required: true,
    expectedColumns: ["activityCode", "description", "income", "rate", "minimum", "exemption"],
  },
  {
    code: "SIFERE_CM03",
    label: "SIFERE Convenio Multilateral CM03",
    taxTypeCode: "IIBB",
    regimeCode: "CM_ART2",
    origin: "CM03",
    adapterVersion: "CM03_V1",
    required: true,
    expectedColumns: ["activityCode", "description", "income", "jurisdiction", "coefficient"],
  },
  {
    code: "IIBB_RPI_TUC",
    label: "Retenciones y percepciones IIBB Tucumán",
    taxTypeCode: "IIBB",
    regimeCode: "IIBB_LOCAL_TUC",
    origin: "DGR_RPI_TUC",
    adapterVersion: "ARCA_RET_V1",
    required: false,
    allocationJurisdiction: "OBLIGATION",
    expectedColumns: [
      "kind", "cuitResponsable", "cuitAgente", "concept", "base", "amount",
      "rate", "issuedOn", "certificateNumber", "documentKind",
    ],
  },
  {
    code: "SIFERE_RPI_CM",
    label: "SIRCAR, SIRTAC y SIRCREB por jurisdicción",
    taxTypeCode: "IIBB",
    regimeCode: "CM_ART2",
    origin: "SIFERE_RPI",
    adapterVersion: "ARCA_RET_V1",
    required: false,
    allocationJurisdiction: "ROW_REQUIRED",
    expectedColumns: [
      "kind", "cuitResponsable", "cuitAgente", "concept", "base", "amount",
      "rate", "issuedOn", "certificateNumber", "documentKind", "jurisdiction",
    ],
  },
  {
    code: "SMT_TEM",
    label: "TEM San Miguel de Tucumán",
    taxTypeCode: "TEM",
    regimeCode: "TEM_SMT",
    origin: "SMT_TEM",
    adapterVersion: "SMT_TEM_V1",
    required: true,
    expectedColumns: ["activityCode", "description", "income", "rate", "minimum", "exemption"],
  },
  {
    code: "SMT_RPI_TEM",
    label: "Retenciones y percepciones TEM",
    taxTypeCode: "TEM",
    regimeCode: "TEM_SMT",
    origin: "SMT_RPI",
    adapterVersion: "ARCA_RET_V1",
    required: false,
    allocationJurisdiction: "OBLIGATION",
    expectedColumns: [
      "kind", "cuitResponsable", "cuitAgente", "concept", "base", "amount",
      "rate", "issuedOn", "certificateNumber", "documentKind",
    ],
  },
] as const;

export function getWorkpaperSourcePolicy(code: string) {
  return WORKPAPER_SOURCE_POLICIES.find((policy) => policy.code === code);
}

export function policiesForObligations(
  obligations: ReadonlyArray<{ taxTypeCode: string; regimeCode: string }>,
) {
  return WORKPAPER_SOURCE_POLICIES.filter((policy) =>
    obligations.some(
      (obligation) =>
        obligation.taxTypeCode === policy.taxTypeCode &&
        (!policy.regimeCode || obligation.regimeCode === policy.regimeCode),
    ),
  );
}
