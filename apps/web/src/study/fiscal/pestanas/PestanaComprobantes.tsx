import { useEffect, useState } from "react";
import { Button } from "@contable/design-system";
import { CLASE_TEXTO_ORDEN, type ClaseComprobante, useComprobantesPermitidos } from "../comprobantesPermitidos";
import { MutationError } from "../MutationError";

interface Props {
  firmId: string;
  clientId: string;
  canWrite: boolean;
}

/** Pestaña «Comprobantes» de la configuración fiscal: qué tipos puede emitir el cliente, por año (corte 4B). */
export function PestanaComprobantes({ firmId, clientId, canWrite }: Props) {
  const year = new Date().getUTCFullYear();
  const { query, guardar } = useComprobantesPermitidos(firmId, clientId, year);
  const estado = query.data;
  const [clases, setClases] = useState<ClaseComprobante[]>([]);
  const [exentos, setExentos] = useState(false);

  useEffect(() => {
    if (!estado) return;
    setClases(estado.allowedClasses);
    setExentos(estado.exemptAllowed);
  }, [estado]);

  if (query.isLoading) return <p className="muted-copy">Cargando los comprobantes que puede emitir el cliente…</p>;
  if (query.isError || !estado) return <p className="muted-copy">No se pudo leer la configuración de comprobantes. Reintentá.</p>;

  const ofrecidas = CLASE_TEXTO_ORDEN.filter((clase) => estado.offered.includes(clase));
  const cambio =
    exentos !== estado.exemptAllowed ||
    clases.length !== estado.allowedClasses.length ||
    clases.some((clase) => !estado.allowedClasses.includes(clase));

  return (
    <section className="fiscal-comprobantes" aria-label="Comprobantes que puede emitir el cliente">
      <h3>Comprobantes que puede emitir el cliente ({year})</h3>
      <p className="muted-copy">
        {estado.origen === "PROPUESTA"
          ? `Propuesta según la condición frente al IVA: guardá para fijarla. Los comprobantes de venta que no correspondan quedan para revisar en el legajo.`
          : `Guardado por el estudio. Los comprobantes de venta que no correspondan quedan para revisar en el legajo.`}
      </p>
      <fieldset disabled={!canWrite}>
        <legend>Tipos de comprobante</legend>
        {ofrecidas.map((clase) => (
          <label key={clase} className="fiscal-comprobantes__opcion">
            <input
              type="checkbox"
              checked={clases.includes(clase)}
              onChange={(event) =>
                setClases((actuales) =>
                  event.target.checked ? [...actuales, clase] : actuales.filter((item) => item !== clase),
                )
              }
            />
            {estado.labels[clase]}
          </label>
        ))}
        <label className="fiscal-comprobantes__opcion">
          <input type="checkbox" checked={exentos} onChange={(event) => setExentos(event.target.checked)} />
          Puede emitir comprobantes exentos
        </label>
      </fieldset>
      {!canWrite ? <small className="muted-copy">Tu perfil puede leer esta configuración pero no cambiarla.</small> : null}
      <div className="fiscal-comprobantes__acciones">
        <Button
          variant="primary"
          disabled={!canWrite || !cambio}
          loading={guardar.isPending}
          onClick={() => guardar.mutate({ allowedClasses: clases, exemptAllowed: exentos })}
        >
          Guardar comprobantes
        </Button>
        {!cambio && canWrite ? <small className="muted-copy">No hay cambios para guardar.</small> : null}
      </div>
      <MutationError error={guardar.error} />
    </section>
  );
}
