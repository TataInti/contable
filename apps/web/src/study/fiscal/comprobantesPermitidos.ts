import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

/**
 * Tipos de comprobante que el cliente puede emitir, por año (corte 4B). La API es dueña del catálogo;
 * las etiquetas de los grupos del control se espejan de `apps/api/src/tax/voucher-profile.ts`.
 */

export type ClaseComprobante =
  | "FACTURA_A" | "FACTURA_B" | "FACTURA_C" | "FACTURA_E"
  | "NOTAS_A" | "NOTAS_B" | "NOTAS_C" | "NOTAS_E";

export interface PermitidosComprobantes {
  year: number;
  condicion: string | null;
  origen: "GUARDADO" | "PROPUESTA";
  allowedClasses: ClaseComprobante[];
  exemptAllowed: boolean;
  offered: ClaseComprobante[];
  labels: Record<ClaseComprobante, string>;
  propuesta: { clases: ClaseComprobante[]; exentos: boolean };
  savedAt: string | null;
}

/** Etiquetas de los grupos del control «no corresponde al perfil» (espejo de la API). */
export const GRUPO_LABELS: Record<string, string> = {
  FACTURA_A: "Facturas A",
  FACTURA_B: "Facturas B",
  FACTURA_C: "Facturas C",
  FACTURA_E: "Facturas E",
  NOTAS_A: "Notas de crédito y débito A",
  NOTAS_B: "Notas de crédito y débito B",
  NOTAS_C: "Notas de crédito y débito C",
  NOTAS_E: "Notas de crédito y débito E",
  EXENTO: "Comprobantes exentos",
  TIPO_NO_RECONOCIDO: "Tipo no reconocido",
};

export const PREFIJO_CONTROL_PERFIL = "PERFIL_COMPROBANTE:";

/** Orden de las clases en la pantalla (el mismo del catálogo de la API). */
export const CLASE_TEXTO_ORDEN: ClaseComprobante[] = [
  "FACTURA_A", "FACTURA_B", "FACTURA_C", "FACTURA_E", "NOTAS_A", "NOTAS_B", "NOTAS_C", "NOTAS_E",
];

export function claveComprobantesPermitidos(firmId: string | null | undefined, clientId: string | null | undefined, year: number) {
  return ["voucher-permissions", firmId, clientId, year] as const;
}

/** Lectura y guardado de las tildes del año (la API reabre los expedientes del año al guardar). */
export function useComprobantesPermitidos(firmId: string | null | undefined, clientId: string | null | undefined, year: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: claveComprobantesPermitidos(firmId, clientId, year),
    queryFn: () => api.get<PermitidosComprobantes>(`/firms/${firmId}/clients/${clientId}/voucher-permissions?year=${year}`),
    enabled: Boolean(firmId && clientId),
  });
  const guardar = useMutation({
    mutationFn: (input: { allowedClasses: ClaseComprobante[]; exemptAllowed: boolean }) =>
      api.put<PermitidosComprobantes>(`/firms/${firmId}/clients/${clientId}/voucher-permissions/${year}`, input),
    onSuccess: (estado) => {
      queryClient.setQueryData(claveComprobantesPermitidos(firmId, clientId, year), estado);
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpaper-coverage", firmId, clientId] });
    },
  });
  return { query, guardar };
}
