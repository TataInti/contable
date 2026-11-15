import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  scopeQuery,
  type CalendarDetail,
  type CalendarListItem,
  type ValidationReport,
} from "./calendariosFiscales";

/**
 * Consultas de la pantalla «Calendarios fiscales». Cada fuente tiene su propia
 * consulta, con su estado de carga, error y reintento. Todas viven bajo la clave
 * ["tax-calendars", firmId], que invalida cada escritura.
 */

export interface AuthorityOption {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
}

export interface JurisdictionOption {
  id: string;
  code: string;
  name: string;
}

export interface TaxTypeOption {
  id: string;
  code: string;
  name: string;
}

export interface RegimeOption {
  id: string;
  code: string;
  name: string;
  taxType: { id: string; name: string };
}

export interface FirmMemberRow {
  userId: string;
  user?: { name: string; emailNormalized: string } | null;
}

export function useCalendarCatalogs(firmId: string | null, enabled: boolean) {
  const authorities = useQuery({
    queryKey: ["tax-authorities", firmId, "calendarios"],
    queryFn: () => api.get<AuthorityOption[]>("/tax/authorities"),
    enabled: Boolean(firmId && enabled),
  });
  const jurisdictions = useQuery({
    queryKey: ["tax-jurisdictions", firmId, "calendarios"],
    queryFn: () => api.get<JurisdictionOption[]>("/tax/jurisdictions"),
    enabled: Boolean(firmId && enabled),
  });
  return { authorities, jurisdictions };
}

export function useTaxTypesAndRegimes(firmId: string | null, enabled: boolean) {
  const taxTypes = useQuery({
    queryKey: ["tax-types", firmId, "calendarios"],
    queryFn: () => api.get<TaxTypeOption[]>("/tax/types"),
    enabled: Boolean(firmId && enabled),
  });
  const regimes = useQuery({
    queryKey: ["tax-regimes", firmId, "calendarios"],
    queryFn: () => api.get<RegimeOption[]>("/tax/regimes"),
    enabled: Boolean(firmId && enabled),
  });
  return { taxTypes, regimes };
}

/** Lista de calendarios del estudio para un alcance (año, organismo, jurisdicción). */
export function useCalendarList(
  firmId: string | null,
  scope: { year: number | null; taxAuthorityId: string | null; jurisdictionId: string | null },
  enabled: boolean,
) {
  const query = scopeQuery(scope);
  return useQuery({
    queryKey: ["tax-calendars", firmId, "list", query],
    queryFn: () => api.get<CalendarListItem[]>(`/firms/${firmId}/tax-calendars${query ? `?${query}` : ""}`),
    enabled: Boolean(firmId && enabled),
  });
}

export function useCalendarDetail(firmId: string | null, calendarId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["tax-calendars", firmId, "detail", calendarId],
    queryFn: () => api.get<CalendarDetail>(`/firms/${firmId}/tax-calendars/${calendarId}`),
    enabled: Boolean(firmId && calendarId && enabled),
  });
}

export function useCalendarValidation(firmId: string | null, calendarId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["tax-calendars", firmId, "validation", calendarId],
    queryFn: () => api.get<ValidationReport>(`/firms/${firmId}/tax-calendars/${calendarId}/validation`),
    enabled: Boolean(firmId && calendarId && enabled),
  });
}

/**
 * Nombres de los integrantes, para «quién publicó u ocultó». La API los lista
 * solo a quien tiene firm.users.manage; sin esa capacidad no se consulta.
 */
export function useMemberNames(firmId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["firm-members", firmId],
    queryFn: () => api.get<FirmMemberRow[]>(`/firms/${firmId}/members`),
    enabled: Boolean(firmId && enabled),
    select: (rows) =>
      new Map(
        rows.map((row) => [row.userId, row.user?.name || row.user?.emailNormalized || "Integrante del estudio"] as const),
      ),
  });
}
