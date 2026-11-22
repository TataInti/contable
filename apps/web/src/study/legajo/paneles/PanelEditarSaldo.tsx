import { useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, MoneyField } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { formatMoney } from "../formato";
import type { CreditLot, EvidenceDocument } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

type FormularioSaldo = {
  reference: string;
  evidenceDocumentId: string;
  originalAmount: string;
  motivo: string;
};

interface PanelEditarSaldoProps {
  editingLot: CreditLot | null;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  editForm: FormularioSaldo;
  setEditForm: Dispatch<SetStateAction<FormularioSaldo>>;
  documentos: EvidenceDocument[] | undefined;
}

/** El importe cambia si se escribe una cifra distinta del monto vigente del saldo. */
function importeCambia(editForm: FormularioSaldo, lot: CreditLot | null): boolean {
  if (!lot || editForm.originalAmount.trim() === "") return false;
  return Number(editForm.originalAmount) !== Number(lot.importeVigente ?? lot.originalAmount);
}

export function PanelEditarSaldo({
  editingLot,
  onCerrar,
  firmId,
  clientId,
  editForm,
  setEditForm,
  documentos,
}: PanelEditarSaldoProps) {
  const queryClient = useQueryClient();
  const [faltaMotivo, setFaltaMotivo] = useState(false);
  const cambiaImporte = importeCambia(editForm, editingLot);
  const editLotMutation = useMutation({
    mutationFn: async () => {
      if (!editingLot) throw new Error("No hay registro seleccionado");
      const base = `/firms/${firmId}/clients/${clientId}/tax-credit-ledger/${editingLot.id}`;
      if (cambiaImporte) {
        // El importe se corrige con un movimiento compensatorio y motivo: queda en el historial del saldo.
        await api.post(`${base}/corrections`, {
          newAmount: editForm.originalAmount,
          reason: editForm.motivo.trim(),
        });
      }
      return api.patch(base, {
        reference: editForm.reference || null,
        evidenceDocumentId: editForm.evidenceDocumentId || null,
      });
    },
    onSuccess: () => {
      onCerrar();
      setFaltaMotivo(false);
      setEditForm({ reference: "", evidenceDocumentId: "", originalAmount: "", motivo: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
      // Un cambio de importe puede devolver el mes a preparación: se refrescan el legajo y la posición.
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["tax-position", firmId, clientId] });
    },
  });
  return (
    <ActionDrawer
      isOpen={editingLot !== null}
      onClose={onCerrar}
      title="Editar saldo"
      description="Actualizá el monto, la referencia o el documento de respaldo del saldo. Cada cambio queda registrado en el historial con usuario y fecha."
      size="wide"
      footer={
        editingLot ? (
          <>
            <Button type="submit" form="legajo-editar-saldo" loading={editLotMutation.isPending}>
              Guardar cambios
            </Button>
            <Button type="button" variant="ghost" onClick={onCerrar}>
              Cancelar
            </Button>
          </>
        ) : undefined
      }
    >
      {editingLot ? (
        <form
          id="legajo-editar-saldo"
          className="study-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (cambiaImporte && editForm.motivo.trim() === "") {
              setFaltaMotivo(true);
              return;
            }
            editLotMutation.mutate();
          }}
        >
          <div className="ds-field">
            <label className="ds-field__label">Saldo</label>
            <p className="muted-copy">
              <strong>{editingLot.kind.replaceAll("_", " ")}</strong> ·{" "}
              {formatMoney(editingLot.importeVigente ?? editingLot.originalAmount)}
            </p>
          </div>
          <MoneyField
            label="Monto vigente"
            id="edit-lot-amount"
            value={editForm.originalAmount}
            onChange={(value) => setEditForm((form) => ({ ...form, originalAmount: value }))}
            placeholder="0,00"
          />
          {cambiaImporte ? (
            <Field
              label="Motivo del cambio de importe"
              id="edit-lot-motivo"
              value={editForm.motivo}
              onChange={(event) => {
                setFaltaMotivo(false);
                setEditForm((form) => ({ ...form, motivo: event.target.value }));
              }}
              placeholder="Por ejemplo: nota de crédito 0001"
              {...(faltaMotivo ? { error: "Escribí el motivo: queda en el historial del saldo" } : {})}
            />
          ) : null}
          <Field
            label="Referencia"
            id="edit-lot-reference"
            value={editForm.reference}
            onChange={(event) =>
              setEditForm((form) => ({ ...form, reference: event.target.value }))
            }
            placeholder="Opcional"
          />
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="edit-lot-evidence">
              Documento de respaldo
            </label>
            <select
              id="edit-lot-evidence"
              className="ds-field__input"
              value={editForm.evidenceDocumentId}
              onChange={(event) =>
                setEditForm((form) => ({ ...form, evidenceDocumentId: event.target.value }))
              }
            >
              <option value="">Sin documento (carga manual)</option>
              {documentos?.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.fileVersions?.[0]?.originalName ?? document.category ?? "Documento"}
                </option>
              ))}
            </select>
          </div>
          <WorkpaperActionError error={editLotMutation.error} />
        </form>
      ) : null}
    </ActionDrawer>
  );
}
