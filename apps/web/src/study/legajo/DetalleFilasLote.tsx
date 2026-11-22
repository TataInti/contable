import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@contable/design-system";
import { useClientContext } from "../../context/ClientContext";
import { api } from "../../lib/api";
import { motivoDeFila } from "./motivosFila";

interface FilaDeLote {
  id: string;
  position: number;
  status: string;
  errors: string[];
  raw: Record<string, unknown> | null;
}

/** Tipo y número del comprobante, si el libro los trae, para ubicar la fila en el archivo. */
function comprobanteDe(raw: Record<string, unknown> | null): string {
  if (!raw) return "";
  const partes = [raw["Tipo"], raw["Número Desde"]]
    .filter((valor) => valor !== undefined && valor !== null && String(valor).trim() !== "")
    .map(String);
  return partes.length > 0 ? ` · ${partes.join(" ")}` : "";
}

/** Filas observadas de cualquier fuente, con contenido y motivo (GET …/import-batches/:id/rows). */
export function DetalleFilasLote({
  firmId,
  clientId,
  batchId,
}: {
  firmId: string;
  clientId: string;
  batchId: string;
}) {
  const filas = useQuery({
    queryKey: ["import-batch-rows", firmId, clientId, batchId],
    queryFn: () =>
      api.get<FilaDeLote[]>(`/firms/${firmId}/clients/${clientId}/import-batches/${batchId}/rows`),
  });

  if (filas.isPending) return <p className="muted-copy">Cargando las filas con error…</p>;
  if (filas.isError) {
    return (
      <div role="alert">
        <p className="form-error">No se pudo leer el detalle de las filas.</p>
        <Button size="sm" variant="ghost" onClick={() => void filas.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }
  const conError = (filas.data ?? []).filter((fila) => fila.status === "ERROR");
  if (conError.length === 0) return null;
  return (
    <section aria-label="Filas con error">
      <h4>Filas con error</h4>
      <ul>
        {conError.map((fila) => (
          <li key={fila.id}>
            <strong>Fila {fila.position + 1}</strong>
            {comprobanteDe(fila.raw)}: {fila.errors.map(motivoDeFila).join(" ")}
            {fila.raw ? <pre>{JSON.stringify(fila.raw)}</pre> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Ver filas con error» de un lote de libro IVA con errores: el detalle se pide solo al abrirlo.
 * `batchId` es el lote importado (`importBatchId` de la cobertura), no el id del vínculo con el legajo.
 */
export function FilasConErrorDeLote({ batchId }: { batchId: string }) {
  const { firmId, clientId } = useClientContext();
  const [abierto, setAbierto] = useState(false);
  const detalleRef = useRef<HTMLDivElement>(null);
  // Al abrir, el botón se desmonta: el foco pasa al detalle y no cae en <body>.
  useEffect(() => {
    if (abierto) detalleRef.current?.focus({ preventScroll: true });
  }, [abierto]);
  if (!abierto) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAbierto(true)}>
        Ver filas con error
      </Button>
    );
  }
  if (!firmId || !clientId) return null;
  return (
    <div ref={detalleRef} role="group" aria-label="Detalle de filas con error" tabIndex={-1}>
      <DetalleFilasLote firmId={firmId} clientId={clientId} batchId={batchId} />
    </div>
  );
}
