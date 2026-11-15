import type { Client } from "../../lib/api";

export interface ClientProfile {
  functionalCurrency: string;
  accountingStandard: string | null;
  fiscalYearEndMonth: number;
  vatCondition: string | null;
  iibbJurisdictions: string[];
  province: string | null;
  activity: string | null;
  legalForm: string | null;
  serviceStartDate: string | null;
}

/** Entrada del catálogo de normas contables definido por el estudio. */
export interface AccountingStandardCatalogEntry {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ClientWithProfile extends Client {
  /** Terminación de CUIT derivada por la API; null cuando el cliente no tiene CUIT. */
  cuitEnding?: string | null;
  tradeName?: string | null;
  profile?: ClientProfile | null;
}

export interface ClientContactForm {
  name: string;
  function: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

export interface ContactRetryTarget {
  firmId: string;
  clientId: string;
  legalName: string;
  email: string;
}

export interface ClientProfileForm {
  functionalCurrency: string;
  accountingStandard: string;
  fiscalYearEndMonth: string;
  vatCondition: string;
  /** Códigos canónicos seleccionados del catálogo. null = derivar de lo guardado + catálogo. */
  iibbJurisdictions: string[] | null;
  province: string;
  activity: string;
  legalForm: string;
  serviceStartDate: string;
}

export function profileFormFrom(client: ClientWithProfile): ClientProfileForm {
  const profile = client.profile;
  return {
    functionalCurrency: profile?.functionalCurrency ?? "ARS",
    accountingStandard: profile?.accountingStandard ?? "",
    fiscalYearEndMonth: String(profile?.fiscalYearEndMonth ?? 12),
    vatCondition: profile?.vatCondition ?? "",
    iibbJurisdictions: null,
    province: profile?.province ?? "",
    activity: profile?.activity ?? "",
    legalForm: profile?.legalForm ?? "",
    serviceStartDate: profile?.serviceStartDate?.slice(0, 10) ?? "",
  };
}
