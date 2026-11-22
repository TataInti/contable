import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Notice } from "@contable/design-system";
import { api, ApiError, type Document } from "../../lib/api";
import { etiquetaCuitEstado, planDeBloqueCuit, validarMotivoCuit } from "./cuitControlTexto";

interface ControlCuitProps {
  firmId: string;
  clientId: string;
  puedeRevisar: boolean;
}

function mensajeDeError(error: unknown): string {
  return error instanceof ApiError ? error.message : "Volvé a intentarlo.";
}

function useRefrescarBandeja({ firmId, clientId }: Pick<ControlCuitProps, "firmId" | "clientId">) {
  const queryClient = useQueryClient();
  return (documentoId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
      ...(documentoId
        ? [
            queryClient.invalidateQueries({ queryKey: ["document", firmId, clientId, documentoId] }),
            queryClient.invalidateQueries({ queryKey: ["extraction", firmId, clientId, documentoId] }),
          ]
        : []),
    ]);
}

/**
 * Panel del detalle de un comprobante con el CUIT pendiente: qué pasa, y las acciones
 * «Mover a <cliente>» y «Aceptar con motivo» (P1: el bloqueo dice qué falta y ofrece cómo resolverlo).
 */
export function ControlCuitPanel({
  documento,
  firmId,
  clientId,
  puedeRevisar,
  onMovido,
}: ControlCuitProps & { documento: Document; onMovido: () => void }) {
  const control = documento.cuitControl;
  const refrescar = useRefrescarBandeja({ firmId, clientId });
  const base = `/firms/${firmId}/clients/${clientId}`;
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!control || (control.estado === "CORRECTO" && !control.aceptado)) return null;

  if (!control.pendiente) {
    return (
      <p className="form-submit-hint" role="note">
        CUIT aceptado con motivo{control.motivo ? `: ${control.motivo}` : "."}
      </p>
    );
  }

  const mover = async (destinoId: string, nombre: string) => {
    setOcupado(true);
    setError(null);
    try {
      await api.post(`${base}/documents/${documento.id}/cuit/move`, { clientId: destinoId });
      await refrescar(documento.id);
      onMovido();
    } catch (err) {
      setError(`No se pudo mover a ${nombre}. ${mensajeDeError(err)}`);
    } finally {
      setOcupado(false);
    }
  };

  const aceptar = async () => {
    const problema = validarMotivoCuit(motivo);
    setErrorMotivo(problema);
    if (problema) return;
    setOcupado(true);
    setError(null);
    try {
      await api.post(`${base}/documents/${documento.id}/cuit/accept`, { reason: motivo.trim() });
      setMotivo("");
      await refrescar(documento.id);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="review-actions cuit-control" aria-label="Control de CUIT">
      <Notice tone="warning" title={etiquetaCuitEstado(control.estado)}>
        {control.mensaje}
      </Notice>
      {puedeRevisar ? (
        <>
          {control.sugerido ? (
            <div className="review-actions__buttons">
              <Button
                disabled={ocupado}
                onClick={() => void mover(control.sugerido!.clientId, control.sugerido!.legalName)}
              >
                {`Mover a ${control.sugerido.legalName}`}
              </Button>
            </div>
          ) : null}
          <form
            className="cuit-control__motivo"
            onSubmit={(event) => {
              event.preventDefault();
              void aceptar();
            }}
          >
            <label htmlFor={`cuit-motivo-${documento.id}`}>Motivo para aceptar el CUIT</label>
            <input
              id={`cuit-motivo-${documento.id}`}
              value={motivo}
              onChange={(event) => {
                setMotivo(event.target.value);
                setErrorMotivo(null);
              }}
              placeholder="Por ejemplo: comprobante a nombre de un socio"
              aria-invalid={errorMotivo ? true : undefined}
            />
            {errorMotivo ? (
              <p className="form-error" role="alert">
                {errorMotivo}
              </p>
            ) : null}
            <Button type="submit" variant="secondary" disabled={ocupado}>
              Aceptar con motivo
            </Button>
          </form>
        </>
      ) : (
        <p className="form-submit-hint" role="note">
          Para resolverlo hace falta el permiso de revisión. Pedíselo a quien administra el estudio.
        </p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Acciones en bloque sobre los comprobantes visibles con CUIT pendiente. Mover en bloque solo si
 * todos sugieren el mismo cliente. Cada documento se resuelve con su propia llamada (auditoría por
 * documento); si alguno falla, se avisa cuántos quedaron para revisar uno por uno.
 */
export function ControlCuitBloque({
  documentos,
  firmId,
  clientId,
  puedeRevisar,
}: ControlCuitProps & { documentos: ReadonlyArray<Document> }) {
  const refrescar = useRefrescarBandeja({ firmId, clientId });
  const plan = planDeBloqueCuit(documentos);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!puedeRevisar || plan.pendientes.length === 0) return null;
  const base = `/firms/${firmId}/clients/${clientId}`;
  const cantidad = plan.pendientes.length;

  const ejecutar = async (accion: (documento: Document) => Promise<unknown>, exito: string) => {
    setOcupado(true);
    setAviso(null);
    let fallidos = 0;
    for (const documento of plan.pendientes) {
      try {
        await accion(documento);
      } catch {
        fallidos += 1;
      }
    }
    await refrescar();
    setOcupado(false);
    setAviso(
      fallidos === 0
        ? exito
        : `${cantidad - fallidos} de ${cantidad} resueltos. ${fallidos} no se pudieron resolver: revisalos uno por uno.`,
    );
  };

  return (
    <section className="cuit-control-bloque" aria-label="Acciones en bloque para el CUIT">
      <p>
        {cantidad === 1 ? "Hay 1 comprobante" : `Hay ${cantidad} comprobantes`} con el CUIT pendiente.
      </p>
      <div className="review-actions__buttons">
        {plan.destino ? (
          <Button
            disabled={ocupado}
            onClick={() =>
              void ejecutar(
                (documento) =>
                  api.post(`${base}/documents/${documento.id}/cuit/move`, { clientId: plan.destino!.clientId }),
                `Se movieron ${cantidad} comprobantes a ${plan.destino!.legalName}.`,
              )
            }
          >
            {`Mover los ${cantidad} a ${plan.destino.legalName}`}
          </Button>
        ) : null}
      </div>
      <form
        className="cuit-control__motivo"
        onSubmit={(event) => {
          event.preventDefault();
          const problema = validarMotivoCuit(motivo);
          setErrorMotivo(problema);
          if (problema) return;
          void ejecutar(
            (documento) => api.post(`${base}/documents/${documento.id}/cuit/accept`, { reason: motivo.trim() }),
            `Se aceptaron ${cantidad} comprobantes con motivo.`,
          );
          setMotivo("");
        }}
      >
        <label htmlFor="cuit-motivo-bloque">Motivo para aceptarlos</label>
        <input
          id="cuit-motivo-bloque"
          value={motivo}
          onChange={(event) => {
            setMotivo(event.target.value);
            setErrorMotivo(null);
          }}
        />
        {errorMotivo ? (
          <p className="form-error" role="alert">
            {errorMotivo}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" disabled={ocupado}>
          {`Aceptar los ${cantidad} con motivo`}
        </Button>
      </form>
      {aviso ? (
        <p className="form-submit-hint" role="status">
          {aviso}
        </p>
      ) : null}
    </section>
  );
}
