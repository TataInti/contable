import { useId, useLayoutEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, SearchSelect } from "@contable/design-system";
import { useClientContext } from "../../context/ClientContext";
import { ApiError, api } from "../../lib/api";
import { ActionDrawer } from "../../ui/ActionDrawer";

const REJECTION_REASONS = [
  { value: "ILLEGIBLE", label: "Ilegible" },
  { value: "DUPLICATE", label: "Duplicado" },
  { value: "NOT_A_VOUCHER", label: "No es un comprobante" },
  { value: "OTHER_CLIENT", label: "Datos de otro cliente" },
  { value: "OTHER", label: "Otro" },
] as const;

/** Qué se rechaza: el documento que falló al procesarse (D23-1 a) o la extracción de la revisión. */
export type ObjetivoRechazo =
  { tipo: "documento" } | { tipo: "extraccion"; extractionId: string | null };

const DESCRIPCION_RECHAZO_EXTRACCION =
  "Elegí el motivo del rechazo. La decisión queda registrada y el documento sale de Para revisar.";
const DESCRIPCION_RECHAZO_DOCUMENTO =
  "Elegí el motivo del rechazo. La decisión queda registrada y el documento no vuelve a procesarse.";

/** Ruta del rechazo según el objetivo; null mientras falte un dato para enviarlo. */
function endpointDeRechazo(
  base: string | null,
  documentId: string | null,
  objetivo: ObjetivoRechazo,
): string | null {
  if (!base || !documentId) return null;
  if (objetivo.tipo === "documento") return `${base}/documents/${documentId}/reject`;
  return objetivo.extractionId ? `${base}/extractions/${objetivo.extractionId}/reject` : null;
}

const AVISO_SIN_RESPUESTA =
  "No sabemos si el rechazo llegó. Actualizamos la bandeja: si el documento sigue fallido, intentá de nuevo.";

/**
 * Aviso del cajón según el tipo de error. Sin respuesta del servidor (espera vencida o red, status 0) no se
 * sabe si el rechazo llegó; con respuesta, se muestra el mensaje y el código que devuelve la API.
 */
function avisoDeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) return AVISO_SIN_RESPUESTA;
  if (error instanceof ApiError) return error.message;
  return "No se pudo rechazar el documento. Volvé a intentarlo.";
}

interface RechazarDocumentoProps {
  isOpen: boolean;
  base: string | null;
  documentId: string | null;
  objetivo: ObjetivoRechazo;
  onClose: () => void;
  onRejected: (documentId: string, reason: string) => void;
}

export function RechazarDocumento({
  isOpen,
  base,
  documentId,
  objetivo,
  onClose,
  onRejected,
}: RechazarDocumentoProps) {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();
  const [rejectionReasonCode, setRejectionReasonCode] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const motivoId = useId();
  const reject = useMutation({
    mutationFn: ({ endpoint, reason }: { documentId: string; endpoint: string; reason: string }) =>
      api.post(endpoint, { reason }),
    onSuccess: (_result, variables) => {
      onRejected(variables.documentId, variables.reason);
      onClose();
    },
    // Con o sin error: la bandeja y el detalle se piden de nuevo, para que el detalle muestre el estado real.
    onSettled: (_result, _error, variables) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] }),
        queryClient.invalidateQueries({
          queryKey: ["document", firmId, clientId, variables.documentId],
        }),
      ]);
    },
  });
  const resetRejection = reject.reset;
  // Cada apertura empieza en blanco: motivo, detalle y aviso de error, como al pulsar «Rechazar».
  useLayoutEffect(() => {
    if (!isOpen) return;
    resetRejection();
    setRejectionReasonCode("");
    setRejectionNote("");
  }, [isOpen, resetRejection]);

  const descripcion =
    objetivo.tipo === "documento" ? DESCRIPCION_RECHAZO_DOCUMENTO : DESCRIPCION_RECHAZO_EXTRACCION;
  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="¿Rechazar este documento?"
      description={descripcion}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          {rejectionReasonCode ? null : (
            <p id={motivoId} className="action-drawer__hint" role="note">
              Elegí un motivo para confirmar el rechazo.
            </p>
          )}
          <Button
            type="submit"
            form="document-rejection-form"
            variant="danger"
            disabled={!rejectionReasonCode}
            aria-busy={reject.isPending || undefined}
            aria-disabled={reject.isPending || undefined}
            aria-describedby={rejectionReasonCode ? undefined : motivoId}
          >
            Confirmar rechazo
          </Button>
        </>
      }
    >
      <form
        id="document-rejection-form"
        onSubmit={(event) => {
          event.preventDefault();
          // Mientras dura la petición no se envía de nuevo; el botón sigue enfocable y marcado como ocupado (D1).
          if (reject.isPending) return;
          const selectedReason = REJECTION_REASONS.find(
            (option) => option.value === rejectionReasonCode,
          );
          const endpoint = endpointDeRechazo(base, documentId, objetivo);
          if (!selectedReason || !documentId || !endpoint) return;
          const reason = [selectedReason.label, rejectionNote.trim()].filter(Boolean).join(" — ");
          reject.mutate({ documentId, endpoint, reason });
        }}
      >
        <div className="ds-field">
          <span className="ds-field__label">Motivo del rechazo</span>
          <SearchSelect
            id="document-rejection-reason"
            label="Motivo del rechazo"
            hideLabel
            className="ctxbar__input"
            value={rejectionReasonCode}
            onChange={(value) => setRejectionReasonCode(value)}
            required
            placeholder="Elegí un motivo"
            options={REJECTION_REASONS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </div>
        <label className="ds-field" htmlFor="document-rejection-note">
          <span className="ds-field__label">Detalle (opcional)</span>
          <textarea
            id="document-rejection-note"
            className="study-textarea"
            rows={3}
            maxLength={450}
            value={rejectionNote}
            onChange={(event) => setRejectionNote(event.target.value)}
            placeholder="Agregá un detalle para facilitar la revisión."
          />
        </label>
        {reject.isPending ? (
          <p className="loading-copy" role="status">
            Rechazando…
          </p>
        ) : null}
        {reject.isError ? (
          <p className="form-error" role="alert">
            {avisoDeError(reject.error)}
          </p>
        ) : null}
      </form>
    </ActionDrawer>
  );
}
