import { useRef } from "react";
import { AsyncState, Button, EmptyState } from "@contable/design-system";
import type { Document } from "../../lib/api";
import { formatearFechaHora } from "../../lib/formatoFechas";
import { StatusBadge } from "../../ui/StatusBadge";
import {
  DenseFooter,
  DenseSearch,
  DenseTable,
  DenseToolbar,
  useDenseShortcuts,
  type DenseColumn,
} from "../../ui/Dense";
import { nombreVisibleDelEstado } from "./colaDeDocumentos";
import { documentFileName, documentTypeLabel } from "./utilidades";

interface ListaDocumentosProps {
  /** Todos los documentos de la consulta: distinguen «Bandeja vacía» de «sin coincidencias». */
  todos: ReadonlyArray<Document>;
  /** Los que se muestran: filtrados por vista y búsqueda, más recientes primero. */
  visibles: ReadonlyArray<Document>;
  cargando: boolean;
  error: boolean;
  onReintentar: () => void;
  busqueda: string;
  onBuscar: (texto: string) => void;
  filtrada: boolean;
  seleccionadoId: string | null;
  onSeleccionar: (id: string) => void;
  puedeSubir: boolean;
  onSubir: () => void;
  onQuitarFiltros: () => void;
}

const COLUMNAS: ReadonlyArray<DenseColumn<Document>> = [
  {
    key: "documento",
    header: "Documento",
    render: (row) => (
      <span className="bandeja-documento">
        <strong>{documentFileName(row)}</strong>
        <small>{`${documentTypeLabel(row)} · ${formatearFechaHora(row.createdAt)}`}</small>
      </span>
    ),
  },
  {
    key: "estado",
    header: "Estado",
    render: (row) => <StatusBadge status={row.status} label={nombreVisibleDelEstado(row.status)} />,
  },
];

/** Búsqueda y lista de la Bandeja: DenseTable con selección por fila, pie con el conteo y los estados de carga, error y vacío. */
export function ListaDocumentos({
  todos,
  visibles,
  cargando,
  error,
  onReintentar,
  busqueda,
  onBuscar,
  filtrada,
  seleccionadoId,
  onSeleccionar,
  puedeSubir,
  onSubir,
  onQuitarFiltros,
}: ListaDocumentosProps) {
  const busquedaRef = useRef<HTMLInputElement>(null);
  useDenseShortcuts({ searchRef: busquedaRef });
  const total = todos.length;

  return (
    <section className="bandeja-lista" aria-label="Documentos">
      <DenseToolbar>
        <DenseSearch
          value={busqueda}
          onChange={onBuscar}
          placeholder="Nombre, tipo, estado o fecha…"
          label="Buscar"
          inputRef={busquedaRef}
        />
      </DenseToolbar>
      {cargando || error ? (
        <AsyncState
          loading={cargando}
          error={error}
          loadingLabel="Cargando documentos…"
          errorTitle="No se pudo cargar la bandeja"
          errorDescription="Volvé a intentarlo."
          onRetry={onReintentar}
        />
      ) : total === 0 ? (
        <EmptyState
          size="compact"
          title="Bandeja vacía"
          description="Subí un archivo para iniciar el flujo."
          action={
            puedeSubir ? (
              <Button size="sm" onClick={onSubir}>
                Subir documento
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DenseTable<Document>
          label="Documentos"
          surface="integrated"
          columns={COLUMNAS}
          rows={visibles}
          rowKey={(row) => row.id}
          selectedKey={seleccionadoId}
          onSelect={(id) => {
            if (id) onSeleccionar(id);
          }}
          empty={
            <EmptyState
              size="compact"
              kind="no-results"
              title="No hay documentos en esta vista"
              description="Probá con otra vista o ajustá la búsqueda."
              action={
                <Button size="sm" variant="secondary" onClick={onQuitarFiltros}>
                  Quitar filtros
                </Button>
              }
            />
          }
          footer={
            <DenseFooter
              count={filtrada ? `${visibles.length} de ${total}` : total}
              noun={total === 1 ? "documento" : "documentos"}
              hint={visibles.length > 0 ? "Más recientes primero" : undefined}
              newShortcut={false}
            />
          }
        />
      )}
    </section>
  );
}
