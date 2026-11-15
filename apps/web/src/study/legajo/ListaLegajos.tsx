import type { ReactNode } from "react";
import { Button, EmptyState } from "@contable/design-system";
import type { Workpaper } from "./tipos";

interface ListaLegajosProps {
  cargando: boolean;
  error: boolean;
  sinPeriodo: boolean;
  legajos: Workpaper[];
  puedeCrear: boolean;
  creando: boolean;
  onCrear: () => void;
  renderLegajo: (wp: Workpaper) => ReactNode;
}

/** Lista de legajos del período: carga, error, sin período, sin legajos con Crear legajo, y tarjetas (K8). */
export function ListaLegajos({
  cargando,
  error,
  sinPeriodo,
  legajos,
  puedeCrear,
  creando,
  onCrear,
  renderLegajo,
}: ListaLegajosProps) {
  if (cargando) {
    return (
      <div className="study-page__state" role="status">
        Cargando legajos…
      </div>
    );
  }
  if (error) {
    return (
      <div className="study-page__state" role="alert">
        No se pudieron cargar los legajos. Reintentá en un momento.
      </div>
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
  return <div className="workpaper-list">{legajos.map((wp) => renderLegajo(wp))}</div>;
}
