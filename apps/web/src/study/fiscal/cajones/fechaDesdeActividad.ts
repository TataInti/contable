import type { TaxRegistration } from "../utilidades";

/**
 * «Desde» que se propone al vincular una actividad (brief 4H): el inicio de la inscripción vigente del mismo
 * nivel (jurisdicción). Si el nivel no tiene inscripción vigente, el inicio del perfil fiscal. Es solo una
 * propuesta: el usuario puede cambiarla antes de vincular.
 */
export function fechaDesdeActividad(
  jurisdictionId: string | undefined,
  inscripciones: TaxRegistration[],
  desdePerfil: string,
): string {
  const delNivel = inscripciones
    .filter((registro) => registro.status === "ACTIVE" && Boolean(jurisdictionId) && registro.regime.jurisdictionId === jurisdictionId)
    .map((registro) => registro.validFrom.slice(0, 10))
    .sort();
  return delNivel[0] ?? desdePerfil.slice(0, 10);
}
