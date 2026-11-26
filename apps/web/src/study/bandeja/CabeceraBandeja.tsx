import type { ReactNode } from "react";
import { Button } from "@contable/design-system";
import { DenseHeader, StatStrip } from "../../ui/Dense";
import type { DocumentQueueFilter } from "./colaDeDocumentos";

export interface VistaBandeja {
  id: DocumentQueueFilter;
  label: string;
  /** Cifra de la cola; «…» mientras carga y «no disponible» si la consulta falla. */
  value: ReactNode;
}

interface CabeceraBandejaProps {
  vistas: ReadonlyArray<VistaBandeja>;
  vistaActiva: DocumentQueueFilter;
  /** Con cliente elegido, cada vista es un botón que filtra la lista. */
  vistasSeleccionables: boolean;
  onElegirVista: (vista: DocumentQueueFilter) => void;
  pendientes: { value: ReactNode; warn: boolean };
  puedeSubir: boolean;
  cargaAbierta: boolean;
  onAlternarCarga: () => void;
  actualizando: boolean;
  onActualizar: () => void;
}

/** Cabecera de la Bandeja: título, «Actualizar», «Subir documento» (secundaria) y los indicadores de cola. */
export function CabeceraBandeja({
  vistas,
  vistaActiva,
  vistasSeleccionables,
  onElegirVista,
  pendientes,
  puedeSubir,
  cargaAbierta,
  onAlternarCarga,
  actualizando,
  onActualizar,
}: CabeceraBandejaProps) {
  return (
    <>
      <DenseHeader
        title="Bandeja documental"
        description="Cargá comprobantes, validá los datos extraídos y prepará el asiento sin perder la evidencia."
        actions={
          <>
            <Button variant="ghost" aria-busy={actualizando || undefined} onClick={onActualizar}>
              {actualizando ? "Actualizando…" : "Actualizar"}
            </Button>
            {puedeSubir ? (
              <Button variant="secondary" onClick={onAlternarCarga}>
                {cargaAbierta ? "Cerrar carga" : "Subir documento"}
              </Button>
            ) : null}
          </>
        }
      />
      <StatStrip
        label="Vistas de la bandeja"
        items={[
          // Las vistas vacías (salvo «Todos» y la activa) no ocupan lugar: quedan las que tienen algo para hacer.
          ...vistas
            .filter((vista) => vista.id === "ALL" || vista.id === vistaActiva || vista.value !== 0)
            .map((vista) => ({
            key: vista.id,
            label: vista.label,
            value: vista.value,
            active: vistasSeleccionables && vista.id === vistaActiva,
            pressed: vistasSeleccionables ? vista.id === vistaActiva : undefined,
            onSelect: vistasSeleccionables ? () => onElegirVista(vista.id) : undefined,
          })),
          {
            key: "pendientes",
            label: "Pedidos por completar",
            value: pendientes.value,
            tone: pendientes.warn ? ("warn" as const) : undefined,
          },
        ]}
      />
    </>
  );
}
