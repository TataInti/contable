export type ClientConfigurationReadiness = {
  hasAccountingProfile: boolean;
  hasActiveFiscalProfile: boolean;
  hasActiveRegistration: boolean;
  hasActiveActivity: boolean;
  hasTaxPeriod: boolean;
  hasObligation: boolean;
};

export function isClientConfigurationComplete(readiness: ClientConfigurationReadiness): boolean {
  return (
    readiness.hasAccountingProfile &&
    readiness.hasActiveFiscalProfile &&
    readiness.hasActiveRegistration &&
    readiness.hasActiveActivity &&
    readiness.hasTaxPeriod &&
    readiness.hasObligation
  );
}
