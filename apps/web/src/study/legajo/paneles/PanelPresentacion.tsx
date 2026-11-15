import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, getStatusBadgeMeta, MoneyField, useNotify } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
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
        if (!filingReceipt) throw new Error("Adjuntá el acuse de presentación.");
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
      notify.success("Presentación registrada con su acuse.");
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
  // Motivo visible junto al botón deshabilitado (P1).
  const motivoRegistrar = !posicion.settlement
    ? "Falta la liquidación finalizada del período."
    : !filingForm.amountFiled
      ? "Indicá el importe presentado."
      : !filingForm.evidenceDocumentId && !filingReceipt
        ? "Adjuntá el acuse de presentación."
        : null;
  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title={`Registrar presentación · ${posicion.regime.taxType.name}`}
      description="Cargá los datos de la presentación y adjuntá el acuse que emite el organismo."
      size="wide"
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="legajo-presentacion"
              loading={recordFilingMutation.isPending}
              loadingLabel="Subiendo y validando el acuse"
              disabled={motivoRegistrar !== null}
            >
              Registrar presentación
            </Button>
          }
          hint={motivoRegistrar}
          onCancel={onCerrar}
        />
      }
    >
      <form
        id="legajo-presentacion"
        className="study-form study-form--presentacion"
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
        <div className="ds-field study-form__full">
          <label className="ds-field__label" htmlFor="tax-filing-evidence">
            Acuse de presentación
          </label>
          <select
            id="tax-filing-evidence"
            className="ds-field__input"
            value={filingForm.evidenceDocumentId}
            onChange={(event) =>
              setFilingForm({ ...filingForm, evidenceDocumentId: event.target.value })
            }
          >
            <option value="">Subir un acuse nuevo</option>
            {filingReceiptDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileVersions?.[0]?.originalName ?? "Acuse"} ·{" "}
                {getStatusBadgeMeta(document.status).label}
              </option>
            ))}
          </select>
          <small className="ds-field__hint">
            Es el comprobante que emite el organismo. Sin acuse la presentación no queda registrada.
          </small>
        </div>
        {!filingForm.evidenceDocumentId ? (
          <div className="study-form__full">
            <Field
              label="Archivo del acuse"
              id="tax-filing-receipt"
              type="file"
              accept={RECEIPT_ACCEPT}
              hint="PDF o imagen."
              required
              onChange={(event) => setFilingReceipt(event.target.files?.[0] ?? null)}
            />
          </div>
        ) : null}
        <Field
          label="Identificador externo (opcional)"
          id="tax-filing-external-id"
          value={filingForm.externalId}
          onChange={(event) => setFilingForm({ ...filingForm, externalId: event.target.value })}
        />
        <WorkpaperActionError error={recordFilingMutation.error} />
      </form>
    </ActionDrawer>
  );
}
