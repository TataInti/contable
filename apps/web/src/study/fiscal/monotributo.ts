import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { formatearFecha } from "../../lib/formatoFechas";

/** Cuota fija mensual del Monotributo (corte 3F): tipos y ayudas compartidas por Regímenes y el Legajo. */

export const CATEGORIAS_MONOTRIBUTO = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;

export const ACTIVIDADES_MONOTRIBUTO = [
  { value: "SERVICIOS", label: "Servicios" },
  { value: "BIENES", label: "Venta de bienes" },
] as const;

export type EstadoCuotaMonotributo = "NO_APLICA" | "SIN_CATEGORIA" | "SIN_CUOTA" | "PENDIENTE" | "PAGADA";

export interface CategoriaMonotributo {
  id: string;
  validFrom: string;
  category: string;
  activity: string;
}

export interface PagoMonotributo {
  id: string;
  paidAt: string;
  amount: string;
  comprobante: string | null;
}

export interface EstadoMonotributo {
  month: string;
  applies: boolean;
  regimeIds: string[];
  status: EstadoCuotaMonotributo;
  category: CategoriaMonotributo | null;
  fee: string | null;
  feeSource: string | null;
  dueDate: string;
  paid: string;
  pending: string | null;
  payments: PagoMonotributo[];
  history: CategoriaMonotributo[];
  catalog: { category: string; activity: string; amount: string }[];
}

/** Lo que la pestaña Regímenes necesita para mostrar la categoría en la fila del Monotributo. */
export interface FilaCategoriaMonotributo {
  regimeIds: readonly string[];
  categoria: CategoriaMonotributo | null;
  loading: boolean;
  abrir: () => void;
}

const FORMATO_ENTRADA = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Mes actual en UTC como «AAAA-MM» (igual que la API cuando no recibe mes). */
export function mesActualMonotributo(): string {
  const hoy = new Date();
  return `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** «2026-08» → «agosto de 2026». */
export function etiquetaMes(month: string): string {
  const [anio, mes] = month.split("-").map(Number);
  return new Date(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, 1)).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function textoCategoriaMonotributo(categoria: CategoriaMonotributo): string {
  const actividad = ACTIVIDADES_MONOTRIBUTO.find((opcion) => opcion.value === categoria.activity)?.label ?? categoria.activity;
  return `Categoría ${categoria.category} · ${actividad}`;
}

/** Importe escrito por el contador («30.000,50», «30000.5», «30000») → «30000.50», o nulo si no es un importe mayor que cero. */
export function importeDeEntrada(texto: string): string | null {
  let limpio = texto.trim().replace(/\s/g, "").replace(/\$/g, "");
  if (limpio.includes(",")) {
    limpio = limpio.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
    limpio = limpio.replace(/\./g, "");
  }
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(limpio)) return null;
  const numero = Number(limpio);
  if (!(numero > 0)) return null;
  const [entero, decimales = ""] = limpio.split(".");
  return decimales ? `${entero}.${decimales.padEnd(2, "0")}` : `${entero}.00`;
}

/** «34530.58» → «34.530,58» para mostrar en el campo. */
export function importeParaEntrada(valor: string): string {
  return FORMATO_ENTRADA.format(Number(valor));
}

export function fechaCuotaMonotributo(iso: string): string {
  return formatearFecha(iso);
}

export function claveMonotributo(firmId: string | null | undefined, clientId: string | null | undefined, month: string) {
  return ["monotributo", firmId, clientId, month] as const;
}

/** Cuota del mes: consulta y las dos escrituras (categoría, pago). Ambas refrescan la cuota de todos los meses del cliente. */
export function useMonotributoMes(firmId: string | null | undefined, clientId: string | null | undefined, month: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: claveMonotributo(firmId, clientId, month),
    queryFn: () => api.get<EstadoMonotributo>(`/firms/${firmId}/clients/${clientId}/monotributo?month=${month}`),
    enabled: Boolean(firmId && clientId && month),
  });
  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ["monotributo", firmId, clientId] });
  };
  const guardarCategoria = useMutation({
    mutationFn: (entrada: { month: string; category: string; activity: string }) =>
      api.put<EstadoMonotributo>(`/firms/${firmId}/clients/${clientId}/monotributo-categories/${entrada.month}`, {
        category: entrada.category,
        activity: entrada.activity,
      }),
    onSuccess: refrescar,
  });
  const registrarPago = useMutation({
    mutationFn: (entrada: { month: string; paidAt: string; amount: string; comprobante?: string }) =>
      api.post<EstadoMonotributo>(`/firms/${firmId}/clients/${clientId}/monotributo/payments`, entrada),
    onSuccess: refrescar,
  });
  return { query, guardarCategoria, registrarPago };
}
