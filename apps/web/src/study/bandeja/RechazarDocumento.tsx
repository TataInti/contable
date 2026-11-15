import { useLayoutEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
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

interface RechazarDocumentoProps {
  isOpen: boolean;
  base: string | null;
  documentId: string | null;
  extractionId: string | null;
  onClose: () => void;
  onRejected: (documentId: string, reason: string) => void;
}

export function RechazarDocumento({
  isOpen,
  base,
  documentId,
  extractionId,
  onClose,
  onRejected,
}: RechazarDocumentoProps) {
  const { firmId, clientId } = useClientContext();
  const queryClient = useQueryClient();
  const [rejectionReasonCode, setRejectionReasonCode] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const reject = useMutation({
    mutationFn: ({
      extractionId,
      reason,
    }: {
      documentId: string;
      extractionId: string;
      reason: string;
    }) => api.post(`${base}/extractions/${extractionId}/reject`, { reason }),
    onSuccess: (_result, variables) => {
      onRejected(variables.documentId, variables.reason);
      onClose();
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

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="¿Rechazar este documento?"
      description="Elegí el motivo del rechazo. La decisión queda registrada y el documento sale de Para revisar."
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="document-rejection-form"
            variant="danger"
            loading={reject.isPending}
            disabled={!rejectionReasonCode || reject.isPending}
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
          const selectedReason = REJECTION_REASONS.find(
            (option) => option.value === rejectionReasonCode,
          );
          if (!selectedReason || !documentId || !extractionId) return;
          const reason = [selectedReason.label, rejectionNote.trim()].filter(Boolean).join(" — ");
          reject.mutate({
            documentId,
            extractionId,
            reason,
          });
        }}
      >
        <label className="ds-field" htmlFor="document-rejection-reason">
          <span className="ds-field__label">Motivo del rechazo</span>
          <select
            id="document-rejection-reason"
            className="ctxbar__input"
            value={rejectionReasonCode}
            onChange={(event) => setRejectionReasonCode(event.target.value)}
            required
          >
            <option value="">Elegí un motivo</option>
            {REJECTION_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
        {reject.isError ? (
          <p className="form-error" role="alert">
            {reject.error instanceof ApiError
              ? reject.error.message
              : "No se pudo rechazar el documento. Volvé a intentarlo."}
          </p>
        ) : null}
      </form>
    </ActionDrawer>
  );
}
