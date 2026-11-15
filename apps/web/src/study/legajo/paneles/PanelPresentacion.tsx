import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, getStatusBadgeMeta, MoneyField, useNotify } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { RECEIPT_ACCEPT, uploadFilingReceipt, waitForReceiptReady } from "../../filingReceipt";
import type { EvidenceDocument, TaxPosition } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

interface PanelPresentacionProps {
  posicion: TaxPosition;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  documentos: EvidenceDocument[] | undefined;
}

// Se monta al abrir el cajón desde la tabla de cálculo: el estado arranca con la posición elegida.
export function PanelPresentacion({
  posicion,
  onCerrar,
  firmId,
  clientId,
  documentos,
}: PanelPresentacionProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [filingForm, setFilingForm] = useState({
    amountFiled: posicion.accrued,
    filedAt: new Date().toISOString().slice(0, 10),
    externalId: "",
    evidenceDocumentId: "",
  });
  const [filingReceipt, setFilingReceipt] = useState<File | null>(null);
  const recordFilingMutation = useMutation({
    mutationFn: async () => {
      const base = `/firms/${firmId}/clients/${clientId}`;
      // La constancia es obligatoria: se elige una ya subida o se sube en este mismo paso.
      let evidenceDocumentId = filingForm.evidenceDocumentId;
      if (!evidenceDocumentId) {
        if (!filingReceipt) throw new Error("Adjuntá la constancia de presentación.");
        evidenceDocumentId = await uploadFilingReceipt(base, filingReceipt);
        setFilingForm((form) => ({ ...form, evidenceDocumentId }));
        setFilingReceipt(null);
        await queryClient.invalidateQueries({ queryKey: ["documents", firmId, clientId] });
        await waitForReceiptReady(base, evidenceDocumentId);
      }
      return api.post(`${base}/tax-obligations/${posicion.obligationId}/filings`, {
        settlementId: posicion.settlement?.id,
        filedAt: filingForm.filedAt,
        amountFiled: filingForm.amountFiled,
        ...(filingForm.externalId.trim() ? { externalId: filingForm.externalId.trim() } : {}),
        evidenceDocumentId,
      });
    },
    onSuccess: () => {
      notify.success("Presentación registrada con su constancia.");
      setFilingReceipt(null);
      onCerrar();
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });
  // Constancias ya subidas (por el estudio o por el cliente desde el portal) y listas para usar.
  const filingReceiptDocuments = (documentos ?? []).filter(
    (document) => document.category === "ACUSE" && ["READY", "APPLIED"].includes(document.status),
  );
  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title={`Registrar presentación · ${posicion.regime.taxType.name}`}
      description="Cargá los datos de la presentación y adjuntá la constancia que emite el organismo."
      size="wide"
    >
      <form
        className="study-form study-form--compact fiscal-action-form"
        onSubmit={(event) => {
          event.preventDefault();
          recordFilingMutation.mutate();
        }}
      >
        <MoneyField
          label="Importe presentado"
          id="tax-filing-amount"
          value={filingForm.amountFiled}
          onChange={(value) => setFilingForm({ ...filingForm, amountFiled: value })}
          required
        />
        <Field
          label="Fecha de presentación"
          id="tax-filing-date"
          type="date"
          value={filingForm.filedAt}
          onChange={(event) => setFilingForm({ ...filingForm, filedAt: event.target.value })}
          required
        />
        <Field
          label="Identificador externo"
          id="tax-filing-external-id"
          value={filingForm.externalId}
          onChange={(event) => setFilingForm({ ...filingForm, externalId: event.target.value })}
          placeholder="Opcional"
        />
        <div className="ds-field fiscal-action-form__wide">
          <label className="ds-field__label" htmlFor="tax-filing-evidence">
            Constancia de presentación
          </label>
          <select
            id="tax-filing-evidence"
            className="ds-field__input"
            value={filingForm.evidenceDocumentId}
            onChange={(event) =>
              setFilingForm({ ...filingForm, evidenceDocumentId: event.target.value })
            }
          >
            <option value="">Subir una constancia nueva</option>
            {filingReceiptDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileVersions?.[0]?.originalName ?? "Constancia"} ·{" "}
                {getStatusBadgeMeta(document.status).label}
              </option>
            ))}
          </select>
          <small className="ds-field__hint">
            Es el comprobante que emite el organismo. Sin constancia la presentación no queda
            registrada.
          </small>
        </div>
        {!filingForm.evidenceDocumentId ? (
          <div className="ds-field fiscal-action-form__wide">
            <label className="ds-field__label" htmlFor="tax-filing-receipt">
              Archivo de la constancia
            </label>
            <input
              id="tax-filing-receipt"
              className="ds-field__input"
              type="file"
              accept={RECEIPT_ACCEPT}
              required
              onChange={(event) => setFilingReceipt(event.target.files?.[0] ?? null)}
            />
            <small className="ds-field__hint">PDF o imagen.</small>
          </div>
        ) : null}
        <div className="study-form__actions">
          <Button
            type="submit"
            loading={recordFilingMutation.isPending}
            loadingLabel="Subiendo y validando la constancia"
            disabled={
              !posicion.settlement ||
              !filingForm.amountFiled ||
              (!filingForm.evidenceDocumentId && !filingReceipt)
            }
          >
            Registrar presentación
          </Button>
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
        </div>
        <WorkpaperActionError error={recordFilingMutation.error} />
      </form>
    </ActionDrawer>
  );
}
