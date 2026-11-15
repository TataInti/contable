import type { ReactNode } from "react";
import { AsyncState, Button, EmptyState } from "@contable/design-system";
import type { Workpaper } from "./tipos";

interface ListaLegajosProps {
  cargando: boolean;
  error: boolean;
  onReintentar: () => void;
  /** La consulta respondió bien: solo entonces «sin legajos» es un vacío confirmado (C07). */
  exito: boolean;
  sinPeriodo: boolean;
  legajos: Workpaper[];
  puedeCrear: boolean;
  creando: boolean;
  onCrear: () => void;
  renderLegajo: (wp: Workpaper, indice: number) => ReactNode;
}

/** Lista de legajos del período: carga anunciada, error con Reintentar, vacío confirmado y tarjetas (K8, C07). */
export function ListaLegajos({
  cargando,
  error,
  onReintentar,
  exito,
  sinPeriodo,
  legajos,
  puedeCrear,
  creando,
  onCrear,
  renderLegajo,
}: ListaLegajosProps) {
  if (cargando || error) {
    return (
      <AsyncState
        loading={cargando}
        error={error}
        loadingLabel="Cargando legajos…"
        errorTitle="No se pudieron cargar los legajos"
        errorDescription="Reintentá en un momento."
        onRetry={onReintentar}
      />
    );
  }
  if (sinPeriodo) {
    return (
      <EmptyState
        title="Elegí un período fiscal"
        description="Seleccioná un período fiscal para consultar o crear el legajo del mes."
      />
    );
  }
  if (legajos.length === 0) {
    if (!exito) return null;
    return (
      <EmptyState
        title="Sin legajos para este período"
        description="Creá un legajo para coordinar las liquidaciones del período."
        action={
          puedeCrear ? (
            <Button onClick={onCrear} loading={creando}>
              Crear legajo
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="workpaper-list">{legajos.map((wp, indice) => renderLegajo(wp, indice))}</div>
  );
}
