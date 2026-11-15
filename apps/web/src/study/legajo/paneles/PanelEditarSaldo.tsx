import type { Dispatch, SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { formatMoney } from "../formato";
import type { CreditLot, EvidenceDocument } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

type FormularioSaldo = { reference: string; evidenceDocumentId: string; originalAmount: string };

interface PanelEditarSaldoProps {
  editingLot: CreditLot | null;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  editForm: FormularioSaldo;
  setEditForm: Dispatch<SetStateAction<FormularioSaldo>>;
  documentos: EvidenceDocument[] | undefined;
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
  const editLotMutation = useMutation({
    mutationFn: () => {
      if (!editingLot) throw new Error("No hay registro seleccionado");
      const payload: Record<string, unknown> = {
        reference: editForm.reference || null,
        evidenceDocumentId: editForm.evidenceDocumentId || null,
      };
      if (editForm.originalAmount) {
        payload.originalAmount = editForm.originalAmount;
      }
      return api.patch(
        `/firms/${firmId}/clients/${clientId}/tax-credit-ledger/${editingLot.id}`,
        payload,
      );
    },
    onSuccess: () => {
      onCerrar();
      setEditForm({ reference: "", evidenceDocumentId: "", originalAmount: "" });
      void queryClient.invalidateQueries({ queryKey: ["tax-credit-ledger", firmId, clientId] });
    },
  });
  return (
      <ActionDrawer
        isOpen={editingLot !== null}
        onClose={onCerrar}
        title="Editar saldo"
        description="Actualizá el monto, la referencia o el documento de respaldo del saldo. Cada cambio queda registrado en el log con usuario y fecha."
        size="wide"
      >
        {editingLot ? (
          <form
            className="opening-credit-form"
            onSubmit={(event) => {
              event.preventDefault();
              editLotMutation.mutate();
            }}
          >
            <div className="ds-field">
              <label className="ds-field__label">Saldo</label>
              <p className="muted-copy">
                <strong>{editingLot.kind.replaceAll("_", " ")}</strong> ·{" "}
                {formatMoney(editingLot.originalAmount)}
              </p>
            </div>
            <Field
              label="Monto original"
              id="edit-lot-amount"
              type="number"
              step="0.01"
              value={editForm.originalAmount}
              onChange={(event) =>
                setEditForm((form) => ({ ...form, originalAmount: event.target.value }))
              }
              placeholder="0,00"
            />
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
            <div className="opening-credit-form__actions">
              <Button type="submit" loading={editLotMutation.isPending}>
                Guardar cambios
              </Button>
              <Button type="button" variant="ghost" onClick={onCerrar}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </ActionDrawer>
  );
}
