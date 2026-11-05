import { nationalTaxCondition, type NationalTaxCondition } from "./tax-enums.js";

/**
 * Condiciones de IVA compartidas con el perfil fiscal del contribuyente.
 * Mantiene exactamente el enum existente; no agrega categorías fiscales.
 */
export const CLIENT_VAT_CONDITIONS = nationalTaxCondition.options;
export const CLIENT_VAT_CONDITION_LABELS: Record<NationalTaxCondition, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No responsable",
};

/**
 * Provincias y CABA. Fuente oficial: https://www.argentina.gob.ar/pais/provincias
 * (23 provincias y la Ciudad Autónoma de Buenos Aires). Este campo expresa
 * ubicación; las jurisdicciones fiscales IIBB se mantienen en su catálogo.
 */
export const ARGENTINA_PROVINCES = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  "Tucumán",
] as const;

/**
 * Opciones descriptivas para forma jurídica. Referencias oficiales: Ley General
 * de Sociedades 19.550 (texto actualizado) y Ley 27.349 (SAS). El campo es
 * informativo: seleccionar una opción no determina por sí solo un encuadre legal.
 */
export const CLIENT_LEGAL_FORMS = [
  "Persona humana",
  "Sociedad anónima (SA)",
  "Sociedad anónima unipersonal (SAU)",
  "Sociedad de responsabilidad limitada (SRL)",
  "Sociedad por acciones simplificada (SAS)",
  "Sociedad colectiva",
  "Sociedad en comandita simple",
  "Sociedad en comandita por acciones",
  "Sociedad de capital e industria",
  "Sociedad comprendida en la Sección IV de la Ley 19.550",
  "Cooperativa",
  "Asociación civil",
  "Fundación",
  "Sociedad extranjera",
  "Organismo público",
  "Otra forma jurídica",
] as const;

export type ClientProfileCategoryField = "vatCondition" | "province" | "activity" | "legalForm";

export interface ClientEconomicActivityOption {
  code: string;
  name: string;
  isActive?: boolean;
}

export interface ClientProfileCategoryValues {
  vatCondition?: string;
  province?: string;
  activity?: string;
  legalForm?: string;
}

/**
 * Las opciones provienen del maestro EconomicActivity existente. La guía de RUT
 * de ARCA indica que las actividades se identifican con códigos NAES o fiscales
 * provinciales: https://www.arca.gob.ar/registro-unico-tributario/tus-datos/informacion.asp
 * Se conserva junto el código y el nombre seleccionados; el catálogo actual del
 * estudio no se presenta como un listado nacional NAES completo.
 */
export function clientEconomicActivityValue(
  activity: Pick<ClientEconomicActivityOption, "code" | "name">,
) {
  return `${activity.code} — ${activity.name}`;
}

/**
 * Devuelve las categorías desconocidas. Un valor histórico se acepta únicamente
 * cuando coincide exactamente con el valor que ya estaba guardado: así se puede
 * conservar y seguir viendo sin permitir nuevos valores de texto libre.
 */
export function unknownClientProfileCategoryValues(
  values: ClientProfileCategoryValues,
  activities: readonly ClientEconomicActivityOption[],
  preserved: ClientProfileCategoryValues = {},
): Partial<Record<ClientProfileCategoryField, string>> {
  const unknown: Partial<Record<ClientProfileCategoryField, string>> = {};
  const staticCatalogs: Record<
    Exclude<ClientProfileCategoryField, "activity">,
    readonly string[]
  > = {
    vatCondition: CLIENT_VAT_CONDITIONS,
    province: ARGENTINA_PROVINCES,
    legalForm: CLIENT_LEGAL_FORMS,
  };

  for (const field of ["vatCondition", "province", "activity", "legalForm"] as const) {
    const value = values[field];
    if (typeof value !== "string" || value.trim() === "") continue;

    const isInCatalog =
      field === "activity"
        ? activities.some(
            (activity) =>
              activity.isActive !== false && clientEconomicActivityValue(activity) === value,
          )
        : staticCatalogs[field].includes(value);
    if (!isInCatalog && value !== preserved[field]) unknown[field] = value;
  }

  return unknown;
}
