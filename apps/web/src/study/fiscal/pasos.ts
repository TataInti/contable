import { isClientConfigurationComplete } from "@contable/contracts";
import { FISCAL_STEPS, type FiscalStep } from "./utilidades";

/** Lista con datos: basta con que exponga `data` (las consultas de react-query lo cumplen). */
type ConsultaConDatos = { data?: readonly unknown[] };

export function stepCompletionFor({
  latestProfile,
  registrationsQuery,
  clientActivitiesQuery,
  periodsQuery,
  obligationsQuery,
}: {
  // Solo importa si existe un perfil: lo usan Configuración fiscal y el Resumen del cliente.
  latestProfile: unknown;
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

export function fiscalConfigurationReadinessFor({
  hasAccountingProfile,
  latestProfile,
  registrations,
  activities,
  periods,
  obligations,
}: {
  hasAccountingProfile: boolean;
  latestProfile: { version: number; status: string } | undefined;
  registrations: readonly { status: string; profile?: { version: number } }[];
  activities: readonly { validTo: unknown; profile?: { version: number } }[];
  periods: readonly unknown[];
  obligations: readonly { profile?: { version: number } }[];
}) {
  return {
    hasAccountingProfile,
    hasActiveFiscalProfile: latestProfile?.status === "ACTIVE",
    hasActiveRegistration: registrations.some((registration) => registration.status === "ACTIVE" && registration.profile?.version === latestProfile?.version),
    hasActiveActivity: activities.some((activity) => activity.validTo === null && activity.profile?.version === latestProfile?.version),
    hasTaxPeriod: periods.length > 0,
    hasObligation: obligations.some((obligation) => obligation.profile?.version === latestProfile?.version),
  };
}

export function fiscalConfigurationCompleteFor(input: Parameters<typeof fiscalConfigurationReadinessFor>[0]) {
  return isClientConfigurationComplete(fiscalConfigurationReadinessFor(input));
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
