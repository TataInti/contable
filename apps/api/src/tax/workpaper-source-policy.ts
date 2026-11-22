/**
 * Registro mínimo y versionado de fuentes del expediente mensual.
 *
 * Mantiene en un solo lugar la correspondencia entre una obligación fiscal,
 * la fuente que espera el proceso real y el adaptador que normaliza sus filas.
 * Las políticas se amplían junto con los formatos oficiales; no se infieren
 * desde nombres de archivo ni desde datos cargados por el usuario.
 *
 * Una obligación se reconoce por atributos fiables: el impuesto (código de
 * tipo) y la familia de cálculo de su régimen (clave del catálogo de sistema).
 * El código del régimen es solo una etiqueta: un régimen que el estudio crea con
 * la misma familia recibe las mismas fuentes que el régimen de sistema.
 */
export interface WorkpaperSourcePolicy {
  code: string;
  label: string;
  taxTypeCode: string;
  /** Clave de la familia de cálculo del régimen (catálogo `calc_families`). */
  calcFamilyKey: string;
  origin: string;
  adapterVersion: string;
  required: boolean;
  voucherDirection?: "SALE" | "PURCHASE";
  allocationJurisdiction?: "OBLIGATION" | "ROW_REQUIRED";
  expectedColumns: readonly string[];
  /**
   * Otras obligaciones que se alimentan de esta misma fuente: un libro, varios impuestos.
   * Las ventas importadas una vez de ARCA sirven a IVA, Ingresos Brutos y TEM del mismo mes.
   */
  alsoFeeds?: ReadonlyArray<{ taxTypeCode: string; calcFamilyKey: string }>;
  /**
   * Fuentes que, ya revisadas, cubren el requisito de esta. La base de Ingresos Brutos y TEM sale
   * por defecto del libro de ventas; la tabla por actividad queda como carga a mano alternativa.
   */
  satisfiedBy?: readonly string[];
}

export const WORKPAPER_SOURCE_POLICIES: readonly WorkpaperSourcePolicy[] = [
  {
    code: "ARCA_IVA_SALES",
    label: "Libro IVA Ventas",
    taxTypeCode: "IVA",
    calcFamilyKey: "VAT_RI",
    origin: "ARCA",
    adapterVersion: "ARCA_LIBRO_IVA_V1",
    required: true,
    voucherDirection: "SALE",
    alsoFeeds: [
      { taxTypeCode: "IIBB", calcFamilyKey: "IIBB_LOCAL" },
      { taxTypeCode: "TEM", calcFamilyKey: "TEM" },
    ],
    expectedColumns: [
      "direction", "letter", "pointOfSale", "numberFrom", "numberTo", "cuit",
      "issuedOn", "net", "nonTaxed", "hasIva", "iva21", "iva105", "iva27", "exempt",
      "otherTaxes", "currency",
    ],
  },
  {
    code: "ARCA_IVA_PURCHASES",
    label: "Libro IVA Compras",
    taxTypeCode: "IVA",
    calcFamilyKey: "VAT_RI",
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
    calcFamilyKey: "VAT_RI",
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
    calcFamilyKey: "VAT_RI",
    origin: "F931",
    adapterVersion: "F931_V1",
    required: false,
    expectedColumns: ["cuit", "remuneration", "deduction"],
  },
  {
    code: "DGR_IIBB_TUC",
    label: "Ingresos Brutos Tucumán",
    taxTypeCode: "IIBB",
    calcFamilyKey: "IIBB_LOCAL",
    origin: "DGR_IIBB",
    adapterVersion: "DGR_IIBB_V1",
    required: true,
    satisfiedBy: ["ARCA_IVA_SALES"],
    expectedColumns: ["activityCode", "description", "income", "rate", "minimum", "exemption"],
  },
  {
    code: "SIFERE_CM03",
    label: "SIFERE Convenio Multilateral CM03",
    taxTypeCode: "IIBB",
    calcFamilyKey: "IIBB_CM03",
    origin: "CM03",
    adapterVersion: "CM03_V1",
    required: true,
    expectedColumns: ["activityCode", "description", "income", "jurisdiction", "coefficient"],
  },
  {
    code: "IIBB_RPI_TUC",
    label: "Retenciones y percepciones IIBB Tucumán",
    taxTypeCode: "IIBB",
    calcFamilyKey: "IIBB_LOCAL",
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
    calcFamilyKey: "IIBB_CM03",
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
    calcFamilyKey: "TEM",
    origin: "SMT_TEM",
    adapterVersion: "SMT_TEM_V1",
    required: true,
    satisfiedBy: ["ARCA_IVA_SALES"],
    expectedColumns: ["activityCode", "description", "income", "rate", "minimum", "exemption"],
  },
  {
    code: "SMT_RPI_TEM",
    label: "Retenciones y percepciones TEM",
    taxTypeCode: "TEM",
    calcFamilyKey: "TEM",
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

/** Atributos fiables de una obligación: impuesto y familia de cálculo de su régimen. */
export type ObligationRef = { taxTypeCode: string; calcFamilyKey: string | null | undefined };

const matchesObligation = (
  target: { taxTypeCode: string; calcFamilyKey: string },
  obligation: ObligationRef,
) =>
  target.taxTypeCode === obligation.taxTypeCode &&
  obligation.calcFamilyKey === target.calcFamilyKey;

/** La obligación para la que la política es una fuente propia (no la que solo se alimenta de ella). */
const isPrimaryFor = (policy: WorkpaperSourcePolicy, obligation: ObligationRef) =>
  matchesObligation(policy, obligation);

const feedsObligation = (policy: WorkpaperSourcePolicy, obligation: ObligationRef) =>
  (policy.alsoFeeds ?? []).some((target) => matchesObligation(target, obligation));

/** Obligaciones a las que sirve la fuente: la propia primero, después las que solo se alimentan de ella. */
export function consumersOfPolicy(
  policy: WorkpaperSourcePolicy,
): Array<{ taxTypeCode: string; calcFamilyKey: string }> {
  return [
    { taxTypeCode: policy.taxTypeCode, calcFamilyKey: policy.calcFamilyKey },
    ...(policy.alsoFeeds ?? []),
  ];
}

/** La obligación donde se carga la fuente: la propia si existe; si no, la primera que se alimenta de ella. */
export function obligationForPolicy<T extends ObligationRef>(
  policy: WorkpaperSourcePolicy,
  obligations: readonly T[],
): T | undefined {
  for (const target of consumersOfPolicy(policy)) {
    const found = obligations.find((obligation) => matchesObligation(target, obligation));
    if (found) return found;
  }
  return undefined;
}

export function policiesForObligations(obligations: readonly ObligationRef[]) {
  return WORKPAPER_SOURCE_POLICIES.filter((policy) =>
    obligations.some(
      (obligation) => isPrimaryFor(policy, obligation) || feedsObligation(policy, obligation),
    ),
  );
}

/**
 * ¿La fuente es obligatoria para estas obligaciones, dado lo ya revisado?
 *
 * - Fuente propia con alternativa (tabla por actividad de Ingresos Brutos o TEM): obligatoria hasta
 *   que el libro de ventas revisado cubra la base.
 * - Fuente que solo alimenta a otras obligaciones (el libro de ventas para un cliente sin IVA):
 *   obligatoria mientras alguna de esas obligaciones no tenga base revisada de ninguna de las dos fuentes.
 */
export function isSourceRequired(
  policy: WorkpaperSourcePolicy,
  obligations: readonly ObligationRef[],
  reviewedCodes: ReadonlySet<string>,
  markedCodes: ReadonlySet<string> = new Set(),
): boolean {
  if (!policy.required) return false;
  // Una base cubierta (lote revisado o marca «Sin movimientos» vigente) satisface a la fuente que la sirve.
  // La marca no cambia la obligatoriedad de la propia fuente: solo cuenta para satisfiedBy.
  const covered = (codes: readonly string[]) =>
    codes.some((code) => reviewedCodes.has(code) || markedCodes.has(code));
  if (obligations.some((obligation) => isPrimaryFor(policy, obligation))) {
    return !covered(policy.satisfiedBy ?? []);
  }
  return obligations
    .filter((obligation) => feedsObligation(policy, obligation))
    .some((obligation) => {
      if (reviewedCodes.has(policy.code)) return false;
      const alternatives = WORKPAPER_SOURCE_POLICIES.filter(
        (candidate) =>
          candidate.satisfiedBy?.includes(policy.code) && isPrimaryFor(candidate, obligation),
      );
      return !covered(alternatives.map((candidate) => candidate.code));
    });
}

/**
 * Fuentes cuyos hechos entran al cálculo de una obligación. Si Ingresos Brutos o TEM tiene su tabla
 * por actividad revisada (carga a mano), esa manda y las ventas del libro no se suman: una base,
 * una sola vez.
 */
export function sourceCodesForCalculation(
  obligation: ObligationRef,
  reviewedCodes: ReadonlySet<string>,
): string[] {
  const candidates = policiesForObligations([obligation]);
  return candidates
    .filter((policy) => {
      if (isPrimaryFor(policy, obligation)) return true;
      return !candidates.some(
        (other) =>
          isPrimaryFor(other, obligation) &&
          other.satisfiedBy?.includes(policy.code) &&
          reviewedCodes.has(other.code),
      );
    })
    .map((policy) => policy.code);
}
