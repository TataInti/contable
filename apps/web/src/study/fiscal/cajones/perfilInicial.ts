import type { ClientWithProfile } from "../../clientes/tipos";
import type { CONDITION_LABELS } from "../utilidades";

/** Alta del cliente que alimenta la propuesta del perfil fiscal (solo los datos que usa el perfil). */
export type ClienteAlta = Partial<Pick<ClientWithProfile, "legalName" | "cuit">> & {
  profile?: { legalForm?: string | null; vatCondition?: string | null } | null;
};

export type CondicionNacional = keyof typeof CONDITION_LABELS;

export type PerfilInicial = {
  legalName: string;
  cuit: string;
  /** Cadena vacía = «Elegí…»: no hay base para proponer. */
  personType: "FISICA" | "JURIDICA" | "";
  nationalCondition: CondicionNacional | "";
  /** De dónde salió la propuesta del tipo de persona; null cuando no hubo propuesta. */
  origenTipo: "forma" | "cuit" | null;
};

const PREFIJO_FISICA = ["20", "23", "24", "27"];
const PREFIJO_JURIDICA = ["30", "33", "34"];
const FORMA_PERSONA_HUMANA = "Persona humana";

/** Tipo de persona que corresponde al prefijo del CUIT; null si el prefijo no define tipo. */
export function tipoSegunCuit(cuit: string): "FISICA" | "JURIDICA" | null {
  const prefijo = cuit.slice(0, 2);
  if (PREFIJO_FISICA.includes(prefijo)) return "FISICA";
  if (PREFIJO_JURIDICA.includes(prefijo)) return "JURIDICA";
  return null;
}

/**
 * Valores iniciales del perfil fiscal a partir del alta. Pura: el padre la usa al abrir
 * «Crear perfil fiscal». El tipo sale de la forma jurídica del alta; sin ella, del CUIT.
 */
export function perfilInicial(cliente: ClienteAlta | null | undefined): PerfilInicial {
  const legalName = cliente?.legalName ?? "";
  const cuit = cliente?.cuit ?? "";
  const legalForm = cliente?.profile?.legalForm ?? null;
  const vatCondition = cliente?.profile?.vatCondition ?? null;

  let personType: PerfilInicial["personType"] = "";
  let origenTipo: PerfilInicial["origenTipo"] = null;
  if (legalForm) {
    personType = legalForm === FORMA_PERSONA_HUMANA ? "FISICA" : "JURIDICA";
    origenTipo = "forma";
  } else {
    const porCuit = tipoSegunCuit(cuit);
    if (porCuit) {
      personType = porCuit;
      origenTipo = "cuit";
    }
  }

  const nationalCondition: PerfilInicial["nationalCondition"] =
    vatCondition === "RESPONSABLE_INSCRIPTO" || vatCondition === "MONOTRIBUTISTA" || vatCondition === "EXENTO" || vatCondition === "NO_RESPONSABLE"
      ? vatCondition
      : "";

  return { legalName, cuit, personType, nationalCondition, origenTipo };
}

/** Aviso (sin bloqueo) cuando el tipo elegido contradice el prefijo del CUIT. */
export function contradiccionTipoCuit(cuit: string, personType: string): string | null {
  if (cuit.length < 2) return null;
  const prefijo = cuit.slice(0, 2);
  const porCuit = tipoSegunCuit(cuit);
  if (!porCuit || personType === "" || personType === porCuit) return null;
  const tipoCorresponde = porCuit === "FISICA" ? "persona física" : "persona jurídica";
  return `El CUIT empieza con ${prefijo}, que corresponde a ${tipoCorresponde}. Revisá el tipo de persona.`;
}

/** Qué falta para guardar el perfil; null cuando ya se puede guardar. */
export function motivoGuardarBloqueado(form: { personType: string; nationalCondition: string }): string | null {
  const faltan = [form.personType === "" ? "el tipo de persona" : null, form.nationalCondition === "" ? "la condición nacional" : null].filter(Boolean);
  if (faltan.length === 0) return null;
  if (faltan.length === 2) return "Falta elegir el tipo de persona y la condición nacional para guardar.";
  return `Falta elegir ${faltan[0]} para guardar.`;
}
