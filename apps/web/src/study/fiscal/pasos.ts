import { FISCAL_STEPS, type FiscalStep, type TaxpayerProfileVersion } from "./utilidades";

/** Lista con datos: basta con que exponga `data` (las consultas de react-query lo cumplen). */
type ConsultaConDatos = { data?: readonly unknown[] };

export function stepCompletionFor({
  latestProfile,
  registrationsQuery,
  clientActivitiesQuery,
  periodsQuery,
  obligationsQuery,
}: {
  latestProfile: TaxpayerProfileVersion | undefined;
  registrationsQuery: ConsultaConDatos;
  clientActivitiesQuery: ConsultaConDatos;
  periodsQuery: ConsultaConDatos;
  obligationsQuery: ConsultaConDatos;
}): Record<FiscalStep, boolean> {
  return {
    perfil: Boolean(latestProfile),
    inscripcion: (registrationsQuery.data?.length ?? 0) > 0,
    actividades: (clientActivitiesQuery.data?.length ?? 0) > 0,
    periodos: (periodsQuery.data?.length ?? 0) > 0,
    obligaciones: (obligationsQuery.data?.length ?? 0) > 0,
  };
}

export function nextRequiredStepFor(stepCompletion: Record<FiscalStep, boolean>) {
  return FISCAL_STEPS.find((item) => !stepCompletion[item.key]);
}

// Un perfil cargado pero sin activar no está terminado: se dice, en lugar de darlo por completo.
export function stepStatusLabelFor(
  key: FiscalStep,
  stepCompletion: Record<FiscalStep, boolean>,
  hasActiveProfile: boolean,
) {
  if (!stepCompletion[key]) return "Pendiente";
  return key === "perfil" && !hasActiveProfile ? "Falta activar" : "Completado";
}
