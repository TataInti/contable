import { Button } from "@contable/design-system";
import "./PeriodoSinLegajo.css";

export interface PeriodoSinLegajoProps {
  /** Si el rol puede crear legajos: sin permiso no se ofrece el botón. */
  puedeCrear: boolean;
  creando: boolean;
  onCrear: () => void;
}

/**
 * Período sin legajo (Barra 2e): una frase de guía alineada a la izquierda y la acción primaria.
 * No usa EmptyState: su título centrado es de la pieza compartida, que usan otras pantallas y no
 * entra en este corte; el arreglo queda en el Legajo.
 */
export function PeriodoSinLegajo({ puedeCrear, creando, onCrear }: PeriodoSinLegajoProps) {
  return (
    <div className="periodo-sin-legajo">
      <p className="periodo-sin-legajo__guia">
        Creá el legajo para reunir las fuentes, clasificar y calcular la liquidación del período.
      </p>
      {puedeCrear ? (
        <Button onClick={onCrear} loading={creando}>
          Nuevo legajo
        </Button>
      ) : null}
    </div>
  );
}
