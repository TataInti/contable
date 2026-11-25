export type ClientConfigurationReadiness = {
  hasAccountingProfile: boolean;
  hasActiveFiscalProfile: boolean;
  hasActiveRegistration: boolean;
  hasActiveActivity: boolean;
  hasTaxPeriod: boolean;
  hasObligation: boolean;
};

export type ClientConfigurationMissing = {
  key: "ficha" | "perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones";
  label: string;
  step: "ficha" | "perfil" | "inscripcion" | "actividades" | "periodos" | "obligaciones";
};

export function clientConfigurationMissing(readiness: ClientConfigurationReadiness): ClientConfigurationMissing[] {
  const missing: ClientConfigurationMissing[] = [];
  if (!readiness.hasAccountingProfile) missing.push({ key: "ficha", label: "ficha contable", step: "ficha" });
  if (!readiness.hasActiveFiscalProfile) missing.push({ key: "perfil", label: "perfil fiscal activo", step: "perfil" });
  if (!readiness.hasActiveRegistration) missing.push({ key: "inscripcion", label: "inscripción fiscal", step: "inscripcion" });
  if (!readiness.hasActiveActivity) missing.push({ key: "actividades", label: "actividad fiscal", step: "actividades" });
  if (!readiness.hasTaxPeriod) missing.push({ key: "periodos", label: "período fiscal", step: "periodos" });
  if (!readiness.hasObligation) missing.push({ key: "obligaciones", label: "obligación", step: "obligaciones" });
  return missing;
}

export function isClientConfigurationComplete(readiness: ClientConfigurationReadiness): boolean {
  return clientConfigurationMissing(readiness).length === 0;
}
