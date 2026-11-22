import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import "./categoriaTem.css";

/** Categoría anual del TEM del cliente (corte 1E): la elige el contador una vez por año y fija el mínimo mensual. */
export interface CategoriaTemOpcion {
  category: string;
  label: string;
  /** Mínimo mensual del año, con dos decimales («10028.00»). */
  minimum: string;
}

export interface CategoriaTemEstado {
  year: number;
  category: string | null;
  label: string | null;
  minimum: string | null;
  options: CategoriaTemOpcion[];
  /** Regímenes con inscripción vigente que toman su mínimo de esta categoría (por id). */
  regimeIds: string[];
}

const FORMATO_IMPORTE = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «10028.00» → «$ 10.028». */
export function importeEnPesos(valor: string): string {
  return `$ ${FORMATO_IMPORTE.format(Number(valor))}`;
}

/** Texto único del faltante (mismo que usa la API en la cobertura y en el bloqueo del cálculo). */
export function textoFaltaCategoriaTem(anio: number): string {
  return `Falta la categoría TEM ${anio}`;
}

export function textoCategoriaTem(anio: number, etiqueta: string): string {
  return `Categoría ${anio}: ${etiqueta}`;
}

export function claveCategoriaTem(firmId: string | null | undefined, clientId: string | null | undefined, anio: number) {
  return ["tem-category", firmId, clientId, anio] as const;
}

/** Lo que la pestaña Regímenes necesita para mostrar la categoría en la fila del TEM. */
export interface FilaCategoriaTem {
  year: number;
  regimeIds: readonly string[];
  category: string | null;
  label: string | null;
  loading: boolean;
  abrir: () => void;
}

/** Consulta, cajón y guardado de la categoría TEM del año en curso. */
export function useCategoriaTem(firmId: string | null | undefined, clientId: string | null | undefined) {
  const queryClient = useQueryClient();
  const year = new Date().getUTCFullYear();
  const [abierto, setAbierto] = useState(false);
  const query = useQuery({
    queryKey: claveCategoriaTem(firmId, clientId, year),
    queryFn: () => api.get<CategoriaTemEstado>(`/firms/${firmId}/clients/${clientId}/tem-categories?year=${year}`),
    enabled: Boolean(firmId && clientId),
  });
  const guardar = useMutation({
    mutationFn: (category: string) =>
      api.put<CategoriaTemEstado>(`/firms/${firmId}/clients/${clientId}/tem-categories/${year}`, { category }),
    onSuccess: (estado) => {
      queryClient.setQueryData(claveCategoriaTem(firmId, clientId, year), estado);
      setAbierto(false);
    },
  });
  const fila: FilaCategoriaTem = {
    year,
    regimeIds: query.data?.regimeIds ?? [],
    category: query.data?.category ?? null,
    label: query.data?.label ?? null,
    loading: query.isLoading,
    abrir: () => {
      guardar.reset();
      setAbierto(true);
    },
  };
  return { year, query, guardar, abierto, cerrar: () => setAbierto(false), fila };
}
