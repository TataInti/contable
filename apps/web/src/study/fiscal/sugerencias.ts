import type { ClientWithProfile } from "../clientes/tipos";
import type {
  EconomicActivity,
  TaxRegime,
  TaxRegistration,
  TaxpayerProfileVersion,
  ClientActivityLink,
} from "./utilidades";

type RegimenCatalogo = TaxRegime & { jurisdiction?: { name?: string; kind?: string } };
const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Propuestas, nunca altas automáticas: solo IDs presentes y activos en los catálogos. */
export function sugerirConfiguracionFiscal(entrada: {
  cliente?: ClientWithProfile;
  perfil?: TaxpayerProfileVersion;
  regimenes: TaxRegime[];
  inscripciones: TaxRegistration[];
  actividades: EconomicActivity[];
  actividadesVigentes: ClientActivityLink[];
  jurisdicciones: { id: string; name: string }[];
}) {
  const { cliente, perfil, regimenes, inscripciones, actividades, actividadesVigentes } = entrada;
  const provincia = normalizar(cliente?.profile?.province ?? "");
  const domicilio = normalizar(perfil?.fiscalAddress ?? "");
  const condicion = perfil?.nationalCondition ?? cliente?.profile?.vatCondition;
  const codigos: string[] = [];
  if (condicion === "MONOTRIBUTISTA") codigos.push("MONOTRIBUTO");
  if (condicion === "RESPONSABLE_INSCRIPTO") codigos.push("RI");
  if (provincia.includes("tucuman")) {
    codigos.push("IIBB_LOCAL_TUC");
    if (/san miguel de tucuman|\bsmt\b/.test(domicilio)) codigos.push("TEM_SMT");
  }
  const vigentes = new Set(
    inscripciones.filter((fila) => fila.status === "ACTIVE").map((fila) => fila.regime.id),
  );
  const sugeridos = codigos.flatMap((codigo) => {
    const regimen = (regimenes as RegimenCatalogo[]).find(
      (fila) => fila.code === codigo && fila.isActive,
    );
    return regimen && !vigentes.has(regimen.id) ? [regimen] : [];
  });
  const actividadDeclarada = normalizar(cliente?.profile?.activity?.trim() ?? "");
  const jurisdicciones = new Set(
    sugeridos
      .map((fila) => normalizar((fila as RegimenCatalogo).jurisdiction?.name ?? ""))
      .filter(Boolean),
  );
  const nombreJurisdiccion = new Map(
    entrada.jurisdicciones.map((fila) => [fila.id, normalizar(fila.name)]),
  );
  const existentes = new Set(
    actividadesVigentes.filter((fila) => !fila.validTo).map((fila) => fila.activity.id),
  );
  const actividadesSugeridas = actividadDeclarada
    ? actividades.filter(
        (fila) =>
          fila.isActive &&
          !existentes.has(fila.id) &&
          (normalizar(`${fila.code} — ${fila.name}`) === actividadDeclarada ||
            normalizar(fila.name) === actividadDeclarada) &&
          jurisdicciones.has(nombreJurisdiccion.get(fila.jurisdictionId ?? "") ?? ""),
      )
    : [];
  return { regimenes: sugeridos, actividades: actividadesSugeridas };
}
